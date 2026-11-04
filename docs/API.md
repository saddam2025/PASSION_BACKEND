# API documentation

All routes are versioned under `/api/v1`. Responses use JSON. Errors use `{ "error": { "code", "message", "details?", "requestId" } }`.

## BE-1 health

| Method + path | Auth | Request | Success response | Errors |
|---|---|---|---|---|
| `GET /api/v1/health` | Public | No parameters or body | `200 { "status": "ok" }` (liveness only; does not depend on MongoDB) | `404` for unknown paths; standard error envelope |
| `GET /api/v1/health/ready` | Public | No parameters or body | `200 { "status": "ready", "database": "ok", "version": "0.1.0" }` after MongoDB ping | `503 { "error": { "code": "DATABASE_UNAVAILABLE", "message": "Database is not ready", "requestId": "…" } }` when MongoDB is not reachable |

Readiness never includes driver details or connection strings. `GET /api/v1/health` is liveness-only and remains available independently of MongoDB. In production the server refuses to listen unless `MONGODB_URI` identifies a credentialed replica set and the live MongoDB handshake confirms replica-set support; `APP_BASE_URL` and every CORS origin must be HTTPS; CORS origins must be exact origins without wildcards or paths; cookies must be Secure and use the `__Host-` names; all six R2 variables must be configured; and configured secrets must meet the minimum length and not be sample values. Startup errors identify variable names only. See [DEPLOYMENT.md](DEPLOYMENT.md).

`TRUST_PROXY_HOPS` defaults to `0` and sets Express's trusted proxy depth. Set it only to the verified number of reverse-proxy hops; `req.ip` is used for IP rate-limit keys. The HTTP logger omits request IP and redacts credential, email, and phone fields. `npm run indexes:sync` and `npm run seed:admin` require `--confirm-db=<exact database name>`; `_test` databases additionally require the deliberate `--allow-test-db` flag.

### BE-1 database integration test setup

Set `MONGODB_URI_TEST` in the process environment or the local, git-ignored `.env` to a disposable Atlas URI. The test suite overrides its database name to `passion_test` and drops that database after the tests. If the variable is missing, the transaction/readiness integration tests are explicitly marked skipped; the 9 HTTP smoke tests continue to run without MongoDB. Never use production data for this test URI.

All endpoints pass through request ID, security headers, CORS allowlist, global rate limiting, body parsing/size limits, cookie parsing, HPP, Mongo operator-injection sanitization, and the central error handler. Later slices add their endpoints here.

## Data model (BE-2)

BE-2 adds persistence models and indexes only; it adds no endpoints or authentication behavior.

| Model | Stored data and invariants | Indexes |
|---|---|---|
| User | Lowercased unique email, name, password hash (excluded from selection and JSON), role, permissions, active/login-lock metadata, token version. | Unique email; active state. |
| Invite | Email, role/permissions, inviter, SHA-256 token hash, expiry/use/revoke dates, purge date. Status is computed from dates and flags. | Unique token hash; email/creation date; TTL on `purgeAt`. |
| PasswordReset | User, SHA-256 token hash, expiry and single-use date. | Unique token hash; TTL on `expiresAt`. |
| RefreshToken | User, SHA-256 token hash, family id, expiry/use/revocation. | Unique token hash; user and family lookup; TTL on `expiresAt`. |
| Course | One document with current/history/all slugs, draft and nullable published snapshots, published timestamp, status, featured and one optimistic `version`. `page.sections` is Mixed within the typed snapshot and is validated at the service boundary using the synchronized Zod schemas. No review state or revision/version history. Soft-deleted slugs remain reserved; documents are limited to 2 MB. | Unique slug; unique multikey `allSlugs`; status/update date; status + draft category/title; status + published category/featured/published date/`_id`; status + featured/published date/`_id`; deleted date. |
| Lead | Person identity, lowercased email, entered and normalized phone, consent, first-touch attribution, possible-duplicate reference. | Unique email; normalized phone. |
| Enrollment | Lead/course refs, reference, course/price/form/answer snapshots, independent enrollment/follow-up states, active flag, assignment, reason, history, idempotency key and registration time. | Unique reference and idempotency key; unique active lead/course partial index; course/status/date; lead/date. |
| Payment | Immutable positive integer minor-unit payment/refund record, allowlisted currency/method, receipt media key, idempotency key, recorder/confirmer and confirmed/voided state. Only one reasoned confirmed-to-voided transition is allowed. Overall enrollment payment status is derived and is not stored here. | Unique idempotency key; enrollment/date. |
| Note | Internal enrollment note and author. | Enrollment/creation date. |
| Notification | One recipient's notification, type/params/entity link and read date. | Recipient/read/creation date. |
| AuditLog | Actor, action, entity, before/after status, timestamp and note. Append-only; secret fields are not part of the schema. | Entity/date; actor/date. |
| Settings | Fixed `academy` key, versioned academy/contact/social/message/currency/payment/legal/SEO/default-permission settings. | Unique singleton key. |
| Category | Arabic name, optional future English name, unique slug, order and soft-delete date. | Unique slug; order; deleted date. |
| Media | Relative key, public/private bucket, MIME/size/dimensions/variants/usages/uploader. | Unique key; bucket/date; usage references. |

