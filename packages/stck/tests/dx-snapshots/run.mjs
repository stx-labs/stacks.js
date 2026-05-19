#!/usr/bin/env node
// DX snapshot harness — runs ts.createLanguageService against each fixture
// and emits a markdown report per approach showing hover, completions, and
// diagnostics at every cursor probe.
//
// Cursor marker syntax (twoslash-style):
//   //   ^?    hover (quickInfo) at column of `^`
//   //   ^|    completions at column of `^`
//   //   ^!    signature help at column of `^`
//
// The `^` is positioned in a comment on the line BELOW the code line it probes,
// aligned to the column you want to query. Optional trailing label after the
// marker is used as a human-readable name in the output:
//   //   ^? — hover on counter

import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '../..');
const repoRoot = path.resolve(pkgRoot, '../..');
const fixturesDir = path.join(here, 'fixtures');
const outputDir = path.join(here, 'output');

fs.mkdirSync(outputDir, { recursive: true });

// Build a single language service spanning the package, so fixtures can import
// from src/.
const tsconfigPath = path.join(pkgRoot, 'tsconfig.json');
const tsconfigText = fs.readFileSync(tsconfigPath, 'utf8');
const parsed = ts.parseConfigFileTextToJson(tsconfigPath, tsconfigText);
if (parsed.error) throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'));
const config = ts.parseJsonConfigFileContent(parsed.config, ts.sys, pkgRoot);

const fixtureFiles = fs
  .readdirSync(fixturesDir)
  .filter(f => f.endsWith('.ts'))
  .map(f => path.join(fixturesDir, f));

const rootNames = Array.from(new Set([...config.fileNames, ...fixtureFiles]));

const host = {
  getScriptFileNames: () => rootNames,
  getScriptVersion: () => '1',
  getScriptSnapshot: (fileName) => {
    if (!fs.existsSync(fileName)) return undefined;
    return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf8'));
  },
  getCurrentDirectory: () => pkgRoot,
  getCompilationSettings: () => config.options,
  getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
  resolveModuleNames: (moduleNames, containingFile) => {
    return moduleNames.map(name => {
      const r = ts.resolveModuleName(name, containingFile, config.options, ts.sys);
      return r.resolvedModule;
    });
  },
};

const service = ts.createLanguageService(host, ts.createDocumentRegistry());

function extractProbes(source, fileName) {
  const lines = source.split('\n');
  const probes = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)\/\/(\s*)(\^[?|!])(.*)$/);
    if (!m) continue;
    const [, leading, gap, marker, label] = m;
    // Column of the ^ within the marker line:
    const caretCol = leading.length + 2 + gap.length;
    // Probed line is the previous code line:
    let probeLine = i - 1;
    while (probeLine >= 0 && /^\s*\/\//.test(lines[probeLine])) probeLine--;
    if (probeLine < 0) continue;
    // Position in source:
    const pos = lines.slice(0, probeLine).reduce((acc, l) => acc + l.length + 1, 0) + caretCol;
    probes.push({
      kind: marker[1], // '?' | '|' | '!'
      label: label.trim().replace(/^[—-]\s*/, '') || `probe-${probes.length + 1}`,
      line: probeLine + 1,
      col: caretCol + 1,
      pos,
      codeLine: lines[probeLine],
    });
  }
  return probes;
}

function renderQuickInfo(qi) {
  if (!qi) return '_(no hover info)_';
  const displayParts = (qi.displayParts || []).map(p => p.text).join('');
  const docs = (qi.documentation || []).map(p => p.text).join('');
  return [
    '```ts',
    displayParts.trim(),
    '```',
    docs ? '\n' + docs : '',
  ].filter(Boolean).join('\n');
}

function renderCompletions(comp, codeLine, probeCol) {
  if (!comp || !comp.entries.length) return '_(no completions)_';
  // Heuristic: filter to "own" members of the receiver if we're right after a `.`
  const isAfterDot = /\.\s*$/.test(codeLine.slice(0, probeCol - 1));
  let entries = comp.entries;
  if (isAfterDot) {
    // Hide standard Object/Function members that pollute the list
    const noisy = new Set([
      'constructor', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
      'toLocaleString', 'toString', 'valueOf', '__defineGetter__', '__defineSetter__',
      '__lookupGetter__', '__lookupSetter__', '__proto__',
      'apply', 'bind', 'call', 'caller', 'arguments', 'name', 'length',
      'prototype',
    ]);
    entries = entries.filter(e => !noisy.has(e.name));
  }
  // Sort by sortText (TS server's preferred ordering)
  entries = entries.slice().sort((a, b) => (a.sortText || '').localeCompare(b.sortText || ''));
  const top = entries.slice(0, 25);
  const list = top.map(e => {
    const kind = e.kind;
    return `- \`${e.name}\` _(${kind})_`;
  }).join('\n');
  const more = entries.length > top.length ? `\n_…${entries.length - top.length} more_` : '';
  return list + more;
}

