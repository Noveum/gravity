import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { bindings, defineConfig, defineWorker, triggers } from "cf/config";

// Deploys fail until these exist on the Worker. Provider, email and storage
// settings stay optional: set them as Worker secrets when the feature is used.
const required = [
  "APP_URL",
  "BETTER_AUTH_SECRET",
  "INTEGRATION_ENCRYPTION_KEY",
  "CRON_SECRET",
];
// A Worker can only open TLS to a certificate from a public authority. A
// database behind a private one, such as Supabase, is reached through a
// Hyperdrive configuration that holds its connection string and CA; any other
// database is reached directly with the DATABASE_URL secret.
const hyperdriveId = process.env.GRAVITY_HYPERDRIVE_ID;
const hyperdriveLocal = process.env.GRAVITY_HYPERDRIVE_LOCAL_URL;
// The local runtime receives declared names only, so .dev.vars lists the rest.
const local = existsSync(".dev.vars")
  ? Object.keys(parseEnv(readFileSync(".dev.vars", "utf8")))
  : [];

// The "pr" mode builds gravity-pr, the Worker for branch previews: its own
// database and secrets, no schedule, and a preview URL for every version.
export default defineConfig(({ mode }) => {
  const preview = mode === "pr";
  return {
    worker: defineWorker({
      name: preview ? "gravity-pr" : "gravity",
      entrypoint: "./worker/index.ts",
      compatibilityDate: "2026-11-17",
      compatibilityFlags: ["nodejs_compat"],
      assets: {
        htmlHandling: "none",
        notFoundHandling: "none",
        runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
      },
      // Every request talks to PostgreSQL; run beside it, not beside the
      // visitor. Smart Placement learns where that is from traffic. A
      // deployment that knows its database region, such as "aws:us-east-1",
      // pins it from the start.
      placement: process.env.GRAVITY_PLACEMENT_REGION
        ? { region: process.env.GRAVITY_PLACEMENT_REGION }
        : { mode: "smart" },
      triggers: preview
        ? []
        : [triggers.scheduled({ schedule: "*/5 * * * *" })],
      ...(preview
        ? { workersDev: true, previewUrls: true }
        : { workersDev: false }),
      observability: { enabled: true },
      env: {
        ASSETS: bindings.assets(),
        // Requests to the app's own URL go here; see worker/self-fetch.ts.
        SELF: bindings.worker({ worker: preview ? "gravity-pr" : "gravity" }),
        HYPERDRIVE: hyperdriveId
          ? bindings.hyperdrive({
              id: hyperdriveId,
              dev: { connectionString: hyperdriveLocal },
            })
          : undefined,
        // Each preview URL signs in on its own origin, next to APP_URL.
        PREVIEW_ALIASES: preview ? bindings.text("true") : undefined,
        ...Object.fromEntries(
          [
            ...required,
            ...(hyperdriveId ? [] : ["DATABASE_URL"]),
            ...local,
          ].map((name) => [name, bindings.secret()]),
        ),
      },
    }),
  };
});
