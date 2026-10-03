import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import type { SyncAction } from '@gravity/shared/events';
import {
  containsCondition,
  emptyFilterGroup,
  encodeListQuery,
  inCondition,
  replaceCondition,
} from '@gravity/shared/filters';
import type {
  ActivityRow,
  CompanyRow,
  EmploymentRow,
  FieldDefinitionRow,
  LeadRow,
  PersonRow,
  SavedViewRow,
} from '@gravity/shared/records';
import { QueryClient } from '@tanstack/react-query';
import { clientId } from '@/lib/query/client-id.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import type { Pages } from '@/lib/query/pages.ts';
import type {
  Bootstrap,
  CompanyRecord,
  LeadPage,
  PersonRecord,
  TimelinePage,
} from '@/lib/query/schemas.ts';
import { isOwnEcho, registerCrmDeltaHandlers } from '@/lib/realtime/crm-deltas.tsx';
import { applyDelta } from '@/lib/realtime/delta-bridge.tsx';
import { bootstrapFixture } from '../../support/bootstrap-fixture.ts';
import { leadFixture } from '../../support/lead-fixture.ts';

let unregister: () => void = () => undefined;

beforeAll(() => {
  unregister = registerCrmDeltaHandlers();
});

afterAll(() => {
  unregister();
});

const warn = spyOn(console, 'warn').mockImplementation(() => undefined);

afterEach(() => {
  warn.mockClear();
});

afterAll(() => {
  warn.mockRestore();
});

const AT = '2026-10-01T10:00:00.000Z';
const everything = encodeListQuery({ filter: emptyFilterGroup(), q: '' });
const newOnly = encodeListQuery({
  filter: replaceCondition(emptyFilterGroup(), inCondition('stage', ['new'])),
  q: '',
});
const readyOnly = encodeListQuery({
  filter: replaceCondition(emptyFilterGroup(), inCondition('stage', ['ready'])),
  q: '',
});
const named = encodeListQuery({
  filter: replaceCondition(emptyFilterGroup(), containsCondition('person', 'ada')),
  q: '',
});

function action(
  model: SyncAction['model'],
  data: Record<string, unknown>,
  overrides: Partial<SyncAction> = {},
): SyncAction {
  return {
    syncId: Number(data['syncId'] ?? 1),
    organizationId: 'o1',
    scopes: ['workspace:o1'],
    action: 'update',
    model,
    modelId: String(data['id'] ?? 'x'),
    data,
    actor: { type: 'user', id: 'u2' },
    at: new Date(0).toISOString(),
    ...overrides,
  };
}

function leadPages(leads: LeadRow[]): Pages<LeadPage> {
  return { pages: [{ leads, nextCursor: null }], pageParams: [null] };
}

function cache(lists: Record<string, LeadRow[]>): QueryClient {
  const client = new QueryClient();
  client.setQueryData<Bootstrap>(queryKeys.bootstrap, bootstrapFixture());
  for (const [search, leads] of Object.entries(lists)) {
    const [pipelineId, query] = search.split('|') as [string, string];
    client.setQueryData(queryKeys.leads(pipelineId, query), leadPages(leads));
  }
  return client;
}

function ids(client: QueryClient, pipelineId: string, search: string): string[] {
  const data = client.getQueryData<Pages<LeadPage>>(queryKeys.leads(pipelineId, search));
  return (data?.pages ?? []).flatMap((page) => page.leads.map((lead) => lead.id));
}

