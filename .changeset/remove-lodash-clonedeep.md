---
'@stacks/transactions': patch
---

Remove `lodash.clonedeep` dependency in favor of native `structuredClone`; fixes ESM bundling error "default is not exported by lodash.clonedeep" (#1782). Requires Node.js 17+ or a browser with `structuredClone`.
