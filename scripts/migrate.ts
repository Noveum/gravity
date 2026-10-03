import { migrateDatabase } from "../packages/database/client";

await migrateDatabase();
console.log("Database migrations complete.");
