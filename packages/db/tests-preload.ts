import { resolveTestDatabaseUrl } from '../../scripts/test-env.ts';
import { ensureLaneDatabase } from './src/test-lane.ts';

const databaseUrl = resolveTestDatabaseUrl('gravity_test_db');
await ensureLaneDatabase(databaseUrl, 'gravity_test_db');
process.env['DATABASE_URL'] = databaseUrl;
process.env['DATABASE_POOL_MAX'] = '1';
