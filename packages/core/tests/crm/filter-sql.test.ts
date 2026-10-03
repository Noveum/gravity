import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { and, db, eq, inArray, type SQL, schema, sql } from '@gravity/db';
import {
  companyFilterRegistry,
  containsCondition,
  evaluateFilter,
  type FilterCondition,
  type FilterGroup,
  type FilterNode,
  type FilterRegistry,
  inCondition,
  leadFilterRegistry,
  matchesSearch,
  personFilterRegistry,
  type RelativeDate,
} from '@gravity/shared/filters';
import type { FieldDefinitionRow } from '@gravity/shared/records';
import { createBrand } from '../../src/crm/brand-service.ts';
import { selectCompanyRows, upsertCompany } from '../../src/crm/company-service.ts';
import { createFieldDefinition, loadFieldDefinitions } from '../../src/crm/field-service.ts';
import { filterToSql, likePattern, searchToSql } from '../../src/crm/filter-sql.ts';
import { selectLeadRows } from '../../src/crm/lead-rows.ts';
import { createLead } from '../../src/crm/lead-service.ts';
import { selectPersonRows, upsertPerson } from '../../src/crm/person-service.ts';
import {
  COMPANY_SEARCH_EXPRESSIONS,
  companySqlRegistry,
  LEAD_SEARCH_EXPRESSIONS,
  leadSqlRegistry,
  PERSON_SEARCH_EXPRESSIONS,
  personSqlRegistry,
} from '../../src/crm/sql-registries.ts';
import { closeRealtime } from '../../src/realtime/publisher.ts';
import { createWorkspace, resetDatabase, type TestWorkspace } from '../../src/test-support.ts';

let workspace: TestWorkspace;
let pipelineId = '';
let readyId = '';
let definitions: FieldDefinitionRow[] = [];
let personDefinitions: FieldDefinitionRow[] = [];
let companyDefinitions: FieldDefinitionRow[] = [];
const ids: Record<string, string> = {};
const people: Record<string, string> = {};
const companies: Record<string, string> = {};
const now = new Date('2026-10-03T12:00:00.000Z');

function all(...children: FilterNode[]): FilterGroup {
  return { kind: 'group', combinator: 'and', children };
}

function any(...children: FilterNode[]): FilterGroup {
  return { kind: 'group', combinator: 'or', children };
}

function range(property: string, from: string | null, to: string | null, negate = false) {
  const condition: FilterCondition = {
    kind: 'condition',
    property,
    operator: 'range',
    from,
    to,
    negate,
  };
  return condition;
}

function relative(property: string, relativeDate: RelativeDate, negate = false) {
  const condition: FilterCondition = {
    kind: 'condition',
    property,
    operator: 'relative',
    relative: relativeDate,
    negate,
  };
  return condition;
}

function filterContext() {
  return { now, userId: workspace.admin.userId };
}

function idsOf(rows: readonly { id: string }[]): string[] {
  return rows.map((row) => row.id).sort();
}

function lookup(table: Record<string, string>, names: readonly string[]): string[] {
  return names.map((name) => table[name] ?? `missing ${name}`);
}

