import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { BASE } from './base-url.ts';
import { readFixture } from './fixture.ts';

const PROPAGATION_BUDGET_MS = 500;
const POLL_INTERVAL_MS = 25;

async function signIn(context: BrowserContext, email: string): Promise<Page> {
  const response = await context.request.post(`${BASE}/api/dev/sign-in`, { data: { email } });
  if (!response.ok()) {
    throw new Error(
      `Dev sign-in for ${email} failed with ${response.status()}: ${await response.text()}. ` +
        'Check that the web server on BASE is running in development and that ' +
        'ALLOWED_EMAIL_DOMAINS in its environment admits this address.',
    );
  }
  return await context.newPage();
}

function isLeadRead(method: string, url: string): boolean {
  return method === 'GET' && new URL(url).pathname.startsWith('/api/leads');
}

function leadRow(page: Page, name: string) {
  return page.locator('[data-testid^="lead-row-"]', { hasText: name });
}

test('a lead created in one browser appears in another within 500ms', async ({ browser }) => {
  const fixture = readFixture();
  const owner = await signIn(await browser.newContext(), fixture.ownerEmail);
  const teammate = await signIn(await browser.newContext(), fixture.teammateEmail);
  const listUrl = `${BASE}/leads/${fixture.pipelineKey}`;
  await Promise.all([owner.goto(listUrl), teammate.goto(listUrl)]);
  const emptyCopy = `No leads in ${fixture.brandName} · Prospecting yet.`;
  await expect(owner.getByText(emptyCopy)).toBeVisible();
  await expect(teammate.getByText(emptyCopy)).toBeVisible();

  const warmUp = `Warm up ${Date.now()}`;
  const warmed = await owner.request.post(`${BASE}/api/leads/quick`, {
    data: { pipelineId: fixture.pipelineId, person: { name: warmUp } },
  });
  expect(warmed.ok()).toBe(true);
  await expect(leadRow(teammate, warmUp)).toBeVisible();

  const teammateReads: string[] = [];
  let measuring = false;
  teammate.on('request', (request) => {
    if (measuring && isLeadRead(request.method(), request.url())) teammateReads.push(request.url());
  });

  const name = `Realtime ${Date.now()}`;
  await owner.keyboard.press('c');
  await owner.getByRole('textbox', { name: 'Person', exact: true }).fill(name);
  const answered = owner
    .waitForResponse((response) => response.url().endsWith('/api/leads/quick') && response.ok())
    .then(() => performance.now());
  measuring = true;
  await owner.keyboard.press('ControlOrMeta+Enter');
  await expect(leadRow(owner, name)).toBeVisible();
  const answeredAt = await answered;

  let seenAt = Number.NaN;
  await expect
    .poll(
      async () => {
        const visible = (await leadRow(teammate, name).count()) > 0;
        if (visible && Number.isNaN(seenAt)) seenAt = performance.now();
        return visible;
      },
      { timeout: 2 * PROPAGATION_BUDGET_MS, intervals: [POLL_INTERVAL_MS] },
    )
    .toBe(true);
  measuring = false;
  expect(teammateReads).toEqual([]);
  const latencyMs = Math.round(seenAt - answeredAt);
  test.info().annotations.push({ type: 'propagation-latency-ms', description: String(latencyMs) });
  console.log(`realtime propagation latency: ${latencyMs}ms`);
  expect(latencyMs).toBeLessThanOrEqual(PROPAGATION_BUDGET_MS);
});
