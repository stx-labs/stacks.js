# `@stacks/stck` — DX examples

Each file in this directory is a **smoke-test showcase** of one prototype approach's call-site developer experience. They are intentionally redundant with each other: same scenario (counter contract — `add(5)`, `increment()`, `getCount()`), different APIs, so they can be read side-by-side.

| Approach | File | Idea | One-line DX |
|---|---|---|---|
| A | [approach-a.md](./approach-a.md) | Bundled value + phantom brand | `await counter.makeUnsignedContractCall("add", [5])` |
| B | [approach-b.md](./approach-b.md) | ABI-as-const, conditional types | `await counter.makeUnsignedContractCall("add", [5])` (kebab keys) |
| C | [approach-c.md](./approach-c.md) | Proxy direct method dispatch | `await counter.add(5n)` |
| D | [approach-d.md](./approach-d.md) | Branded principal, non-breaking | `await makeUnsignedContractCall({ ...typedCall(counter, "add", [5]), publicKey })` |
| E | [approach-e.md](./approach-e.md) | Branded principal, standalone | `await call(counter, "add", { n: 5n }, { publicKey })` or `await c.add({ n: 5n })` |
| F | [approach-f.md](./approach-f.md) | openapi-fetch `createClient<Contracts>()` | `await stx.makeUnsignedContractCall({ contract, functionName: "add", functionArgs: [Cl.uint(5)] })` |
| G | [approach-g.md](./approach-g.md) | Type-only branded principal (E with no runtime ABI) | `await call(counter, "add", [Cl.uint(5)], { publicKey })` |
| H | [approach-h.md](./approach-h.md) | Same-name typed re-exports of `@stacks/transactions` — brand on `contractAddress` | `await makeUnsignedContractCall({ contractAddress: counterAddress("ST1..."), contractName: "counter", functionName: "add", functionArgs: [Cl.uint(5)], publicKey })` |

## Companion: LSP-accurate DX snapshots

For each approach there is also a generated **DX snapshot** that captures what the TypeScript language service actually shows for hover, autocomplete, and diagnostics at key cursor positions. See:

- [`../tests/dx-snapshots/output/`](../tests/dx-snapshots/output/) — one `approach-X.md` per approach
- [`../tests/dx-snapshots/COMPARISON.md`](../tests/dx-snapshots/COMPARISON.md) — same probes across all approaches side-by-side
- [`../tests/dx-snapshots/run.mjs`](../tests/dx-snapshots/run.mjs) — the harness (`node tests/dx-snapshots/run.mjs` regenerates)

The files in *this* directory are **handwritten** — they show the idealised call site. The snapshot files in `tests/dx-snapshots/output/` are **machine-generated** — they show what the user actually sees in their editor.

## Original reports

Each approach also has a `src/approach-X/REPORT.md` (for C/D/E/F) covering the design decisions and remaining uncertainties from the subagent that prototyped it.
