import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app/createApp';
import { parseEnvironment } from '../src/config/env';
import { createLogger } from '../src/config/logger';
import { enumerateRegisteredRoutes, routeProtectionIssues } from '../src/security/routeInventory';

const environment = parseEnvironment({
  NODE_ENV: 'test', PORT: '4000', MONGODB_URI: 'mongodb://127.0.0.1:27017/passion?replicaSet=rs0',
  ACCESS_TOKEN_SECRET: 'security-review-access-secret-00000000001', REFRESH_TOKEN_SECRET: 'security-review-refresh-secret-00000000002',
  COOKIE_DOMAIN: 'localhost', COOKIE_SECURE: 'false', CORS_ORIGINS: 'http://localhost:5173', APP_BASE_URL: 'http://localhost:5173', LOG_LEVEL: 'silent',
});

const app = createApp(environment, { logger: createLogger('silent') });
const routes = enumerateRegisteredRoutes(app);
const issues = routeProtectionIssues(routes);
if (issues.length) throw new Error(`Route security inventory failed:\n${issues.join('\n')}`);

const rows = routes.map((route) => {
  const access = route.auth ? 'Required' : 'Public allowlist';
  const checks = [...(route.roles ?? []).map((role) => `role:${role}`), ...(route.permissions ?? []).map((permission) => `permission:${permission}`)];
  const policy = checks.length ? checks.join(', ') : 'Public allowlist';
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method);
  const csrf = route.method === 'POST' && route.path === '/api/v1/public/registrations'
    ? 'Origin only (documented exception)'
    : mutating ? 'Yes' : 'No';
  return `| ${route.method} | \`${route.path}\` | ${access} | ${policy} | ${csrf} | \`security.route-inventory.unit.test.ts\` |`;
});

const content = `# Security route review\n\nGenerated from the routers mounted by \`createApp()\`; regeneration fails if a route misses the required guard. Route enumeration and policy checks are proved by \`security.route-inventory.unit.test.ts\`.\n\n| Method | Path | Auth | Role or permission | CSRF | Proving test |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n\n## Object-level access checks\n\n| Resource | IDOR protection evidence |\n|---|---|\n| Enrollments and related lead details | \`staffRecords.mongo.integration.test.ts\`: “returns detail without secrets or unrelated lead data and normalizes invalid/missing ids to the same 404”; enrollment actions are also covered by “enforces auth, CSRF and Assistant permissions while allowing default follow-up and notes actions”. |\n| Notes | \`staffRecords.mongo.integration.test.ts\`: “enforces auth, CSRF and Assistant permissions while allowing default follow-up and notes actions”; note listing and creation resolve through the actor-visible enrollment. |\n| Payments | \`payments.mongo.integration.test.ts\`: “enforces fixed Assistant payment rights, CSRF, ownership and currency matching”; “filters and sorts enrollment/payment lists, hides summary for an actor without viewPayments, and scopes payment details”. |\n| Receipts and media | \`media.mongo.integration.test.ts\`: “uses fixed Assistant payment rights for private receipts and audits receipt access by ids”; “attaches a private receipt once, rejects duplicate attachment and rejects a different Assistant”; “restricts public media upload, list and get to Admin while preserving Assistant receipt access”. |\n| Users and invites | \`auth.mongo.integration.test.ts\`: “prevents last-admin demotion/deactivation and self-demotion; assistant cannot call admin routes”; invite acceptance/reset single-use checks are in the auth integration file. |\n\n## Security checks beyond route enumeration\n\n- Production environment validation covers replica-set URIs, remote Mongo credentials, HTTPS app/CORS origins, Secure production cookies, complete R2 configuration, and secret length/example-value rejection: \`environment.test.ts\`.\n- Proxy trust and rate-limit client IP behavior: \`foundation.http.test.ts\`.\n- HSTS, production error envelope and PII redaction: \`security.logging.unit.test.ts\`.\n- Request CSRF behavior: \`auth.mongo.integration.test.ts\`, \`staffRecords.mongo.integration.test.ts\`, and \`media.mongo.integration.test.ts\`.\n\n## Not covered / external dependencies\n\n- The production email delivery provider is not implemented; production does not use the development console-link transport, but invite/reset delivery needs a provider integration before those messages can be delivered.\n- Live production Atlas replica-set access and Cloudflare R2 credentials require deployment smoke checks; unit tests validate configuration shape only.\n- Social-crawler routing from the public host to the SEO API remains a hosting-edge task documented in \`docs/LINK_PREVIEW.md\`.\n`;

writeFileSync(fileURLToPath(new URL('../docs/SECURITY_REVIEW.md', import.meta.url)), content, 'utf8');
process.stdout.write(`Generated security review for ${routes.length} registered routes.\n`);
