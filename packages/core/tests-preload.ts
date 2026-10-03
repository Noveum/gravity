import { ensureLaneDatabase } from '@gravity/db/test-lane';
import { resolveTestDatabaseUrl } from '../../scripts/test-env.ts';

const databaseUrl = resolveTestDatabaseUrl('gravity_test_core');
await ensureLaneDatabase(databaseUrl, 'gravity_test_core');
process.env['DATABASE_URL'] = databaseUrl;
process.env['REDIS_URL'] = '';
process.env['DATABASE_POOL_MAX'] = '1';