async function pin(leadId: string | undefined, values: Partial<typeof schema.lead.$inferInsert>) {
  await db
    .update(schema.lead)
    .set(values)
    .where(eq(schema.lead.id, leadId ?? 'missing'));
}

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace();
  const context = { principal: workspace.admin };
  const brand = await createBrand(context, { name: 'Yodu' });
  pipelineId = brand.pipeline.id;
  readyId = brand.stages.find((stage) => stage.name === 'Ready')?.id ?? '';
  await createFieldDefinition(context, {
    object: 'lead',
    pipelineId,
    key: 'industry',
    label: 'Industry',
    type: 'select',
    options: [
      { value: 'saas', label: 'SaaS' },
      { value: 'agency', label: 'Agency' },
    ],
  });
  await createFieldDefinition(context, {
    object: 'lead',
    key: 'tags',
    label: 'Tags',
    type: 'multi_select',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
  });
  await createFieldDefinition(context, {
    object: 'lead',
    key: 'seats',
    label: 'Seats',
    type: 'number',
  });
  await createFieldDefinition(context, {
    object: 'lead',
    key: 'vip',
    label: 'VIP',
    type: 'boolean',
  });
  await createFieldDefinition(context, {
    object: 'lead',
    key: 'renewal',
    label: 'Renewal',
    type: 'date',
  });
  await createFieldDefinition(context, {
    object: 'person',
    key: 'tier',
    label: 'Tier',
    type: 'select',
    options: [{ value: 'gold', label: 'Gold' }],
  });
  await createFieldDefinition(context, {
    object: 'company',
    key: 'employees',
    label: 'Employees',
    type: 'number',
  });
  definitions = await loadFieldDefinitions(db, workspace.organizationId, 'lead', pipelineId);
  personDefinitions = await loadFieldDefinitions(db, workspace.organizationId, 'person', null);
  companyDefinitions = await loadFieldDefinitions(db, workspace.organizationId, 'company', null);
  const ada = await upsertPerson(context, {
    name: 'Ada Lovelace',
    emails: ['ada@acme.io', 'ada.l@analytical.org'],
    linkedinUrl: 'https://linkedin.com/in/ada',
    company: { domain: 'acme.io', name: 'Acme' },
    title: 'Countess',
    fields: { tier: 'gold' },
  });
  const grace = await upsertPerson(context, { name: 'Grace Hopper', doNotContact: true });
  const linus = await upsertPerson(context, {
    name: 'Linus',
    emails: ['linus@initech.com'],
    company: { domain: 'initech.com', name: 'Initech' },
  });
  const edsger = await upsertPerson(context, { name: 'Edsger 50%_off\\Dijkstra' });
  const barbara = await upsertPerson(context, {
    name: 'Barbara Liskov',
    location: 'Boston',
    timezone: 'Europe/London',
  });
  people['ada'] = ada.person.id;
  people['grace'] = grace.person.id;
  people['linus'] = linus.person.id;
  people['edsger'] = edsger.person.id;
  people['barbara'] = barbara.person.id;
  companies['acme'] = ada.company?.id ?? '';
  companies['initech'] = linus.company?.id ?? '';
  companies['globex'] = (
    await upsertCompany(context, {
      name: 'Globex',
      domains: ['globex.com', 'globex.io'],
      segment: 'Enterprise',
      size: '51-200',
      fields: { employees: 120 },
    })
  ).company.id;
  companies['nameless'] = (
    await upsertCompany(context, { name: 'Nameless Co', location: 'Paris' })
  ).company.id;
  ids['ada'] = (
    await createLead(context, {
      personId: ada.person.id,
      pipelineId,
      priority: 1,
      nextAction: 'Call',
      nextActionAt: '2026-10-02T15:00:00.000Z',
      fields: { industry: 'saas', tags: ['a'], seats: 5, vip: true, renewal: '2026-10-02' },
    })
  ).lead.id;
  ids['grace'] = (
    await createLead(context, { personId: grace.person.id, pipelineId, ownerId: null })
  ).lead.id;
  ids['linus'] = (
    await createLead(context, {
      personId: linus.person.id,
      pipelineId,
      stageId: readyId,
      priority: 3,
      nextActionAt: '2026-10-03T23:30:00.000Z',
      fields: { industry: 'agency', seats: 2, vip: false, renewal: '2026-10-03' },
    })
  ).lead.id;
  ids['edsger'] = (
    await createLead(context, { personId: edsger.person.id, pipelineId, priority: 4 })
  ).lead.id;
  ids['barbara'] = (
    await createLead(context, { personId: barbara.person.id, pipelineId, priority: 2 })
  ).lead.id;
  const pinnedUpdate = new Date('2026-10-03T08:00:00.000Z');
  await pin(ids['ada'], {
    createdAt: new Date('2026-09-26T00:00:00.000Z'),
    updatedAt: pinnedUpdate,
    lastOutboundAt: new Date('2026-09-03T00:00:00.000Z'),
  });
  await db.execute(
    sql`update lead set created_at = '2026-09-25 23:59:59.999999+00' where id = ${ids['grace'] ?? 'missing'}`,
  );
  await pin(ids['grace'], {
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    holdUntil: new Date('2026-10-04T00:00:00.000Z'),
  });
  await pin(ids['linus'], {
    createdAt: new Date('2026-10-03T23:59:59.999Z'),
    updatedAt: pinnedUpdate,
    lastOutboundAt: new Date('2026-09-02T23:59:59.999Z'),
  });
  await pin(ids['edsger'], {
    createdAt: new Date('2026-10-04T00:00:00.000Z'),
    updatedAt: pinnedUpdate,
    fields: { industry: 5, tags: 'a', seats: '5', vip: 'true', renewal: 20261002 },
  });
  await pin(ids['barbara'], {
    createdAt: new Date('2026-09-03T00:00:00.000Z'),
    updatedAt: pinnedUpdate,
    fields: { industry: null, tags: [1], seats: null, renewal: '2026-10' },
  });
  await db
    .update(schema.person)
    .set({ createdAt: new Date('2026-09-01T00:00:00.000Z') })
    .where(eq(schema.person.organizationId, workspace.organizationId));
  await db
    .update(schema.person)
    .set({ createdAt: new Date('2026-10-03T00:00:00.000Z') })
    .where(eq(schema.person.id, ada.person.id));
});

