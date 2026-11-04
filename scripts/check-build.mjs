import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../dist/shared/schemas/permissions.js');
require('../dist/services/authTokens.js');
process.stdout.write('Compiled module smoke check passed.\n');
