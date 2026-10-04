import { expect, type Page, test } from '@playwright/test';
import { BASE } from './base-url.ts';
import { readFixture } from './fixture.ts';
import { signIn } from './sign-in.ts';

const ARRIVAL_BUDGET_MS = 10_000;
const POLL_INTERVAL_MS = 50;

function isLeadRead(method: string, url: string): boolean {
  return method === 'GET' && new URL(url).pathname.startsWith('/api/leads');
}

function leadRow(page: Page, name: string) {
  return page.locator('[data-testid^="lead-row-"]', { hasText: name });
}

test('an import previews, reaches a teammate by delta, and a second run adds nothing', async ({
  browser,
}) => {
  const fixture = readFixture();
  const owner = await signIn(await browser.newContext(), fixture.ownerEmail);
  const teammate = await signIn(await browser.newContext(), fixture.teammateEmail);
  await teammate.goto(`${BASE}/leads/${fixture.importPipelineKey}`);
  await teammate.waitForLoadState('networkidle');

  const warmUp = `Warm up ${Date.now()}`;
  const warmed = await owner.request.post(`${BASE}/api/leads/quick`, {
    data: { pipelineId: fixture.importPipelineId, person: { name: warmUp } },
  });
  expect(warmed.ok()).toBe(true);
  await expect(leadRow(teammate, warmUp)).toBeVisible();

  const reads: string[] = [];
  let measuring = false;
  teammate.on('request', (request) => {
    if (measuring && isLeadRead(request.method(), request.url())) reads.push(request.url());
  });

  const suffix = Date.now().toString(36);
  const names = [`Imported One ${suffix}`, `Imported Two ${suffix}`, `Imported Three ${suffix}`];
  const csv = [
    'Full Name,Work Email,Company,Website,Stage',
    `${names[0]},one-${suffix}@vela.example,Vela Robotics ${suffix},vela-${suffix}.example,Ready`,
    `${names[1]},two-${suffix}@quarry.example,Quarry Labs ${suffix},quarry-${suffix}.example,New`,
    `${names[2]},three-${suffix}@kestrel.example,,,Contacted`,
  ].join('\n');
  const file = { name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) };

  await owner.goto(`${BASE}/import?target=leads&pipeline=${fixture.importPipelineKey}`);
  await owner.getByLabel('Import file').setInputFiles(file);
  await expect(owner.getByRole('heading', { name: 'Map the columns' })).toBeFocused();
  await expect(owner.getByLabel('Field for Full Name')).toHaveValue('person.name');
  await expect(owner.getByLabel('Field for Website')).toHaveValue('company.domain');
  await expect(owner.getByLabel('Field for Stage')).toHaveValue('lead.stage');
  await owner.keyboard.press('ControlOrMeta+Enter');
  await expect(owner.getByRole('heading', { name: 'Check the preview' })).toBeFocused();
  await expect(owner.getByText('3 new', { exact: true })).toBeVisible();
  expect(await leadRow(teammate, names[0] ?? '').count()).toBe(0);

  measuring = true;
  await owner.keyboard.press('ControlOrMeta+Enter');
  await expect(owner.getByRole('heading', { name: 'Import result' })).toBeFocused();
  await expect(owner.getByText('3 leads created', { exact: true })).toBeVisible();
  const committedAt = performance.now();
  for (const name of names) {
    await expect
      .poll(async () => await leadRow(teammate, name).count(), {
        timeout: ARRIVAL_BUDGET_MS,
        intervals: [POLL_INTERVAL_MS],
      })
      .toBe(1);
  }
  measuring = false;
  expect(reads).toEqual([]);
  console.log(`import arrival after the result: ${Math.round(performance.now() - committedAt)}ms`);

  await owner.getByRole('button', { name: 'Import another file' }).click();
  await owner.getByLabel('Import file').setInputFiles(file);
  await expect(owner.getByRole('heading', { name: 'Map the columns' })).toBeFocused();
  await owner.keyboard.press('ControlOrMeta+Enter');
  await expect(owner.getByText('3 unchanged', { exact: true })).toBeVisible();
  await expect(owner.getByText('3 leads already in pipeline', { exact: true })).toBeVisible();
  await expect(owner.getByText(/Nothing to import/)).toBeVisible();
  await expect(owner.getByRole('button', { name: /^Import \d+ rows?/ })).toHaveCount(0);
});
