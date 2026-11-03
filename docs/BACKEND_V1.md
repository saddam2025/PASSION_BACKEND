You are building the BACKEND of a coaching-academy platform. Step 0: save this whole message as docs/BACKEND_V1.md in the backend repo, and create or update AGENTS.md with: "Backend V1: you MUST run installs, the dev server, tests and HTTP smoke requests, and fix every failure. Never claim something works unless you ran it. No fake implementations." From now on I will send "Execute BE-N" and you execute ONLY that slice. For this first message execute BE-1.

CONTEXT
A platform with a public site (course landing pages, registration forms), an Admin dashboard and an Assistant dashboard. The frontend repo (PASSION_FRONTEND) currently runs on mocks behind typed services; this backend must implement the same contracts so the frontend can switch from mocks to the API later. Read these first, do not rewrite them: PASSION_PLATFORM/docs/SPEC.md (requirements; ignore any online-payment-gateway parts and English-content parts), docs/API_CONTRACT_DRAFT.md (its COURSES parts are SUPERSEDED), docs/PERMISSION_MATRIX.md, docs/STATUS_MODEL.md, docs/ANALYTICS_DEFINITIONS.md, docs/MEDIA_STORAGE.md, docs/DECISIONS.md, and PASSION_FRONTEND/docs/COURSES_V2.md (authoritative for the courses data model and rules, including its addenda). If sources conflict: COURSES_V2.md and DECISIONS.md win, then SPEC.md.

KEY DECISIONS (supersede older docs)
- Content is Arabic only: text fields are stored as ar; an optional en is tolerated by schemas but never required or validated as required.
- No online payments. Payments are manual records created by staff. Derived paymentStatus: unpaid, pending, partially_paid, paid, refunded, partially_refunded, cancelled (failed reserved). Payment records are immutable; corrections are void + new record.
- Courses: ONE document per course with embedded draft and published snapshots plus versions (see COURSES_V2.md). The public API reads only published.
- Media on Cloudflare R2 through the S3 API, backend-only access: a public bucket for site images and a private bucket for payment receipts (signed URLs).
- An Admin may publish directly; an Assistant submits for review; an Assistant can never approve, publish, archive, delete or rollback.
- Accounts exist only through Admin invitations (hashed single-use tokens). No public signup.
- Do NOT implement course endpoints before slice BE-4.

STACK (fixed)
Node.js LTS + TypeScript (strict), Express (stable, pinned), Mongoose on MongoDB with transactions (replica set), Zod, pino, helmet, cors, express-rate-limit, hpp, an operator-injection protection that works with the chosen Express version, cookie-parser. Tests: Vitest + supertest. Per the current Atlas testing decision, transaction and database readiness integration tests use `MONGODB_URI_TEST` with a disposable `passion_test` database; the URI is read from process environment or local `.env`, never logged, and the test database is dropped after the run. If unset, those integration tests are explicitly skipped while the database-independent HTTP tests still run. Pin stable dependency versions. Later slices add: argon2 (prefer a prebuilt-binary package so it installs on Windows), JWT lib, sanitize-html, sharp, multer, @aws-sdk/client-s3 and presigner.

ARCHITECTURE
src/{config, app, server, routes, controllers, services, models, middleware, lib, shared/schemas, scripts, tests}. Flow: routes -> controllers -> services -> models. Controllers hold no business logic; services receive an actor context (userId, role, permissions). Versioned /api/v1. Every route validates params/query/body with Zod (unknown fields stripped). Error shape everywhere: { error: { code, message, details?, requestId } }. Pagination shape: { items, total, page, pageSize }. Central permission map + requirePermission middleware + object-level checks. Audit service. Academy time zone constant Africa/Cairo.