Index deployment is performed with `npm run indexes:sync`. Shared validation schemas and their frontend sync policy are documented in `docs/SCHEMA_SYNC.md`.

## BE-4 course management and public catalog

Course mutations are Admin-only, require CSRF and an allowlisted Origin/Referer, validate with the shared course Zod schemas, sanitize text before storage, and use Mongo transactions for the course, media usage references and audit event. Saves require `expectedVersion`; stale writes return `409 CONFLICT`. Snapshots are capped at 1.8 MB on input (2 MB document limit). Soft deletion retains the reserved slug but removes the course from normal queries and public routes.

| Method + path | Auth | Request | Success response | Errors |
|---|---|---|---|---|
| `POST /api/v1/courses` | Admin + CSRF/origin | `{ slug, title, category, template?: "full"|"short"|"blank", featured? }`; service also accepts `{ slug, draft, featured? }` for full snapshot adapters | `201 { course }`, with version `0` and a generated template snapshot | `400/422` invalid schema; `401`; `403`; `409` duplicate slug |
| `GET /api/v1/courses` | Admin | `q` (case-insensitive slug/title search), `status`, `category`, `page`, `pageSize` (1–100), `sort` (`newest`, `oldest`, `title`) | `{ items, total, page, pageSize, pageCount }`; each course includes `featured` and computed `hasUnpublishedChanges` alongside its draft and published snapshots | `400`; `401`; `403` |
| `GET /api/v1/courses/:id` | Admin | Course ObjectId | `{ course }` including draft, published snapshot, slug history and version | Same `404` for invalid/unknown/deleted; `401`; `403` |
| `PUT /api/v1/courses/:id/draft` | Admin + CSRF/origin | `{ expectedVersion, draft }` | `{ course }`; validates and saves the full snapshot, updates slug history and media usage refs | `422` invalid snapshot; `409` stale version/slug; `404` |
| `POST /api/v1/courses/:id/publish` | Admin + CSRF/origin | `{ expectedVersion }` | `{ course }`; published snapshot becomes the validated draft and status becomes `published` | `422` with readiness field paths; `409`; `404` |
| `PATCH /api/v1/courses/:id/featured` | Admin + CSRF/origin | `{ featured: boolean }` | `{ course: { id, slug, status, featured, hasUnpublishedChanges, title, category, coverImage, createdAt, updatedAt, version } }`; toggles the public featured flag, advances version, and appends `course_featured_updated` audit only when the value changes | `400/422` invalid body; `401`; `403`; `404`; `409` concurrent update |
| `POST /api/v1/courses/:id/unpublish` | Admin + CSRF/origin | `{ expectedVersion }` | `{ course }`; status becomes `draft`, published snapshot is retained but is no longer public | `409`; `404` |
| `POST /api/v1/courses/:id/archive` / `unarchive` | Admin + CSRF/origin | `{ expectedVersion }` | `{ course }`; archive or restore as draft | `409`; `404` |
| `DELETE /api/v1/courses/:id` | Admin + CSRF/origin | `{ expectedVersion }` | `{ deleted: true, id }`; marks deleted and detaches media usage references | `409`; `404` |
| `GET /api/v1/courses/check-slug?slug=...&exceptId=...` | Admin | Slug and optional current course id | `{ available: boolean }`; current/history/soft-deleted slugs are reserved | `400`; `401`; `403` |
| `GET /api/v1/public/courses` | Public | `q` (case-insensitive match in published Arabic title or short description), `category`, `featured`, `page`, `pageSize` (1–50, default 12) | Published summaries only, ordered featured first then newest `publishedAt`; `Cache-Control: public, max-age=60`, ETag and `304` support | `400` invalid query |
| `GET /api/v1/public/courses/:slug` | Public | Current or historical slug | `{ status: "ok", course }` with published detail/page/form snapshots; historical slug returns `{ status: "redirect", slug }`; no course/media database ids or draft fields | Identical `404` for absent, deleted, draft or archived slugs; ETag and `304` support |

