import { withOAuthRequest } from "@crm/auth/flow";
import { getAuth } from "@crm/auth/server";
import { errorResponse } from "@crm/core/http";
export const runtime = "nodejs";
async function handle(request: Request) {
  try {
    const auth = await getAuth();
    return await withOAuthRequest(request, () => auth.handler(request));
  } catch (error) {
    return errorResponse(error);
  }
}

export { handle as GET, handle as POST };
