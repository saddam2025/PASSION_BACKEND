# Security route review

Generated from the routers mounted by `createApp()`; regeneration fails if a route misses the required guard. Route enumeration and policy checks are proved by `security.route-inventory.unit.test.ts`.

| Method | Path | Auth | Role or permission | CSRF | Proving test |
|---|---|---|---|---|---|
| GET | `/api/v1/admin/overview` | Required | role:admin | No | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/audit` | Required | role:admin | No | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/audit/export.csv` | Required | role:admin | No | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/auth/change-password` | Required | role:admin, role:assistant | Yes | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/auth/csrf` | Public allowlist | Public allowlist | No | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/auth/invites/:token` | Public allowlist | Public allowlist | No | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/auth/invites/accept` | Public allowlist | Public allowlist | Yes | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/auth/login` | Public allowlist | Public allowlist | Yes | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/auth/logout` | Public allowlist | Public allowlist | Yes | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/auth/me` | Required | role:admin, role:assistant | No | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/auth/password-reset/confirm` | Public allowlist | Public allowlist | Yes | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/auth/password-reset/request` | Public allowlist | Public allowlist | Yes | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/auth/refresh` | Public allowlist | Public allowlist | Yes | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/categories` | Public allowlist | Public allowlist | No | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/categories` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| DELETE | `/api/v1/categories/:id` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| PATCH | `/api/v1/categories/:id` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/categories/public` | Public allowlist | Public allowlist | No | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/categories/reorder` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/courses` | Required | role:admin | No | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/courses` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| DELETE | `/api/v1/courses/:id` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/courses/:id` | Required | role:admin | No | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/courses/:id/archive` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| PUT | `/api/v1/courses/:id/draft` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| PATCH | `/api/v1/courses/:id/featured` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/courses/:id/publish` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/courses/:id/unarchive` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/courses/:id/unpublish` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/courses/check-slug` | Required | role:admin | No | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/enrollments` | Required | permission:viewLeads | No | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/enrollments/:id` | Required | permission:viewLeads | No | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/enrollments/:id/assign` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/enrollments/:id/cancel` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/enrollments/:id/confirm` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| PATCH | `/api/v1/enrollments/:id/follow-up` | Required | permission:updateFollowUp | Yes | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/enrollments/:id/notes` | Required | permission:manageNotes | No | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/enrollments/:id/notes` | Required | permission:manageNotes | Yes | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/enrollments/:id/payments` | Required | permission:viewPayments | No | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/enrollments/:id/payments` | Required | permission:recordPayments | Yes | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/enrollments/:id/whatsapp-contact` | Required | permission:updateFollowUp | Yes | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/enrollments/export.csv` | Required | role:admin | No | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/enrollments/export.csv` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/enrollments/filters` | Required | permission:viewLeads | No | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/health` | Public allowlist | Public allowlist | No | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/health/ready` | Public allowlist | Public allowlist | No | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/invites` | Required | role:admin | No | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/invites` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/invites/:id/resend` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/invites/:id/revoke` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/leads/:id` | Required | permission:viewLeads | No | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/media` | Required | role:admin | No | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/media` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| DELETE | `/api/v1/media/:id` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/media/:id` | Required | role:admin | No | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/media/receipts` | Required | permission:recordPayments | Yes | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/media/receipts/:id/url` | Required | permission:viewPayments | No | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/notifications` | Required | role:admin, role:assistant | No | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/notifications/:id/read` | Required | role:admin, role:assistant | Yes | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/notifications/read-all` | Required | role:admin, role:assistant | Yes | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/notifications/unread-count` | Required | role:admin, role:assistant | No | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/payments` | Required | permission:viewPayments | No | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/payments/:id/void` | Required | permission:recordPayments | Yes | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/public/courses` | Public allowlist | Public allowlist | No | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/public/courses/:slug` | Public allowlist | Public allowlist | No | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/public/registrations` | Public allowlist | Public allowlist | Origin only (documented exception) | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/public/registrations/:reference` | Public allowlist | Public allowlist | No | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/seo/courses/:slug` | Public allowlist | Public allowlist | No | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/seo/robots.txt` | Public allowlist | Public allowlist | No | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/seo/sitemap.xml` | Public allowlist | Public allowlist | No | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/settings` | Required | permission:viewSettings | No | `security.route-inventory.unit.test.ts` |
| PATCH | `/api/v1/settings` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/settings/public` | Public allowlist | Public allowlist | No | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/users` | Required | role:admin | No | `security.route-inventory.unit.test.ts` |
| GET | `/api/v1/users/:id` | Required | role:admin | No | `security.route-inventory.unit.test.ts` |
| PATCH | `/api/v1/users/:id` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/users/:id/deactivate` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |
| POST | `/api/v1/users/:id/reactivate` | Required | role:admin | Yes | `security.route-inventory.unit.test.ts` |

## Object-level access checks

| Resource | IDOR protection evidence |
|---|---|
| Enrollments and related lead details | `staffRecords.mongo.integration.test.ts`: “returns detail without secrets or unrelated lead data and normalizes invalid/missing ids to the same 404”; enrollment actions are also covered by “enforces auth, CSRF and Assistant permissions while allowing default follow-up and notes actions”. |
| Notes | `staffRecords.mongo.integration.test.ts`: “enforces auth, CSRF and Assistant permissions while allowing default follow-up and notes actions”; note listing and creation resolve through the actor-visible enrollment. |
| Payments | `payments.mongo.integration.test.ts`: “enforces fixed Assistant payment rights, CSRF, ownership and currency matching”; “filters and sorts enrollment/payment lists, hides summary for an actor without viewPayments, and scopes payment details”. |
| Receipts and media | `media.mongo.integration.test.ts`: “uses fixed Assistant payment rights for private receipts and audits receipt access by ids”; “attaches a private receipt once, rejects duplicate attachment and rejects a different Assistant”; “restricts public media upload, list and get to Admin while preserving Assistant receipt access”. |
| Users and invites | `auth.mongo.integration.test.ts`: “prevents last-admin demotion/deactivation and self-demotion; assistant cannot call admin routes”; invite acceptance/reset single-use checks are in the auth integration file. |

## Security checks beyond route enumeration

- Production environment validation covers replica-set URIs, remote Mongo credentials, HTTPS app/CORS origins, Secure production cookies, complete R2 configuration, and secret length/example-value rejection: `environment.test.ts`.
- Proxy trust and rate-limit client IP behavior: `foundation.http.test.ts`.
- HSTS, production error envelope and PII redaction: `security.logging.unit.test.ts`.
- Request CSRF behavior: `auth.mongo.integration.test.ts`, `staffRecords.mongo.integration.test.ts`, and `media.mongo.integration.test.ts`.

## Not covered / external dependencies

- The production email delivery provider is not implemented; production does not use the development console-link transport, but invite/reset delivery needs a provider integration before those messages can be delivered.
- Live production Atlas replica-set access and Cloudflare R2 credentials require deployment smoke checks; unit tests validate configuration shape only.
- Social-crawler routing from the public host to the SEO API remains a hosting-edge task documented in `docs/LINK_PREVIEW.md`.
