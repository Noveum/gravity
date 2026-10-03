import { beforeEach, describe, expect, test } from 'bun:test';
import { screen, waitFor } from '@testing-library/react';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { mockNavigation } from '../../support/navigation.ts';
import { renderWithClient } from '../../support/render.tsx';

await restoreModulesAfterThisFile(['next/navigation']);
const navigation = mockNavigation('/leads');

const { LeadsIndex } = await import('@/features/leads/leads-index.tsx');
const { LeadsView } = await import('@/features/leads/leads-view.tsx');
const { lastPipelineKey, rememberPipeline } = await import('@/lib/last-pipeline.ts');

const twoPipelines = bootstrapFixture({
  pipelines: [
    ...bootstrapFixture().pipelines,
    {
      id: 'p2',
      brandId: 'b1',
      name: 'Partners',
      key: 'PRT',
      kind: 'people',
      position: 1,
      syncId: 1,
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
      archivedAt: null,
    },
  ],
});

beforeEach(() => {
  navigation.replace.mockClear();
  window.localStorage.clear();
});

describe('LeadsIndex', () => {
  test('opens the last used pipeline', async () => {
    rememberPipeline('u1', 'PRT');
    renderWithClient(<LeadsIndex />, { bootstrap: twoPipelines });
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/leads/PRT'));
  });

  test('falls back to the first pipeline when the remembered one is gone', async () => {
    rememberPipeline('u1', 'OLD');
    renderWithClient(<LeadsIndex />, { bootstrap: twoPipelines });
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/leads/YOD'));
  });

  test('explains what to do when there is no pipeline', () => {
    renderWithClient(<LeadsIndex />, {
      bootstrap: bootstrapFixture({ brands: [], pipelines: [], stages: [] }),
    });
    expect(screen.getByText('No pipelines yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a brand' })).toHaveAttribute(
      'href',
      '/settings/brands',
    );
  });
});

describe('LeadsView', () => {
  test('remembers the pipeline it shows, per user', async () => {
    renderWithClient(<LeadsView pipelineKey="PRT" />, { bootstrap: twoPipelines });
    expect(screen.getByText('Yodu · Partners')).toBeInTheDocument();
    await waitFor(() => expect(lastPipelineKey('u1')).toBe('PRT'));
    expect(lastPipelineKey('u2')).toBeNull();
  });

  test('names a pipeline that does not exist and remembers nothing', () => {
    renderWithClient(<LeadsView pipelineKey="NOPE" />);
    expect(screen.getByText('There is no pipeline NOPE')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to your pipelines' })).toHaveAttribute(
      'href',
      '/leads',
    );
    expect(lastPipelineKey('u1')).toBeNull();
  });
});