afterAll(async () => {
  await closeRealtime();
});

type Case = [name: string, build: () => FilterGroup, include: string[], exclude: string[]];

const LEAD_CASES: Case[] = [
  ['owner is me', () => all(inCondition('owner', ['me'])), ['ada'], ['grace']],
  ['owner is unset', () => all(inCondition('owner', ['none'])), ['grace'], ['ada']],
  [
    'owner is not me, nulls included',
    () => all(inCondition('owner', ['me'], true)),
    ['grace'],
    ['ada'],
  ],
  ['owner is me or unset', () => all(inCondition('owner', ['me', 'none'])), ['ada', 'grace'], []],
  ['owner is set', () => all(inCondition('owner', ['none'], true)), ['ada'], ['grace']],
  ['priority range', () => all(range('priority', '1', '2')), ['ada', 'barbara'], ['linus']],
  [
    'priority in a set',
    () => all(inCondition('priority', ['1', '3'])),
    ['ada', 'linus'],
    ['grace'],
  ],
  ['priority in a fraction', () => all(inCondition('priority', ['1.5'])), [], ['ada']],
  ['priority up to zero', () => all(range('priority', null, '0')), ['grace'], ['ada']],
  ['priority up to a non number', () => all(range('priority', null, 'abc')), [], ['grace']],
  ['priority from minus infinity', () => all(range('priority', '-Infinity', null)), ['grace'], []],
  ['priority from infinity', () => all(range('priority', 'Infinity', null)), [], ['edsger']],
  ['priority up to infinity', () => all(range('priority', null, 'Infinity')), ['ada'], []],
  ['stage negated', () => all(inCondition('stage', [readyId], true)), ['ada', 'grace'], ['linus']],
  ['stage category', () => all(inCondition('stageCategory', ['open'])), ['ada'], []],
  [
    'owed by none is read as unset, which no row is',
    () => all(inCondition('owedBy', ['none'])),
    [],
    ['grace'],
  ],
  ['owed by none negated', () => all(inCondition('owedBy', ['none'], true)), ['grace'], []],
  ['custom select', () => all(inCondition('fields.industry', ['saas'])), ['ada'], ['linus']],
  [
    'custom select negated, unset included',
    () => all(inCondition('fields.industry', ['saas'], true)),
    ['grace', 'edsger', 'barbara'],
    ['ada'],
  ],
  [
    'custom select unset, a mistyped value is not unset',
    () => all(inCondition('fields.industry', ['none'])),
    ['grace', 'barbara'],
    ['edsger', 'ada'],
  ],
  [
    'custom select compares strings only',
    () => all(inCondition('fields.industry', ['5'])),
    [],
    ['edsger'],
  ],
  [
    'custom multi unset',
    () => all(inCondition('fields.tags', ['none'])),
    ['linus', 'grace', 'edsger', 'barbara'],
    ['ada'],
  ],
  ['custom multi overlap', () => all(inCondition('fields.tags', ['a', 'b'])), ['ada'], ['edsger']],
  [
    'custom multi overlap or unset',
    () => all(inCondition('fields.tags', ['a', 'none'])),
    ['ada', 'grace', 'linus', 'edsger', 'barbara'],
    [],
  ],
  [
    'custom multi negated',
    () => all(inCondition('fields.tags', ['a'], true)),
    ['grace', 'edsger'],
    ['ada'],
  ],
  [
    'custom number range',
    () => all(range('fields.seats', '3', null)),
    ['ada'],
    ['linus', 'edsger'],
  ],
  [
    'custom number up to infinity counts numbers only',
    () => all(range('fields.seats', null, 'Infinity')),
    ['ada', 'linus'],
    ['grace', 'edsger'],
  ],
  ['custom number in', () => all(inCondition('fields.seats', ['5.0'])), ['ada'], ['edsger']],
  [
    'custom number unset',
    () => all(inCondition('fields.seats', ['none'])),
    ['grace', 'barbara'],
    ['edsger', 'ada'],
  ],
  [
    'custom number negated',
    () => all(inCondition('fields.seats', ['5'], true)),
    ['edsger', 'grace'],
    ['ada'],
  ],
  ['custom boolean true', () => all(inCondition('fields.vip', ['true'])), ['ada'], ['edsger']],
  ['custom boolean false', () => all(inCondition('fields.vip', ['false'])), ['linus'], ['grace']],
  ['custom boolean ignores none', () => all(inCondition('fields.vip', ['none'])), [], ['grace']],
  [
    'custom boolean ignores other tokens',
    () => all(inCondition('fields.vip', ['yes'])),
    [],
    ['linus'],
  ],
  [
    'custom boolean negated',
    () => all(inCondition('fields.vip', ['true'], true)),
    ['linus', 'grace', 'edsger'],
    ['ada'],
  ],
  [
    'custom date overdue',
    () => all(inCondition('fields.renewal', ['overdue'])),
    ['ada'],
    ['linus', 'edsger'],
  ],
  ['custom date today', () => all(inCondition('fields.renewal', ['today'])), ['linus'], ['ada']],
  [
    'custom date unset',
    () => all(inCondition('fields.renewal', ['none'])),
    ['grace', 'edsger', 'barbara'],
    ['ada'],
  ],
  [
    'custom date set',
    () => all(inCondition('fields.renewal', ['any'])),
    ['ada', 'linus'],
    ['barbara'],
  ],
  ['custom date range', () => all(range('fields.renewal', '2026-10-03', null)), ['linus'], ['ada']],
  [
    'custom date in the past day',
    () => all(relative('fields.renewal', { unit: 'day', offset: 1, direction: 'past' })),
    ['ada', 'linus'],
    ['edsger'],
  ],
  ['company contains', () => all(containsCondition('company', 'ACME')), ['ada'], ['linus']],
  [
    'company does not contain, no company included',
    () => all(containsCondition('company', 'acme', true)),
    ['grace'],
    ['ada'],
  ],
  ['email contains', () => all(containsCondition('email', 'ACME.IO')), ['ada'], ['linus']],
  [
    'person contains an underscore literally',
    () => all(containsCondition('person', 'a_a')),
    [],
    ['ada'],
  ],
  [
    'person contains a percent literally',
    () => all(containsCondition('person', 'a%e')),
    [],
    ['ada'],
  ],
  [
    'person contains escape characters',
    () => all(containsCondition('person', '%_off\\')),
    ['edsger'],
    ['ada'],
  ],
  [
    'person does not contain',
    () => all(containsCondition('person', 'hopper', true)),
    ['ada'],
    ['grace'],
  ],
  ['source contains', () => all(containsCondition('source', 'MAN')), ['ada'], []],
  [
    'next action overdue',
    () => all(inCondition('nextActionAt', ['overdue'])),
    ['ada'],
    ['linus', 'grace'],
  ],
  ['next action today', () => all(inCondition('nextActionAt', ['today'])), ['linus'], ['ada']],
  ['no next action', () => all(inCondition('nextActionAt', ['none'])), ['grace'], ['ada']],
  [
    'next action within one day',
    () => all(range('nextActionAt', '2026-10-03', '2026-10-03')),
    ['linus'],
    ['ada'],
  ],
  [
    'next action not after a day, nulls included',
    () => all(range('nextActionAt', '2026-10-01', null, true)),
    ['grace'],
    ['ada'],
  ],
  [
    'created in the past week',
    () => all(relative('created', { unit: 'week', offset: 1, direction: 'past' })),
    ['ada', 'linus'],
    ['grace', 'edsger', 'barbara'],
  ],
  [
    'created in the past month',
    () => all(relative('created', { unit: 'month', offset: 1, direction: 'past' })),
    ['ada', 'grace', 'linus', 'barbara'],
    ['edsger'],
  ],
  [
    'updated today',
    () => all(relative('updated', { unit: 'day', offset: 0, direction: 'future' })),
    ['ada'],
    ['grace'],
  ],
  [
    'held until tomorrow',
    () => all(relative('holdUntil', { unit: 'day', offset: 1, direction: 'future' })),
    ['grace'],
    ['ada'],
  ],
  [
    'not held until tomorrow, nulls included',
    () => all(relative('holdUntil', { unit: 'day', offset: 1, direction: 'future' }, true)),
    ['ada'],
    ['grace'],
  ],
  [
    'last touch in the past month',
    () => all(relative('lastOutboundAt', { unit: 'month', offset: 1, direction: 'past' })),
    ['ada'],
    ['linus'],
  ],
  [
    'stage or priority',
    () => any(inCondition('stage', [readyId]), inCondition('priority', ['1'])),
    ['linus', 'ada'],
    ['grace'],
  ],
  [
    'an unknown property and an empty group are skipped',
    () => any(inCondition('ghost', ['x']), all()),
    ['ada', 'grace', 'linus', 'edsger', 'barbara'],
    [],
  ],
  [
    'an empty group inside or is not true',
    () => any(all(), inCondition('stage', [readyId])),
    ['linus'],
    ['ada'],
  ],
  [
    'an unknown property inside and is skipped',
    () => all(inCondition('ghost', ['x']), inCondition('stage', [readyId])),
    ['linus'],
    ['ada'],
  ],
  ['an empty filter matches everything', () => all(), ['ada', 'grace'], []],
  [
    'nested groups with negations',
    () =>
      all(
        any(inCondition('owner', ['me'], true), inCondition('priority', ['3'])),
        inCondition('stageCategory', ['won'], true),
      ),
    ['grace', 'linus'],
    ['ada'],
  ],
];

