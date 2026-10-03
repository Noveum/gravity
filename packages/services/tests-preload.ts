import { ensureLaneDatabase } from '@gravity/db/test-lane';
import { resolveTestDatabaseUrl } from '../../scripts/test-env.ts';

const databaseUrl = resolveTestDatabaseUrl('gravity_test_svc');
await ensureLaneDatabase(databaseUrl, 'gravity_test_svc');
process.env['DATABASE_URL'] = databaseUrl;
process.env['DATABASE_POOL_MAX'] = '1';
