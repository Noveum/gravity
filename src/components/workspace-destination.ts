export interface WorkspaceResult {
  organizationId: string;
  productId: string;
}

// This chooses an internal page only. OAuth parameters remain untrusted until
// the auth provider validates their signature; no caller-controlled redirect is followed.
export function workspaceDestination(result: WorkspaceResult, oauthQuery = "") {
  if (oauthQuery.length <= 10000) {
    const query = new URLSearchParams(oauthQuery);
    if (query.get("sig") && query.get("client_id"))
      return `/authorize?${query.toString()}`;
  }
  return `/?organizationId=${encodeURIComponent(result.organizationId)}&productId=${encodeURIComponent(result.productId)}`;
}
