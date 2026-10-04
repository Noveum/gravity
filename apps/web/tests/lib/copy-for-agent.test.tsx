import { afterEach, describe, expect, mock, test } from 'bun:test';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';
import {
  COPY_FOR_AGENT_BINDING,
  useCopyForAgent,
  useCopyForAgentTarget,
} from '@/lib/copy-for-agent.tsx';
import { serveJson } from '../support/fetch.ts';
import { renderWithClient } from '../support/render.tsx';

const realFetch = globalThis.fetch;
const realSecureContext = window.isSecureContext;

function setSecureContext(value: boolean): void {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value });
}

class FakeClipboardItem {
  readonly items: Readonly<Record<string, Promise<Blob>>>;
  constructor(items: Record<string, Promise<Blob>>) {
    this.items = items;
  }
}

function defineClipboardItem(value: unknown): void {
  Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, writable: true, value });
}

afterEach(() => {
  globalThis.fetch = realFetch;
  setSecureContext(realSecureContext);
  defineClipboardItem(undefined);
});

function Harness({ target }: { readonly target: string | null }) {
  useCopyForAgentTarget(target);
  const copy = useCopyForAgent();
  return (
    <div>
      <input aria-label="Note" />
      <input aria-label="Locked" readOnly />
      <button type="button" onClick={() => copy()}>
        Copy it
      </button>
      <button type="button" onClick={() => copy('other')}>
        Copy other
      </button>
    </div>
  );
}

function renderHarness(target: string | null = 'per1') {
  return renderWithClient(<Harness target={target} />);
}

function stubWriteText(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
}

interface Written {
  readonly texts: string[];
  readonly write: ReturnType<typeof mock>;
}

function stubClipboardItem(failWith?: Error): Written {
  const texts: string[] = [];
  const write = mock(async (items: readonly FakeClipboardItem[]) => {
    const blob = await items[0]?.items['text/plain'];
    if (failWith !== undefined) throw failWith;
    texts.push((await blob?.text()) ?? '');
  });
  defineClipboardItem(FakeClipboardItem);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
  return { texts, write };
}

function reply(label = 'Ada Lovelace', text = 'Person: Ada Lovelace') {
  return { body: { subject: { type: 'person', id: 'per1' }, label, text } };
}

const COPY = '{Meta>}{Shift>}a{/Shift}{/Meta}';

describe('the copy for agent hotkey', () => {
  test('binds Cmd+Shift+A', () => {
    expect(COPY_FOR_AGENT_BINDING).toBe('mod+shift+a');
  });

  test('copies the context of the registered record and names it in the toast', async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    stubWriteText(writeText);
    const sent = serveJson(() => reply('YOD-2 · Ada Lovelace'));
    renderHarness('l2');
    await userEvent.keyboard(COPY);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Person: Ada Lovelace'));
    expect(sent[0]?.url).toBe('/api/context?ref=l2');
    expect(await screen.findByText('Copied YOD-2 · Ada Lovelace')).toBeInTheDocument();
  });

  test('Ctrl+Shift+A works too, and the ref is encoded', async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    stubWriteText(writeText);
    const sent = serveJson(() => reply());
    renderHarness('a b/c');
    await userEvent.keyboard('{Control>}{Shift>}a{/Shift}{/Control}');
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(sent[0]?.url).toBe('/api/context?ref=a%20b%2Fc');
  });

  test('works while typing in an editable field, like Cmd+Shift+C', async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    stubWriteText(writeText);
    serveJson(() => reply());
    renderHarness();
    await userEvent.click(screen.getByLabelText('Note'));
    await userEvent.keyboard(COPY);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Person: Ada Lovelace'));
  });

  test('works from a read-only field', async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    stubWriteText(writeText);
    serveJson(() => reply());
    renderHarness();
    screen.getByLabelText('Locked').focus();
    await userEvent.keyboard(COPY);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
  });

  test('a plain A and Cmd+A do not copy', async () => {
    const sent = serveJson(() => reply());
    renderHarness();
    await userEvent.keyboard('a');
    await userEvent.keyboard('{Meta>}a{/Meta}');
    expect(sent).toHaveLength(0);
  });

  test('is not bound while no record is registered', async () => {
    const sent = serveJson(() => reply());
    renderHarness(null);
    await userEvent.keyboard(COPY);
    expect(sent).toHaveLength(0);
  });

  test('does not fire while a dialog owns the keyboard', async () => {
    const sent = serveJson(() => reply());
    renderWithClient(
      <>
        <Harness target="per1" />
        <Dialog open>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Rename</DialogTitle>
            <button type="button">Inside</button>
          </DialogContent>
        </Dialog>
      </>,
    );
    screen.getByRole('button', { name: 'Inside' }).focus();
    await userEvent.keyboard(COPY);
    expect(sent).toHaveLength(0);
  });
});