The generated templates are editable starting points: Full contains hero, image/text, feature cards, curriculum, instructor, pricing CTA, steps, FAQ, registration form and WhatsApp contact; Short contains hero, text, pricing CTA, registration form and WhatsApp contact; Blank contains only the registration form. All section contents remain editable and are validated on create/save/publish. Readiness requires: Arabic title and short description; non-empty category; valid current slug; cover image; at least one visible, non-empty, schema-valid section; a valid registration form definition; and either a non-negative price or `contactUs: true`. A promo price, when present, must be lower than the base price. Form fields must have Arabic labels; select/radio fields require at least two unique choices. Registration continues to read only the published snapshot, and queries only non-deleted documents (`deletedAt: null`).

The Admin course list derives `hasUnpublishedChanges` by comparing canonical draft and published snapshots (it is false unless the course is published and the snapshots differ); `featured` is the stored course-level flag. Public list search escapes all regex metacharacters before building case-insensitive Mongo regexes, and searches only the published Arabic title/short description. No text index is used because this is substring matching; category/status/order and admin title-sort paths use compound indexes on `Course`, with `_id` as a deterministic tie-breaker for public ordering.

## BE-3 authentication and account management

All paths below include the `/api/v1` prefix. Access and refresh credentials are only returned as `HttpOnly` cookies; responses never contain the raw JWT or refresh token. Mutating requests, including login and refresh, require an allowed `Origin` (or `Referer`), the readable CSRF cookie from `GET /auth/csrf`, and a matching `X-CSRF-Token` header. Development cookies are scoped to `/api/v1` and `/api/v1/auth`; production uses Secure `__Host-` cookies with `Path=/` and no Domain (the `__Host-` browser requirement conflicts with narrower refresh-cookie path scoping).

| Method + path | Auth | Request | Success response | Errors |
|---|---|---|---|---|
| `GET /api/v1/auth/csrf` | Public | None | `200 { csrfToken }`, also sets readable CSRF cookie | Standard error envelope |
| `POST /api/v1/auth/login` | Public + CSRF + origin; IP and hashed-email limits | `{ email, password }` | `200 { user }`; sets access and refresh cookies | `400` validation, `401` generic credentials/lockout, `403` CSRF/origin, `429` rate limit |
| `POST /api/v1/auth/refresh` | Refresh cookie + CSRF + origin | Empty body | `200 { user }`; rotates both auth cookies | `401` invalid/expired/reused refresh token, `403` CSRF/origin |
| `POST /api/v1/auth/logout` | CSRF + origin; refresh cookie optional | Empty body | `204`; revokes refresh family and clears auth cookies | `403` CSRF/origin |
| `GET /api/v1/auth/me` | Active access cookie | None | `200 { user: { id, name, email, role, permissions } }` | `401` invalid, expired, inactive, or stale token |
| `POST /api/v1/auth/change-password` | Active access cookie + CSRF + origin | `{ currentPassword, password }` | `204`; revokes refresh sessions and clears cookies | `400/422` validation, `401` current password, `403` CSRF/origin |
| `GET /api/v1/auth/invites/:token` | Public | Opaque token path param | `200 { email, role, expiresAt }` | Identical `404` for invalid, used, revoked, or expired token |
| `POST /api/v1/auth/invites/accept` | Public + CSRF + origin | `{ token, name, password }` | `201 { accepted: true }`; user creation and token consumption are transactional | `400/422` validation, `404` invalid/used/expired invite, `409` duplicate account, `403` CSRF/origin |
| `POST /api/v1/auth/password-reset/request` | Public + CSRF + origin | `{ email }` | Always `202 { accepted: true }` | `400` malformed email, `403` CSRF/origin |
| `POST /api/v1/auth/password-reset/confirm` | Public + CSRF + origin | `{ token, password }` | `204`; consumes one-time token and invalidates sessions | `400/422` validation, `404` invalid/expired/used token, `403` CSRF/origin |
| `GET /api/v1/users` | Admin | `page`, `pageSize`, `search`, `role`, `active`, `sort` query | `{ items, total, page, pageSize }` | `400` query validation, `401`, `403` Assistant |
| `GET /api/v1/users/:id` | Admin | ObjectId path param | `200 { user: { id, name: { ar }, email, role, permissions, active, createdAt, lastLoginAt } }` | `400` invalid ID, `401`, `403`, `404` |
| `PATCH /api/v1/users/:id` | Admin + CSRF + origin | `{ name?, role?, permissions? }` | `200 { user }` | `400` validation, `401`, `403` self-demotion/CSRF, `404`, `409` last Admin |
| `POST /api/v1/users/:id/deactivate` | Admin + CSRF + origin | Empty body | `200 { user }`; bumps tokenVersion and revokes refresh sessions | `401`, `403` self-deactivation/CSRF, `404`, `409` last Admin |
| `POST /api/v1/users/:id/reactivate` | Admin + CSRF + origin | Empty body | `200 { user }` | `401`, `403` CSRF, `404` |
| `POST /api/v1/invites` | Admin + CSRF + origin | `{ email, role?, permissions?, hours? }` | `201 { invite, link }`; raw invite link appears only in this response | `400` validation, `401`, `403` Assistant/CSRF, `409` active user or pending invite |
| `GET /api/v1/invites` | Admin | `page`, `pageSize`, `search`, `status` query | `{ items, total, page, pageSize }`; status is computed | `400` query validation, `401`, `403` Assistant |
| `POST /api/v1/invites/:id/revoke` | Admin + CSRF + origin | Empty body | `204` | `400` invalid ID, `401`, `403` Assistant/CSRF, `404` |
| `POST /api/v1/invites/:id/resend` | Admin + CSRF + origin | Empty body | `200 { invite, link }`; rotates token and returns new link once | `400` invalid ID, `401`, `403` Assistant/CSRF, `404` |

