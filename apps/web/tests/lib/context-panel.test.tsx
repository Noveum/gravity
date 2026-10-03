import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { restoreModulesAfterThisFile } from '../../tests-support.ts';
import { bootstrapFixture } from '../support/bootstrap-fixture.ts';
import { mockNavigation } from '../support/navigation.ts';
import { renderWithClient } from '../support/render.tsx';
import { setViewport, setViewportWidth } from '../support/viewport.ts';

await restoreModulesAfterThisFile(['next/navigation']);
const navigation = mockNavigation('/leads/YOD');
beforeEach(() => {
  navigation.pathname = '/leads/YOD';
  setViewport(true);
});
afterAll(() => setViewport(false));

const { ContextPanel } = await import('@/components/layout/context-panel.tsx');
const { clampPanelWidth, ContextPanelProvider, PREFERENCE_DEBOUNCE_MS, useContextPanel } =
  await import('@/lib/context-panel.tsx');
const { queryKeys } = await import('@/lib/query/keys.ts');

function settle(ms = PREFERENCE_DEBOUNCE_MS + 150): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function preferenceResponse(width: number): Response {
  return new Response(
    JSON.stringify({
      preference: {
        page: 'context-panel',
        scope: '',
        layout: 'list',
        display: { width, open: true },
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

function Peeker() {
  const { show } = useContextPanel();
  useEffect(() => show(<p>Peek body</p>, 'Lead YOD-1'), [show]);
  return null;
}

function Clearer() {
  const { clear } = useContextPanel();
  return (
    <button type="button" onClick={clear}>
      Clear the panel
    </button>
  );
}

function renderPanel(bootstrap = bootstrapFixture(), peek = true) {
  const fetchMock = mock(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          preference: {
            page: 'context-panel',
            scope: '',
            layout: 'list',
            display: { width: 436, open: true },
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    ),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const rendered = renderWithClient(
    <ContextPanelProvider>
      {peek ? <Peeker /> : null}
      <ContextPanel />
    </ContextPanelProvider>,
    { bootstrap },
  );
  return { fetchMock, ...rendered };
}

function lastBody(fetchMock: ReturnType<typeof mock>): unknown {
  const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
  expect(url).toBe('/api/view-preferences');
  return JSON.parse(String(init.body));
}

describe('clampPanelWidth', () => {
  test('keeps the width between 360 and 640 and defaults garbage to 420', () => {
    expect([
      clampPanelWidth(100),
      clampPanelWidth(900),
      clampPanelWidth(Number.NaN),
      clampPanelWidth(500.4),
    ]).toEqual([360, 640, 420, 500]);
  });
});

describe('ContextPanel', () => {
  test('shows the peek, hides and shows again with ]', async () => {
    renderPanel();
    expect(await screen.findByText('Peek body')).toBeInTheDocument();
    await userEvent.keyboard(']');
    await waitFor(() => expect(screen.queryByText('Peek body')).not.toBeInTheDocument());
    await userEvent.keyboard(']');
    expect(await screen.findByText('Peek body')).toBeInTheDocument();
  });

  test('clear drops the content, so ] has nothing to bring back', async () => {
    const fetchMock = mock(() => Promise.resolve(preferenceResponse(420)));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    renderWithClient(
      <ContextPanelProvider>
        <Peeker />
        <Clearer />
        <ContextPanel />
      </ContextPanelProvider>,
    );
    await screen.findByText('Peek body');
    await userEvent.click(screen.getByRole('button', { name: 'Clear the panel' }));
    expect(screen.queryByText('Peek body')).not.toBeInTheDocument();
    await userEvent.keyboard(']');
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('remembers that it was hidden', async () => {
    const { fetchMock } = renderPanel();
    await screen.findByText('Peek body');
    await userEvent.keyboard(']');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastBody(fetchMock)).toMatchObject({
      page: 'context-panel',
      display: { width: 420, open: false },
    });
  });

  test('] does nothing on a record page, where it means the next record', async () => {
    navigation.pathname = '/people/per1';
    const { fetchMock } = renderPanel();
    await screen.findByText('Peek body');
    await userEvent.keyboard(']');
    expect(screen.getByText('Peek body')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('the width slider responds to arrows and remembers the width', async () => {
    const { fetchMock } = renderPanel();
    const slider = await screen.findByRole('slider', { name: 'Context panel width' });
    expect(slider).toHaveAttribute('aria-valuenow', '420');
    slider.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(slider).toHaveAttribute('aria-valuenow', '436');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastBody(fetchMock)).toMatchObject({ page: 'context-panel', display: { width: 436 } });
  });

  test('Home and End jump to the narrowest and widest panel', async () => {
    renderPanel();
    const slider = await screen.findByRole('slider', { name: 'Context panel width' });
    slider.focus();
    await userEvent.keyboard('{End}');
    expect(slider).toHaveAttribute('aria-valuenow', '640');
    await userEvent.keyboard('{Home}');
    expect(slider).toHaveAttribute('aria-valuenow', '360');
  });

  test('dragging the edge resizes within the limits and saves once on release', async () => {
    const { fetchMock } = renderPanel();
    const slider = await screen.findByRole('slider', { name: 'Context panel width' });
    const panel = screen.getByRole('complementary', { name: 'Lead YOD-1' });
    fireEvent.pointerDown(slider, { pointerId: 1, clientX: 1000 });
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 900 });
    expect(slider).toHaveAttribute('aria-valuenow', '520');
    expect(panel.style.width).toBe('520px');
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 200 });
    expect(slider).toHaveAttribute('aria-valuenow', '640');
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider, { pointerId: 1, clientX: 200 });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(lastBody(fetchMock)).toMatchObject({ display: { width: 640, open: true } });
  });

  test('opens at the width the user saved', async () => {
    renderPanel(
      bootstrapFixture({
        viewPreferences: [
          { page: 'context-panel', scope: '', layout: 'list', display: { width: 512, open: true } },
        ],
      }),
    );
    const slider = await screen.findByRole('slider', { name: 'Context panel width' });
    expect(slider).toHaveAttribute('aria-valuenow', '512');
  });

  test('] with nothing to show does nothing and saves nothing', async () => {
    const { fetchMock } = renderPanel(bootstrapFixture(), false);
    await userEvent.keyboard(']');
    await settle();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a burst of arrow keys saves once, with the final width', async () => {
    const { fetchMock } = renderPanel();
    const slider = await screen.findByRole('slider', { name: 'Context panel width' });
    slider.focus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowRight}');
    expect(slider).toHaveAttribute('aria-valuenow', '468');
    expect(fetchMock).not.toHaveBeenCalled();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastBody(fetchMock)).toMatchObject({ display: { width: 468, open: true } });
  });

  test('fast ] presses save once, with the last state', async () => {
    const { fetchMock } = renderPanel();
    await screen.findByText('Peek body');
    await userEvent.keyboard(']]]');
    expect(screen.queryByText('Peek body')).not.toBeInTheDocument();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastBody(fetchMock)).toMatchObject({ display: { open: false } });
  });

  test('a slow answer to an older save never overwrites a newer width', async () => {
    const answers: ((response: Response) => void)[] = [];
    const bodies: unknown[] = [];
    const { client } = renderPanel();
    globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Promise<Response>((resolve) => answers.push(resolve));
    }) as unknown as typeof fetch;
    const slider = await screen.findByRole('slider', { name: 'Context panel width' });
    slider.focus();
    await userEvent.keyboard('{ArrowLeft}');
    await settle();
    expect(bodies).toHaveLength(1);
    await userEvent.keyboard('{ArrowLeft}');
    await settle();
    expect(bodies).toHaveLength(1);
    answers.shift()?.(preferenceResponse(436));
    await waitFor(() => expect(bodies).toHaveLength(2));
    const savedWidths = () =>
      client
        .getQueryData<ReturnType<typeof bootstrapFixture>>(queryKeys.bootstrap)
        ?.viewPreferences.map((entry) => entry.display['width']);
    expect(savedWidths()).toEqual([]);
    expect(bodies[1]).toMatchObject({ display: { width: 452 } });
    answers.shift()?.(preferenceResponse(452));
    await waitFor(() => expect(savedWidths()).toEqual([452]));
    expect(slider).toHaveAttribute('aria-valuenow', '452');
  });

  test('a width still waiting to be saved is sent when the panel goes away', async () => {
    const { fetchMock, unmount } = renderPanel();
    const slider = await screen.findByRole('slider', { name: 'Context panel width' });
    slider.focus();
    await userEvent.keyboard('{ArrowLeft}');
    unmount();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastBody(fetchMock)).toMatchObject({ display: { width: 436 } });
  });

  test('the header close button hides the panel', async () => {
    setViewportWidth(1000);
    renderPanel();
    await screen.findByText('Peek body');
    await userEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(screen.queryByText('Peek body')).not.toBeInTheDocument();
  });

  test('Esc closes the overlay panel when it is the topmost layer', async () => {
    setViewportWidth(1000);
    renderPanel();
    const panel = await screen.findByRole('complementary', { name: 'Lead YOD-1' });
    expect(panel.className).toContain('absolute');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('Peek body')).not.toBeInTheDocument();
  });

  test('Esc inside a dialog above the panel leaves the panel open', async () => {
    setViewportWidth(1000);
    renderWithClient(
      <ContextPanelProvider>
        <Peeker />
        <ContextPanel />
        <div role="dialog" aria-label="Palette">
          <button type="button">Inside</button>
        </div>
      </ContextPanelProvider>,
    );
    await screen.findByText('Peek body');
    screen.getByRole('button', { name: 'Inside' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByText('Peek body')).toBeInTheDocument();
  });
});
