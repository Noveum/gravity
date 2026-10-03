import { DEFAULT_PROSPECTING_STAGES } from '@gravity/shared/constants';
import type { Bootstrap } from '@/lib/query/schemas.ts';

const AT = '2026-10-01T10:00:00.000Z';

function stageId(name: string): string {
  if (name === 'New') return 'new';
  if (name === 'Ready') return 'ready';
  return `stage-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`;
}

export function bootstrapFixture(overrides: Partial<Bootstrap> = {}): Bootstrap {
  return {
    organization: { id: 'o1', name: 'Acme Studio', slug: 'acme-studio' },
    me: { userId: 'u1', role: 'admin' },
    brands: [
      {
        id: 'b1',
        name: 'Yodu',
        domain: 'yodu.ai',
        color: 'blue',
        signature: '',
        currentPlaybookVersion: 1,
        syncId: 1,
        createdAt: AT,
        updatedAt: AT,
        archivedAt: null,
      },
    ],
    pipelines: [
      {
        id: 'p1',
        brandId: 'b1',
        name: 'Prospecting',
        key: 'YOD',
        kind: 'people',
        position: 0,
        syncId: 1,
        createdAt: AT,
        updatedAt: AT,
        archivedAt: null,
      },
    ],
    stages: DEFAULT_PROSPECTING_STAGES.map((stage, index) => ({
      id: stageId(stage.name),
      pipelineId: 'p1',
      name: stage.name,
      category: stage.category,
      sortOrder: index,
      syncId: 1,
      archivedAt: null,
    })),
    fields: [],
    members: [
      {
        memberId: 'm1',
        userId: 'u1',
        name: 'Ada Admin',
        email: 'ada@acme.test',
        image: null,
        role: 'admin',
        isAgent: false,
        syncId: 1,
      },
      {
        memberId: 'm2',
        userId: 'u2',
        name: 'Tess Teammate',
        email: 'tess@acme.test',
        image: null,
        role: 'member',
        isAgent: false,
        syncId: 1,
      },
    ],
    savedViews: [],
    viewPreferences: [],
    ...overrides,
  };
}
