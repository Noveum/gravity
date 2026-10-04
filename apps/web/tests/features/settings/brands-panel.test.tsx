import { afterEach, describe, expect, test } from 'bun:test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { z } from 'zod';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { serveJson } from '../../support/fetch.ts';
import { mockNavigation } from '../../support/navigation.ts';
import { renderWithClient } from '../../support/render.tsx';

await restoreModulesAfterThisFile(['next/navigation']);
mockNavigation('/settings/brands');
const { BrandsPanel } = await import('@/features/settings/brands-panel.tsx');

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const AT = '2026-10-03T10:00:00.000Z';
const [yodu] = bootstrapFixture().brands;
if (yodu === undefined) throw new Error('The fixture has a brand.');

function brandItem(container: HTMLElement, name: string): HTMLElement {
  const item = container.querySelector(`[data-brand="${name}"]`);
  if (!(item instanceof HTMLElement)) throw new Error(`No brand item for ${name}.`);
  return item;
}

describe('BrandsPanel', () => {
  test('suggests a free pipeline key from the name and creates the brand', async () => {
    const sent = serveJson((_url, _method, body) => ({
      body: {
        brand: {
          id: 'b2',
          name: 'Nimbus',
          domain: null,
          color: 'violet',
          signature: '',
          currentPlaybookVersion: 1,
          syncId: 7,
          createdAt: AT,
          updatedAt: AT,
          archivedAt: null,
        },
        pipeline: {
          id: 'p2',
          brandId: 'b2',
          name: 'Prospecting',
          key: (body as { pipelineKey: string }).pipelineKey,
          kind: 'people',
          position: 0,
          syncId: 8,
          createdAt: AT,
          updatedAt: AT,
          archivedAt: null,
        },
        stages: [],
      },
    }));
    const { container } = renderWithClient(<BrandsPanel />);
    const form = screen.getByRole('form', { name: 'New brand' });
    await userEvent.type(within(form).getByLabelText('Brand name'), 'Yod');
    expect(within(form).getByLabelText('Pipeline key')).toHaveValue('YOA');
    await userEvent.clear(within(form).getByLabelText('Brand name'));
    await userEvent.type(within(form).getByLabelText('Brand name'), 'Nimbus');
    expect(within(form).getByLabelText('Pipeline key')).toHaveValue('NIM');
    await userEvent.click(within(form).getByRole('button', { name: 'violet' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Create brand' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({
      name: 'Nimbus',
      domain: null,
      color: 'violet',
      pipelineKey: 'NIM',
    });
    const item = await waitFor(() => brandItem(container, 'Nimbus'));
    expect(within(item).getByRole('heading', { name: 'Nimbus' })).toBeInTheDocument();
    expect(within(item).getByText('NIM')).toBeInTheDocument();
    expect(within(form).getByLabelText('Brand name')).toHaveValue('');
  });

  test('a typed pipeline key is kept and sent as typed in capitals', async () => {
    const sent = serveJson((_url, method) =>
      method === 'GET'
        ? { body: bootstrapFixture() }
        : { status: 422, body: { error: { code: 'invalid', message: 'No.' } } },
    );
    renderWithClient(<BrandsPanel />);
    const form = screen.getByRole('form', { name: 'New brand' });
    await userEvent.type(within(form).getByLabelText('Brand name'), 'Nimbus');
    await userEvent.clear(within(form).getByLabelText('Pipeline key'));
    await userEvent.type(within(form).getByLabelText('Pipeline key'), 'nbs');
    await userEvent.type(within(form).getByLabelText('Domain'), 'nimbus.dev');
    await userEvent.click(within(form).getByRole('button', { name: 'Create brand' }));
    await waitFor(() =>
      expect(sent.filter((request) => request.method === 'POST')).toHaveLength(1),
    );
    expect(sent[0]?.body).toEqual({
      name: 'Nimbus',
      domain: 'nimbus.dev',
      color: 'blue',
      pipelineKey: 'NBS',
    });
    expect(await screen.findByText('Could not create Nimbus')).toBeInTheDocument();
  });

  test('a brand with no name or a key that is not 2 to 5 letters is refused before sending', async () => {
    const sent = serveJson(() => ({ body: {} }));
    renderWithClient(<BrandsPanel />);
    const form = screen.getByRole('form', { name: 'New brand' });
    await userEvent.click(within(form).getByRole('button', { name: 'Create brand' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Name the brand.');
    await userEvent.type(within(form).getByLabelText('Brand name'), 'Nimbus');
    await userEvent.clear(within(form).getByLabelText('Pipeline key'));
    await userEvent.type(within(form).getByLabelText('Pipeline key'), 'n');
    await userEvent.click(within(form).getByRole('button', { name: 'Create brand' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Use 2 to 5 letters');
    expect(sent).toHaveLength(0);
  });

  test('renaming a brand shows the new name at once and saves it', async () => {
    const sent = serveJson((_url, _method, body) => ({
      body: { brand: { ...yodu, ...(body as object), syncId: 5 } },
    }));
    const { container } = renderWithClient(<BrandsPanel />);
    const item = brandItem(container, 'Yodu');
    await userEvent.click(within(item).getByRole('button', { name: 'Edit Name' }));
    const input = within(item).getByRole('textbox', { name: 'Name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Yodu Labs{Enter}');
    expect(within(item).getByRole('heading', { name: 'Yodu Labs' })).toBeInTheDocument();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      url: '/api/brands/b1',
      method: 'PATCH',
      body: { name: 'Yodu Labs' },
    });
  });

  test('picking a colour on a brand saves it', async () => {
    const sent = serveJson((_url, _method, body) => ({
      body: { brand: { ...yodu, ...(body as object), syncId: 5 } },
    }));
    const { container } = renderWithClient(<BrandsPanel />);
    const item = brandItem(container, 'Yodu');
    await userEvent.click(within(item).getByRole('button', { name: 'green' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ url: '/api/brands/b1', body: { color: 'green' } });
  });

  test('archiving a brand asks first, then removes it and its pipelines', async () => {
    const sent = serveJson(() => ({ body: { brand: { ...yodu, archivedAt: AT, syncId: 9 } } }));
    const { container } = renderWithClient(<BrandsPanel />);
    const item = brandItem(container, 'Yodu');
    await userEvent.click(within(item).getByRole('button', { name: 'Archive' }));
    expect(sent).toHaveLength(0);
    const confirm = within(item).getByRole('alertdialog', { name: 'Archive Yodu' });
    expect(confirm).toHaveTextContent('Its pipelines and stages leave every list.');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Keep' }));
    expect(within(item).queryByRole('alertdialog')).not.toBeInTheDocument();
    await userEvent.click(within(item).getByRole('button', { name: 'Archive' }));
    await userEvent.click(
      within(within(item).getByRole('alertdialog')).getByRole('button', { name: 'Archive' }),
    );
    await waitFor(() => expect(container.querySelector('[data-brand="Yodu"]')).toBeNull());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ url: '/api/brands/b1', method: 'DELETE' });
  });

  test('a new pipeline for a brand takes a free key built from the brand and its name', async () => {
    const sent = serveJson((_url, _method, body) => ({
      body: {
        pipeline: {
          id: 'p9',
          brandId: 'b1',
          name: (body as { name: string }).name,
          key: (body as { key: string }).key,
          kind: 'deals',
          position: 1,
          syncId: 6,
          createdAt: AT,
          updatedAt: AT,
          archivedAt: null,
        },
        stages: [],
      },
    }));
    const { container } = renderWithClient(<BrandsPanel />);
    const item = brandItem(container, 'Yodu');
    await userEvent.selectOptions(within(item).getByLabelText('Pipeline kind'), 'deals');
    await userEvent.type(within(item).getByLabelText('New pipeline for Yodu'), 'Renewals');
    await userEvent.click(within(item).getByRole('button', { name: /^Add pipeline / }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      url: '/api/pipelines',
      body: { brandId: 'b1', name: 'Renewals', kind: 'deals' },
    });
    const { key } = z.object({ key: z.string() }).parse(sent[0]?.body);
    expect(key).toMatch(/^[A-Z]{2,5}$/);
    expect(key).not.toBe('YOD');
    expect(await within(item).findByText('Renewals')).toBeInTheDocument();
  });

  test('a guest sees the brands but no way to change them', () => {
    const { container } = renderWithClient(<BrandsPanel />, {
      bootstrap: bootstrapFixture({ me: { userId: 'u3', role: 'guest' } }),
    });
    expect(screen.getByText('Yodu')).toBeInTheDocument();
    expect(screen.queryByLabelText('Brand name')).not.toBeInTheDocument();
    expect(
      screen.getByText('Changing brands needs the member role. Ask an admin.'),
    ).toBeInTheDocument();
    const item = brandItem(container, 'Yodu');
    expect(within(item).queryByRole('button')).not.toBeInTheDocument();
  });

  test('a contributor is told the same role is needed', () => {
    renderWithClient(<BrandsPanel />, {
      bootstrap: bootstrapFixture({ me: { userId: 'u3', role: 'contributor' } }),
    });
    expect(
      screen.getByText('Changing brands needs the member role. Ask an admin.'),
    ).toBeInTheDocument();
  });
});
