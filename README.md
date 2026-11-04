# Passion Academy API

Node.js + TypeScript + Express API. BE-1 supplies the secure server foundation and health endpoints. Course, authentication and other business APIs are introduced in their requested slices; no course routes are implemented here.

## Requirements

- Node.js 22 or newer LTS and npm.
- Docker Desktop for the local MongoDB replica set, or a MongoDB Atlas replica-set URI.

## Local MongoDB with Docker

From this repository:

```powershell
docker compose up -d
docker compose ps
Copy-Item .env.example .env
npm ci
npm run dev
```

The compose health check initializes a one-node replica set named `rs0`. The default `.env.example` URI is `mongodb://127.0.0.1:27017/passion?replicaSet=rs0`. Keep `.env` local; it is git-ignored.

In another terminal, verify liveness and database readiness:

```powershell
Invoke-RestMethod http://localhost:4000/api/v1/health
Invoke-RestMethod http://localhost:4000/api/v1/health/ready
```

## MongoDB Atlas

1. Create a free **M0** cluster in MongoDB Atlas (Atlas clusters are replica sets and support transactions).
2. In **Database Access**, create a database user with a strong password and only the permissions needed for this app.
3. In **Network Access**, allow the IP address of the machine running the API.
4. Choose **Connect → Drivers**, copy the connection string, and put it in `MONGODB_URI` in your local `.env`. Replace the username, password and cluster host locally. Keep `.env` out of version control and never put the URI in frontend variables or chat.

On startup, the API pings MongoDB and checks the `hello` response. Production startup fails unless the URI identifies a replica set and the live connection advertises one. Invalid or unreachable connections fail startup without printing the URI or driver error details.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Yes | `development`, `test`, or `production`. |
| `PORT` | Yes | HTTP listen port, 1–65535. |
| `TRUST_PROXY_HOPS` | No (0) | Number of verified trusted reverse-proxy hops. Express uses this for `req.ip` and IP-based rate-limit keys; do not enable it without a trusted proxy. |
| `MONGODB_URI` | Yes | MongoDB connection URI; production requires a remote credentialed replica set. Production MongoDB passwords must be at least 32 characters and not sample values. |
| `ACCESS_TOKEN_SECRET` | Yes | At least 32 characters; production rejects example/test/development values; must differ from refresh secret. |
| `REFRESH_TOKEN_SECRET` | Yes | At least 32 characters; production rejects example/test/development values; must differ from access secret. |
| `COOKIE_DOMAIN` | Yes | Domain for non-local development cookies; omitted for local hosts and production `__Host-` cookies. |
| `COOKIE_SECURE` | Yes | `true` or `false`; must be `true` in production. |
| `COOKIE_SAME_SITE` | No (`lax`) | `lax`, `strict`, or `none`; `none` requires `COOKIE_SECURE=true`. |
| `CORS_ORIGINS` | Yes | Comma-separated exact origin URLs; production permits HTTPS origins only and rejects wildcards and paths. |
| `APP_BASE_URL` | Yes | Frontend base URL; HTTPS required in production. |
| `LOG_LEVEL` | Yes | Pino level: fatal, error, warn, info, debug, trace, or silent. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BUCKET`, `R2_PRIVATE_BUCKET`, `R2_PUBLIC_BASE_URL` | No in development; required in production | Server-only R2 settings for media. Configure all six together; production credential fields must be at least 32 characters and not sample values. |
| `RECEIPT_SIGNED_URL_SECONDS` | No (300) | Private receipt URL lifetime, from 60 to 900 seconds. |
| `EMAIL_FROM`, `EMAIL_PROVIDER_API_KEY` | No | No production provider transport is implemented yet. Production does not use the development console-link transport; invite/reset messages need a provider integration before delivery. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` | No | Required only when running `npm run seed:admin`; credentials are never printed. |

The server fails before listening when any required value is missing or invalid and reports each variable by name. Generate different random secrets for access and refresh tokens when deploying.

## Development and checks

```powershell
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` requires `MONGODB_URI_TEST` for database integration tests. Configure a disposable database whose selected name ends in `_test` (default `passion_test`). Tests run only with `NODE_ENV=test` and clean only the collections they own. Without a test URI the suite fails by default; `ALLOW_SKIP_DB_TESTS=1 npm test` explicitly skips database suites and is not a passing full test run. Never log the URI or use production data. `npm run start` runs the compiled `dist/server/index.js` after `npm run build`.

For index synchronization, explicitly confirm the exact database selected in `MONGODB_URI`:

```powershell
npm run indexes:sync -- --confirm-db=PASSION
```

Replace `PASSION` with the actual database name. The command refuses `_test` databases unless both the exact confirmation and `--allow-test-db` are supplied. The seed-admin command uses the same database confirmation.

## API conventions

Routes are `/api/v1`; route handlers validate request schemas and unknown keys are stripped. Business logic belongs in services, permission checks in middleware and object-level service checks, persistence in Mongoose models. Pagination responses use `{ items, total, page, pageSize }`. The academy reporting time zone is `Africa/Cairo`. See [docs/API.md](docs/API.md) for implemented endpoints.

## BE-3 authentication setup

Set `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` and `SEED_ADMIN_NAME` in the ignored local `.env`. The password must satisfy the shared policy (10+ characters, upper/lowercase, number, symbol, no edge spaces, and not the account email/common-password list). Then run:

```powershell
npm run seed:admin -- --confirm-db=PASSION
npm run dev
```

The seed command is idempotent: an existing email is left unchanged. It never prints the password. Replace `PASSION` with the exact database name. To intentionally seed a disposable `_test` database, pass both `--confirm-db=<exact-test-database>` and `--allow-test-db`; never use that flag with a production URI. In development, invite and password-reset links are written to the local console for manual delivery; production never logs those links. Configure a real email transport before production use.

For browser clients, first call `GET /api/v1/auth/csrf`, then send the returned `csrfToken` in `X-CSRF-Token` and include credentials on same-origin login, refresh, logout, password and admin mutations. Configure the exact frontend origin in `CORS_ORIGINS`. Production auth cookies require HTTPS and use `__Host-` cookie names.

## Deploy the API on Railway

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the production deployment checklist, variables, backups, and smoke checks. [docs/RAILWAY_DEPLOY.md](docs/RAILWAY_DEPLOY.md) contains the shorter Railway/Vercel setup. The API builds with `npm run build`, starts with `npm run start`, listens on Railway's injected `PORT`, and exposes `/api/v1/health/ready` for a deployment health check.
