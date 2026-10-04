import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { z } from "zod";
import { DomainError, type Principal } from "../core/policy";
import type { Database } from "../database/client";
import { getDatabase, isDemoMode } from "../database/client";
import * as schema from "../database/schema";
import { demoUser } from "../database/seed";
import t from "../i18n/translations/en.json";
import { emailSignInEnabled, emailSignInPlugin } from "./email";
import { appUrl, authPlugins } from "./options";
import { databaseRateLimit } from "./rate-limit";

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
  return createAuthForDatabase(await getDatabase());
}
export function createAuthForDatabase(db: Database) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new DomainError("AUTH_UNAVAILABLE", 503);
  const limiter = databaseRateLimit(db);
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
    plugins: [
      ...authPlugins(db),
      ...(emailSignInEnabled() ? [emailSignInPlugin()] : []),
    ],
    rateLimit: { enabled: true, customStorage: limiter },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          (ctx.path === "/email-otp/send-verification-otp" ||
            ctx.path === "/sign-in/email-otp") &&
          ctx.request &&
          ctx.request.headers.get("origin") !== appUrl()
        )
          throw new APIError("FORBIDDEN", {
            code: "FORBIDDEN",
            message: t.errors.FORBIDDEN,
          });
        if (ctx.path !== "/email-otp/send-verification-otp") return;
        const email = z
          .string()
          .trim()
          .toLowerCase()
          .pipe(z.email())
          .safeParse(ctx.body?.email);
        if (!email.success || ctx.body?.type !== "sign-in")
          throw new APIError("BAD_REQUEST", {
            code: "INVALID_INPUT",
            message: t.errors.INVALID_INPUT,
          });
        const decision = await limiter.consume(`email:${email.data}`, {
          window: 60,
          max: 1,
        });
        if (!decision.allowed)
          throw new APIError("TOO_MANY_REQUESTS", {
            code: "RATE_LIMITED",
            message: t.errors.RATE_LIMITED,
          });
        ctx.body.email = email.data;
      }),
    },
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
