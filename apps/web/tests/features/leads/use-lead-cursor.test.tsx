import { describe, expect, test } from 'bun:test';
import type { LeadRow } from '@gravity/shared/records';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { leadFixture } from '../../support/lead-fixture.ts';
import { mockNavigation } from '../../support/navigation.ts';

await restoreModulesAfterThisFile(['next/navigation']);
const navigation = mockNavigation('/leads/YOD');

const { useLeadCursor } = await import('@/features/leads/use-lead-cursor.tsx');
const { ContextPanelProvider } = await import('@/lib/context-panel.tsx');
const { HotkeyProvider } = await import('@/lib/keyboard/index.ts');
const { queryKeys } = await import('@/lib/query/keys.ts');
const { neighbourOf, trailHref } = await import('@/lib/record-trail.ts');

const rows = [1, 2, 3].map((number) =>
  leadFixture({ id: `l${number}`, key: `YOD-${number}`, number, personId: `per${number}` }),
);

function stepIn(ordered: readonly LeadRow[]) {
  return (from: LeadRow | undefined, delta: 1 | -1) => {
    const index = from === undefined ? -1 : ordered.indexOf(from);
    return ordered[Math.min(ordered.length - 1, Math.max(0, index + delta))];
  };
}

function setup(initial: readonly LeadRow[] = rows) {
  const client = new QueryClient();
  client.setQueryData(queryKeys.bootstrap, bootstrapFixture());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <HotkeyProvider>
        <ContextPanelProvider>{children}</ContextPanelProvider>
      </HotkeyProvider>
    </QueryClientProvider>
  );
  return renderHook(
    ({ ordered }: { ordered: readonly LeadRow[] }) =>
      useLeadCursor({ ordered, step: stepIn(ordered) }),
    { wrapper, initialProps: { ordered: initial } },
  );
}

describe('useLeadCursor', () => {
  test('starts on the first lead and J and K move through the given step', async () => {
    const hook = setup();
    expect(hook.result.current.active?.id).toBe('l1');
    await userEvent.keyboard('jj');
    expect(hook.result.current.active?.id).toBe('l3');
    await userEvent.keyboard('j');
    expect(hook.result.current.active?.id).toBe('l3');
    await userEvent.keyboard('k');
    expect(hook.result.current.active?.id).toBe('l2');
  });

  test('X selects, the selection becomes the targets, and Escape clears it', async () => {
    const hook = setup();
    expect(hook.result.current.selection.targets.map((lead) => lead.id)).toEqual(['l1']);
    await userEvent.keyboard('x{Shift>}j{/Shift}');
    expect([...hook.result.current.selectedIds]).toEqual(['l1', 'l2']);
    expect(hook.result.current.selection.hasSelection).toBe(true);
    expect(hook.result.current.selection.targets.map((lead) => lead.id)).toEqual(['l1', 'l2']);
    await userEvent.keyboard('{Escape}');
    expect(hook.result.current.selection.hasSelection).toBe(false);
  });

  test('when the active lead leaves, the focus goes to its surviving neighbour', async () => {
    const hook = setup();
    await userEvent.keyboard('j');
    expect(hook.result.current.active?.id).toBe('l2');
    const [first, , third] = rows;
    if (first === undefined || third === undefined) throw new Error('fixture');
    hook.rerender({ ordered: [first, third] });
    expect(hook.result.current.active?.id).toBe('l3');
  });

  test('Enter opens the active record and leaves the list as the record trail', async () => {
    navigation.push.mockClear();
    setup();
    await userEvent.keyboard('j{Enter}');
    expect(navigation.push).toHaveBeenCalledWith('/people/per2?lead=l2');
    expect(neighbourOf('/people', 'per2', 1)).toBe('per3');
    expect(trailHref('/people', 'per3')).toBe('/people/per3?lead=l3');
  });

  test('a verb request focuses its lead until it is settled', () => {
    const hook = setup();
    const [, second] = rows;
    if (second === undefined) throw new Error('fixture');
    act(() => hook.result.current.requestVerb({ lead: second, verb: 'stage', origin: null }));
    expect(hook.result.current.active?.id).toBe('l2');
    expect(hook.result.current.selection.request?.verb).toBe('stage');
    act(() => hook.result.current.selection.settleRequest());
    expect(hook.result.current.selection.request).toBeNull();
  });
});
