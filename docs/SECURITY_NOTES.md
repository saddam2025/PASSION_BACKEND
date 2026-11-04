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

## FINAL-1 production audit (2026-11-04)

Audits were run before and after the safe dependency updates. Counts include all severities.

| Run | Full tree (low / moderate / high / critical; total) | Production tree (low / moderate / high / critical; total) | Dev-only (low / moderate / high / critical; total) |
|---|---:|---:|---:|
| Before FINAL-1 updates | 1 / 35 / 3 / 1; 40 | 1 / 21 / 3 / 1; 26 | 0 / 14 / 0 / 0; 14 |
| After FINAL-1 updates | 1 / 16 / 1 / 0; 18 | 1 / 2 / 1 / 0; 4 | 0 / 14 / 0 / 0; 14 |

### High and critical findings and changes

- `fast-xml-parser` (critical, production transitive): pulled through the direct AWS S3 SDK packages (`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`). Updated both direct AWS packages together from `3.883.0` to `3.1161.0` within SDK major 3; the critical finding cleared.
- `multer` (high, production direct): updated from `2.0.2` to `2.5.0` within major 2; the high finding cleared. Media focused tests passed after the update.
- `sharp` (high, production direct): updated from `0.34.4` to `0.35.5`. npm classifies this as a semver-major change because sharp is a `0.x` package; the maintained release fixes the 2026 librsvg/libvips advisories. Our Node engine is 22+, and the media code uses APIs still present in 0.35.5; focused media tests passed. Image uploads remain restricted by MIME/magic-byte checks, size/pixel limits, and re-encoding.
- `zod@3.24.2` (high, production direct): the audit range is `<4.6.6`, so the latest Zod 3 release queried (`3.25.76`) remains in the affected range. npm offers only `zod@4.6.7`, a major migration. It was not upgraded during FINAL-1 because it can change validation behavior across every shared request schema. Mitigations are the 100 KB request-body limit and field/array bounds in schemas. Plan: perform a dedicated Zod 4 compatibility migration with schema-by-schema behavior tests before clearing this risk; do not expose production traffic while the high advisory remains unresolved.

### Remaining findings

- One production high: Zod, as described above. Production also reports one low and two moderate advisories; full tree reports fourteen additional moderate advisories in the development toolchain. Review those separately during dependency maintenance.
- `npm audit --omit=dev` after the updates: 1 low, 2 moderate, 1 high, 0 critical. `npm audit` after the updates: 1 low, 16 moderate, 1 high, 0 critical.
- No `npm audit fix --force` was run. Safe updates used exact package versions and refreshed `package-lock.json`.

## Personal data and retention

The API stores the following personal data:

- User and invite records: staff name, email, role, password hash, account/lock metadata, inviter and invite lifecycle dates. Passwords are not stored in plaintext; invite, reset, and refresh tokens are stored as hashes only.
- Lead and enrollment records: name, email, phone and normalized phone, consent acceptance timestamp and privacy-policy version, first-touch attribution, possible-duplicate references, submitted form answers, form/course/price snapshots, status history, assignment and staff follow-up data.
- Payment records: integer amount, currency, method, received date, reference and optional staff note. Private receipt media is stored in R2 and referenced by a relative key; short-lived signed URLs are generated on demand.
- Notes, notifications, and audit records: staff-authored note text, recipient IDs, action/entity/status metadata, timestamps and optional audit notes. Audit redaction removes secret-like fields; operators should avoid putting unnecessary personal data in notes.

Retention periods for leads, enrollments, notes, payment records, audit records, and attached receipts are not set by the backend; the academy must decide them based on legal and operational requirements. Refresh-token and password-reset records expire via TTL; invites are purged 30 days after expiry; unattached receipt files are eligible for purge after 24 hours. **Open question for the academy:** what retention period and deletion/archival workflow should apply to each business record class, and which legal basis applies after a course ends?
