import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const FIXTURE_PATH = resolve(import.meta.dirname, '.fixture.json');

export const e2eFixtureSchema = z.object({
  ownerEmail: z.email(),
  teammateEmail: z.email(),
  brandName: z.string().min(1),
  pipelineKey: z.string().min(2),
  pipelineId: z.string().min(1),
});
export type E2EFixture = z.infer<typeof e2eFixtureSchema>;

export function writeFixture(fixture: E2EFixture): void {
  writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2));
}

export function readFixture(): E2EFixture {
  return e2eFixtureSchema.parse(JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')));
}
