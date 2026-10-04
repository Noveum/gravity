import { ensureLaneDatabase } from '@gravity/db/test-lane';
import { resolveTestDatabaseUrl } from '../../scripts/test-env.ts';

const databaseUrl = resolveTestDatabaseUrl('gravity_test_mcp');
await ensureLaneDatabase(databaseUrl, 'gravity_test_mcp');
process.env['DATABASE_URL'] = databaseUrl;
process.env['REDIS_URL'] = '';
process.env['DATABASE_POOL_MAX'] = '2';
if ((process.env['BETTER_AUTH_SECRET'] ?? '').length < 16) {
  process.env['BETTER_AUTH_SECRET'] = 'gravity-test-secret-0123456789abcdef';
}
