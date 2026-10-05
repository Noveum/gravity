import { siteCopy } from "./content";

export const gravityRepository = "https://github.com/Noveum/gravity";
export const deploymentGuide = "/docs/deploy-on-vercel";
export const deploymentEnvironment = [
  "APP_URL",
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "INTEGRATION_ENCRYPTION_KEY",
  "CRON_SECRET",
  "CRM_DEMO_MODE",
  "DATABASE_SSL_MODE",
  "PUBLIC_SITE_INDEXING",
] as const;

// Only non-sensitive flags are supplied. Each installation supplies its own
// database and provider credentials in Vercel's environment form.
export function vercelDeployUrl() {
  const query = new URLSearchParams({
    "repository-url": gravityRepository,
    "project-name": "gravity",
    "repository-name": "gravity",
    env: deploymentEnvironment.join(","),
    envDefaults: JSON.stringify({
      CRM_DEMO_MODE: "false",
      DATABASE_SSL_MODE: "verify-full",
      PUBLIC_SITE_INDEXING: "false",
    }),
    envDescription: siteCopy.deployEnvironmentDescription,
    envLink: `${gravityRepository}/blob/main/docs/vercel.md#environment`,
  });
  return `https://vercel.com/new/clone?${query}`;
}
