import { expect, type Request, test } from '@playwright/test';
import { BASE } from './base-url.ts';
import { readFixture } from './fixture.ts';
import { signIn } from './sign-in.ts';

const KEYSTROKE_BUDGET_MS = 16;
const KEYSTROKE_P90_MS = 64;
const ROUTE_BUDGET_MS = 100;
const ROUTE_P90_MS = 300;
const KEYSTROKE_SAMPLES = 21;
const ROUTE_SAMPLES = 11;
const PROBE_POLL_MS = [5, 10, 20];
const SEEDED_LEADS = 40;
const HELD_PEOPLE_RESPONSE_MS = 1_500;
const PEOPLE_LIST_URL = /\/api\/people(\?|$)/;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
}

function percentile90(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.9) - 1] ?? Number.POSITIVE_INFINITY;
}

function report(name: string, samples: readonly number[], budgetMs: number, p90Ms: number): void {
  const summary = `${name} median ${median(samples).toFixed(1)}ms, p90 ${percentile90(samples).toFixed(1)}ms of ${samples.length} (budgets ${budgetMs}ms and ${p90Ms}ms): ${samples.map((sample) => sample.toFixed(1)).join(' ')}`;
  test.info().annotations.push({ type: `${name}-ms`, description: summary });
  console.log(summary);
}

function installKeystrokeProbe(): void {
  const probe = { started: 0, samples: [] as number[] };
  Object.assign(window, { gravityKeystrokeProbe: probe });
  window.addEventListener(
    'keydown',
    (event) => {
      probe.started = event.timeStamp;
    },
    { capture: true },
  );
  new MutationObserver((records) => {
    if (probe.started === 0) return;
    const activated = records.some(
      (record) =>
        record.target instanceof Element && record.target.getAttribute('data-active') === 'true',
    );
    if (!activated) return;
    probe.samples.push(performance.now() - probe.started);
    probe.started = 0;
  }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-active'] });
}

function keystrokeSamples(): number[] {
  const holder = window as unknown as { gravityKeystrokeProbe?: { samples: number[] } };
  return holder.gravityKeystrokeProbe?.samples ?? [];
}

function installRouteProbe(): void {
  const probe: { started: number; elapsed: number | null } = { started: 0, elapsed: null };
  Object.assign(window, { gravityRouteProbe: probe });
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'p') probe.started = event.timeStamp;
  };
  window.addEventListener('keydown', onKey, { capture: true });
  const observer = new MutationObserver(() => {
    if (probe.started === 0 || probe.elapsed !== null) return;
    if (document.querySelector('[data-testid^="record-row-"]') === null) return;
    probe.elapsed = performance.now() - probe.started;
    observer.disconnect();
    window.removeEventListener('keydown', onKey, { capture: true });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function routeElapsed(): number | null {
  const holder = window as unknown as { gravityRouteProbe?: { elapsed: number | null } };
  return holder.gravityRouteProbe?.elapsed ?? null;
}

function isServerComponentRequest(request: Request): boolean {
  return request.headers()['rsc'] === '1' || request.url().includes('_rsc=');
}

test('keystrokes and cached route changes stay inside the UI spec budgets', async ({ browser }) => {
  const fixture = readFixture();
  const context = await browser.newContext();
  try {
    const page = await signIn(context, fixture.ownerEmail);
    const suffix = Date.now().toString(36);
    const rows = Array.from(
      { length: SEEDED_LEADS },
      (_, index) => `Perf ${suffix} ${index},perf-${suffix}-${index}@vela.example`,
    );
    const seeded = await page.request.post(`${BASE}/api/imports`, {
      data: {
        format: 'csv',
        content: ['Name,Email', ...rows].join('\n'),
        target: 'leads',
        pipelineId: fixture.perfPipelineId,
        mapping: { Name: 'person.name', Email: 'person.email' },
        source: 'perf',
      },
    });
    expect(seeded.ok()).toBe(true);

    await page.goto(`${BASE}/leads/${fixture.perfPipelineKey}`);
    await expect(page.locator('[data-testid^="lead-row-"]').first()).toBeVisible();
    await page.keyboard.press('j');
    await expect(page.locator('[data-active="true"]')).toHaveCount(1);
    await page.evaluate(installKeystrokeProbe);
    for (let index = 0; index < KEYSTROKE_SAMPLES; index += 1) {
      await page.keyboard.press(index % 2 === 0 ? 'j' : 'k');
      await expect
        .poll(async () => (await page.evaluate(keystrokeSamples)).length, {
          intervals: PROBE_POLL_MS,
        })
        .toBe(index + 1);
    }
    const keystrokes = await page.evaluate(keystrokeSamples);
    expect(keystrokes).toHaveLength(KEYSTROKE_SAMPLES);
    report('keystroke', keystrokes, KEYSTROKE_BUDGET_MS, KEYSTROKE_P90_MS);
    expect(median(keystrokes)).toBeLessThan(KEYSTROKE_BUDGET_MS);
    expect(percentile90(keystrokes)).toBeLessThan(KEYSTROKE_P90_MS);

    await page.keyboard.press('g');
    await page.keyboard.press('p');
    await expect(page.locator('[data-testid^="record-row-"]').first()).toBeVisible();
    const serverRequests: string[] = [];
    let sampling = false;
    page.on('request', (request) => {
      if (sampling && isServerComponentRequest(request)) serverRequests.push(request.url());
    });
    const routes: number[] = [];
    try {
      await page.route(PEOPLE_LIST_URL, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, HELD_PEOPLE_RESPONSE_MS));
        await route.continue();
      });
      for (let index = 0; index < ROUTE_SAMPLES; index += 1) {
        await page.keyboard.press('g');
        await page.keyboard.press('l');
        await expect(page.locator('[data-testid^="lead-row-"]').first()).toBeVisible();
        await page.evaluate(installRouteProbe);
        sampling = true;
        await page.keyboard.press('g');
        await page.keyboard.press('p');
        await expect
          .poll(() => page.evaluate(routeElapsed), { intervals: PROBE_POLL_MS })
          .not.toBeNull();
        sampling = false;
        routes.push((await page.evaluate(routeElapsed)) ?? Number.POSITIVE_INFINITY);
      }
    } finally {
      sampling = false;
      await page.unrouteAll({ behavior: 'wait' });
    }
    report('route', routes, ROUTE_BUDGET_MS, ROUTE_P90_MS);
    expect(serverRequests).toEqual([]);
    expect(median(routes)).toBeLessThan(ROUTE_BUDGET_MS);
    expect(percentile90(routes)).toBeLessThan(ROUTE_P90_MS);
  } finally {
    await context.close();
  }
});