const PERSON_CASES: Case[] = [
  [
    'email contains a second address',
    () => all(containsCondition('email', 'analytical')),
    ['ada'],
    ['linus'],
  ],
  ['email contains across addresses', () => all(containsCondition('email', 'io ada')), ['ada'], []],
  ['email contains, any case', () => all(containsCondition('email', 'ACME')), ['ada'], ['grace']],
  [
    'email does not contain, no email included',
    () => all(containsCondition('email', 'acme', true)),
    ['grace'],
    ['ada'],
  ],
  ['do not contact', () => all(inCondition('doNotContact', ['true'])), ['grace'], ['ada']],
  ['may contact', () => all(inCondition('doNotContact', ['false'])), ['ada'], ['grace']],
  ['do not contact ignores none', () => all(inCondition('doNotContact', ['none'])), [], ['grace']],
  [
    'do not contact negated',
    () => all(inCondition('doNotContact', ['true'], true)),
    ['ada'],
    ['grace'],
  ],
  ['title contains', () => all(containsCondition('title', 'count')), ['ada'], ['linus']],
  [
    'title does not contain, no title included',
    () => all(containsCondition('title', 'count', true)),
    ['linus', 'grace'],
    ['ada'],
  ],
  ['company contains', () => all(containsCondition('company', 'init')), ['linus'], ['ada']],
  ['location contains', () => all(containsCondition('location', 'bost')), ['barbara'], ['ada']],
  ['timezone contains', () => all(containsCondition('timezone', 'london')), ['barbara'], ['ada']],
  ['custom select', () => all(inCondition('fields.tier', ['gold'])), ['ada'], ['grace']],
  [
    'custom select negated',
    () => all(inCondition('fields.tier', ['gold'], true)),
    ['grace'],
    ['ada'],
  ],
  ['created today', () => all(inCondition('created', ['today'])), ['ada'], ['grace']],
];