SECURITY BASELINE (applies to every slice)
argon2id password hashing and a strong password policy; short-lived access JWT + rotating refresh token in httpOnly Secure SameSite cookies with reuse detection; CSRF protection for cookie-authenticated mutations; login rate limit and lockout with generic errors; helmet with strict CSP and HSTS; strict CORS allowlist from env; body size limits; no mass assignment; rich text sanitized server-side; URL allowlist (http, https, mailto, tel, wa.me); upload validation (MIME + magic bytes, size, random names, sharp re-encode); secrets only in env with fail-fast validation; pino redaction of passwords, tokens, cookies and authorization; no stack traces in production; indexes for every query path; pagination everywhere; IDOR checks; the audit log never stores secrets.

SLICES
BE-1 Foundation: scaffold, config + env validation, logger, DB connection and transaction helper, middleware stack, error handling, health endpoints, test harness, scripts, README, .env.example, docker-compose for a local single-node Mongo replica set.
BE-2 Models, shared Zod schemas and indexes: User, Invite, PasswordReset, RefreshToken, Course (embedded draft/published/versions), Lead, Enrollment, Payment, Note, Notification, AuditLog, Settings, Category, Media. Copy the pure-Zod schema files from PASSION_FRONTEND/src/schemas into src/shared/schemas (no React) and document how to keep them in sync.
BE-3 Auth, RBAC, invites, password reset, users and permissions, seed-admin script (credentials from env), audit foundation.
BE-4 Courses (needs the frontend Courses V2 to be finished): CRUD, draft save with optimistic concurrency, publish/submit/approve/reject/unpublish/archive/rollback, slug history, versions, public catalog and detail, sanitization.
BE-5 Registrations (idempotency key, honeypot, rate limits, duplicate guard, consent), leads, enrollments, notes, manual payments with derived status, notifications, CSV export with formula-injection protection.
BE-6 Media on R2: uploads, variants, public and private buckets, signed receipt URLs, usage checks before delete.
BE-7 Settings, categories, analytics (aggregations exactly per ANALYTICS_DEFINITIONS.md), SEO endpoints (sitemap, robots, meta for course pages), audit log endpoints.
BE-8 Hardening and docs: OpenAPI or docs/API.md, deployment guide, backup notes, dependency audit, final security review.

DEFINITION OF DONE FOR EVERY SLICE
1) Install, run the dev server and exercise the slice with real HTTP requests; keep the commands you used. 2) Run only `npm run test:focus -- <slice-pattern>`, `npm run test:fast`, `npm run typecheck`, and `npm run lint` during an ordinary slice. The owner runs `npm run test:full` and supplies its summary; the agent runs it only when requested or when shared auth, permissions, middleware, models, test setup, or config code changed. Do not mark a slice Done until a full-suite summary shows failed 0 and skipped 0. The full suite is run by the owner at BE-7B close, before frontend integration, before deployment, and whenever shared code changes. 3) No secrets in the repo; `.env.example` updated. 4) `docs/API.md` updated with the endpoints of the slice (method, path, auth, request, response, errors). 5) Never claim something works unless you ran it. If something cannot be completed, list it as SKIPPED with the concrete reason.
REPORT FORMAT (short): what was built (files), endpoints implemented, tests added (names) and the result of running them, commands you ran with a summary of their output, SKIPPED items, a short manual test I should run. Then STOP and wait for "Execute BE-N".

