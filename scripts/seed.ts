import { getDatabase, isDemoMode } from "../packages/database/client";

if (!isDemoMode()) throw new Error("DEMO_SEED_DISABLED");
await getDatabase();
console.log("Fictional development data ready.");