const COMPANY_CASES: Case[] = [
  [
    'domain contains a second domain',
    () => all(containsCondition('domain', 'globex.io')),
    ['globex'],
    ['acme'],
  ],
  [
    'domain contains across domains',
    () => all(containsCondition('domain', 'com globex')),
    ['globex'],
    [],
  ],
  [
    'domain does not contain, no domain included',
    () => all(containsCondition('domain', 'acme', true)),
    ['nameless', 'globex'],
    ['acme'],
  ],
  ['segment contains', () => all(containsCondition('segment', 'ENTER')), ['globex'], ['acme']],
  [
    'segment does not contain',
    () => all(containsCondition('segment', 'enter', true)),
    ['acme'],
    ['globex'],
  ],
  ['name contains', () => all(containsCondition('name', 'co')), ['nameless'], ['initech']],
  ['location contains', () => all(containsCondition('location', 'par')), ['nameless'], ['acme']],
  ['size contains', () => all(containsCondition('size', '51')), ['globex'], ['acme']],
  ['custom number range', () => all(range('fields.employees', '100', null)), ['globex'], ['acme']],
];

function expectedIds<T extends { id: string }>(
  filter: FilterGroup,
  everything: readonly T[],
  registry: FilterRegistry<T>,
): string[] {
  return idsOf(everything.filter((row) => evaluateFilter(filter, row, registry, filterContext())));
}

