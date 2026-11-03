# Course link preview hosting notes

The API serves crawler HTML from `GET /api/v1/seo/courses/:slug`. The page reads only the currently published snapshot and includes Arabic title/description, canonical URL, Open Graph/Twitter metadata, absolute image URL and an immediate human redirect to the real SPA URL. Historical slugs return metadata canonicalized to the current slug. `GET /api/v1/seo/sitemap.xml` and `/api/v1/seo/robots.txt` provide crawler discovery.

## Deployment rewrite (pending hosting decision)

At deployment, route requests under `/ar/courses/*` to the matching API SEO endpoint only when the User-Agent is one of `facebookexternalhit`, `Facebot`, `WhatsApp`, `Twitterbot`, or `LinkedInBot`. All human browsers continue to receive the frontend SPA. Preserve the requested slug so old-slug canonicalization can run in the API. For example, an nginx `map $http_user_agent $course_preview` can detect these agents, then a location/rewrite can proxy to `/api/v1/seo/courses/$slug`; a Cloudflare Worker can do the same before serving the SPA. Avoid matching user-agent text in the application itself as an access-control rule.

If the frontend and API share a host, configure the edge/server proxy rule before the SPA fallback, keep `/api/v1/*` on the API, and use `APP_BASE_URL` as the public origin. If they use separate hosts, the public-site edge must proxy crawler requests to the API origin while canonical links still use the public-site `APP_BASE_URL`. Final hostnames and rewrite syntax remain pending the hosting decision.
