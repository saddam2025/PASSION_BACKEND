# Deploy Passion API on Railway

The frontend is already deployed at `https://passion-frontend.vercel.app`. Deploy this repository as a separate Railway service; do not deploy `PASSION_FRONTEND` as the API.

## Create the Railway service

1. In Railway, create a project and choose **Deploy from GitHub repo**. Select the GitHub repository for `PASSION_BACKEND`, branch `main`, and repository root `/`.
2. In the service settings use build command `npm run build` and start command `npm start`. The repository targets Node.js 22 or newer. Railway injects `PORT`; do not set a fixed port.
3. Set the healthcheck path to `/api/v1/health/ready`. This endpoint returns `200` only after the MongoDB connection is ready. Railway uses the healthcheck during rollout and switches traffic only after it gets a 2xx response.
4. Generate a Railway public domain and keep it handy for the Vercel setting below.

Railway automatically detects Node package scripts, and its healthcheck uses the injected `PORT`; a Dockerfile is not needed. The service's build/start commands can be set in Railway's dashboard. Do not add the deprecated `railway.json` configuration format for a new service.

## Railway variables

Add these in **Railway → API service → Variables**. Put secret values directly in Railway's variable editor. Do not commit them, put them in Vercel, or send them in chat.

| Variable | Value to enter |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | Leave unset; Railway injects this. |
| `TRUST_PROXY_HOPS` | `1` for direct browser-to-Railway API requests. |
| `MONGODB_URI` | The Atlas URI for the existing production database `PASSION`, not `passion_test`. Copy it from your local ignored backend `.env`; do not post it. |
| `ACCESS_TOKEN_SECRET` | Generate a unique random value at least 32 characters long. |
| `REFRESH_TOKEN_SECRET` | Generate a different unique random value at least 32 characters long. |
| `COOKIE_DOMAIN` | `localhost` (required by current schema; ignored for production `__Host-` cookies). |
| `COOKIE_SECURE` | `true` |
| `COOKIE_SAME_SITE` | `none` when using the Vercel and Railway generated domains directly; `none` requires Secure cookies. A custom frontend and API domain under the same registrable domain can use `lax` and is more reliable with browser privacy settings. |
| `CORS_ORIGINS` | `https://passion-frontend.vercel.app` (exact origin; no trailing slash). |
| `APP_BASE_URL` | `https://passion-frontend.vercel.app` |
| `LOG_LEVEL` | `info` |
| `R2_ACCOUNT_ID` | Cloudflare R2 account ID. |
| `R2_ACCESS_KEY_ID` | Secret R2 access key ID. |
| `R2_SECRET_ACCESS_KEY` | Secret R2 access key secret. |
| `R2_PUBLIC_BUCKET` | Public media bucket name. |
| `R2_PRIVATE_BUCKET` | Private receipt bucket name. |
| `R2_PUBLIC_BASE_URL` | HTTPS public media base URL. |
| `RECEIPT_SIGNED_URL_SECONDS` | Optional; defaults to `300`. |

The six R2 variables are required by production startup. Keep R2 credentials only in Railway, never in Vercel. `MONGODB_URI_TEST` and `SEED_ADMIN_*` are not production service variables. The existing Admin account is in the `PASSION` database; using that database preserves the account and course data.

## Atlas network access

Atlas only accepts database connections from IP addresses in its project's IP access list. Railway's static outbound IP feature is available on its Pro plan: enable it in the API service's Networking settings and add the displayed IP addresses to Atlas Network Access. If your Railway plan has no static outbound IP, the Railway egress address can change; do not leave an unrestricted Atlas IP entry as a permanent production configuration. Atlas documents the allowlist requirement, and Railway documents the static-IP plan requirement.

## Connect Vercel to Railway

After Railway deploys and provides its public API domain:

1. In **Vercel → passion-frontend → Settings → Environment Variables**, set `VITE_API_BASE_URL` to `https://<your-railway-domain>/api/v1` for Production (and Preview if needed). Keep the frontend's `VITE_SITE_URL` as `https://passion-frontend.vercel.app`.
2. Redeploy the Vercel frontend so Vite bakes in the API URL. Do not add MongoDB, token, email, or R2 secrets to Vercel.
3. Open `https://<your-railway-domain>/api/v1/health/ready`; expect a JSON response with `status: "ready"` and `database: "ok"`.
4. Test Admin login from the Vercel site. If cookies are blocked because the Vercel and Railway generated domains are cross-site, attach a custom domain to each service under the same registrable domain, then set `COOKIE_SAME_SITE=lax`, update `CORS_ORIGINS`, `APP_BASE_URL`, and `VITE_API_BASE_URL`, and redeploy both services.

## MongoDB IP allowlist reference

Atlas accepts connections only from IP addresses or CIDR ranges in the project's IP access list. Railway documents static outbound IPs for Pro-plan customers and calls out Atlas allowlisting as a use case. See [Railway static outbound IPs](https://docs.railway.com/networking/static-outbound-ips), [Railway healthchecks](https://docs.railway.com/deployments/healthchecks), [Railway start command](https://docs.railway.com/deployments/start-command), [MongoDB Atlas IP access list](https://www.mongodb.com/docs/atlas/security/ip-access-list/).
