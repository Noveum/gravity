import { afterEach, describe, expect, mock, test } from 'bun:test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { COPY_FOR_AGENT_BINDING, useCopyForAgent } from '@/features/records/use-copy-for-agent.ts';
import { serveJson } from '../../support/fetch.ts';
import { renderWithClient } from '../../support/render.tsx';

const realFetch = globalThis.fetch;
const realSecureContext = window.isSecureContext;

function setSecureContext(value: boolean): void {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value });
}

afterEach(() => {
  globalThis.fetch = realFetch;
  setSecureContext(realSecureContext);
});

function Record({ recordId = 'per1' }: { readonly recordId?: string }) {
  useCopyForAgent(recordId);
  return (
    <div>
      <input aria-label="Note" />
      <input aria-label="Locked" readOnly />
    </div>
  );
}

function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
}

function serveContext(text = 'Person: Ada Lovelace') {
  return serveJson(() => ({ body: { subject: { type: 'person', id: 'per1' }, text } }));
}

const COPY = '{Meta>}{Shift>}a{/Shift}{/Meta}';

describe('useCopyForAgent', () => {
  test('binds Cmd+Shift+A', () => {
    expect(COPY_FOR_AGENT_BINDING).toBe('mod+shift+a');
  });

  test('Cmd+Shift+A copies the context text of the record', async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    stubClipboard(writeText);
    const sent = serveContext();
    renderWithClient(<Record />);
    await userEvent.keyboard(COPY);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Person: Ada Lovelace'));
    expect(sent[0]?.url).toBe('/api/context?ref=per1');
    expect(await screen.findByText('Context copied')).toBeInTheDocument();
  });

  test('Ctrl+Shift+A works too, and the ref is encoded', async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    stubClipboard(writeText);
    const sent = serveContext();
    renderWithClient(<Record recordId="a b/c" />);
    await userEvent.keyboard('{Control>}{Shift>}a{/Shift}{/Control}');
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(sent[0]?.url).toBe('/api/context?ref=a%20b%2Fc');
  });

  test('does not fire while typing in an editable field', async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    stubClipboard(writeText);
    const sent = serveContext();
    renderWithClient(<Record />);
    await userEvent.click(screen.getByLabelText('Note'));
    await userEvent.keyboard(COPY);
    expect(sent).toHaveLength(0);
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByText('Context copied') === null).toBe(true);
  });

  test('fires from a read-only field, which is not editable', async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    stubClipboard(writeText);
    serveContext();
    renderWithClient(<Record />);
    screen.getByLabelText('Locked').focus();
    await userEvent.keyboard(COPY);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Person: Ada Lovelace'));
  });

  test('a plain A and Cmd+A do not copy', async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    stubClipboard(writeText);
    const sent = serveContext();
    renderWithClient(<Record />);
    await userEvent.keyboard('a');
    await userEvent.keyboard('{Meta>}a{/Meta}');
    expect(sent).toHaveLength(0);
  });

  test('names the failure when the server refuses', async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    stubClipboard(writeText);
    serveJson(() => ({
      status: 404,
      body: { error: { code: 'not_found', message: 'That person does not exist.' } },
    }));
    renderWithClient(<Record />);
    await userEvent.keyboard(COPY);
    expect(await screen.findByText('Could not copy the context')).toBeInTheDocument();
    expect(screen.getByText('That person does not exist.')).toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByText('Context copied') === null).toBe(true);
  });

  test('names the failure when the browser refuses the clipboard', async () => {
    setSecureContext(true);
    stubClipboard(() => Promise.reject(new Error('denied')));
    serveContext();
    renderWithClient(<Record />);
    await userEvent.keyboard(COPY);
    expect(await screen.findByText('Could not copy the context')).toBeInTheDocument();
    expect(screen.getByText('The browser blocked clipboard access.')).toBeInTheDocument();
    expect(screen.queryByText('Context copied') === null).toBe(true);
  });

  test('says the page needs a secure connection when there is no clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    setSecureContext(false);
    serveContext();
    renderWithClient(<Record />);
    await userEvent.keyboard(COPY);
    expect(await screen.findByText('Could not copy the context')).toBeInTheDocument();
    expect(
      screen.getByText('Copying needs a secure connection, open Gravity over https.'),
    ).toBeInTheDocument();
  });
});
