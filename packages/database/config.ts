import type { Options } from "postgres";

interface DatabaseEnvironment {
  NODE_ENV?: string;
  DATABASE_SSL_MODE?: string;
  DATABASE_SSL_CA?: string;
}

export function databaseOptions(
  connectionUrl: string,
  environment: DatabaseEnvironment = process.env,
): Options<Record<string, never>> {
  let url: URL;
  try {
    url = new URL(connectionUrl);
  } catch {
    throw new Error("DATABASE_URL_INVALID");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname)
    throw new Error("DATABASE_URL_INVALID");
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const isSupabase = /\.(supabase\.co|pooler\.supabase\.com)$/.test(
    url.hostname,
  );
  if (isSupabase && url.port === "6543")
    throw new Error("DATABASE_SESSION_POOLER_REQUIRED");
  const sslMode = environment.DATABASE_SSL_MODE ?? "verify-full";
  if (!["verify-full", "disable"].includes(sslMode))
    throw new Error("DATABASE_SSL_MODE_INVALID");
  if (
    sslMode === "disable" &&
    (!isLocal || environment.NODE_ENV === "production")
  )
    throw new Error("DATABASE_TLS_REQUIRED");
  // Postgres.js ssl='require' skips certificate verification. Always supply
  // explicit TLS options, including the provider CA when one is required.
  return {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    max_lifetime: 300,
    ssl:
      sslMode === "disable"
        ? false
        : {
            rejectUnauthorized: true,
            ...(environment.DATABASE_SSL_CA
              ? { ca: environment.DATABASE_SSL_CA.replace(/\\n/g, "\n") }
              : {}),
          },
    connection: { application_name: "gravity" },
    // Notices can include SQL statement details; surface failures through
    // sanitized application errors rather than a driver's default logger.
    onnotice: () => {},
  };
}
