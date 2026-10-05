import { timingSafeEqual } from "node:crypto";
import { processReceipts } from "@crm/connectors/receipts";
import { IntegrationService } from "@crm/connectors/service";
import { getDatabase, isDemoMode } from "@crm/database/client";
import { connections } from "@crm/database/schema";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization") ?? "";
  if (
    !expected ||
    isDemoMode() ||
    provided.length !== `Bearer ${expected}`.length ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(`Bearer ${expected}`))
  )
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const started = Date.now();
  try {
    const db = await getDatabase();
    const receipts = await processReceipts(db);
    const service = new IntegrationService(db);
    const rows = await db
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.status, "connected"),
          isNotNull(connections.encryptedCredentials),
          or(
            isNull(connections.leaseUntil),
            lt(connections.leaseUntil, new Date()),
          ),
        ),
      )
      .orderBy(sql`${connections.lastSyncedAt} ASC NULLS FIRST`)
      .limit(4);
    let synced = 0,
      failed = 0;
    for (let offset = 0; offset < rows.length; offset += 2) {
      await Promise.all(
        rows.slice(offset, offset + 2).map(async (row) => {
          try {
            await service.sync(
              { userId: row.ownerId, source: "session" },
              row.organizationId,
              row.id,
            );
            synced++;
          } catch {
            failed++;
          }
        }),
      );
    }
    console.info(
      JSON.stringify({
        event: "gravity.integrations.cron",
        synced,
        failed,
        receipts,
        durationMs: Date.now() - started,
      }),
    );
    return Response.json(
      { synced, failed, receipts },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // Driver errors can contain connection details. Keep failure logs useful
    // without logging SQL, credentials, provider responses or imported data.
    console.error(
      JSON.stringify({
        event: "gravity.integrations.cron.failed",
        errorCode: "INTEGRATION_SYNC_UNAVAILABLE",
        durationMs: Date.now() - started,
      }),
    );
    return Response.json(
      { error: "INTEGRATION_SYNC_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
