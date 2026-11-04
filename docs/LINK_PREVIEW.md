# Course link preview hosting notes

The API serves crawler HTML from `GET /api/v1/seo/courses/:slug`. The page reads only the currently published snapshot and includes Arabic title/description, canonical URL, Open Graph/Twitter metadata, absolute image URL and an immediate human redirect to the real SPA URL. Historical slugs return metadata canonicalized to the current slug. `GET /api/v1/seo/sitemap.xml` and `/api/v1/seo/robots.txt` provide crawler discovery.

## Vercel deployment rewrite

`PASSION_FRONTEND/vercel.json` routes `/ar/courses/:slug` and `/courses/:slug` to `GET /api/v1/seo/courses/:slug` only when the User-Agent matches `facebookexternalhit`, `Facebot`, `WhatsApp`, `Twitterbot`, `LinkedInBot`, `TelegramBot`, or `Slackbot`. Human browsers continue to the SPA. The source URL slug is preserved so historical-slug canonicalization runs in the API. This is crawler routing, not access control.

The same Vercel rewrite list sends `/api/:path*` to the backend and maps `/sitemap.xml` and `/robots.txt` to `/api/v1/seo/sitemap.xml` and `/api/v1/seo/robots.txt`. These rules precede the SPA fallback. Set backend `APP_BASE_URL` to `https://passion-frontend.vercel.app`; the API emits canonical and sitemap URLs for that public origin.
