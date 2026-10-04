import { afterEach, describe, expect, mock, test } from 'bun:test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';
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
      <CopyLinkProvider workspaceSlug="acme">
        <Target />
      </CopyLinkProvider>,
    );
    await userEvent.keyboard('{Meta>}{Shift>}c{/Shift}{/Meta}');
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('http://localhost:3300/people/per1?lead=l1&w=acme'),
    );
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });

  test('copies the current view when no record is registered', async () => {
    const writeText = mock(() => Promise.resolve());
    stubClipboard(writeText);
    window.history.replaceState(null, '', '/leads/YOD?q=ada');
    renderWithClient(<CopyLinkProvider workspaceSlug="acme">{null}</CopyLinkProvider>);
    await userEvent.keyboard('{Control>}{Shift>}c{/Shift}{/Control}');
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('http://localhost:3300/leads/YOD?q=ada&w=acme'),
    );
  });

  test('names the workspace once, replacing a stale one from the URL', async () => {
    const writeText = mock(() => Promise.resolve());
    stubClipboard(writeText);
    window.history.replaceState(null, '', '/people/per1?w=elsewhere');
    renderWithClient(<CopyLinkProvider workspaceSlug="acme">{null}</CopyLinkProvider>);
    await userEvent.keyboard('{Meta>}{Shift>}c{/Shift}{/Meta}');
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('http://localhost:3300/people/per1?w=acme'),
    );
  });

  test('says so when the browser refuses the clipboard', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')));
    renderWithClient(<CopyLinkProvider workspaceSlug="acme">{null}</CopyLinkProvider>);
    await userEvent.keyboard('{Meta>}{Shift>}c{/Shift}{/Meta}');
    expect(await screen.findByText('Could not copy the link')).toBeInTheDocument();
  });

  test('does not fire while a dialog owns the keyboard', async () => {
    const writeText = mock(() => Promise.resolve());
    stubClipboard(writeText);
    renderWithClient(
      <CopyLinkProvider workspaceSlug="acme">
        <Dialog open>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Rename</DialogTitle>
            <button type="button">Inside</button>
          </DialogContent>
        </Dialog>
      </CopyLinkProvider>,
    );
    screen.getByRole('button', { name: 'Inside' }).focus();
    await userEvent.keyboard('{Meta>}{Shift>}c{/Shift}{/Meta}');
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByText('Link copied')).not.toBeInTheDocument();
  });
});