Assistant effective permissions are fixed by role: `viewLeads`, `updateFollowUp`, `viewPayments`, `recordPayments`, and `manageNotes`. Legacy user, invite, and settings grants remain stored but cannot widen those rights. Admin always receives every permission. User-facing records omit password hashes, token hashes and internal login-lock fields. Account links are logged only by the development console transport; production and tests do not log or deliver links until a real email provider is configured. `npm run seed:admin` reads `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` and `SEED_ADMIN_NAME`; it creates the first Admin once and does not overwrite an existing account. It refuses database names ending in `_test` unless invoked with the deliberate `--allow-test-db` guard.

## BE-5A public registration

Public write requests require an `Origin` or `Referer` matching `CORS_ORIGINS`; they do not require CSRF. Requests are validated and unknown keys are stripped. The POST route is rate-limited to 100 requests/IP and 20 requests/normalized-email SHA-256 key per 15 minutes. Confirmation reads are limited to 30 requests/IP per 15 minutes. Limits use the current process memory store and must be replaced/shared when deploying multiple API instances.

| Method + path | Auth | Request | Success response | Errors |
|---|---|---|---|---|
| `POST /api/v1/public/registrations` | Public + allowlisted Origin/Referer; IP and hashed-email limits; no CSRF | `{ courseSlug, fullName?, email?, phone?, answers, consent?, idempotencyKey, website?, formStartedAt?, attribution?: { utm_source?, utm_medium?, utm_campaign?, referrer? } }`. `answers` accepts the current frontend answer map or an array of `{ id, value }`. Core values may be supplied at top level or under `answers`; consent must be `true`. `website`/`honeypot` and `formStartedAt`/legacy `renderedAt` support spam checks. | `201 { reference, status: "received" }` for a created registration; replay/duplicate and neutral spam response use `200` with the same shape. | `400/422` invalid body/answers; `403` Origin; `404 COURSE_NOT_AVAILABLE`; `409 REGISTRATION_CLOSED`, `COURSE_FULL`, or conflicting idempotency key; `429 RATE_LIMITED`; standard error envelope. |
| `GET /api/v1/public/registrations/:reference` | Public; strict IP limit | Reference path parameter | `200 { reference, courseTitle: { ar }, status: "received" }`; contains no personal or internal identifiers. | Identical `404` envelope for unknown or malformed references; `429 RATE_LIMITED`. |

Registration normalizes both accepted answer forms into one canonical field-id map before validation; required checks cannot be skipped by using the frontend mock aliases or the array form. It reads only a published, non-deleted Course snapshot, checks `published.details.enrollment.registrationOpen` and capacity, validates every answer against `published.form`, then writes the Lead/Enrollment in one MongoDB transaction. Emails are normalized; phone is retained as entered and stored separately as digits-only international format. A duplicate phone only links `possibleDuplicateOf`, never merges Leads. Consent policy version comes from the Settings privacy page or documented fallback `1`. Notifications fan out per active Admin and Assistant with the default/granted `viewLeads` permission; params include only Arabic course title and reference. Audit records contain no visitor details. Public route error logs include only safe error code and request ID.

