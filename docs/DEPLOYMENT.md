# Backend deployment and operations

This guide covers a production deployment of the API on Railway with MongoDB Atlas and Cloudflare R2. Keep all credentials in the Railway service Variables panel; never put them in Vercel variables, source files, logs, or chat.

## Railway service

Deploy the backend repository from GitHub. For a monorepo, set the Railway service Root Directory to `PASSION_BACKEND`.

| Railway setting | Value |
|---|---|
| Build command | `npm ci && npm run build` |
| Start command | `npm run start` |
| Healthcheck path | `/api/v1/health/ready` |
| Port | Leave unset; Railway injects `PORT`. |

The process exits before listening if required production configuration is invalid. A successful boot checks that MongoDB actually advertises a replica set. Graceful shutdown handles `SIGINT` and `SIGTERM` and closes HTTP and MongoDB connections.

## Environment variables

Add these in Railway → service → Variables. Do not add `.env` to the deployment.

| Variable | Required | Rule |
|---|---:|---|
| `NODE_ENV` | Yes | Set to `production`. |
| `PORT` | Railway | Use Railway's injected value; do not hardcode a port. |
| `MONGODB_URI` | Yes | Remote Atlas URI with credentials and a replica set. A `mongodb+srv://` URI is accepted; a standard `mongodb://` URI must include `replicaSet`. MongoDB password must be at least 32 characters and not a sample value. The URI must select the intended production database. |
| `ACCESS_TOKEN_SECRET` | Yes | Random secret, at least 32 characters; not an example, test, or development value. |
| `REFRESH_TOKEN_SECRET` | Yes | Separate random secret, at least 32 characters; not an example, test, or development value. |
| `COOKIE_DOMAIN` | Yes by schema | Keep a nonempty value. Production `__Host-` cookies ignore Domain and require `Secure; Path=/`. |
| `COOKIE_SECURE` | Yes | `true`. |
| `COOKIE_SAME_SITE` | No | Prefer `lax` with a same-origin Vercel proxy. Direct cross-site browser requests require `none`, which is accepted only with Secure cookies. |
| `CORS_ORIGINS` | Yes | Exact comma-separated HTTPS origins only; for the current site use `https://passion-frontend.vercel.app` with no `/ar`, wildcard, path, or trailing slash. |
| `APP_BASE_URL` | Yes | HTTPS public frontend origin, for example `https://passion-frontend.vercel.app`. |
| `TRUST_PROXY_HOPS` | No, defaults to `0` | Set to the verified number of trusted proxy hops. Use `1` only when one trusted proxy sits in front of the Railway app. Express uses this value for `req.ip`, which feeds IP rate limits and request attribution. Do not trust arbitrary client-supplied forwarding headers. |
| `LOG_LEVEL` | Yes | Usually `info` in production. Passwords, tokens, cookies, authorization values, email and phone fields are redacted. Request IP is omitted from HTTP logs. |
| `R2_ACCOUNT_ID` | Yes | Cloudflare account identifier. |
| `R2_ACCESS_KEY_ID` | Yes | R2 token access key; at least 32 characters and not a sample value. |
| `R2_SECRET_ACCESS_KEY` | Yes | R2 token secret; at least 32 characters and not a sample value. |
| `R2_PUBLIC_BUCKET` | Yes | Public site-image bucket name. |
| `R2_PRIVATE_BUCKET` | Yes | Private receipt bucket name. |
| `R2_PUBLIC_BASE_URL` | Yes | HTTPS public base URL for public images. |
| `RECEIPT_SIGNED_URL_SECONDS` | No, defaults to `300` | Integer from 60 through 900. |
| `EMAIL_FROM`, `EMAIL_PROVIDER_API_KEY` | No | No production email provider transport is implemented yet. Production never logs invite or reset links; delivery requires a provider integration before inviting staff or sending password resets. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` | Only for initial seed | Supply only for the seed command. Password follows the account password policy. Remove these variables after seeding. |
| `MONGODB_URI_TEST`, `MONGODB_TEST_DB`, `TEST_ARGON2_MEMORY_COST`, `TEST_ARGON2_TIME_COST` | No; test only | Do not set these on the production service. |

## First-time setup

1. In Atlas, create a production cluster and a dedicated database user. Use a unique, long password and least-privilege access for the application database.
2. In Atlas Network Access, allow the API's outbound IP range. Railway egress can be dynamic depending on plan and service configuration; use Railway's documented static egress option or a controlled network design. Avoid leaving Atlas open to `0.0.0.0/0` as a permanent allowlist entry.
3. In Cloudflare R2, create separate public-image and private-receipt buckets. Create an API token with **Object Read and Write** scoped to those two buckets only. Do not grant account-wide or unrelated bucket access. Put the token values in the six `R2_*` variables above.
4. Set the required Railway variables and deploy. Confirm `/api/v1/health/ready` returns ready with database `ok`.
5. Synchronize indexes against the explicitly named production database before creating the first Admin. From the backend directory, with `MONGODB_URI` set only in the environment:

   ```powershell
   npm run indexes:sync -- --confirm-db=PASSION
   ```

   Replace `PASSION` with the exact database name selected in `MONGODB_URI`. The script refuses `_test` databases unless the deliberate `--allow-test-db` flag is also supplied.

6. Set the three `SEED_ADMIN_*` variables temporarily, then seed the Admin against the same confirmed database:

   ```powershell
   npm run seed:admin -- --confirm-db=PASSION
   ```

   Remove the seed variables afterward. The script is idempotent and does not overwrite an existing account. It refuses `_test` databases unless explicitly allowed.
7. Run the post-deploy checks below. Do not announce the deployment as ready until the actual Atlas and R2 checks pass.

## Smoke checks after deployment

```powershell
Invoke-RestMethod https://<railway-domain>/api/v1/health
Invoke-RestMethod https://<railway-domain>/api/v1/health/ready
npm run r2:smoke
```

Liveness should return HTTP 200. Readiness should return HTTP 200 with database `ok`. The R2 smoke script verifies access to both configured buckets. These checks must be run using the deployed configuration; local unit tests cannot prove cloud access.

Also verify login, refresh, logout and a protected request from the deployed frontend. Use HTTPS. Keep `CORS_ORIGINS` exact. Never paste cookies, CSRF tokens, passwords or connection strings into issue reports.

## Social link preview routing

The API's `GET /api/v1/seo/courses/:slug` serves crawler HTML. The public host must route requests under `/ar/courses/*` to the matching API SEO endpoint only for social crawler user agents (`facebookexternalhit`, `Facebot`, `WhatsApp`, `Twitterbot`, `LinkedInBot`). Human browser requests must continue to the frontend SPA. Preserve the requested slug so historical-slug canonical redirects work. This edge rule is pending the hosting decision; see [LINK_PREVIEW.md](LINK_PREVIEW.md). Do not send crawler routing through a rule that rewrites ordinary `/api/v1/*` requests to `index.html`.

## Atlas backup and restore

Enable Atlas continuous cloud backup where available, or scheduled snapshots on the selected tier. Choose and document a retention period that meets the academy's legal and operational requirements; retention has not yet been decided. Monitor backup success and run a restore drill to a separate cluster or database before relying on backups. Record the drill date, restore duration, validation results, and cleanup.

Manual restore outline:

1. Pause writes or put the application into its planned maintenance state and record the recovery point.
2. In Atlas, restore the selected snapshot or point-in-time backup to a new temporary cluster/database. Do not overwrite the original during the first validation.
3. Validate collections, indexes, representative course/enrollment/payment counts, and application readiness against the restored target. Confirm the selected backup point meets the recovery objective.
4. Update the Railway `MONGODB_URI` to the validated restored target, redeploy/restart, and verify health, readiness, login, and read-only staff workflows.
5. Keep the original cluster isolated until the owner accepts recovery, then follow the documented retention and secure disposal policy. Record the incident and restore drill result.

The academy must decide retention duration and recovery objectives (RPO/RTO) before production launch.
