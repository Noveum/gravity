// Compatibility for already-open clients; new clients use the CRM-specific
// route because browser content blockers can treat /api/events as tracking.
export { GET } from "../crm/live/route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;
