import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { limitedBody } from "../core/http";
import { DomainError } from "../core/policy";

const oauthFlow = new AsyncLocalStorage<string>();
export function flowKey(query: string) {
  const params = new URLSearchParams(query);
  const keys = [
    "client_id",
    "redirect_uri",
    "code_challenge",
    "code_challenge_method",
    "state",
    "scope",
    "resource",
  ];
  if (!params.get("client_id") || !params.get("code_challenge"))
    throw new DomainError("INVALID_INPUT", 400);
  return createHash("sha256")
    .update(JSON.stringify(keys.map((key) => [key, params.getAll(key)])))
    .digest("hex");
}
export const currentFlowKey = () => oauthFlow.getStore();
export async function withOAuthRequest(
  request: Request,
  handler: () => Promise<Response>,
) {
  let query = new URL(request.url).search.slice(1);
  if (
    request.method === "POST" &&
    request.headers.get("content-type")?.includes("application/json")
  ) {
    const body = await limitedBody(request.clone(), 50000);
    if (body.length) {
      const parsed = JSON.parse(new TextDecoder().decode(body));
      if (typeof parsed.oauth_query === "string") query = parsed.oauth_query;
    }
  }
  if (!new URLSearchParams(query).has("code_challenge")) return handler();
  return oauthFlow.run(flowKey(query), handler);
}
