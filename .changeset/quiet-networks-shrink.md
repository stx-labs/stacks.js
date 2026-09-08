---
"@stacks/network": patch
"@stacks/auth": patch
---

Remove unused `cross-fetch` dependency from `@stacks/network` and `@stacks/auth`. Neither package has imported it since v7; network calls rely on the global `fetch` via `@stacks/common`.
