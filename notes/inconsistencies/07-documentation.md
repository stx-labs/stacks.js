# Documentation & Comment Inconsistencies

## 1. README Files

### Missing entirely
- `packages/internal/` — no README
- `packages/sbtc/` — no README (if this package exists)

### Placeholder/stub content
- `packages/api/README.md` — 15 lines, mostly "todo: one-liner" and "## Todo"
- `packages/common/README.md` — 9 lines, minimal

### Well-documented
- `packages/stacking/README.md` — 845 lines (most comprehensive)
- `packages/cli/README.md` — 662 lines
- `packages/transactions/README.md` — 514 lines
- `packages/bns/README.md` — 321 lines
- `packages/wallet-sdk/README.md` — 229 lines
- `packages/auth/README.md` — 104 lines

No consistent structure or template across READMEs.

---

## 2. CHANGELOG Files

All packages have `CHANGELOG.md` except `sbtc` (if present). Consistent formatting.

---

## 3. Per-Package LICENSE Files

**No package has its own LICENSE file.** Only the monorepo root has one. Standard practice for published npm packages is to include a LICENSE per package so it ships with the tarball.

---

## 4. JSDoc Coverage

**Good coverage**: auth, transactions, storage, wallet-sdk
**Minimal/none**: api, common, encryption, network, cli, internal, bns

Wide variance — no established minimum for exported functions.

---

## 5. Deprecation Patterns

- **Only** JSDoc `@deprecated` tags are used (21 files)
- **No** runtime `console.warn()` deprecation notices anywhere
- Deprecations are invisible unless reading source or using TypeScript tooling

---

## 6. TODO Comments (62 instances)

### Potentially stale
- `profile/src/profile.ts:17` — `// TODO: bring into this monorepo/convert to ts`
- `auth/src/userSession.ts:240` — `// TODO: real version handling`
- `auth/src/userSession.ts:385` — `// TODO: this is not used?`
- `auth/src/sessionStore.ts:21` — `// TODO: fix, not used?`
- `cli/src/keys.ts:1` — `// TODO: most of this code should be in blockstack.js` (references old repo name)
- `transactions/src/wire/serialization.ts:476` — `// TODO: implement` (unimplemented feature)

### Literal TODO strings in code values
- `cli/src/keys.ts:257-258` — Literal string `'TODO'` used as placeholder values

### No consistent format
- Some have descriptions, others are bare `// TODO`
- No ownership markers (e.g., `// TODO(owner): ...`)
- No tracking mechanism
