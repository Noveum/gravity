import { afterEach, describe, expect, test } from 'bun:test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { serveJson } from '../../support/fetch.ts';
import { mockNavigation } from '../../support/navigation.ts';
import { renderWithClient } from '../../support/render.tsx';

await restoreModulesAfterThisFile(['next/navigation']);
mockNavigation('/settings/brands');
const { BrandsPanel } = await import('@/features/settings/brands-panel.tsx');
const { FieldsPanel } = await import('@/features/settings/fields-panel.tsx');
const { PipelinePanel } = await import('@/features/settings/pipeline-panel.tsx');

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function neverAnswer(): void {
  globalThis.fetch = (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
}

describe('settings panels while the bootstrap loads', () => {
  test('show nothing at first, then a skeleton after 300ms', async () => {
    neverAnswer();
    renderWithClient(<BrandsPanel />, { bootstrap: null });
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument();
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Brands' })).not.toBeInTheDocument();
  });

  test('every panel shows the skeleton', async () => {
    neverAnswer();
    for (const panel of [<FieldsPanel key="f" />, <PipelinePanel key="p" pipelineId="p1" />]) {
      const view = renderWithClient(panel, { bootstrap: null });
      expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
      view.unmount();
    }
  });
});

describe('settings panels when the bootstrap fails', () => {
  test('say what failed and Retry loads the panel', async () => {
    let healthy = false;
    serveJson(() =>
      healthy
        ? { body: bootstrapFixture() }
        : { status: 500, body: { error: { code: 'internal', message: 'The database is down.' } } },
    );
    renderWithClient(<BrandsPanel />, { bootstrap: null });
    expect(await screen.findByText('Could not load brands')).toBeInTheDocument();
    expect(screen.getByText('The database is down.')).toBeInTheDocument();
    healthy = true;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Brands' })).toBeInTheDocument(),
    );
    expect(screen.queryByText('Could not load brands')).not.toBeInTheDocument();
  });

  test('the fields and pipeline panels name themselves', async () => {
    serveJson(() => ({ status: 500, body: { error: { code: 'internal', message: 'Down.' } } }));
    for (const [panel, title] of [
      [<FieldsPanel key="f" />, 'Could not load custom fields'],
      [<PipelinePanel key="p" pipelineId="p1" />, 'Could not load the pipeline'],
    ] as const) {
      const view = renderWithClient(panel, { bootstrap: null });
      expect(await screen.findByText(title)).toBeInTheDocument();
      view.unmount();
    }
  });
});
