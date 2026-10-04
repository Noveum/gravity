import { describe, expect, test } from 'bun:test';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { ImportView } from '@/features/import/import-view.tsx';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { serveJson } from '../../support/fetch.ts';
import { choose, outcome, partial, report, SUBMIT } from '../../support/import-fixtures.ts';
import { renderWithClient } from '../../support/render.tsx';

const unchanged = [
  outcome(1, 'Ada Lovelace', {
    status: 'unchanged',
    matchedBy: 'email',
    lead: 'exists',
    leadKey: 'YOD-1',
  }),
  outcome(2, 'Grace Hopper', {
    status: 'unchanged',
    matchedBy: 'email',
    lead: 'exists',
    leadKey: 'YOD-2',
  }),
];

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? { ...value } : {};
}

function view(target: 'leads' | 'people' = 'leads') {
  return renderWithClient(
    <ImportView initialTarget={target} initialPipelineKey={target === 'leads' ? 'YOD' : null} />,
  );
}

function route(commit: unknown = report('commit'), previewRows?: Record<string, unknown>[]) {
  return serveJson((url) => ({
    body: url.pathname.endsWith('/preview') ? report('preview', previewRows) : commit,
  }));
}

describe('gating the import from the keyboard', () => {
  test('Cmd+Enter never commits a preview with nothing to write', async () => {
    const sent = route(report('commit', unchanged), unchanged);
    view();
    await choose();
    await userEvent.keyboard(SUBMIT);
    await screen.findByText('2 unchanged');
    await userEvent.keyboard(SUBMIT);
    await userEvent.keyboard(SUBMIT);
    expect(sent).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Import \d/ })).not.toBeInTheDocument();
  });

  test('the toast counts the rows that were written, not the rows processed', async () => {
    const rows = [
      outcome(1, 'Ada Lovelace'),
      outcome(2, 'Grace Hopper', { status: 'unchanged', lead: 'exists', leadKey: 'YOD-2' }),
      outcome(3, 'Bad', { status: 'invalid', lead: 'none' }),
    ];
    route(report('commit', rows), rows);
    view();
    await choose();
    await userEvent.keyboard(SUBMIT);
    await screen.findByText('1 new');
    await userEvent.keyboard(SUBMIT);
    expect(await screen.findByText('Imported 1 row')).toBeInTheDocument();
  });

  test('a key held down commits once', async () => {
    const sent = serveJson((url) => ({
      body: report(url.pathname.endsWith('/preview') ? 'preview' : 'commit'),
    }));
    view();
    await choose();
    await userEvent.keyboard(SUBMIT);
    await screen.findByText('2 new');
    act(() => {
      fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
      fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
      fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    });
    await screen.findByText('Imported 2 rows');
    expect(sent.filter((request) => request.url === '/api/imports')).toHaveLength(1);
  });

  test('a role without import rights cannot start anything from the keyboard', async () => {
    const sent = route();
    renderWithClient(<ImportView initialTarget="people" initialPipelineKey={null} />, {
      bootstrap: bootstrapFixture({ me: { userId: 'u1', role: 'contributor' } }),
    });
    await userEvent.keyboard('o');
    await userEvent.keyboard(SUBMIT);
    expect(sent).toHaveLength(0);
    expect(screen.queryByLabelText('Import file')).not.toBeInTheDocument();
  });
});

