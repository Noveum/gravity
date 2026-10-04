import { afterEach, describe, expect, test } from 'bun:test';
import type { FieldDefinitionRow } from '@gravity/shared/records';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { serveJson } from '../../support/fetch.ts';
import { mockNavigation } from '../../support/navigation.ts';
import { renderWithClient } from '../../support/render.tsx';

await restoreModulesAfterThisFile(['next/navigation']);
mockNavigation('/settings/fields');
const { FieldsPanel } = await import('@/features/settings/fields-panel.tsx');

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const industry: FieldDefinitionRow = {
  id: 'f9',
  object: 'lead',
  pipelineId: null,
  key: 'industry',
  label: 'Industry',
  type: 'select',
  options: [{ value: 'saas', label: 'SaaS' }],
  description: '',
  example: '',
  position: 0,
  syncId: 2,
  archivedAt: null,
};

const personField: FieldDefinitionRow = {
  ...industry,
  id: 'f10',
  object: 'person',
  key: 'timezone',
  label: 'Timezone',
  type: 'text',
  options: [],
};

const withFields = bootstrapFixture({ fields: [industry, personField] });

describe('FieldsPanel', () => {
  test('derives the key, insists on options for a choice field, then creates it', async () => {
    const sent = serveJson((_url, _method, body) => ({
      body: {
        field: {
          id: 'f1',
          archivedAt: null,
          syncId: 3,
          position: 0,
          description: '',
          example: '',
          ...(body as object),
        },
      },
    }));
    renderWithClient(<FieldsPanel />);
    await userEvent.type(screen.getByLabelText('Field name'), 'Deal size');
    expect(screen.getByLabelText('Key')).toHaveValue('deal_size');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'select');
    await userEvent.click(screen.getByRole('button', { name: 'Create field' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Add at least one option.');
    expect(sent).toHaveLength(0);
    await userEvent.type(screen.getByLabelText('Options, one per line'), 'Small{Enter}Large');
    await userEvent.click(screen.getByRole('button', { name: 'Create field' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toMatchObject({
      object: 'lead',
      pipelineId: null,
      key: 'deal_size',
      label: 'Deal size',
      type: 'select',
      options: [
        { value: 'small', label: 'Small' },
        { value: 'large', label: 'Large' },
      ],
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Edit field Deal size' })).toBeInTheDocument();
  });

  test('a field with no name is refused before anything is sent', async () => {
    const sent = serveJson(() => ({ body: {} }));
    renderWithClient(<FieldsPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Create field' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Name the field.');
    expect(sent).toHaveLength(0);
  });

  test('a plain field sends no options even after a choice type was picked and dropped', async () => {
    const sent = serveJson((_url, _method, body) => ({
      body: {
        field: {
          id: 'f2',
          archivedAt: null,
          syncId: 3,
          position: 0,
          description: '',
          example: '',
          ...(body as object),
        },
      },
    }));
    renderWithClient(<FieldsPanel />);
    await userEvent.type(screen.getByLabelText('Field name'), 'Budget');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'select');
    await userEvent.type(screen.getByLabelText('Options, one per line'), 'Low');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'number');
    expect(screen.queryByLabelText('Options, one per line')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create field' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toMatchObject({ key: 'budget', type: 'number', options: [] });
  });

  test('a lead field can be limited to one pipeline and people fields cannot', async () => {
    const sent = serveJson((_url, _method, body) => ({
      body: {
        field: {
          id: 'f3',
          archivedAt: null,
          syncId: 3,
          position: 0,
          description: '',
          example: '',
          ...(body as object),
        },
      },
    }));
    renderWithClient(<FieldsPanel />);
    await userEvent.type(screen.getByLabelText('Field name'), 'Source');
    await userEvent.selectOptions(screen.getByLabelText('Pipeline'), 'p1');
    await userEvent.click(screen.getByRole('button', { name: 'Create field' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toMatchObject({ object: 'lead', pipelineId: 'p1', key: 'source' });
    await userEvent.click(screen.getByRole('button', { name: 'People' }));
    expect(screen.queryByLabelText('Pipeline')).not.toBeInTheDocument();
  });

  test('the record type switch is a labelled group that lists that type only', async () => {
    renderWithClient(<FieldsPanel />, { bootstrap: withFields });
    const group = screen.getByRole('group', { name: 'Record type' });
    expect(group.tagName).toBe('FIELDSET');
    expect(within(group).getByRole('button', { name: 'Leads' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Industry')).toBeInTheDocument();
    expect(screen.queryByText('Timezone')).not.toBeInTheDocument();
    await userEvent.click(within(group).getByRole('button', { name: 'People' }));
    expect(within(group).getByRole('button', { name: 'People' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Timezone')).toBeInTheDocument();
    expect(screen.queryByText('Industry')).not.toBeInTheDocument();
  });

  test('renaming a field saves the new label and archiving removes it', async () => {
    const sent = serveJson((_url, method, body) => ({
      body: {
        field:
          method === 'DELETE'
            ? { ...industry, archivedAt: '2026-10-03T10:00:00.000Z', syncId: 8 }
            : { ...industry, ...(body as object), syncId: 6 },
      },
    }));
    renderWithClient(<FieldsPanel />, { bootstrap: withFields });
    await userEvent.click(screen.getByRole('button', { name: 'Edit field Industry' }));
    const input = screen.getByRole('textbox', { name: 'field Industry' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Sector{Enter}');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      url: '/api/fields/f9',
      method: 'PATCH',
      body: { label: 'Sector' },
    });
    expect(await screen.findByText('Sector')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Archive Sector' }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toMatchObject({ url: '/api/fields/f9', method: 'DELETE' });
    expect(screen.queryByText('Sector')).not.toBeInTheDocument();
  });

  test('a contributor sees the fields but the role needed to change them is named', () => {
    renderWithClient(<FieldsPanel />, {
      bootstrap: bootstrapFixture({
        me: { userId: 'u3', role: 'contributor' },
        fields: [industry],
      }),
    });
    expect(screen.getByText('Industry')).toBeInTheDocument();
    expect(screen.queryByLabelText('Field name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Archive/ })).not.toBeInTheDocument();
    expect(
      screen.getByText('Changing fields needs the member role. Ask an admin.'),
    ).toBeInTheDocument();
  });

  test('archiving a field raises an Undo toast that brings it back', async () => {
    const sent = serveJson((url, method) => {
      if (url.pathname.endsWith('/unarchive'))
        return { body: { field: { ...industry, syncId: 8 } } };
      if (method === 'DELETE')
        return {
          body: { field: { ...industry, archivedAt: '2026-10-03T10:00:00.000Z', syncId: 7 } },
        };
      return { body: bootstrapFixture() };
    });
    renderWithClient(<FieldsPanel />, { bootstrap: withFields });
    await userEvent.click(screen.getByRole('button', { name: 'Archive Industry' }));
    expect(screen.queryByText('Industry')).not.toBeInTheDocument();
    expect(await screen.findByText('Archived Industry')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByText('Industry')).toBeInTheDocument());
    expect(sent.find((request) => request.url.endsWith('/unarchive'))).toMatchObject({
      url: '/api/fields/f9/unarchive',
      method: 'POST',
    });
  });

  test('an Undo refused because the key was reused shows the server message', async () => {
    serveJson((url, method) => {
      if (url.pathname.endsWith('/unarchive')) {
        return {
          status: 409,
          body: {
            error: {
              code: 'conflict',
              message: 'A custom field with that key already exists here.',
            },
          },
        };
      }
      if (method === 'DELETE')
        return {
          body: { field: { ...industry, archivedAt: '2026-10-03T10:00:00.000Z', syncId: 7 } },
        };
      return { body: bootstrapFixture() };
    });
    renderWithClient(<FieldsPanel />, { bootstrap: withFields });
    await userEvent.click(screen.getByRole('button', { name: 'Archive Industry' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Could not restore Industry')).toBeInTheDocument();
    expect(
      screen.getByText('A custom field with that key already exists here.'),
    ).toBeInTheDocument();
  });

  test('archiving the only field focuses the heading, otherwise a neighbouring row', async () => {
    const second: FieldDefinitionRow = { ...industry, id: 'f11', key: 'region', label: 'Region' };
    serveJson((_url, method) =>
      method === 'DELETE'
        ? { body: { field: { ...industry, archivedAt: '2026-10-03T10:00:00.000Z', syncId: 7 } } }
        : { body: bootstrapFixture() },
    );
    const view = renderWithClient(<FieldsPanel />, {
      bootstrap: bootstrapFixture({ fields: [industry, second] }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Archive Industry' }));
    expect(screen.getByRole('button', { name: 'Edit field Region' })).toHaveFocus();
    view.unmount();
    serveJson((_url, method) =>
      method === 'DELETE'
        ? { body: { field: { ...industry, archivedAt: '2026-10-03T10:00:00.000Z', syncId: 7 } } }
        : { body: bootstrapFixture() },
    );
    renderWithClient(<FieldsPanel />, { bootstrap: bootstrapFixture({ fields: [industry] }) });
    await userEvent.click(screen.getByRole('button', { name: 'Archive Industry' }));
    expect(screen.getByRole('heading', { name: 'Custom fields' })).toHaveFocus();
  });

  test('a key a live field already has is refused before sending, here and workspace wide', async () => {
    const sent = serveJson(() => ({ body: {} }));
    renderWithClient(<FieldsPanel />, { bootstrap: withFields });
    await userEvent.type(screen.getByLabelText('Field name'), 'Industry');
    await userEvent.click(screen.getByRole('button', { name: 'Create field' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A custom field with that key already exists here.',
    );
    await userEvent.selectOptions(screen.getByLabelText('Pipeline'), 'p1');
    await userEvent.click(screen.getByRole('button', { name: 'Create field' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A workspace-wide custom field already uses that key. Use another key.',
    );
    expect(sent).toHaveLength(0);
  });

  test('a key that is not lowercase letters, digits and underscores is refused before sending', async () => {
    const sent = serveJson(() => ({ body: {} }));
    renderWithClient(<FieldsPanel />);
    await userEvent.type(screen.getByLabelText('Field name'), 'Budget');
    await userEvent.type(screen.getByLabelText('Key'), 'Big Budget', {
      initialSelectionStart: 0,
      initialSelectionEnd: 6,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Create field' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Use lowercase letters, digits and underscores.',
    );
    expect(sent).toHaveLength(0);
  });

  test('clearing the key brings the derived one back', async () => {
    renderWithClient(<FieldsPanel />);
    await userEvent.type(screen.getByLabelText('Field name'), 'Deal size');
    const key = screen.getByLabelText('Key');
    await userEvent.type(key, 'x', { initialSelectionStart: 0, initialSelectionEnd: 9 });
    expect(key).toHaveValue('x');
    await userEvent.clear(key);
    expect(key).toHaveValue('deal_size');
  });

  test('a refused field keeps everything typed and shows the server message, with no toast', async () => {
    serveJson((_url, method) =>
      method === 'GET'
        ? { body: bootstrapFixture() }
        : {
            status: 409,
            body: {
              error: {
                code: 'conflict',
                message: 'A pipeline already has a custom field with that key. Use another key.',
              },
            },
          },
    );
    renderWithClient(<FieldsPanel />);
    await userEvent.type(screen.getByLabelText('Field name'), 'Deal size');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'select');
    await userEvent.type(screen.getByLabelText('Options, one per line'), 'Small{Enter}Large');
    await userEvent.click(screen.getByRole('button', { name: 'Create field' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A pipeline already has a custom field',
    );
    expect(screen.getByLabelText('Field name')).toHaveValue('Deal size');
    expect(screen.getByLabelText('Key')).toHaveValue('deal_size');
    expect(screen.getByLabelText('Type')).toHaveValue('select');
    expect(screen.getByLabelText('Options, one per line')).toHaveValue('Small\nLarge');
    expect(screen.queryByText('Could not create Deal size')).not.toBeInTheDocument();
  });
});
