import { afterEach, describe, expect, mock, test } from 'bun:test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CopyLinkProvider, useCopyLinkTarget } from '@/lib/copy-link.tsx';
import { renderWithClient } from '../support/render.tsx';

function Target() {
  useCopyLinkTarget('/people/per1?lead=l1');
  return null;
}

function stubClipboard(writeText: () => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('copy link', () => {
  test('Cmd+Shift+C copies the registered record link and confirms', async () => {
    const writeText = mock(() => Promise.resolve());
    stubClipboard(writeText);
    renderWithClient(
      <CopyLinkProvider>
        <Target />
      </CopyLinkProvider>,
    );
    await userEvent.keyboard('{Meta>}{Shift>}c{/Shift}{/Meta}');
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('http://localhost:3300/people/per1?lead=l1'),
    );
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });

  test('copies the current view when no record is registered', async () => {
    const writeText = mock(() => Promise.resolve());
    stubClipboard(writeText);
    window.history.replaceState(null, '', '/leads/YOD?q=ada');
    renderWithClient(<CopyLinkProvider>{null}</CopyLinkProvider>);
    await userEvent.keyboard('{Control>}{Shift>}c{/Shift}{/Control}');
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('http://localhost:3300/leads/YOD?q=ada'),
    );
  });

  test('says so when the browser refuses the clipboard', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')));
    renderWithClient(<CopyLinkProvider>{null}</CopyLinkProvider>);
    await userEvent.keyboard('{Meta>}{Shift>}c{/Shift}{/Meta}');
    expect(await screen.findByText('Could not copy the link')).toBeInTheDocument();
  });
});
