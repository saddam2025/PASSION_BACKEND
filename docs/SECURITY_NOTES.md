# Dependency security close-out (BE-3)

## Audit counts

All counts below are from `npm audit` / `npm audit --omit=dev`, including moderate findings in the totals.

| Run | Full tree (moderate / high / critical) | Production (moderate / high / critical) | Dev-only (moderate / high / critical) |
| --- | --- | --- | --- |
| Before remediation | 18 / 6 / 2 (26 total) | 1 / 5 / 0 (6 total) | 17 / 1 / 2 (20 total) |
| After remediation | 14 / 1 / 0 (15 total) | 0 / 1 / 0 (1 total) | 14 / 0 / 0 (14 total) |

### High and critical findings before remediation

- `body-parser` (high, production), `path-to-regexp` (high, production), and `qs` (moderate, production): pulled by direct dependency `express@4.21.2`. Updated Express to `4.22.3`, which resolves these transitive advisories.
- `mongoose@8.9.5` (high, production; two advisories): direct dependency. Updated to `8.24.7` within major 8.
- `zod@3.24.2` (high, production): direct dependency. The audit's fix is Zod `4.6.7`, a breaking major migration; retained Zod 3 because changing schema behavior/API during this backend close-out requires a dedicated compatibility migration. Mitigation: Express request bodies are capped at 100 KB and schemas constrain request arrays/fields. Reassess before production exposure.
- `tinypool` and `vitest` (critical, development): pulled by direct dependency `vitest@2.1.9`; `@vitest/mocker`, `vite`, `vite-node`, and nested `esbuild` were affected transitively. Upgraded to `vitest@5.0.5` and `vite@8.3.5`; both critical findings and the related high Vite/esbuild findings are cleared.

### Remaining findings after remediation

- One high: `zod` in production, as described above; no safe non-breaking upgrade was offered.
- Fourteen moderate, all development-only. The current audit reports the ESLint / `@typescript-eslint` toolchain and its `minimatch`, `glob`, `rimraf`, `flat-cache`, and `file-entry-cache` chain with `fixAvailable: false`. These are not shipped production dependencies. The Vitest/Vite/esbuild moderates have been resolved by the upgrades above.

## Commands

- Before: `npm audit`, `npm audit --omit=dev`
- Remediation: `npm install --save-exact express@4.22.3 mongoose@8.24.7`; `npm install --save-dev --save-exact vitest@5.0.5 vite@8.3.5`
- After: `npm audit`, `npm audit --omit=dev`
- Verification: `npm run typecheck`, `npm run lint`, `npm run build`, `npm test` (48 passed, 0 failed, 0 skipped)

`npm audit fix --force` was not run.