The current mock contract is accepted during migration: top-level `courseSlug`, answer map with `fullName`/`email`/`phone`/`consent`, `honeypot`, `renderedAt`, and `attribution` object. Confirmation intentionally omits the mock-only `firstName` and `alreadyRegistered` fields to avoid disclosing personal data or registration state.

## BE-5B staff records, notes and notifications

All enrollment, lead and notification reads require an active cookie-authenticated user. Writes also require an allowlisted `Origin`/`Referer`, the readable CSRF cookie from `GET /auth/csrf`, and a matching `X-CSRF-Token`. Unknown input keys are stripped. Paginated lists use `{ items, total, page, pageSize }`; errors use the shared error envelope.

| Method + path | Auth and permission | Request | Success response | Errors |
|---|---|---|---|---|
| `GET /api/v1/enrollments` | Auth + `viewLeads`; payment fields require `viewPayments` | `search`, `courseId`, `enrollmentStatus`, `followUpStatus`, `paymentStatus`, `assignedTo` (`me`, `unassigned`, or user id), `dateFrom`, `dateTo` (`YYYY-MM-DD` in Africa/Cairo), `sort` (`newest`, `oldest`, `name`, `course`, `paymentStatus`), `page`, `pageSize` (1–50) | Paged rows contain enrollment details; `paymentSummary { netMinor, status, lastPaymentAt }` is included only for users allowed to view payment details. | `400` invalid query or date range; `401`; `403` |
| `GET /api/v1/enrollments/filters` | Auth + `viewLeads` (Admin and Assistant) | No parameters | `{ courses: [{ id, title }] }`; only course IDs and Arabic titles with at least one enrollment visible in the staff enrollment list, sorted by title. No other course fields are projected. | `401`; `403` |
| `GET /api/v1/enrollments/:id` | Auth + `viewLeads` | Enrollment ObjectId | `{ enrollment }` with lead, Arabic course snapshot, price/form/answer snapshots, status history with actor names, notes, same-lead enrollment references, and duplicate flag/reference list | Same `404` for malformed and unknown IDs; `401`; `403` |
| `PATCH /api/v1/enrollments/:id/follow-up` | Auth + `updateFollowUp` + CSRF | `{ followUpStatus, note? }` | `{ enrollment }`; appends the status event and audit record | `400/422` invalid body; `401`; `403`; `404`; `409` same status or cancelled enrollment |
| `POST /api/v1/enrollments/:id/assign` | Auth + Admin + CSRF | `{ assigneeId: ObjectId | null }` | `{ enrollment }`; assignee must be active Admin/Assistant; null clears assignment | `400` invalid body; `401`; `403` Assistant/CSRF; `404`; `409` unchanged assignment; `422` inactive/missing assignee |
| `POST /api/v1/enrollments/:id/confirm` | Auth + Admin + CSRF | `{ reason? }`; reason is required when no confirmed payment exists | `{ enrollment }`; pending becomes confirmed; appends history and audit | `400` missing/short required reason; `401`; `403` Assistant/CSRF; `404`; `409` invalid source state |
| `POST /api/v1/enrollments/:id/cancel` | Auth + Admin + CSRF | `{ reason }` | `{ enrollment }`; sets cancelled and `isActive: false`, leaving payments untouched | `400` missing/short reason; `401`; `403` Assistant/CSRF; `404`; `409` invalid source state |
| `POST /api/v1/enrollments/:id/whatsapp-contact` | Auth + `updateFollowUp` + CSRF | Empty JSON body | `{ enrollment }`; logs that WhatsApp was opened, without claiming a message was sent | `401`; `403`; `404` |
| `GET /api/v1/enrollments/:id/notes` | Auth + `manageNotes` | `page`, `pageSize` (1–100) | Paged notes with body, date and author `{ id, name }` | `400`; `401`; `403`; `404` |
| `POST /api/v1/enrollments/:id/notes` | Auth + `manageNotes` + CSRF | `{ body }` (plain text, 1–2,000 characters after sanitization) | `201 { note }`; notes can only be appended in this slice | `400/422`; `401`; `403`; `404` |
| `GET /api/v1/leads/:id` | Auth + `viewLeads` | Lead ObjectId | Lead identity, `{ counts: { leads, enrollments } }`, enrollments and possible-duplicate references | Same `404` for malformed and unknown IDs; `401`; `403` |
| `GET /api/v1/notifications` | Auth; current recipient only | `unreadOnly`, `page`, `pageSize` (1–100) | Paged notifications for the current user only | `400`; `401` |
| `GET /api/v1/notifications/unread-count` | Auth; current recipient only | None | `{ count }` | `401` |
| `POST /api/v1/notifications/:id/read` | Auth + CSRF; current recipient only | Notification ObjectId | `{ notification }`; another recipient's or missing id returns the same `404` | `401`; `403`; `404` |
| `POST /api/v1/notifications/read-all` | Auth + CSRF; current recipient only | Empty JSON body | `{ updated: true }`; marks this user's unread notifications read | `401`; `403` |

