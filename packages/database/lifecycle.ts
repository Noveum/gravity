import { after } from "next/server";
import { DATABASE_IDLE_SECONDS } from "./config";

// Postgres.js has no pool-release event for Vercel's attachDatabasePool.
// Keep its native idle timer running after the response, so a suspended
// function does not retain its idle session until that instance is deleted.
export function allowIdleDatabaseRelease() {
  if (!process.env.VERCEL_URL || !process.env.VERCEL_REGION) return;
  after(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, DATABASE_IDLE_SECONDS * 1000 + 100);
      }),
  );
}
