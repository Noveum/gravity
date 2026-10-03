import { beforeEach, describe, expect, test } from 'bun:test';
import { emptyFilterGroup } from '@gravity/shared/filters';
import type { SavedViewRow } from '@gravity/shared/records';
import { screen } from '@testing-library/react';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { mockNavigation } from '../../support/navigation.ts';
import { renderWithClient } from '../../support/render.tsx';

await restoreModulesAfterThisFile(['next/navigation']);
const navigation = mockNavigation('/leads/YOD');
beforeEach(() => {
  navigation.pathname = '/leads/YOD';
  navigation.search = '';
});

const { SidebarViews } = await import('@/components/layout/sidebar-views.tsx');

function view(overrides: Partial<SavedViewRow>): SavedViewRow {
  return {
    id: 'v1',
    object: 'lead',
    pipelineId: 'p1',
    name: 'Hot leads',
    filter: emptyFilterGroup(),
    display: {},
    visibility: 'private',
    ownerId: 'u1',
    position: 0,
    syncId: 1,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

const bootstrap = bootstrapFixture({
  savedViews: [
    view({}),
    view({ id: 'v2', name: 'Everyone', pipelineId: null, visibility: 'workspace' }),
    view({ id: 'v3', name: 'Founders', object: 'person', pipelineId: null }),
    view({ id: 'v4', name: 'Gone pipeline', pipelineId: 'p-archived' }),
  ],
});

describe('SidebarViews', () => {
  test('links each saved view to its list, skipping views whose pipeline is gone', () => {
    renderWithClient(<SidebarViews collapsed={false} touch={false} onNavigate={null} />, {
      bootstrap,
    });
    expect(screen.getByRole('link', { name: 'Hot leads' })).toHaveAttribute(
      'href',
      '/leads/YOD?view=v1',
    );
    expect(screen.getByRole('link', { name: 'Everyone' })).toHaveAttribute(
      'href',
      '/leads/YOD?view=v2',
    );
    expect(screen.getByRole('link', { name: 'Founders' })).toHaveAttribute(
      'href',
      '/people?view=v3',
    );
    expect(screen.queryByRole('link', { name: 'Gone pipeline' })).not.toBeInTheDocument();
  });

  test('marks the open view current', () => {
    navigation.search = 'view=v1';
    renderWithClient(<SidebarViews collapsed={false} touch={false} onNavigate={null} />, {
      bootstrap,
    });
    expect(screen.getByRole('link', { name: 'Hot leads' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Everyone' })).not.toHaveAttribute('aria-current');
  });

  test('renders nothing when collapsed or when there are no views', () => {
    const collapsed = renderWithClient(<SidebarViews collapsed touch={false} onNavigate={null} />, {
      bootstrap,
    });
    expect(collapsed.container.textContent).toBe('');
    collapsed.unmount();
    const empty = renderWithClient(
      <SidebarViews collapsed={false} touch={false} onNavigate={null} />,
    );
    expect(empty.container.textContent).toBe('');
  });
});