Enrollment status, follow-up status and payment status are independent. A new registration may be created after cancellation because the cancelled row is inactive. Follow-up edits and WhatsApp contact logs are available to default Assistants; assignment, confirmation and cancellation remain Admin-only under the conservative unresolved workflow policy recorded in `PASSION_PLATFORM/docs/DECISIONS.md`. Every enrollment mutation and notification read action appends an audit event containing actor/entity identifiers and status metadata, not customer contact details. Notes have no edit/delete API.

## BE-5C manual payments, derived status and CSV export

All reads require an active cookie-authenticated user. Mutations also require an allowlisted `Origin`/`Referer`, the CSRF cookie from `GET /auth/csrf`, and a matching `X-CSRF-Token`. Amounts are positive integer minor units. A known enrollment price requires the same currency as its price snapshot; a contact-us price uses the enabled currency allowlist. Payment/refund rows are immutable. An Assistant can void only their own confirmed payment-kind record with a required reason; Admin may void any confirmed record. The net-negative guard applies to both. Refund records remain Admin-only. Idempotency replays with the same payload return the original record (`200`); reuse with a different payload conflicts (`409`).

| Method + path | Auth and permission | Request/query | Success response | Errors |
|---|---|---|---|---|
| `POST /api/v1/enrollments/:id/payments` | Auth + `recordPayments` for payment records, Admin for refunds + CSRF | `{ kind: "payment"|"refund", amount, currency, method, receivedAt, reference?, note?, receiptMediaKey?, idempotencyKey }`; refund requires a note/reason. `receiptMediaKey` is a relative private key under `receipts/`. | `201 { payment: { ..., receiptId }, paymentSummary, replayed: false }`; `receiptId` is the private Media ObjectId when a receipt is attached, otherwise `null`; same-key/same-payload replay returns `200` with the same projection and `replayed: true`. | `400/422` invalid input/currency; `401`; `403`; `404`; `409` conflicting key, cancelled payment, or refund exceeding net. |
| `POST /api/v1/payments/:id/void` | Auth + `recordPayments` + CSRF; Admin may void any record, Assistant only own payment-kind record | `{ reason }` (3–1,000 chars) | `{ payment, paymentSummary }`; only a confirmed row can transition once to voided. | `400` invalid reason; `401`; `403` wrong actor/role; `404` absent or already voided; `409` if voiding would make net negative. |
| `GET /api/v1/enrollments/:id/payments` | Auth + `viewPayments` | Enrollment ObjectId | `{ items, total, paymentSummary, outstandingMinor }`; each row includes `receiptId` (private Media ObjectId or `null`) and void metadata. No bucket name or signed URL is returned. | `400`; `401`; `403`; `404`. |
| `GET /api/v1/payments` | Auth + `viewPayments` | `dateFrom`, `dateTo` (Cairo calendar days), `method`, `kind`, `status`, `courseId`, `sort` (`newest`, `oldest`), `page`, `pageSize` (1–50) | Paged cross-enrollment ledger. This endpoint provides records, not revenue analytics. | `400`; `401`; `403`. |
| `GET /api/v1/enrollments/export.csv` | Admin only | Same non-search filters as `GET /enrollments`; `search` is not accepted on GET. | Streaming UTF-8 CSV with BOM, CRLF, Cairo dates and decimal amounts; filename is generated safely. Export is capped at 10,000 rows and records a PII-free `enrollments_exported` audit event. | `400` invalid filters or GET search; `401`; `403`; `422` row cap exceeded. |
| `POST /api/v1/enrollments/export.csv` | Auth + Admin + CSRF | JSON body with the same filters as `GET /enrollments`, including `search` | Same safe streaming CSV. Search is applied server-side; the audit stores only whether search was provided, never its text. | `400` invalid filters; `401`; `403` Assistant/CSRF; `422` row cap exceeded. |

