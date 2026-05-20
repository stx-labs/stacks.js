import { Cl, ClarityValue, ListCV, TupleCV } from '..';

// COMBINATOR TYPES
type Combinator = (str: string) => ParseResult;

type ParseResult = ParseSuccess | ParseFail;

type Capture = ClarityValue | string;

interface ParseSuccess {
  success: true;
  value: string;
  rest: string;
  capture?: Capture;
}

interface ParseFail {
  success: false;
}

// GENERAL COMBINATORS
function regex(pattern: RegExp, map?: (value: string) => ClarityValue): Combinator {
  return (s: string) => {
    const match = s.match(pattern);
    if (!match || match.index !== 0) return { success: false };
    return {
      success: true,
      value: match[0],
      rest: s.substring(match[0].length),
      capture: map ? map(match[0]) : undefined,
    };
  };
}

function whitespace(): Combinator {
  return regex(/\s+/);
}

function lazy(c: () => Combinator): Combinator {
  return (s: string) => c()(s);
}

function either(combinators: Combinator[]): Combinator {
  return (s: string) => {
    for (const c of combinators) {
      const result = c(s);
      if (result.success) return result;
    }
    return { success: false };
  };
}

function entire(combinator: Combinator): Combinator {
  return (s: string) => {
    const result = combinator(s);
    if (!result.success || result.rest) return { success: false };
    return result;
  };
}

function optional(c: Combinator): Combinator {
  return (s: string) => {
    const result = c(s);
    if (result.success) return result;
    return {
      success: true,
      value: '',
      rest: s,
    };
  };
}

function sequence(
  combinators: Combinator[],
  reduce: (values: Capture[]) => Capture = v => v[0]
): Combinator {
  return (s: string) => {
    let rest = s;
    let value = '';
    const captures: Capture[] = [];

    for (const c of combinators) {
      const result = c(rest);
      if (!result.success) return { success: false };

      rest = result.rest;
      value += result.value;
      if (result.capture) captures.push(result.capture);
    }

    return {
      success: true,
      value,
      rest,
      capture: reduce(captures),
    };
  };
}

function chain(
  combinators: Combinator[],
  reduce: (values: Capture[]) => Capture = v => v[0]
): Combinator {
  const joined = combinators.flatMap((combinator, index) =>
    index === 0 ? [combinator] : [optional(whitespace()), combinator]
  );
  return sequence(joined, reduce);
}

function parens(combinator: Combinator): Combinator {
  return chain([regex(/\(/), combinator, regex(/\)/)]);
}

function greedy(
  min: number,
  combinator: Combinator,
  reduce: (values: Capture[]) => Capture = v => v[v.length - 1],
  separator?: Combinator
): Combinator {
  return (s: string) => {
    let rest = s;
    let value = '';
    const captures: Capture[] = [];

    let count;
    for (count = 0; ; count++) {
      const result = combinator(rest);
      if (!result.success) break;
      rest = result.rest;
      value += result.value;
      if (result.capture) captures.push(result.capture);

      if (separator) {
        const sepResult = separator(rest);
        if (!sepResult.success) {
          count++; // count as matched but no trailing separator
          break;
        }
        rest = sepResult.rest;
        value += sepResult.value;
      }
    }

    if (count < min) return { success: false };
    return {
      success: true,
      value,
      rest,
      capture: reduce(captures),
    };
  };
}

function capture(combinator: Combinator, map?: (value: string) => Capture): Combinator {
  return (s: string) => {
    const result = combinator(s);
    if (!result.success) return { success: false };
    return {
      success: true,
      value: result.value,
      rest: result.rest,
      capture: map ? map(result.value) : result.value,
    };
  };
}

// CLARITY VALUE PARSERS
function clInt(): Combinator {
  return capture(regex(/-?[0-9]+/), v => Cl.int(parseInt(v)));
}

function clUint(): Combinator {
  return sequence([regex(/u/), capture(regex(/[0-9]+/), v => Cl.uint(parseInt(v)))]);
}

function clBool(): Combinator {
  return capture(regex(/true|false/), v => Cl.bool(v === 'true'));
}

