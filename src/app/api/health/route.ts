import { appUrl } from "@crm/auth/options";
import { getDatabase, isDemoMode } from "@crm/database/client";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = performance.now();
  let isReady = false;
  try {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (isDemoMode() || !secret || secret.length < 32 || !loginConfigured())
      throw new Error("PRODUCTION_CONFIGURATION_REQUIRED");
    appUrl();
    const db = await getDatabase();
    await db.execute(sql`SELECT id FROM public.organizations LIMIT 0`);
    await db.execute(sql`SELECT id FROM public.session LIMIT 0`);
    await db.execute(sql`SELECT id FROM public.pipelines LIMIT 0`);
    await db.execute(
      sql`SELECT id, status, request_hash FROM public.deliveries LIMIT 0`,
    );
    await db.execute(
      sql`SELECT owner_id, probability, expected_close_date, closed_at FROM public.opportunities LIMIT 0`,
    );
    isReady = true;
  } catch {
    // Errors can contain SQL, URLs or credentials. Log only bounded status.
  }
  const status = isReady ? "ready" : "unavailable";
  const event = {
    event: "gravity.health",
    status,
    durationMs: Math.round(performance.now() - startedAt),
  };
  if (isReady) console.info(JSON.stringify(event));
  else console.error(JSON.stringify(event));
  return Response.json(
    { status },
    {
      status: isReady ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

import { loginConfigured } from "@crm/auth/config";