describe('focus across the steps', () => {
  test('focus follows each step: mapping, preview, result, back, replaced file', async () => {
    route();
    view();
    await choose();
    expect(await screen.findByRole('heading', { name: 'Map the columns' })).toHaveFocus();
    await userEvent.keyboard(SUBMIT);
    expect(await screen.findByRole('heading', { name: 'Check the preview' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('heading', { name: 'Map the columns' })).toHaveFocus();
    await userEvent.keyboard(SUBMIT);
    await screen.findByRole('heading', { name: 'Check the preview' });
    await userEvent.keyboard(SUBMIT);
    expect(await screen.findByRole('heading', { name: 'Import result' })).toHaveFocus();
  });

  test('going back from the mapping to choosing a file moves focus to the page', async () => {
    route();
    view();
    await choose();
    await screen.findByRole('heading', { name: 'Map the columns' });
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('heading', { name: 'Import', level: 1 })).toHaveFocus();
  });

  test('replacing the file after a preview shows the new file mapping with focus on it', async () => {
    route();
    view();
    await choose();
    await userEvent.keyboard(SUBMIT);
    await screen.findByText('2 new');
    await choose('Name,Phone\nAda,555\n', 'other.csv');
    expect(await screen.findByLabelText('Field for Phone')).toHaveValue('person.phone');
    expect(screen.queryByText('2 new')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Map the columns' })).toHaveFocus();
  });

  test('the preview and result regions are live', async () => {
    route();
    view();
    await choose();
    await userEvent.keyboard(SUBMIT);
    const preview = await screen.findByRole('heading', { name: 'Check the preview' });
    expect(preview.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
    await userEvent.keyboard(SUBMIT);
    const result = await screen.findByRole('heading', { name: 'Import result' });
    expect(result.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
  });
});

describe('partial imports and the result screen', () => {
  const stopped = 'Stopped after row 1 to stay within the time limit. Continue from row 2.';

  function partialRoute() {
    return serveJson((url) => ({
      body: url.pathname.endsWith('/preview')
        ? report('preview')
        : partial([outcome(1, 'Ada Lovelace', { leadKey: 'YOD-1' })], 2, {
            row: null,
            message: stopped,
          }),
    }));
  }

  test('a partial report says how far it got and previews the rest from the stopped row', async () => {
    const sent = partialRoute();
    view();
    await choose();
    await userEvent.keyboard(SUBMIT);
    await screen.findByText('2 new');
    await userEvent.keyboard(SUBMIT);
    expect(await screen.findByText('Processed 1 of 2 rows')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(stopped);
    await userEvent.click(
      screen.getByRole('button', { name: /Run the same file again from row 2/ }),
    );
    expect(await screen.findByRole('heading', { name: 'Check the preview' })).toHaveFocus();
    expect(
      screen.getByText('From row 2 of the file, where the last import stopped.'),
    ).toBeInTheDocument();
    expect(sent.map((request) => request.url)).toEqual([
      '/api/imports/preview',
      '/api/imports',
      '/api/imports/preview',
    ]);
    expect(sent[2]?.body).toEqual({ ...asRecord(sent[1]?.body), startRow: 2, rowLimit: null });
    await userEvent.keyboard(SUBMIT);
    await waitFor(() => expect(sent).toHaveLength(4));
    expect(sent[3]).toMatchObject({ url: '/api/imports', body: { startRow: 2, rowLimit: null } });
  });

  test('Cmd+Enter on a partial result previews from the stopped row', async () => {
    const sent = partialRoute();
    view();
    await choose();
    await userEvent.keyboard(SUBMIT);
    await screen.findByText('2 new');
    await userEvent.keyboard(SUBMIT);
    await screen.findByText('Processed 1 of 2 rows');
    await userEvent.keyboard(SUBMIT);
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[2]).toMatchObject({ url: '/api/imports/preview', body: { startRow: 2 } });
  });

  test('a partial preview commits only the rows it checked and the button says so', async () => {
    const sent = serveJson((url) => ({
      body: url.pathname.endsWith('/preview')
        ? partial(
            [outcome(1, 'Ada Lovelace')],
            2,
            {
              row: null,
              message:
                'Stopped after row 1 to stay within the time limit. The rows after it were not checked.',
            },
            'preview',
          )
        : report('commit', [outcome(1, 'Ada Lovelace')]),
    }));
    view();
    await choose();
    await userEvent.keyboard(SUBMIT);
    await userEvent.click(
      await screen.findByRole('button', { name: /^Import 1 row, previewed rows only/ }),
    );
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toMatchObject({ url: '/api/imports', body: { startRow: 1, rowLimit: 1 } });
  });

  test('a source id column needs a source name before the preview', async () => {
    const sent = route();
    view();
    await choose('Source ID,Full Name\n7,Ada Lovelace\n', 'ids.csv');
    expect(await screen.findByLabelText('Field for Source ID')).toHaveValue('sourceId');
    await userEvent.keyboard(SUBMIT);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Name the source of these ids, such as hubspot or crm-2026',
    );
    expect(sent).toHaveLength(0);
    await userEvent.type(screen.getByLabelText('Source name'), 'hubspot');
    await userEvent.keyboard(SUBMIT);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toMatchObject({ source: 'hubspot' });
  });

  test('Cmd+Enter on a finished result does nothing', async () => {
    const sent = route();
    view();
    await choose();
    await userEvent.keyboard(SUBMIT);
    await screen.findByText('2 new');
    await userEvent.keyboard(SUBMIT);
    await screen.findByRole('heading', { name: 'Import result' });
    await userEvent.keyboard(SUBMIT);
    expect(sent).toHaveLength(2);
    expect(
      screen.queryByRole('button', { name: /Run the same file again/ }),
    ).not.toBeInTheDocument();
  });

  test('Import another file really clears the file, by button and by the N key', async () => {
    route();
    view();
    await choose();
    await userEvent.keyboard(SUBMIT);
    await screen.findByText('2 new');
    await userEvent.keyboard(SUBMIT);
    await screen.findByRole('heading', { name: 'Import result' });
    await userEvent.click(screen.getByRole('button', { name: /Import another file/ }));
    expect(screen.queryByLabelText('Field for Full Name')).not.toBeInTheDocument();
    expect(screen.getByText('Choose a CSV or JSON file.')).toBeInTheDocument();
    await choose();
    await userEvent.keyboard(SUBMIT);
    await screen.findByText('2 new');
    await userEvent.keyboard(SUBMIT);
    await screen.findByRole('heading', { name: 'Import result' });
    await userEvent.keyboard('n');
    expect(screen.getByText('Choose a CSV or JSON file.')).toBeInTheDocument();
  });

  test('a stop at a row names the row and how far it got', async () => {
    serveJson((url) => ({
      body: url.pathname.endsWith('/preview')
        ? report('preview')
        : partial([outcome(1, 'Ada Lovelace')], 2, {
            row: 2,
            message: 'That stage is not in this pipeline.',
          }),
    }));
    view();
    await choose();
    await userEvent.keyboard(SUBMIT);
    await screen.findByText('2 new');
    await userEvent.keyboard(SUBMIT);
    expect(await screen.findByText('Processed 1 of 2 rows')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Stopped at row 2: That stage is not in this pipeline.',
    );
  });

  test('a commit request that fails says batches may be saved and previews the file again', async () => {
    const sent = serveJson((url) =>
      url.pathname.endsWith('/preview')
        ? { body: report('preview') }
        : {
            status: 500,
            body: { error: { code: 'internal', message: 'Something went wrong on our side.' } },
          },
    );
    view();
    await choose();
    await userEvent.keyboard(SUBMIT);
    await screen.findByText('2 new');
    await userEvent.keyboard(SUBMIT);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Some batches may already be saved.',
    );
    await userEvent.click(screen.getByRole('button', { name: /Preview the same file again/ }));
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[2]).toMatchObject({ url: '/api/imports/preview', body: { rowLimit: null } });
  });

  test('a refused commit says nothing was saved by it', async () => {
    serveJson((url) =>
      url.pathname.endsWith('/preview')
        ? { body: report('preview') }
        : {
            status: 429,
            body: {
              error: {
                code: 'rate_limited',
                message: 'You have started many imports in the last hour.',
              },
            },
          },
    );
    view();
    await choose();
    await userEvent.keyboard(SUBMIT);
    await screen.findByText('2 new');
    await userEvent.keyboard(SUBMIT);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('You have started many imports in the last hour.');
    expect(alert).not.toHaveTextContent('batches');
    expect(screen.getByRole('button', { name: /^Import 2 rows/ })).toBeInTheDocument();
  });
});

describe('the outcome table', () => {
  test('conflict and same-record rows carry their own labels and full reasons', async () => {
    const long =
      'Bea Bauer already uses ada@vela.example, so this row was not merged into Nameless Ref and nothing from it was written.';
    const rows = [
      outcome(1, 'Ada Lovelace', {
        status: 'skipped',
        lead: 'none',
        issues: [{ row: 1, column: null, code: 'conflict', message: long }],
      }),
      outcome(2, 'Ada L', {
        status: 'skipped',
        lead: 'none',
        issues: [{ row: 2, column: null, code: 'same_record', message: 'Same record as row 1.' }],
      }),
      outcome(3, 'Grace Hopper'),
    ];
    route(report('commit', rows), rows);
    view();
    await choose();
    await userEvent.keyboard(SUBMIT);
    expect(await screen.findByText('Conflict')).toBeInTheDocument();
    expect(screen.getByText('Same record')).toBeInTheDocument();
    const reason = screen.getByText(long);
    expect(reason.className).not.toContain('truncate');
    expect(reason).not.toHaveAttribute('title');
    expect(screen.getByText('2 skipped')).toBeInTheDocument();
  });

  test('a long report shows 200 rows, problems first, and says so', async () => {
    const rows = [
      ...Array.from({ length: 249 }, (_, index) => outcome(index + 1, `Person ${index + 1}`)),
      outcome(250, 'Bad Row', {
        status: 'invalid',
        lead: 'none',
        issues: [{ row: 250, column: null, code: 'invalid', message: 'Invalid email address' }],
      }),
    ];
    route(report('commit', rows), rows);
    view();
    await choose();
    await userEvent.keyboard(SUBMIT);
    expect(
      await screen.findByText('Showing 200 of 250 rows, rows with a problem first.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Bad Row')).toBeInTheDocument();
    expect(screen.queryByText('Person 200')).not.toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(201);
  });
});

describe('rows without an identity', () => {
  test('the report flags them and says a rerun of the whole file would add them twice', async () => {
    const warning = {
      column: null,
      code: 'no_identity',
      message:
        'This row has no email, LinkedIn or source id, so importing the whole file again would add it twice.',
    };
    const rows = [
      outcome(1, 'Nameless One', { issues: [{ row: 1, ...warning }] }),
      outcome(2, 'Nameless Two', { issues: [{ row: 2, ...warning }] }),
      outcome(3, 'Ada Lovelace'),
    ];
    route(report('commit', rows), rows);
    view();
    await choose();
    await userEvent.keyboard(SUBMIT);
    expect(
      await screen.findByText(
        '2 rows have no email, LinkedIn or source id. Importing the whole file again would add them twice.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('New')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /^Import 3 rows/ })).toBeInTheDocument();
  });
});

describe('focus and late answers', () => {
  test('step headings keep the visible focus ring', async () => {
    route();
    view();
    await choose();
    const heading = await screen.findByRole('heading', { name: 'Map the columns' });
    expect(heading.className).not.toContain('outline-none');
    expect(screen.getByRole('heading', { name: 'Import', level: 1 }).className).not.toContain(
      'outline-none',
    );
  });

  test('strict mode does not move focus when the page first renders', () => {
    route();
    renderWithClient(
      <StrictMode>
        <ImportView initialTarget="leads" initialPipelineKey="YOD" />
      </StrictMode>,
    );
    expect(document.activeElement).toBe(document.body);
  });

  test('a preview that lands after Escape never brings the preview back', async () => {
    let calls = 0;
    let release: (response: Response) => void = () => undefined;
    const answer = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    globalThis.fetch = (async (input: string) => {
      calls += 1;
      const path = new URL(input, 'http://localhost:3300').pathname;
      if (path === '/api/imports') {
        return answer(
          { error: { code: 'internal', message: 'Something went wrong on our side.' } },
          500,
        );
      }
      if (calls === 1) return answer(report('preview'));
      return await new Promise<Response>((resolve) => {
        release = resolve;
      });
    }) as unknown as typeof fetch;
    view();
    await choose();
    await userEvent.keyboard(SUBMIT);
    await screen.findByText('2 new');
    await userEvent.keyboard(SUBMIT);
    await userEvent.click(
      await screen.findByRole('button', { name: /Preview the same file again/ }),
    );
    await waitFor(() => expect(calls).toBe(3));
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('heading', { name: 'Map the columns' })).toBeInTheDocument();
    await act(async () => {
      release(answer(report('preview')));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByRole('heading', { name: 'Check the preview' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Map the columns' })).toBeInTheDocument();
  });

  test('the action buttons sit outside the live region of the preview', async () => {
    route();
    view();
    await choose();
    await userEvent.keyboard(SUBMIT);
    const heading = await screen.findByRole('heading', { name: 'Check the preview' });
    const live = heading.closest('[aria-live]');
    expect(live?.querySelector('button')).toBeNull();
  });
});

describe('copy', () => {
  test('the limits come from the shared constants', () => {
    route();
    view();
    expect(screen.getByText(/Up to 2,000 rows and 2\.0 MB\./)).toBeInTheDocument();
  });
});
