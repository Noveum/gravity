import { migrateDatabase } from "../packages/database/client";
import { loadScriptEnvironment } from "./environment";

loadScriptEnvironment();
try {
  await migrateDatabase();
  console.log("Database migrations complete.");
} catch {
  console.error(
    "Database migration failed. Check the target, credentials, TLS CA and migration permissions.",
  );
  process.exitCode = 1;
}