describe('copy', () => {
  test('a click copies the same text as the key', async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    stubWriteText(writeText);
    const sent = serveJson(() => reply());
    renderHarness('per1');
    await userEvent.click(screen.getByRole('button', { name: 'Copy it' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Person: Ada Lovelace'));
    expect(sent[0]?.url).toBe('/api/context?ref=per1');
  });

  test('an explicit target wins over the registered one', async () => {
    stubWriteText(() => Promise.resolve());
    const sent = serveJson(() => reply());
    renderHarness('per1');
    await userEvent.click(screen.getByRole('button', { name: 'Copy other' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.url).toBe('/api/context?ref=other');
  });

  test('says to focus a record first when nothing is registered', async () => {
    const sent = serveJson(() => reply());
    renderHarness(null);
    await userEvent.click(screen.getByRole('button', { name: 'Copy it' }));
    expect(await screen.findByText('Focus a record first')).toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });

  test('a second press while copying does nothing', async () => {
    const written = mock((_text: string) => Promise.resolve());
    stubWriteText(written);
    let release: (response: Response) => void = () => undefined;
    const fetchMock = mock(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    renderHarness();
    await userEvent.keyboard(COPY);
    await userEvent.keyboard(COPY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(Response.json(reply().body));
    expect(await screen.findByText('Copied Ada Lovelace')).toBeInTheDocument();
    await userEvent.keyboard(COPY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      release(Response.json(reply().body));
      await Promise.resolve();
    });
    await waitFor(() => expect(written).toHaveBeenCalledTimes(2));
  });

  test('writes a promised clipboard item before the server answers, for Safari', async () => {
    const clipboard = stubClipboardItem();
    let release: (response: Response) => void = () => undefined;
    globalThis.fetch = mock(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    ) as unknown as typeof fetch;
    renderHarness();
    await userEvent.keyboard(COPY);
    expect(clipboard.write).toHaveBeenCalledTimes(1);
    expect(clipboard.texts).toEqual([]);
    release(Response.json(reply().body));
    await waitFor(() => expect(clipboard.texts).toEqual(['Person: Ada Lovelace']));
    expect(await screen.findByText('Copied Ada Lovelace')).toBeInTheDocument();
  });

  test('falls back to writeText when the browser has no clipboard item', async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    stubWriteText(writeText);
    serveJson(() => reply());
    renderHarness();
    await userEvent.keyboard(COPY);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Person: Ada Lovelace'));
  });
});

describe('when copying fails', () => {
  test('names the server refusal and never reports the clipboard', async () => {
    const clipboard = stubClipboardItem();
    serveJson(() => ({
      status: 404,
      body: { error: { code: 'not_found', message: 'That person does not exist.' } },
    }));
    renderHarness();
    await userEvent.keyboard(COPY);
    expect(await screen.findByText('Could not copy the context')).toBeInTheDocument();
    expect(screen.getByText('That person does not exist.')).toBeInTheDocument();
    expect(clipboard.texts).toEqual([]);
    expect(screen.queryByText(/^Copied/)).not.toBeInTheDocument();
  });

  test('names the server refusal on the writeText path too', async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    stubWriteText(writeText);
    serveJson(() => ({
      status: 404,
      body: { error: { code: 'not_found', message: 'That person does not exist.' } },
    }));
    renderHarness();
    await userEvent.keyboard(COPY);
    expect(await screen.findByText('That person does not exist.')).toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });

  test('names a clipboard refusal of the clipboard item', async () => {
    setSecureContext(true);
    stubClipboardItem(new Error('denied'));
    serveJson(() => reply());
    renderHarness();
    await userEvent.keyboard(COPY);
    expect(await screen.findByText('Could not copy the context')).toBeInTheDocument();
    expect(screen.getByText('The browser blocked clipboard access.')).toBeInTheDocument();
    expect(screen.queryByText(/^Copied/)).not.toBeInTheDocument();
  });

  test('names a clipboard refusal of writeText', async () => {
    setSecureContext(true);
    stubWriteText(() => Promise.reject(new Error('denied')));
    serveJson(() => reply());
    renderHarness();
    await userEvent.keyboard(COPY);
    expect(await screen.findByText('The browser blocked clipboard access.')).toBeInTheDocument();
  });

  test('says the page needs a secure connection when there is no clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    setSecureContext(false);
    serveJson(() => reply());
    renderHarness();
    await userEvent.keyboard(COPY);
    expect(
      await screen.findByText('Copying needs a secure connection, open Gravity over https.'),
    ).toBeInTheDocument();
  });
});

describe('without the provider', () => {
  test('registering a target is harmless', () => {
    function Lonely() {
      useCopyForAgentTarget('per1');
      return <p>fine</p>;
    }
    render(<Lonely />);
    expect(screen.getByText('fine')).toBeInTheDocument();
  });
});
