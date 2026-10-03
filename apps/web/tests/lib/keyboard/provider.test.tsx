import { describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  HOTKEY_PRIORITY,
  HotkeyProvider,
  useHotkey,
  useHotkeyList,
} from '../../../src/lib/keyboard/index.ts';

interface SurfaceProps {
  readonly onEnter: () => void;
  readonly onSpace: () => void;
  readonly onActivate: () => void;
}

function RecordSurface({ onEnter, onSpace, onActivate }: SurfaceProps) {
  useHotkey('enter', onEnter, { label: 'Open record', section: 'Records', scope: 'records' });
  useHotkey('space', onSpace, { label: 'Peek record', section: 'Records', scope: 'records' });

  return (
    <div>
      <button type="button" data-testid="new-record" onClick={onActivate}>
        New record
      </button>
      <a href="/team/eng/board" data-testid="view-board" onClick={onActivate}>
        Board
      </a>
      <div role="option" aria-selected="false" tabIndex={0} data-testid="filter-chip">
        Assignee is Aditi
      </div>
      <div data-testid="rows" tabIndex={-1}>
        ENG-1
      </div>
    </div>
  );
}

function renderSurface() {
  const handlers = { onEnter: mock(), onSpace: mock(), onActivate: mock() };
  render(
    <HotkeyProvider>
      <RecordSurface {...handlers} />
    </HotkeyProvider>,
  );
  return handlers;
}

describe('activation keys', () => {
  it('activates a focused button instead of running the enter binding', async () => {
    const user = userEvent.setup();
    const handlers = renderSurface();

    await user.tab();
    expect(screen.getByTestId('new-record')).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(handlers.onActivate).toHaveBeenCalledTimes(1);
    expect(handlers.onEnter).not.toHaveBeenCalled();
  });

  it('leaves enter and space to a focused link and to a role=option row', async () => {
    const user = userEvent.setup();
    const handlers = renderSurface();

    screen.getByTestId('view-board').focus();
    await user.keyboard('{Enter}');
    expect(handlers.onEnter).not.toHaveBeenCalled();

    screen.getByTestId('filter-chip').focus();
    await user.keyboard('{Enter}[Space]');
    expect(handlers.onEnter).not.toHaveBeenCalled();
    expect(handlers.onSpace).not.toHaveBeenCalled();
  });

  it('still runs the bindings when no control holds focus', async () => {
    const user = userEvent.setup();
    const handlers = renderSurface();

    screen.getByTestId('rows').focus();
    await user.keyboard('{Enter}[Space]');
    expect(handlers.onEnter).toHaveBeenCalledTimes(1);
    expect(handlers.onSpace).toHaveBeenCalledTimes(1);
  });
});

function LayerSurface({ onEscape }: { readonly onEscape: () => void }) {
  useHotkey('escape', onEscape, {
    label: 'Clear the selection',
    section: 'Records',
    scope: 'records',
    preventDefault: false,
  });

  return (
    <div
      data-testid="layer"
      role="menu"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.preventDefault();
      }}
    >
      menu
    </div>
  );
}

describe('an open layer that handles the key itself', () => {
  it('keeps the global binding out of an escape the layer already handled', async () => {
    const user = userEvent.setup();
    const onEscape = mock();
    render(
      <HotkeyProvider>
        <LayerSurface onEscape={onEscape} />
      </HotkeyProvider>,
    );

    screen.getByTestId('layer').focus();
    await user.keyboard('{Escape}');
    expect(onEscape).not.toHaveBeenCalled();

    document.body.focus();
    await user.keyboard('{Escape}');
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});

function GlobalCreate({ onRun }: { readonly onRun: () => void }) {
  useHotkey('c', onRun, { label: 'Create record', section: 'Records' });
  return null;
}

function InboxCreate({ onRun }: { readonly onRun: () => void }) {
  useHotkey('c', onRun, {
    label: 'New message',
    section: 'Navigation',
    scope: 'inbox',
    priority: HOTKEY_PRIORITY.surface,
  });
  return null;
}

describe('scoped bindings', () => {
  async function pressC(globalFirst: boolean) {
    const user = userEvent.setup();
    const onGlobal = mock();
    const onInbox = mock();
    render(
      <HotkeyProvider>
        {globalFirst ? <GlobalCreate onRun={onGlobal} /> : <InboxCreate onRun={onInbox} />}
        {globalFirst ? <InboxCreate onRun={onInbox} /> : <GlobalCreate onRun={onGlobal} />}
      </HotkeyProvider>,
    );
    await user.keyboard('c');
    return { onGlobal, onInbox };
  }

  it('runs the surface binding when the global one registered first', async () => {
    const { onGlobal, onInbox } = await pressC(true);
    expect(onInbox).toHaveBeenCalledTimes(1);
    expect(onGlobal).not.toHaveBeenCalled();
  });

  it('runs the surface binding when it registered first', async () => {
    const { onGlobal, onInbox } = await pressC(false);
    expect(onInbox).toHaveBeenCalledTimes(1);
    expect(onGlobal).not.toHaveBeenCalled();
  });
});

function AdvertisedBindings() {
  const entries = useHotkeyList();
  return (
    <div data-testid="advertised">
      {entries
        .filter((entry) => entry.advertised)
        .map((entry) => entry.binding)
        .join(' ')}
    </div>
  );
}

function ListSurface({ onNext, onExtend }: { onNext: () => void; onExtend: () => void }) {
  useHotkey('j', onNext, {
    label: 'Next record',
    section: 'Records',
    scope: 'records',
    aliases: ['down'],
  });
  useHotkey('shift+j', onExtend, {
    label: 'Extend the selection down',
    section: 'Records',
    scope: 'records',
    aliases: ['shift+down'],
  });
  return null;
}

describe('binding aliases', () => {
  function renderList() {
    const user = userEvent.setup();
    const onNext = mock();
    const onExtend = mock();
    render(
      <HotkeyProvider>
        <ListSurface onNext={onNext} onExtend={onExtend} />
      </HotkeyProvider>,
    );
    return { user, onNext, onExtend };
  }

  it('runs the same handler for the letter and the arrow', async () => {
    const { user, onNext } = renderList();
    await user.keyboard('j');
    await user.keyboard('{ArrowDown}');
    expect(onNext).toHaveBeenCalledTimes(2);
  });

  it('keeps the shifted alias separate from the plain one', async () => {
    const { user, onNext, onExtend } = renderList();
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    expect(onExtend).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('advertises the binding once, not once per alias', () => {
    render(
      <HotkeyProvider>
        <ListSurface onNext={mock()} onExtend={mock()} />
        <AdvertisedBindings />
      </HotkeyProvider>,
    );
    expect(screen.getByTestId('advertised').textContent).toBe('j shift+j');
  });
});

describe('malformed keyboard events', () => {
  it.each([undefined, null, 42, ''])(
    'ignores an invalid key %p and keeps shortcuts working',
    async (key) => {
      const user = userEvent.setup();
      const onRun = mock();
      render(
        <HotkeyProvider>
          <GlobalCreate onRun={onRun} />
        </HotkeyProvider>,
      );
      const event = new Event('keydown', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'key', { value: key });
      expect(() => window.dispatchEvent(event)).not.toThrow();
      expect(event.defaultPrevented).toBe(false);
      expect(onRun).not.toHaveBeenCalled();
      await user.keyboard('c');
      expect(onRun).toHaveBeenCalledTimes(1);
    },
  );
});
