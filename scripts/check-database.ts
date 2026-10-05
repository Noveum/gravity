import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { databaseOptions } from "../packages/database/config";
import * as schema from "../packages/database/schema";
import { loadScriptEnvironment } from "./environment";

loadScriptEnvironment();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL_REQUIRED");
const client = postgres(url, databaseOptions(url));
try {
  const expected = Object.values(schema)
    .flatMap((value) => (is(value, PgTable) ? [getTableName(value)] : []))
    .sort();
  const tables = await client<
    {
      name: string;
      rls: boolean;
      owner: boolean;
      can_read: boolean;
      can_write: boolean;
      can_truncate: boolean;
    }[]
  >`
    SELECT c.relname as name, c.relrowsecurity as rls,
      c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) as owner,
      has_table_privilege(current_user, c.oid, 'SELECT') as can_read,
      (has_table_privilege(current_user, c.oid, 'INSERT') AND
       has_table_privilege(current_user, c.oid, 'UPDATE') AND
       has_table_privilege(current_user, c.oid, 'DELETE')) as can_write,
      has_table_privilege(current_user, c.oid, 'TRUNCATE') as can_truncate
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY(${expected})
  `;
  const [role] = await client`
    SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls,
      has_schema_privilege(current_user, 'public', 'CREATE') as can_create,
      pg_has_role(current_user, 'gravity_app', 'USAGE') as server_group
    FROM pg_roles WHERE rolname = current_user
  `;
  if (
    tables.length !== expected.length ||
    tables.some(
      (t) => !t.rls || t.owner || !t.can_read || !t.can_write || t.can_truncate,
    ) ||
    !role ||
    role.rolsuper ||
    role.rolcreatedb ||
    role.rolcreaterole ||
    role.rolbypassrls ||
    role.can_create ||
    !role.server_group
  )
    throw new Error("DATABASE_RUNTIME_PERMISSIONS_UNSAFE");
  // Exercise actual SQL and RLS using the restricted runtime role.
  await client`SELECT id FROM public.organizations LIMIT 1`;
  await client`SELECT id FROM public.session LIMIT 1`;
  console.log(
    `Database verified: ${tables.length} protected tables, restricted runtime role, certificate verification enabled.`,
  );
} catch {
  console.error(
    "Database verification failed. Check migrations, runtime permissions, TLS and credentials.",
  );
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 2 });
}