The enrollment list's course filter uses the same `courseId` returned by `/enrollments/filters`. Filter options are derived only from enrollment snapshots, so Admin-only course fields are never exposed to Assistants. The payment filter/sort and optional summary use the service-maintained `paymentSummary`; no request may write it. Receipt IDs are resolved from private Media usage references only for payment-detail projections; bucket names and full/signed URLs are never returned. CSV values are quoted and formula-injection neutralized, and the export omits internal ids, hashes, and notes. A cancelled enrollment keeps all payment rows; refunds remain allowed, while a new payment is rejected.

## BE-6 media and private receipts

Mutation routes require an active access cookie, an allowlisted Origin/Referer, the CSRF cookie, and a matching `X-CSRF-Token`. Multipart requests accept exactly one file in the `file` field. API responses contain generated relative keys only; storage bucket credentials and R2 URLs are never sent to the browser. Uploads are limited to 30 per authenticated user per 15 minutes.

| Method + path | Auth and permission | Request | Success response | Errors |
|---|---|---|---|---|
| `POST /api/v1/media` | Auth + Admin + CSRF | `multipart/form-data`, one image in `file`; JPEG/PNG/WebP, max 5 MB | `201 { id, key, variants: { thumb, medium, large, original }, width, height, mime: "image/webp", size, createdAt }` | `401`, `403`, `413`/`422` type, size, or dimension failure, `429` |
| `GET /api/v1/media` | Auth + Admin | `page`, `pageSize` (1–100), `search` (display name), `usage` (`all`, `used`, `unused`), `sort` (`newest`, `oldest`) | `{ items, total, page, pageSize }`; each item includes relative keys, uploader, usage references/count | `400`, `401`, `403` |
| `GET /api/v1/media/:id` | Auth + Admin | Media ObjectId | Public media asset and usage references | Same `404` for invalid, absent or private IDs; `403` Assistant |
| `DELETE /api/v1/media/:id` | Auth; Admin only; CSRF | Media ObjectId | `{ deleted: true, id }`; removes the object, all variants, and the record | Same `404` for Assistant/absent/invalid; `409 MEDIA_IN_USE` with entity type/id/field references |
| `POST /api/v1/media/receipts` | Auth + `recordPayments`; CSRF | One JPEG/PNG/WebP/PDF in `file`; max 8 MB | `201 { id, key }`; key is under `receipts/` and private | `401`, `403`, `413`/`422`, `429` |
| `GET /api/v1/media/receipts/:id/url` | Auth + `viewPayments` (Admin always) | Receipt Media ObjectId | `{ url, expiresIn }`; signed URL lifetime defaults to 300 seconds and is configurable from 60–900 | Same `404` for missing/forbidden/invalid receipt |

When `receiptMediaKey` is supplied to `POST /api/v1/enrollments/:id/payments`, it must be a valid relative receipt key for a private record, unattached, and uploaded by the actor (Admin may use any receipt). The receipt usage reference and payment record are written in the same transaction. The key cannot be reused for another payment. Unattached receipts older than 24 hours can be removed using `MediaService.purgeUnattachedReceipts()`; linked receipts are excluded. See `docs/MEDIA_STORAGE.md` for the storage driver and usage-helper contract for BE-4/BE-7.

## BE-7A settings, categories, audit

