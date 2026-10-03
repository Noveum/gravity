import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { DomainError, type Principal } from "../core/policy";
import { getDatabase, isDemoMode } from "../database/client";
import * as schema from "../database/schema";
import { demoUser } from "../database/seed";
import { appUrl, authPlugins } from "./options";

export function enabledProviders() {
  return [
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? "google"
      : null,
    process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? "github"
      : null,
  ].filter((value): value is "google" | "github" => value !== null);
}
async function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new DomainError("AUTH_UNAVAILABLE", 503);
  const db = await getDatabase();
  const socialProviders = {
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
  };
  return betterAuth({
    baseURL: appUrl(),
    secret,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    socialProviders,
    plugins: authPlugins(db),
    rateLimit: { enabled: true },
    advanced: { useSecureCookies: appUrl().startsWith("https://") },
  });
}
let authPromise: ReturnType<typeof createAuth> | undefined;
export async function getAuth() {
  authPromise ??= createAuth().catch((error) => {
    authPromise = undefined;
    throw error;
  });
  return authPromise;
}
export async function currentPrincipal(headers: Headers): Promise<Principal> {
  if (isDemoMode()) return { userId: demoUser, source: "demo" };
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers });
  if (!session) throw new DomainError("UNAUTHORIZED", 401);
  return { userId: session.user.id, source: "session" };
}
export function assertMutationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(appUrl()).origin)
    throw new DomainError("FORBIDDEN", 403);
}