BE-1 DETAILS
- package.json scripts: dev (tsx watch or equivalent), build, start, test, test:watch, lint, typecheck.
- Env schema (Zod, fail fast with a clear message): NODE_ENV, PORT, MONGODB_URI, ACCESS_TOKEN_SECRET, REFRESH_TOKEN_SECRET, COOKIE_DOMAIN and secure flags, CORS_ORIGINS (comma list), APP_BASE_URL, LOG_LEVEL; optional R2_* and email settings (not required yet).
- createApp() factory for tests; server.ts boots, connects, handles graceful shutdown.
- Middleware: request id, pino-http with redaction, helmet + CSP, CORS allowlist with credentials, JSON body limit, cookie-parser, hpp, operator-injection protection, global rate limit, 404 handler, central error handler mapping Zod, Mongoose and AppError classes (Validation, Auth, Forbidden, NotFound, Conflict, RateLimit) to the shared error shape.
- lib: asyncHandler, pagination helpers, ObjectId validation, time helpers, withTransaction helper (and a boot-time check that warns clearly if the database is not a replica set).
- Health: GET /api/v1/health (liveness) and GET /api/v1/health/ready (database ping + version).
- docker-compose.yml for a local single-node Mongo replica set, and README steps for both Docker and MongoDB Atlas.
BE-1 ACCEPTANCE
E1 The app refuses to boot with missing or invalid env and prints which variables are wrong.
E2 /health and /health/ready work against the DB; /ready fails cleanly when the DB is down.
E3 Unknown route returns 404 in the error shape; malformed JSON returns 400; an oversized body returns 413; a validation failure returns the Zod details in the error shape.
E4 Security headers are present; a request from a non-allowed origin is rejected by CORS; the rate limiter triggers on a burst.
E5 withTransaction works (commit and rollback) in a test using the in-memory replica set.
E6 All tests, typecheck and lint pass; the README lets a new developer run everything.

Execute BE-1 now.

## BE-2 ADDENDUM

1. Database integration tests must really run. Use mongodb-memory-server replica set only when its binary is already cached; never trigger a large download. Otherwise use `MONGODB_URI_TEST`. `npm test` fails if the database is unavailable unless `ALLOW_SKIP_DB_TESTS=1` is explicitly set. Test setup refuses to run unless `NODE_ENV=test` and the selected database name ends in `_test`; it cleans only its own collections. Report exact passed/failed/skipped counts. Skipped database tests are not a pass. Await `Model.init()` / `syncIndexes()` before index assertions. Never log connection strings.
2. Payment records contain kind, method, receivedAt, confirmedBy, idempotencyKey, status, void fields and positive integer minor-unit amounts with an allowlisted currency. Updates/deletes are blocked except one confirmed-to-voided transition with a reason. AuditLog is append-only. Tests cover immutability.
3. Invite, PasswordReset and RefreshToken contain SHA-256 hashes only. RefreshToken and PasswordReset use `expiresAt` TTL; Invite uses `purgeAt = expiresAt + 30 days` TTL and retains accepted/revoked/expired rows for listing. Invite status is computed from dates/flags.
4. User email is unique/lowercase; passwordHash is select:false; JSON transforms remove it and token fields. User includes role, permissions, active/login lock fields and tokenVersion.
5. Enrollment has a PAS-XXXXXX reference, snapshots, statuses, assignment, cancellation reason, event history, registration date and unique idempotency key. Maintain `isActive` and enforce one active enrollment per lead/course with a partial unique index.
6. Lead email is unique/lowercase, phoneNormalized is indexed, consent and first-touch attribution are stored, and possible duplicates are linked without merging.
7. Course has unique current slug and unique `allSlugs` (current plus history), soft-delete timestamp, 2 MB serialized-size limit, `version` optimistic concurrency, and versions capped at 20. Mixed section arrays are marked modified when changed.
8. Settings is a fixed-key singleton with optimistic versioning and structured academy/contact/social/message/currency/payment/legal/SEO/default-permission fields. Category has unique slug/order/soft-delete. Notifications are per recipient and indexed by recipient/read/date. Media keys are relative and unique; bucket is public/private.
9. Add `docs/SCHEMA_SYNC.md` and `scripts/check-schema-sync.ts` / `npm run check:schema-sync`. Compare copied schema files with frontend sources after line-ending normalization; report readable diffs. The source root is `FRONTEND_SCHEMAS_PATH` or `../PASSION_FRONTEND/src/schemas`; a missing source exits nonzero unless `--allow-missing` is provided. Reconcile schema/model names; Arabic text is required and English is optional. Do not copy course section/page-config schemas until the frontend stabilizes.