function clPrincipal(): Combinator {
  return sequence([
    regex(/'/),
    capture(
      sequence([regex(/[A-Z0-9]+/), optional(sequence([regex(/\./), regex(/[a-zA-Z0-9-]+/)]))]),
      Cl.address
    ),
  ]);
}

function clBuffer(): Combinator {
  return sequence([regex(/0x/), capture(regex(/[0-9a-fA-F]+/), Cl.bufferFromHex)]);
}

/** @ignore helper for string values, removes escaping and unescapes special characters */
function unescape(input: string): string {
  // To correctly unescape sequences like \n, \t, \", \\, \uXXXX, etc.,
  // we can leverage JSON.parse by wrapping the input string in double quotes.
  // This ensures that all standard JSON escape sequences are handled according
  // to the JSON specification, aligning with the test cases provided.
  try {
    return JSON.parse(`"${input}"`);
  } catch (error) {
    throw new Error(
      `Failed to unescape string: "${input}" ${error instanceof Error ? error.message : error}`
    );
  }
}

function clAscii(): Combinator {
  return sequence([
    regex(/"/),
    capture(regex(/(\\.|[^"])*/), t => Cl.stringAscii(unescape(t))),
    regex(/"/),
  ]);
}

function clUtf8(): Combinator {
  return sequence([
    regex(/u"/),
    capture(regex(/(\\.|[^"])*/), t => Cl.stringUtf8(unescape(t))),
    regex(/"/),
  ]);
}

function clList(): Combinator {
  return parens(
    sequence([
      regex(/list/),
      greedy(0, sequence([whitespace(), clValue()]), c => Cl.list(c as ClarityValue[])),
    ])
  );
}

function clTuple(): Combinator {
  const tupleCurly = chain([
    regex(/\{/),
    greedy(
      1,
      // entries
      sequence(
        [
          capture(regex(/[a-zA-Z][a-zA-Z0-9_]*/)), // key
          regex(/\s*:/),
          whitespace(), // todo: can this be optional?
          clValue(), // value
        ],
        ([k, v]) => Cl.tuple({ [k as string]: v as ClarityValue })
      ),
      c => Cl.tuple(Object.assign({}, ...c.map(t => (t as TupleCV).value))),
      regex(/\s*,\s*/)
    ),
    regex(/\}/),
  ]);
  const tupleFunction = parens(
    sequence([
      optional(whitespace()),
      regex(/tuple/),
      whitespace(),
      greedy(
        1,
        parens(
          // entries
          sequence(
            [
              optional(whitespace()),
              capture(regex(/[a-zA-Z][a-zA-Z0-9_]*/)), // key
              whitespace(),
              clValue(), // value
              optional(whitespace()),
            ],
            ([k, v]) => Cl.tuple({ [k as string]: v as ClarityValue })
          )
        ),
        c => Cl.tuple(Object.assign({}, ...c.map(t => (t as TupleCV).value))),
        whitespace()
      ),
    ])
  );
  return either([tupleCurly, tupleFunction]);
}

function clNone(): Combinator {
  return capture(regex(/none/), Cl.none);
}

function clSome(): Combinator {
  return parens(
    sequence([regex(/some/), whitespace(), clValue()], c => Cl.some(c[0] as ClarityValue))
  );
}

function clOk(): Combinator {
  return parens(sequence([regex(/ok/), whitespace(), clValue()], c => Cl.ok(c[0] as ClarityValue)));
}

function clErr(): Combinator {
  return parens(
    sequence([regex(/err/), whitespace(), clValue()], c => Cl.error(c[0] as ClarityValue))
  );
}

function clValue(map: (combinator: Combinator) => Combinator = v => v) {
  return either(
    [
      clBuffer,
      clAscii,
      clUtf8,
      clInt,
      clUint,
      clBool,
      clPrincipal,
      clList,
      clTuple,
      clNone,
      clSome,
      clOk,
      clErr,
    ]
      .map(lazy)
      .map(map)
  );
}

/**
 * Parse a piece of string text as Clarity value syntax.
 * Supports all Clarity value types (primitives, sequences, composite types).
 *
 * @example
 * ```
 * const repr = Cl.parse("u4");
 * const repr = Cl.parse(`"hello"`);
 * const repr = Cl.parse('(tuple (a 1) (b 2))');
 * ```
 */
export function parse(clarityValueString: string): ClarityValue {
  const result = clValue(entire)(clarityValueString);
  if (!result.success || !result.capture) throw 'Parse error'; // todo: we can add better error messages and add position tracking
  return result.capture as ClarityValue;
}

/** @ignore Meant for internal use by other Stacks.js packages. Not stable. */
export function internal_parseCommaSeparated(clarityValueString: string): ClarityValue[] {
  const combinator = entire(
    greedy(1, clValue(), c => Cl.list(c as ClarityValue[]), regex(/\s*,\s*/))
  );
  const result = combinator(clarityValueString);
  if (!result.success || !result.capture)
    throw `Error trying to parse string: ${clarityValueString}`;
  return (result.capture as ListCV<ClarityValue>).value;
}
