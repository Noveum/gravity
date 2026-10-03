import postgres from 'postgres';

const connectionString =
  process.env['DATABASE_URL'] ?? 'postgres://gravity:gravity@localhost:5436/gravity';

const sql = postgres(connectionString);

await sql`create extension if not exists pg_trgm`;
await sql.end();
