import { closeRealtime } from '../realtime/publisher.ts';
import { DEMO_SEED_DEFAULTS, seedDemoWorkspace } from './demo-seed.ts';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const options = {
  slug: flag('slug') ?? DEMO_SEED_DEFAULTS.slug,
  domain: flag('domain') ?? DEMO_SEED_DEFAULTS.domain,
  reuse: process.argv.includes('--reuse'),
};

let code = 0;
try {
  const result = await seedDemoWorkspace(options);
  const verb = result.reused ? 'Completed' : 'Seeded';
  console.info(
    `${verb} ${result.slug}: ${result.brands} brands, ${result.people} people, ${result.leads} leads.`,
  );
  console.info(`Sign in as ${result.ownerEmail} or ${result.teammateEmail} with the dev sign-in.`);
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  code = 1;
}
await closeRealtime();
process.exit(code);
