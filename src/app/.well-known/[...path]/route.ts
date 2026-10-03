import { getAuth } from "@crm/auth/server";
import { errorResponse } from "@crm/core/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    // The provider's onRequest hook recognizes the RFC root/issuer discovery paths.
    // Prefixing /api/auth would bypass protected-resource discovery.
    return (await getAuth()).handler(request);
  } catch (error) {
    return errorResponse(error);
  }
}