function leadsWhere(where: SQL | undefined) {
  return selectLeadRows(
    db,
    workspace.organizationId,
    and(eq(schema.lead.pipelineId, pipelineId), where),
  );
}

function peopleWhere(where: SQL | undefined) {
  return selectPersonRows(
    db,
    workspace.organizationId,
    and(inArray(schema.person.id, Object.values(people)), where),
  );
}

function companiesWhere(where: SQL | undefined) {
  return selectCompanyRows(db, workspace.organizationId, where);
}

describe('filterToSql agrees with evaluateFilter on leads', () => {
  for (const [name, build, include, exclude] of LEAD_CASES) {
    test(name, async () => {
      const filter = build();
      const everything = await leadsWhere(undefined);
      const registry = leadFilterRegistry(definitions, pipelineId);
      const expected = expectedIds(filter, everything, registry);
      const actual = idsOf(
        await leadsWhere(
          filterToSql(filter, leadSqlRegistry(definitions, pipelineId), filterContext()),
        ),
      );
      expect(actual).toEqual(expected);
      for (const id of lookup(ids, include)) expect(expected).toContain(id);
      for (const id of lookup(ids, exclude)) expect(expected).not.toContain(id);
    });
  }

  for (const q of [
    'ada',
    'ACME',
    'yod-3',
    'ada acme',
    'nobody',
    'a%e',
    'a_a',
    '50%',
    'off\\',
    'initech yod',
  ]) {
    test(`search "${q}"`, async () => {
      const everything = await leadsWhere(undefined);
      const expected = idsOf(
        everything.filter((lead) => matchesSearch(lead, q, leadFilterRegistry())),
      );
      const actual = idsOf(await leadsWhere(searchToSql(q, LEAD_SEARCH_EXPRESSIONS)));
      expect(actual).toEqual(expected);
    });
  }

  test('search matches a lead key and every token', async () => {
    const byKey = await leadsWhere(searchToSql('yod-3', LEAD_SEARCH_EXPRESSIONS));
    expect(byKey.map((lead) => lead.key)).toEqual(['YOD-3']);
    const both = await leadsWhere(searchToSql('initech yod', LEAD_SEARCH_EXPRESSIONS));
    expect(idsOf(both)).toEqual(lookup(ids, ['linus']));
    expect(searchToSql('   ', LEAD_SEARCH_EXPRESSIONS)).toBeUndefined();
  });
});

describe('filterToSql agrees with evaluateFilter on people', () => {
  for (const [name, build, include, exclude] of PERSON_CASES) {
    test(name, async () => {
      const filter = build();
      const everything = await peopleWhere(undefined);
      const registry = personFilterRegistry(personDefinitions);
      const expected = expectedIds(filter, everything, registry);
      const actual = idsOf(
        await peopleWhere(
          filterToSql(filter, personSqlRegistry(personDefinitions), filterContext()),
        ),
      );
      expect(actual).toEqual(expected);
      for (const id of lookup(people, include)) expect(expected).toContain(id);
      for (const id of lookup(people, exclude)) expect(expected).not.toContain(id);
    });
  }

  for (const q of [
    'acme',
    'analytical',
    'countess',
    'linkedin.com/in/ada',
    'initech',
    'ADA LOVE',
  ]) {
    test(`search "${q}"`, async () => {
      const everything = await peopleWhere(undefined);
      const expected = idsOf(
        everything.filter((person) => matchesSearch(person, q, personFilterRegistry())),
      );
      const actual = idsOf(await peopleWhere(searchToSql(q, PERSON_SEARCH_EXPRESSIONS)));
      expect(actual).toEqual(expected);
    });
  }
});