function renderSignatureHelp(sh) {
  if (!sh || !sh.items.length) return '_(no signature help)_';
  return sh.items.map((item, i) => {
    const params = item.parameters.map(p => p.displayParts.map(d => d.text).join('')).join(', ');
    const prefix = item.prefixDisplayParts.map(d => d.text).join('');
    const suffix = item.suffixDisplayParts.map(d => d.text).join('');
    const cur = sh.argumentIndex;
    return '```ts\n' + prefix + params + suffix + '\n```\n' +
      `_(arg ${cur + 1}/${item.parameters.length}${i === sh.selectedItemIndex ? ', selected' : ''})_`;
  }).join('\n\n');
}

function renderDiagnostics(fileName) {
  const sem = service.getSemanticDiagnostics(fileName);
  const syn = service.getSyntacticDiagnostics(fileName);
  // Filter "is declared but never read" (TS6133) and unused-parameter (TS6196) —
  // they're fixture-level noise, not DX signal.
  const noise = new Set([6133, 6196, 7027]);
  const all = [...syn, ...sem].filter(d => !noise.has(d.code));
  if (!all.length) return '_None._';
  const source = fs.readFileSync(fileName, 'utf8');
  return all.map(d => {
    const { line, character } = ts.getLineAndCharacterOfPosition(d.file, d.start);
    const endPos = d.start + (d.length ?? 0);
    const end = ts.getLineAndCharacterOfPosition(d.file, endPos);
    const fileText = d.file.text;
    const underlined = fileText.slice(d.start, endPos);
    // For a one-line span, show the underline preview inline; for multi-line, summarise.
    const spanLabel = line === end.line
      ? `L${line + 1}:${character + 1}-${end.character + 1} _(${d.length} chars)_`
      : `L${line + 1}:${character + 1}–L${end.line + 1}:${end.character + 1}`;
    const preview = underlined.length > 200
      ? underlined.slice(0, 100) + ` … ` + underlined.slice(-80)
      : underlined;
    const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n  ');
    return `- **${spanLabel}** TS${d.code}: ${msg}\n  underline: \`${preview.replace(/\n/g, ' ⏎ ').replace(/`/g, '\\`')}\``;
  }).join('\n');
}

function processFixture(fixturePath) {
  const source = fs.readFileSync(fixturePath, 'utf8');
  const probes = extractProbes(source, fixturePath);
  const baseName = path.basename(fixturePath, '.ts');

  const out = [];
  out.push(`# DX snapshot — \`${baseName}\``);
  out.push('');
  out.push('_Generated from `' + path.relative(pkgRoot, fixturePath) + '` by `tests/dx-snapshots/run.mjs`. Captures hover (`^?`), completions (`^|`), and signature help (`^!`) at the marked cursor positions — i.e. what the LSP would show a user at each point._');
  out.push('');
  out.push('## Fixture');
  out.push('');
  out.push('```ts');
  out.push(source.trimEnd());
  out.push('```');
  out.push('');

  for (const probe of probes) {
    out.push(`## ${probe.label}`);
    out.push('');
    out.push(`Line ${probe.line}, col ${probe.col} — \`${probe.codeLine.trim()}\``);
    out.push('');
    if (probe.kind === '?') {
      const qi = service.getQuickInfoAtPosition(fixturePath, probe.pos);
      out.push('**Hover:**');
      out.push('');
      out.push(renderQuickInfo(qi));
    } else if (probe.kind === '|') {
      const comp = service.getCompletionsAtPosition(fixturePath, probe.pos, {
        includeCompletionsForModuleExports: false,
        triggerKind: ts.CompletionTriggerKind.Invoked,
      });
      out.push('**Completions:**');
      out.push('');
      out.push(renderCompletions(comp, probe.codeLine, probe.col));
    } else if (probe.kind === '!') {
      const sh = service.getSignatureHelpItems(fixturePath, probe.pos, {});
      out.push('**Signature help:**');
      out.push('');
      out.push(renderSignatureHelp(sh));
    }
    out.push('');
  }

  out.push('## Diagnostics');
  out.push('');
  out.push(renderDiagnostics(fixturePath));
  out.push('');

  const outPath = path.join(outputDir, `${baseName}.md`);
  fs.writeFileSync(outPath, out.join('\n'));
  console.log(`wrote ${path.relative(pkgRoot, outPath)} (${probes.length} probes)`);
}

for (const fixture of fixtureFiles) {
  try {
    processFixture(fixture);
  } catch (e) {
    console.error(`FAILED ${fixture}:`, e.message);
    if (process.env.DX_VERBOSE) console.error(e.stack);
  }
}
