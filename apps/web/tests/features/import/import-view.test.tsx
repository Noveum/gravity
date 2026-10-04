import { describe, expect, test } from 'bun:test';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportView } from '@/features/import/import-view.tsx';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { serveJson } from '../../support/fetch.ts';
import { choose, outcome, report, SUBMIT } from '../../support/import-fixtures.ts';
import { renderWithClient } from '../../support/render.tsx';

describe('ImportView', () => {
  test('suggests a mapping, previews with Cmd+Enter and imports with a second Cmd+Enter', async () => {
    const sent = serveJson((url) => ({
      body: report(url.pathname.endsWith('/preview') ? 'preview' : 'commit'),
    }));
    renderWithClient(<ImportView initialTarget="leads" initialPipelineKey="YOD" />);
    await choose();
    expect(await screen.findByLabelText('Field for Full Name')).toHaveValue('person.name');
    expect(screen.getByLabelText('Field for Work Email')).toHaveValue('person.email');
    expect(screen.getByLabelText('Field for Stage')).toHaveValue('lead.stage');
    await userEvent.keyboard(SUBMIT);
    expect(await screen.findByText('2 new')).toBeInTheDocument();
    expect(sent[0]).toMatchObject({
      url: '/api/imports/preview',
      method: 'POST',
      body: {
        format: 'csv',
        target: 'leads',
        pipelineId: 'p1',
        mapping: { 'Full Name': 'person.name', 'Work Email': 'person.email', Stage: 'lead.stage' },
        source: 'import',
        defaultOwner: 'me',
      },
    });
    await userEvent.keyboard(SUBMIT);
    expect(await screen.findByText('Imported 2 rows')).toBeInTheDocument();
    expect(sent[1]?.url).toBe('/api/imports');
    expect(screen.getByRole('link', { name: 'Open the YOD leads' })).toHaveAttribute(
      'href',
      '/leads/YOD',
    );
  });

  test('commits exactly what the preview showed', async () => {
    const sent = serveJson((url) => ({
      body: report(url.pathname.endsWith('/preview') ? 'preview' : 'commit'),
    }));
    renderWithClient(<ImportView initialTarget="leads" initialPipelineKey="YOD" />);
    await choose();
    await screen.findByLabelText('Field for Full Name');
    await userEvent.keyboard(SUBMIT);
    await screen.findByText('2 new');
    await userEvent.keyboard(SUBMIT);
    await screen.findByText('Imported 2 rows');
    expect(sent[1]?.body).toEqual(sent[0]?.body);
  });

  test('reads a JSON file and sends it as json', async () => {
    const sent = serveJson(() => ({ body: report('preview') }));
    renderWithClient(<ImportView initialTarget="people" initialPipelineKey={null} />);
    await choose(
      JSON.stringify([{ name: 'Ada Lovelace', email: 'ada@vela.example', company: 'Vela' }]),
      'people.json',
    );
    expect(await screen.findByLabelText('Field for email')).toHaveValue('person.email');
    expect(screen.getByLabelText('Field for company')).toHaveValue('company.name');
    await userEvent.keyboard(SUBMIT);
    await screen.findByText('2 new');
    expect(sent[0]?.body).toMatchObject({ format: 'json', target: 'people', pipelineId: null });
  });

  test('explains a file it cannot read', async () => {
    serveJson(() => ({ body: {} }));
    renderWithClient(<ImportView initialTarget="people" initialPipelineKey={null} />);
    await choose('Name\n"Ada\n');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The file ends inside a quoted value that starts on line 2.',
    );
  });

  test('refuses a file that is not UTF-8 text', async () => {
    const sent = serveJson(() => ({ body: {} }));
    renderWithClient(<ImportView initialTarget="people" initialPipelineKey={null} />);
    await choose(new Uint8Array([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0xff, 0xfe, 0x41, 0x0a]));
    expect(await screen.findByRole('alert')).toHaveTextContent('This file is not UTF-8 text.');
    expect(screen.queryByLabelText('Field for Name')).not.toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });

  test('names a mapping problem instead of sending the file', async () => {
    const sent = serveJson(() => ({ body: {} }));
    renderWithClient(<ImportView initialTarget="people" initialPipelineKey={null} />);
    await choose();
    await userEvent.selectOptions(await screen.findByLabelText('Field for Full Name'), 'ignore');
    await userEvent.keyboard(SUBMIT);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Map a name column, or first and last name columns.',
    );
    expect(sent).toHaveLength(0);
  });

  test('names a source name the server would refuse', async () => {
    const sent = serveJson(() => ({ body: {} }));
    renderWithClient(<ImportView initialTarget="people" initialPipelineKey={null} />);
    await choose();
    await screen.findByLabelText('Field for Full Name');
    await userEvent.clear(screen.getByLabelText('Source name'));
    await userEvent.type(screen.getByLabelText('Source name'), 'Old CRM!');
    await userEvent.keyboard(SUBMIT);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Name the source with lowercase letters, digits, dots, colons or dashes.',
    );
    expect(sent).toHaveLength(0);
  });

  test('Escape goes back from the preview to the mapping', async () => {
    serveJson(() => ({ body: report('preview') }));
    renderWithClient(<ImportView initialTarget="leads" initialPipelineKey="YOD" />);
    await choose();
    await userEvent.keyboard(SUBMIT);
    await screen.findByText('2 new');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('2 new')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Field for Full Name')).toBeInTheDocument();
  });

  test('Escape from the mapping goes back to choosing a file', async () => {
    serveJson(() => ({ body: {} }));
    renderWithClient(<ImportView initialTarget="people" initialPipelineKey={null} />);
    await choose();
    await screen.findByLabelText('Field for Full Name');
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByLabelText('Field for Full Name')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Choose a CSV or JSON file.')).toBeInTheDocument();
  });

  test('the O key opens the file chooser', async () => {
    serveJson(() => ({ body: {} }));
    renderWithClient(<ImportView initialTarget="people" initialPipelineKey={null} />);
    const chooser = screen.getByLabelText('Import file') as HTMLInputElement;
    let opened = 0;
    chooser.addEventListener('click', () => {
      opened += 1;
    });
    await userEvent.keyboard('o');
    expect(opened).toBe(1);
  });

  test('the source controls are locked while a preview is showing', async () => {
    serveJson(() => ({ body: report('preview') }));
    renderWithClient(<ImportView initialTarget="leads" initialPipelineKey="YOD" />);
    await choose();
    await userEvent.keyboard(SUBMIT);
    await screen.findByText('2 new');
    expect(screen.getByLabelText('Source name')).toBeDisabled();
    expect(screen.getByLabelText('What to import')).toBeDisabled();
  });

  test('a preview that lands after the mapping was edited is dropped', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = globalThis.fetch;
    try {
      serveJson(() => ({ body: report('preview') }));
      const served = globalThis.fetch;
      let answered: Promise<Response> = Promise.resolve(new Response());
      globalThis.fetch = ((input: string, init?: RequestInit) => {
        answered = gate.then(() => served(input, init));
        return answered;
      }) as unknown as typeof fetch;
      renderWithClient(<ImportView initialTarget="people" initialPipelineKey={null} />);
      await choose();
      await screen.findByLabelText('Field for Full Name');
      await userEvent.keyboard(SUBMIT);
      await userEvent.selectOptions(screen.getByLabelText('Field for Stage'), 'person.title');
      await act(async () => {
        release();
        await answered;
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(screen.queryByText('2 new')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Field for Stage')).toHaveValue('person.title');
    } finally {
      globalThis.fetch = original;
    }
  });

  test('a re-run says what was already there and offers nothing to import', async () => {
    const rows = [
      outcome(1, 'Ada Lovelace', {
        status: 'unchanged',
        matchedBy: 'email',
        lead: 'exists',
        leadKey: 'YOD-1',
      }),
      outcome(2, 'Grace Hopper', {
        status: 'unchanged',
        matchedBy: 'source_id',
        lead: 'exists',
        leadKey: 'YOD-2',
      }),
    ];
    serveJson(() => ({ body: report('preview', rows) }));
    renderWithClient(<ImportView initialTarget="leads" initialPipelineKey="YOD" />);
    await choose();
    await userEvent.keyboard(SUBMIT);
    expect(await screen.findByText('2 unchanged')).toBeInTheDocument();
    expect(screen.getByText('YOD-1 already in pipeline')).toBeInTheDocument();
    expect(screen.getByText('Matched by email')).toBeInTheDocument();
    expect(screen.getByText('Matched by source id')).toBeInTheDocument();
    expect(
      screen.getByText('Nothing to import. No row would add or change anything.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Import \d/ })).not.toBeInTheDocument();
  });

  test('a skipped row shows its reason and what a person kept shows too', async () => {
    const rows = [
      outcome(1, 'Ada Lovelace', {
        status: 'skipped',
        lead: 'none',
        issues: [
          {
            row: 1,
            column: null,
            code: 'conflict',
            message: 'Bea Bauer already uses ada@vela.example.',
          },
        ],
      }),
      outcome(2, 'Grace Hopper', { status: 'merge', kept: ['company'], lead: 'none' }),
    ];
    serveJson(() => ({ body: report('preview', rows) }));
    renderWithClient(<ImportView initialTarget="leads" initialPipelineKey="YOD" />);
    await choose();
    await userEvent.keyboard(SUBMIT);
    expect(await screen.findByText('Bea Bauer already uses ada@vela.example.')).toBeInTheDocument();
    expect(screen.getByText('Kept what a person set: company')).toBeInTheDocument();
    expect(screen.getByText('1 skipped')).toBeInTheDocument();
  });

  test('a refused preview names why and keeps the mapping', async () => {
    serveJson(() => ({
      status: 422,
      body: {
        error: { code: 'validation_failed', message: 'That stage is not in this pipeline.' },
      },
    }));
    renderWithClient(<ImportView initialTarget="leads" initialPipelineKey="YOD" />);
    await choose();
    await userEvent.keyboard(SUBMIT);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That stage is not in this pipeline.',
    );
    expect(screen.getByLabelText('Field for Full Name')).toBeInTheDocument();
  });

  test('an import that stops part way says where and offers the same file again', async () => {
    serveJson((url) => {
      if (url.pathname.endsWith('/preview')) return { body: report('preview') };
      const done = report('commit');
      return {
        body: {
          report: {
            ...done.report,
            status: 'partial',
            failure: { row: 2, message: 'Fix row 2 and run the same file again to continue.' },
          },
        },
      };
    });
    renderWithClient(<ImportView initialTarget="leads" initialPipelineKey="YOD" />);
    await choose();
    await userEvent.keyboard(SUBMIT);
    await screen.findByText('2 new');
    await userEvent.keyboard(SUBMIT);
    expect(await screen.findByText('The import stopped part way')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Stopped at row 2: Fix row 2 and run the same file again to continue.',
    );
  });

  test('an import stopped at the time limit says so without blaming a row', async () => {
    const stopped =
      'Stopped after row 1 to stay within the time limit. Run the same file again to continue.';
    serveJson((url) => {
      if (url.pathname.endsWith('/preview')) return { body: report('preview') };
      const done = report('commit');
      return {
        body: {
          report: { ...done.report, status: 'partial', failure: { row: null, message: stopped } },
        },
      };
    });
    renderWithClient(<ImportView initialTarget="leads" initialPipelineKey="YOD" />);
    await choose();
    await userEvent.keyboard(SUBMIT);
    await screen.findByText('2 new');
    await userEvent.keyboard(SUBMIT);
    expect(await screen.findByText('The import stopped part way')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(stopped);
    expect(screen.getByRole('alert')).not.toHaveTextContent('Stopped at row');
  });

  test('a role without import rights is told why', () => {
    renderWithClient(<ImportView initialTarget="people" initialPipelineKey={null} />, {
      bootstrap: bootstrapFixture({ me: { userId: 'u1', role: 'contributor' } }),
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your role cannot run imports. Ask a member or an admin of this workspace.',
    );
    expect(screen.queryByLabelText('Import file')).not.toBeInTheDocument();
  });
});