describe('filterToSql agrees with evaluateFilter on companies', () => {
  for (const [name, build, include, exclude] of COMPANY_CASES) {
    test(name, async () => {
      const filter = build();
      const everything = await companiesWhere(undefined);
      const registry = companyFilterRegistry(companyDefinitions);
      const expected = expectedIds(filter, everything, registry);
      const actual = idsOf(
        await companiesWhere(
          filterToSql(filter, companySqlRegistry(companyDefinitions), filterContext()),
        ),
      );
      expect(actual).toEqual(expected);
      for (const id of lookup(companies, include)) expect(expected).toContain(id);
      for (const id of lookup(companies, exclude)) expect(expected).not.toContain(id);
    });
  }

  for (const q of ['acme', 'globex.io', 'glob com', 'nameless co', 'ACME.IO']) {
    test(`search "${q}"`, async () => {
      const everything = await companiesWhere(undefined);
      const expected = idsOf(
        everything.filter((company) => matchesSearch(company, q, companyFilterRegistry())),
      );
      const actual = idsOf(await companiesWhere(searchToSql(q, COMPANY_SEARCH_EXPRESSIONS)));
      expect(actual).toEqual(expected);
    });
  }
});

describe('filterToSql', () => {
  test('returns nothing to add for an empty or wholly unknown filter', () => {
    const registry = leadSqlRegistry(definitions, pipelineId);
    expect(filterToSql(all(), registry, filterContext())).toBeUndefined();
    expect(
      filterToSql(all(inCondition('ghost', ['x']), any()), registry, filterContext()),
    ).toBeUndefined();
  });

  test('refuses an operator the property does not support', () => {
    const registry = leadSqlRegistry(definitions, pipelineId);
    expect(() =>
      filterToSql(all(containsCondition('priority', '1')), registry, filterContext()),
    ).toThrow('The priority filter does not support contains.');
    expect(() =>
      filterToSql(all(inCondition('person', ['Ada'])), registry, filterContext()),
    ).toThrow('The person filter does not support in.');
  });

  test('likePattern escapes the LIKE wildcards and the escape character', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });
});

describe('registries', () => {
  function keysAndKinds(entries: readonly { key: string; kind: string }[]): string[] {
    return entries.map((entry) => `${entry.key}:${entry.kind}`).sort();
  }

  function fromMap(map: ReadonlyMap<string, { kind: string }>): string[] {
    return keysAndKinds([...map].map(([key, value]) => ({ key, kind: value.kind })));
  }

  test('every shared filter property has a SQL translation of the same kind', () => {
    expect(keysAndKinds(leadFilterRegistry(definitions, pipelineId).properties)).toEqual(
      fromMap(leadSqlRegistry(definitions, pipelineId)),
    );
    expect(keysAndKinds(personFilterRegistry([]).properties)).toEqual(
      fromMap(personSqlRegistry([])),
    );
    expect(keysAndKinds(companyFilterRegistry([]).properties)).toEqual(
      fromMap(companySqlRegistry([])),
    );
    expect(keysAndKinds(personFilterRegistry(personDefinitions).properties)).toEqual(
      fromMap(personSqlRegistry(personDefinitions)),
    );
    expect(keysAndKinds(companyFilterRegistry(companyDefinitions).properties)).toEqual(
      fromMap(companySqlRegistry(companyDefinitions)),
    );
  });

  test('a pipeline field is absent from another pipeline and from people', () => {
    expect(leadSqlRegistry(definitions, 'p-other').has('fields.industry')).toBe(false);
    expect(leadSqlRegistry(definitions, pipelineId).has('fields.industry')).toBe(true);
    expect(personSqlRegistry(definitions).has('fields.seats')).toBe(false);
  });

  test('allowsMe matches the shared registry', () => {
    const shared = leadFilterRegistry(definitions, pipelineId).properties.filter(
      (property) => property.allowsMe === true,
    );
    const sqlKeys = [...leadSqlRegistry(definitions, pipelineId)]
      .filter(([, property]) => property.allowsMe === true)
      .map(([key]) => key);
    expect(sqlKeys).toEqual(shared.map((property) => property.key));
  });
});
