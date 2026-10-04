import { assertLocalSeedTarget, parseSeedArgs } from './seed-guard.ts';

let code = 0;
let closeRealtime: (() => Promise<void>) | null = null;
try {
  const args = parseSeedArgs(process.argv.slice(2));
  assertLocalSeedTarget(
    { nodeEnv: process.env['NODE_ENV'], databaseUrl: process.env['DATABASE_URL'] },
    args.allowRemote,
  );
  const { seedDemoWorkspace, publishSeededOutbox } = await import('./demo-seed.ts');
  const publisher = await import('../realtime/publisher.ts');
  closeRealtime = publisher.closeRealtime;
  const result = await seedDemoWorkspace(args);
  await publishSeededOutbox(result.organizationId);
  const verb = result.reused ? 'Completed' : 'Seeded';
  console.info(
    `${verb} ${result.slug}: ${result.brands} brands, ${result.people} people, ${result.leads} leads.`,
  );
  console.info(`Sign in as ${result.ownerEmail} or ${result.teammateEmail} with the dev sign-in.`);
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  code = 1;
}
if (closeRealtime !== null) await closeRealtime();
process.exit(code);