function bootstrapOf(client: QueryClient): Bootstrap {
  const bootstrap = client.getQueryData<Bootstrap>(queryKeys.bootstrap);
  if (bootstrap === undefined) throw new Error('the bootstrap is cached');
  return bootstrap;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function personFixture(overrides: Partial<PersonRow> = {}): PersonRow {
  return {
    id: 'per1',
    name: 'Ada Lovelace',
    emails: ['ada@acme.io'],
    primaryEmail: 'ada@acme.io',
    phones: [],
    linkedinUrl: null,
    linkedinProviderId: null,
    location: null,
    timezone: null,
    doNotContact: false,
    fields: {},
    companyId: null,
    companyName: null,
    title: null,
    syncId: 5,
    createdAt: AT,
    updatedAt: AT,
    archivedAt: null,
    ...overrides,
  };
}

function companyFixture(overrides: Partial<CompanyRow> = {}): CompanyRow {
  return {
    id: 'c1',
    name: 'Acme',
    domains: ['acme.io'],
    primaryDomain: 'acme.io',
    size: null,
    segment: null,
    location: null,
    fields: {},
    syncId: 5,
    createdAt: AT,
    updatedAt: AT,
    archivedAt: null,
    ...overrides,
  };
}

function employmentFixture(overrides: Partial<EmploymentRow> = {}): EmploymentRow {
  return {
    id: 'e1',
    personId: 'per1',
    companyId: 'c1',
    companyName: 'Acme',
    title: 'Engineer',
    startedAt: null,
    endedAt: null,
    isCurrent: true,
    syncId: 60,
    ...overrides,
  };
}

function viewFixture(overrides: Partial<SavedViewRow> = {}): SavedViewRow {
  return {
    id: 'v1',
    object: 'lead',
    pipelineId: 'p1',
    name: 'Hot',
    filter: emptyFilterGroup(),
    display: {},
    visibility: 'workspace',
    ownerId: 'u2',
    position: 0,
    syncId: 70,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function fieldFixture(overrides: Partial<FieldDefinitionRow> = {}): FieldDefinitionRow {
  return {
    id: 'f1',
    object: 'lead',
    pipelineId: 'p1',
    key: 'budget',
    label: 'Budget',
    type: 'number',
    options: [],
    description: '',
    example: '',
    position: 0,
    syncId: 1,
    archivedAt: null,
    ...overrides,
  };
}

describe('lead deltas', () => {
  test('a teammate stage change moves the row between filtered lists', () => {
    const client = cache({ [`p1|${newOnly}`]: [leadFixture()], [`p1|${readyOnly}`]: [] });
    applyDelta(action('lead', leadFixture({ stageId: 'ready', syncId: 11 })), client);
    expect(ids(client, 'p1', newOnly)).toEqual([]);
    expect(ids(client, 'p1', readyOnly)).toEqual(['l1']);
  });

  test('a new lead joins only the lists of its pipeline', () => {
    const client = cache({ [`p1|${everything}`]: [], [`p2|${everything}`]: [] });
    applyDelta(action('lead', leadFixture({ id: 'l9', syncId: 12 }), { action: 'insert' }), client);
    expect(ids(client, 'p1', everything)).toEqual(['l9']);
    expect(ids(client, 'p2', everything)).toEqual([]);
  });

  test('an update for a lead the list has never seen is placed, not dropped', () => {
    const client = cache({ [`p1|${readyOnly}`]: [] });
    applyDelta(action('lead', leadFixture({ id: 'l7', stageId: 'ready', syncId: 14 })), client);
    expect(ids(client, 'p1', readyOnly)).toEqual(['l7']);
  });

  test('the browser ignores its own echo', () => {
    const client = cache({ [`p1|${newOnly}`]: [leadFixture()] });
    applyDelta(
      action('lead', leadFixture({ stageId: 'ready', syncId: 13 }), {
        originClientId: clientId(),
      }),
      client,
    );
    expect(ids(client, 'p1', newOnly)).toEqual(['l1']);
  });

  test('an older update after a newer one does not revert the row', () => {
    const client = cache({ [`p1|${everything}`]: [leadFixture()] });
    applyDelta(action('lead', leadFixture({ priority: 1, syncId: 21 })), client);
    applyDelta(action('lead', leadFixture({ priority: 4, syncId: 20 })), client);
    const data = client.getQueryData<Pages<LeadPage>>(queryKeys.leads('p1', everything));
    expect(data?.pages[0]?.leads[0]?.priority).toBe(1);
  });

  test('a delete removes the lead from every list', () => {
    const client = cache({
      [`p1|${everything}`]: [leadFixture()],
      [`p1|${newOnly}`]: [leadFixture()],
    });
    applyDelta(action('lead', { id: 'l1', syncId: 30 }, { action: 'delete' }), client);
    expect([...ids(client, 'p1', everything), ...ids(client, 'p1', newOnly)]).toEqual([]);
  });

  test('a payload it cannot read is logged and refetches the lead lists', () => {
    const client = cache({ [`p1|${everything}`]: [leadFixture()] });
    applyDelta(action('lead', { id: 'l1', syncId: 31, stageId: 7 }), client);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('lead');
    expect(String(warn.mock.calls[0]?.[0])).toContain('l1');
    expect(client.getQueryState(queryKeys.leads('p1', everything))?.isInvalidated).toBe(true);
    expect(ids(client, 'p1', everything)).toEqual(['l1']);
  });
});

describe('echoes', () => {
  test('an action without an origin or from another browser is not an echo', () => {
    expect(isOwnEcho(action('lead', { id: 'l1' }))).toBe(false);
    expect(isOwnEcho(action('lead', { id: 'l1' }, { originClientId: 'someone-else' }))).toBe(false);
    expect(isOwnEcho(action('lead', { id: 'l1' }, { originClientId: clientId() }))).toBe(true);
  });

  test('the browser ignores its own person echo', () => {
    const client = cache({});
    client.setQueryData<PersonRecord>(queryKeys.person('per1'), {
      person: personFixture(),
      employments: [],
      leads: [],
    });
    applyDelta(
      action('person', personFixture({ name: 'Echoed', syncId: 6 }), {
        originClientId: clientId(),
      }),
      client,
    );
    expect(client.getQueryData<PersonRecord>(queryKeys.person('per1'))?.person.name).toBe(
      'Ada Lovelace',
    );
  });

  test('its own activity still lands in its own timeline', () => {
    const client = cache({});
    const key = queryKeys.timeline('lead', 'l1', 'all');
    client.setQueryData<Pages<TimelinePage>>(key, {
      pages: [{ activities: [], nextCursor: null }],
      pageParams: [null],
    });
    const activity: ActivityRow = {
      id: 'a1',
      kind: 'lead.stage_changed',
      actor: { type: 'user', id: 'u1' },
      occurredAt: AT,
      payload: {},
      links: [{ entityType: 'lead', entityId: 'l1' }],
      syncId: 80,
    };
    applyDelta(action('activity', activity, { originClientId: clientId() }), client);
    const activities = client.getQueryData<Pages<TimelinePage>>(key)?.pages[0]?.activities ?? [];
    expect(activities.map((entry) => entry.id)).toEqual(['a1']);
  });

  test('its own configuration change still updates the bootstrap', () => {
    const client = cache({});
    applyDelta(
      action('saved_view', viewFixture(), { action: 'insert', originClientId: clientId() }),
      client,
    );
    expect(bootstrapOf(client).savedViews.map((view) => view.id)).toEqual(['v1']);
  });
});

describe('record and configuration deltas', () => {
  test('renaming a person re-evaluates leads filtered by person name', () => {
    const client = cache({ [`p1|${named}`]: [leadFixture()] });
    const renamed = personFixture({
      name: 'Grace Hopper',
      emails: [],
      primaryEmail: null,
      syncId: 40,
      updatedAt: '2026-10-03T10:00:00.000Z',
    });
    applyDelta(action('person', renamed), client);
    expect(ids(client, 'p1', named)).toEqual([]);
  });

  test('renaming a company relabels its leads', () => {
    const client = cache({
      [`p1|${everything}`]: [leadFixture({ companyId: 'c1', companyName: 'Acme' })],
    });
    applyDelta(action('company', companyFixture({ name: 'Acme Labs', syncId: 41 })), client);
    const data = client.getQueryData<Pages<LeadPage>>(queryKeys.leads('p1', everything));
    expect(data?.pages[0]?.leads[0]?.companyName).toBe('Acme Labs');
  });

  test('a new job shows the person on the open company record', () => {
    const client = cache({});
    client.setQueryData<PersonRecord>(queryKeys.person('per1'), {
      person: personFixture(),
      employments: [],
      leads: [],
    });
    client.setQueryData<CompanyRecord>(queryKeys.company('c1'), {
      company: companyFixture(),
      people: [],
      leads: [],
    });
    applyDelta(action('employment', employmentFixture(), { action: 'insert' }), client);
    const record = client.getQueryData<CompanyRecord>(queryKeys.company('c1'));
    expect(record?.people.map((entry) => entry.person.id)).toEqual(['per1']);
    expect(record?.people[0]?.employment.title).toBe('Engineer');
    expect(client.getQueryData<PersonRecord>(queryKeys.person('per1'))?.person.companyName).toBe(
      'Acme',
    );
  });

  test('an ended job leaves the open company record', () => {
    const client = cache({});
    client.setQueryData<CompanyRecord>(queryKeys.company('c1'), {
      company: companyFixture(),
      people: [{ person: personFixture(), employment: employmentFixture() }],
      leads: [],
    });
    applyDelta(
      action('employment', employmentFixture({ isCurrent: false, endedAt: AT, syncId: 61 })),
      client,
    );
    expect(client.getQueryData<CompanyRecord>(queryKeys.company('c1'))?.people).toEqual([]);
  });

  test('a new job for a person it has not loaded refetches the company record', () => {
    const client = cache({});
    client.setQueryData<CompanyRecord>(queryKeys.company('c1'), {
      company: companyFixture(),
      people: [],
      leads: [],
    });
    applyDelta(action('employment', employmentFixture({ personId: 'per9' })), client);
    expect(client.getQueryState(queryKeys.company('c1'))?.isInvalidated).toBe(true);
  });

  test('archiving a stage removes it from the bootstrap', () => {
    const client = cache({});
    const stage = bootstrapFixture().stages[0];
    if (stage === undefined) throw new Error('fixture has stages');
    applyDelta(
      action(
        'stage',
        { ...stage, syncId: 50, archivedAt: '2026-10-03T10:00:00.000Z' },
        { action: 'archive' },
      ),
      client,
    );
    expect(bootstrapOf(client).stages.some((entry) => entry.id === stage.id)).toBe(false);
  });

  test('a saved view widened to the workspace appears though it was never seen', () => {
    const client = cache({});
    applyDelta(action('saved_view', viewFixture({ syncId: 71 })), client);
    expect(bootstrapOf(client).savedViews.map((view) => view.id)).toEqual(['v1']);
  });

  test('archiving a pipeline prunes it with its stages, fields and saved views', () => {
    const client = new QueryClient();
    client.setQueryData<Bootstrap>(
      queryKeys.bootstrap,
      bootstrapFixture({ fields: [fieldFixture()], savedViews: [viewFixture()] }),
    );
    const before = bootstrapOf(client);
    const archivedAt = '2026-10-03T10:00:00.000Z';
    let syncId = 100;
    const pipeline = before.pipelines[0];
    if (pipeline === undefined) throw new Error('fixture has a pipeline');
    applyDelta(
      action('pipeline', { ...pipeline, archivedAt, syncId: ++syncId }, { action: 'archive' }),
      client,
    );
    for (const stage of before.stages) {
      applyDelta(
        action('stage', { ...stage, archivedAt, syncId: ++syncId }, { action: 'archive' }),
        client,
      );
    }
    applyDelta(
      action('field_definition', fieldFixture({ archivedAt, syncId: ++syncId }), {
        action: 'archive',
      }),
      client,
    );
    applyDelta(action('saved_view', { id: 'v1', syncId: ++syncId }, { action: 'delete' }), client);
    const after = bootstrapOf(client);
    expect(after.pipelines).toEqual([]);
    expect(after.stages).toEqual([]);
    expect(after.fields).toEqual([]);
    expect(after.savedViews).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  test('a pipeline archive alone already prunes what hangs off it', () => {
    const client = new QueryClient();
    client.setQueryData<Bootstrap>(
      queryKeys.bootstrap,
      bootstrapFixture({
        fields: [fieldFixture(), fieldFixture({ id: 'f2', pipelineId: null })],
        savedViews: [viewFixture(), viewFixture({ id: 'v2', object: 'person', pipelineId: null })],
      }),
    );
    const pipeline = bootstrapOf(client).pipelines[0];
    if (pipeline === undefined) throw new Error('fixture has a pipeline');
    applyDelta(
      action(
        'pipeline',
        { ...pipeline, archivedAt: '2026-10-03T10:00:00.000Z', syncId: 90 },
        { action: 'archive' },
      ),
      client,
    );
    const after = bootstrapOf(client);
    expect(after.stages).toEqual([]);
    expect(after.fields.map((field) => field.id)).toEqual(['f2']);
    expect(after.savedViews.map((view) => view.id)).toEqual(['v2']);
  });

  test('a brand archive alone prunes its pipelines and their stages', () => {
    const client = cache({});
    const brand = bootstrapOf(client).brands[0];
    if (brand === undefined) throw new Error('fixture has a brand');
    applyDelta(
      action(
        'brand',
        { ...brand, archivedAt: '2026-10-03T10:00:00.000Z', syncId: 95 },
        { action: 'archive' },
      ),
      client,
    );
    const after = bootstrapOf(client);
    expect(after.brands).toEqual([]);
    expect(after.pipelines).toEqual([]);
    expect(after.stages).toEqual([]);
  });

  test('a configuration payload it cannot read is logged and refetches the bootstrap', () => {
    const client = cache({});
    applyDelta(action('organization', { id: 'o1', name: 42, syncId: 96 }), client);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('organization');
    expect(client.getQueryState(queryKeys.bootstrap)?.isInvalidated).toBe(true);
  });
});

describe('deltas that arrive while a query is fetching', () => {
  test('a lead created during the first fetch of a list is kept', async () => {
    const client = cache({});
    const response = deferred<Pages<LeadPage>>();
    const fetching = client.fetchQuery({
      queryKey: queryKeys.leads('p1', everything),
      queryFn: () => response.promise,
    });
    applyDelta(action('lead', leadFixture({ id: 'l5', syncId: 15 }), { action: 'insert' }), client);
    response.resolve(leadPages([]));
    await fetching;
    expect(ids(client, 'p1', everything)).toEqual(['l5']);
  });

  test('a change during a refetch survives the older response', async () => {
    const client = cache({ [`p1|${newOnly}`]: [leadFixture()] });
    const response = deferred<Pages<LeadPage>>();
    const refetching = client.fetchQuery({
      queryKey: queryKeys.leads('p1', newOnly),
      queryFn: () => response.promise,
      staleTime: 0,
    });
    applyDelta(action('lead', leadFixture({ stageId: 'ready', syncId: 16 })), client);
    response.resolve(leadPages([leadFixture()]));
    await refetching;
    expect(ids(client, 'p1', newOnly)).toEqual([]);
  });

  test('a response newer than the delta wins', async () => {
    const client = cache({ [`p1|${everything}`]: [leadFixture()] });
    const response = deferred<Pages<LeadPage>>();
    const refetching = client.fetchQuery({
      queryKey: queryKeys.leads('p1', everything),
      queryFn: () => response.promise,
      staleTime: 0,
    });
    applyDelta(action('lead', leadFixture({ priority: 2, syncId: 17 })), client);
    response.resolve(leadPages([leadFixture({ priority: 3, syncId: 18 })]));
    await refetching;
    const data = client.getQueryData<Pages<LeadPage>>(queryKeys.leads('p1', everything));
    expect(data?.pages[0]?.leads[0]?.priority).toBe(3);
  });

  test('a stage archived while the bootstrap loads is still pruned', async () => {
    const client = new QueryClient();
    const response = deferred<Bootstrap>();
    const loading = client.fetchQuery({
      queryKey: queryKeys.bootstrap,
      queryFn: () => response.promise,
    });
    const stage = bootstrapFixture().stages[0];
    if (stage === undefined) throw new Error('fixture has stages');
    applyDelta(
      action(
        'stage',
        { ...stage, syncId: 51, archivedAt: '2026-10-03T10:00:00.000Z' },
        { action: 'archive' },
      ),
      client,
    );
    response.resolve(bootstrapFixture());
    await loading;
    expect(bootstrapOf(client).stages.some((entry) => entry.id === stage.id)).toBe(false);
  });
});
