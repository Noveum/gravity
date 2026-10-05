import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../database/client";
import { verification } from "../database/schema";

// Reuse the protected verification store so limits survive serverless instances.
// The primary-key upsert checks and increments under one PostgreSQL row lock.
export function databaseRateLimit(db: Database) {
  return {
    async consume(key: string, rule: { window: number; max: number }) {
      const id = `gravity-limit:${createHash("sha256")
        .update(`${rule.window}:${key}`)
        .digest("hex")}`;
      const expired = sql`${verification.expiresAt} <= CURRENT_TIMESTAMP`;
      const expiresAt = sql`CURRENT_TIMESTAMP + ${rule.window} * INTERVAL '1 second'`;
      const accepted = await db
        .insert(verification)
        .values({ id, identifier: id, value: "1", expiresAt })
        .onConflictDoUpdate({
          target: verification.id,
          set: {
            value: sql`CASE WHEN ${expired} THEN '1' ELSE (CAST(${verification.value} AS INTEGER) + 1)::TEXT END`,
            expiresAt: sql`CASE WHEN ${expired} THEN ${expiresAt} ELSE ${verification.expiresAt} END`,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          },
          where: sql`${expired} OR CAST(${verification.value} AS INTEGER) < ${rule.max}`,
        })
        .returning({ id: verification.id });
      if (accepted.length) return { allowed: true, retryAfter: null };
      const [existing] = await db
        .select({ expiresAt: verification.expiresAt })
        .from(verification)
        .where(eq(verification.id, id));
      return {
        allowed: false,
        retryAfter: existing
          ? Math.max(
              1,
              Math.ceil((existing.expiresAt.getTime() - Date.now()) / 1000),
            )
          : rule.window,
      };
    },
  };
}