| Method + path | Auth and permission | Request | Success response | Errors |
|---|---|---|---|---|
| `GET /api/v1/settings/public` | Public | None | Cacheable public projection: Arabic academy name, public logo key, contact, social links, currency, safe SEO defaults, legal policy versions and only `whatsappMessageTemplate` (`registration` template) after allowing only `{name}`, `{course}`, `{reference}` placeholders. Other templates and staff grants are excluded. | `500` |
| `GET /api/v1/settings` | Auth + `viewSettings` (Admin always) | None | Current section values and optimistic `version`. | `401`, `403` |
| `PATCH /api/v1/settings` | Admin + CSRF | `{ expectedVersion, section, value }`; section values are validated against the corresponding schema. | Updated settings and new version. Legal HTML is sanitized; changing legal text increments its `policyVersion`. | `401`, `403`, `409` with `currentVersion`, `422` |
| `GET /api/v1/categories/public` | Public | None | `{ items }`, active categories ordered by order then id. | `500` |
| `POST /api/v1/categories` | Admin + CSRF | `{ name, slug? }`; Arabic name, optional editable Latin slug. | `201` category. Arabic names produce a transliterated slug; empty transliteration gets a random `category-xxxx` fallback. | `401`, `403`, `409`, `422` |
| `PATCH /api/v1/categories/:id` | Admin + CSRF | `{ name?, slug? }` | Updated category. | `401`, `403`, `404`, `409`, `422` |
| `DELETE /api/v1/categories/:id` | Admin + CSRF | Category id | `{ deleted: true }` soft-delete. | `401`, `403`, `404`, `409` with `usageCount` |
| `POST /api/v1/categories/reorder` | Admin + CSRF | `{ ids: [...] }`, exact set of active category ids | `{ items }` in new order. | `401`, `403`, `409`, `422` |
| `GET /api/v1/audit` | Admin | entity/action/actor filters, Cairo `dateFrom`/`dateTo`, `page`, `pageSize` (1–100) | Paged rows ordered by `occurredAt` and id descending; actor contains only id/name. | `401`, `403`, `422` |
| `GET /api/v1/audit/export.csv` | Admin | Same filters | UTF-8 BOM CSV, formula-injection protection, maximum 10,000 rows; creates an `audit_exported` event. | `401`, `403`, `422` |

Settings mutations accept one section per request; the body is allowlisted per section and saved with optimistic concurrency. `viewSettings` is an explicit Assistant grant. Invited users snapshot current staff defaults at invite acceptance; existing accounts keep their saved grants. Category slugs use a fixed Arabic transliteration map in the service. Category deletion checks both draft and published course snapshots using either Arabic category name or slug.

## BE-4B overview, payment-role policy and link previews

| Method + path | Auth and permission | Request/query | Success response | Errors |
|---|---|---|---|---|
| `GET /api/v1/admin/overview` | Auth + Admin | Optional inclusive `from` and `to` (`YYYY-MM-DD`, Africa/Cairo calendar days); omission means all time. Currency is EGP. | `{ from, to, totalRegistrations, registrations, paid, unpaid, netRevenue, courses: [{ id, title, registrations, paid, revenue, currency }] }`; money fields are integer minor units; empty results return zero counts/revenue and `courses: []`. | `400/422` invalid/reversed dates; `401`; `403` Assistant. |
| `GET /api/v1/seo/courses/:slug` | Public | Current or historical slug | `200 text/html; charset=utf-8`; complete Arabic HTML metadata, canonical current SPA URL, absolute `og:image`, robots flag, and human redirect. | Identical `404 text/html` for unknown, draft, archived and deleted courses. |
| `GET /api/v1/seo/sitemap.xml` | Public | None | XML containing `/ar`, `/ar/courses`, and published indexable course URLs with `publishedAt` as `lastmod`. | `500` |
| `GET /api/v1/seo/robots.txt` | Public | None | Plain text allowing public pages, disallowing `/api/`, and naming the sitemap. | `500` |

Overview definitions: registrations are enrollment rows whose `registeredAt` falls within the selected Cairo-day range; cancelled rows remain in `registrations`. `paid` means the current enrollment `paymentSummary.status` is exactly `paid`; `unpaid` means status is not `paid` and enrollment is not cancelled (so partial, pending, refunded and unpaid rows count unpaid). Net revenue is confirmed EGP payment amounts minus confirmed EGP refunds whose `receivedAt` is in the same date range; voided rows are ignored. The per-course table uses registration cohort counts and current payment summary for `paid`; its revenue is the cohort's confirmed payment/refund cash received in the selected range. `totalRegistrations` remains the all-time count to match the frontend card. This endpoint intentionally returns only five summary metrics and a course table, not the richer B6 analytics definitions.

Assistant rights are fixed by role: default view/record payments, but only void their own `payment` record once with a reason; refunds and voiding any other actor's record remain Admin-only. Stored per-user grants remain for compatibility but do not widen effective Assistant permissions. Assignment, cancellation, confirm-without-payment, and CSV export remain Admin-only. Public image media endpoints are Admin-only; private receipt upload and signed URL keep the default Assistant `recordPayments`/`viewPayments` checks. `APP_BASE_URL` is the public site origin. `R2_PUBLIC_BASE_URL` is used for crawler image URLs; when absent, the image is resolved against `APP_BASE_URL`.
