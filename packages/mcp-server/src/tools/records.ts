import {
  getRecordContext,
  listFieldDefinitions,
  listLeads,
  listMembers,
  listPipelines,
  listSavedViews,
  listStages,
  oneLine,
  type RecordContext,
  type ResolvedRecordRef,
  renderRecordContext,
  resolveRecordRef,
  searchRecords,
} from '@gravity/core';
import { CONTEXT_TOKENS, leadPriorityLabel, SEARCH_RESULT_LIMIT } from '@gravity/shared/constants';
import {
  type DomainError,
  isDomainError,
  notFound,
  validationFailed,
} from '@gravity/shared/errors';
import {
  type FilterGroup,
  type FilterRegistry,
  filterGroupQuerySchema,
  isEmptyFilter,
  leadFilterRegistry,
  MAX_FILTER_CONDITIONS,
  safeFilter,
} from '@gravity/shared/filters';
import type { Principal } from '@gravity/shared/policy';
import type {
  CompanyRow,
  LeadRow,
  PersonRow,
  PipelineRow,
  SavedViewRow,
} from '@gravity/shared/records';
import type { RecordLinks } from '@gravity/shared/utils';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolContext } from './index.ts';
import { defineTool } from './support.ts';

const LIST_LIMIT = 50;
const LIST_LIMIT_MAX = 100;
const TIMELINE_IN_DATA = 20;
const CONTEXT_LIST_LIMIT = 20;
const UNKNOWN_STAGE = 'Unknown stage';

interface LeadNames {
  readonly stages: Readonly<Record<string, string>>;
  readonly members: Readonly<Record<string, string>>;
}

const filterArgumentSchema = z.object({ filter: filterGroupQuerySchema });

function clampContextTokens(value: number | undefined): number {
  if (value === undefined) return CONTEXT_TOKENS.default;
  return Math.min(CONTEXT_TOKENS.max, Math.max(CONTEXT_TOKENS.min, value));
}

async function leadNamesFor(principal: Principal): Promise<LeadNames> {
  const [stages, members] = await Promise.all([listStages(principal), listMembers(principal)]);
  return {
    stages: Object.fromEntries(stages.map((stage) => [stage.id, stage.name])),
    members: Object.fromEntries(members.map((entry) => [entry.user.id, entry.user.name])),
  };
}

function leadSummary(lead: LeadRow, names: LeadNames, links: RecordLinks) {
  return {
    key: lead.key,
    url: links.lead(lead.key),
    person: lead.personName,
    company: lead.companyName,
    stage: names.stages[lead.stageId] ?? UNKNOWN_STAGE,
    stageId: lead.stageId,
    stageCategory: lead.stageCategory,
    owner: lead.ownerId === null ? null : (names.members[lead.ownerId] ?? null),
    ownerId: lead.ownerId,
    priority: leadPriorityLabel(lead.priority),
    nextAction: lead.nextAction,
    nextActionAt: lead.nextActionAt,
    holdReason: lead.holdReason,
    updatedAt: lead.updatedAt,
  };
}

function leadView(lead: LeadRow, names: LeadNames, links: RecordLinks) {
  return { ...leadSummary(lead, names, links), email: lead.personEmail };
}

type LeadView = ReturnType<typeof leadView>;

function leadLine(view: LeadView): string {
  const line = [
    `- ${view.key} ${view.person}${view.company === null ? '' : ` (${view.company})`}`,
    view.stage,
    view.owner ?? 'no owner',
    view.priority,
    ...(view.nextAction === null ? [] : [`next: ${view.nextAction}`]),
    view.url,
  ].join(' · ');
  return oneLine(line);
}

function personHit(person: PersonRow, links: RecordLinks) {
  return {
    id: person.id,
    name: person.name,
    email: person.primaryEmail,
    company: person.companyName,
    title: person.title,
    url: links.person(person.id),
  };
}

function companyHit(company: CompanyRow, links: RecordLinks) {
  return {
    id: company.id,
    name: company.name,
    domain: company.primaryDomain,
    url: links.company(company.id),
  };
}

function leadHit(lead: LeadRow, links: RecordLinks) {
  return {
    key: lead.key,
    person: lead.personName,
    company: lead.companyName,
    stageCategory: lead.stageCategory,
    url: links.lead(lead.key),
  };
}

function suffix(value: string | null, render: (present: string) => string): string {
  return value === null ? '' : render(value);
}

function searchText(
  people: readonly ReturnType<typeof personHit>[],
  companies: readonly ReturnType<typeof companyHit>[],
  leads: readonly ReturnType<typeof leadHit>[],
): string {
  return [
    `People (${people.length}):`,
    ...people.map(
      (person) =>
        `- ${person.name}${suffix(person.email, (email) => ` <${email}>`)}${suffix(person.company, (company) => `, ${company}`)} ${person.url}`,
    ),
    `Companies (${companies.length}):`,
    ...companies.map(
      (company) =>
        `- ${company.name}${suffix(company.domain, (domain) => ` (${domain})`)} ${company.url}`,
    ),
    `Leads (${leads.length}):`,
    ...leads.map(
      (lead) =>
        `- ${lead.key} ${lead.person}${suffix(lead.company, (company) => ` (${company})`)} [${lead.stageCategory}] ${lead.url}`,
    ),
  ]
    .map(oneLine)
    .join('\n');
}

function subjectUrl(subject: ResolvedRecordRef, bundle: RecordContext, links: RecordLinks): string {
  if (subject.type === 'person') return links.person(subject.id);
  if (subject.type === 'company') return links.company(subject.id);
  const focus = bundle.leads.find((lead) => lead.id === subject.id);
  return focus === undefined ? links.app : links.lead(focus.key);
}

function colleague(entry: RecordContext['people'][number], links: RecordLinks) {
  return {
    id: entry.person.id,
    name: entry.person.name,
    title: entry.employment.title,
    url: links.person(entry.person.id),
  };
}

function contextData(subject: ResolvedRecordRef, bundle: RecordContext, links: RecordLinks) {
  return {
    subject: { ...subject, url: subjectUrl(subject, bundle, links) },
    person: bundle.person,
    company: bundle.company,
    employments: bundle.employments,
    people: bundle.people.slice(0, CONTEXT_LIST_LIMIT).map((entry) => colleague(entry, links)),
    peopleTotal: bundle.people.length,
    leads: bundle.leads
      .slice(0, CONTEXT_LIST_LIMIT)
      .map((lead) => leadSummary(lead, bundle.names, links)),
    leadsTotal: bundle.leads.length,
    timeline: bundle.timeline.slice(0, TIMELINE_IN_DATA),
  };
}

function pipelineOf(pipelines: readonly PipelineRow[], ref: string): PipelineRow {
  const pipeline = pipelines.find((entry) => entry.id === ref || entry.key === ref.toUpperCase());
  if (pipeline !== undefined) return pipeline;
  const keys = pipelines.map((entry) => entry.key).join(', ');
  throw notFound(
    `There is no pipeline ${ref}. Pipelines: ${keys.length === 0 ? 'none yet' : keys}.`,
  );
}

function servesPipeline(view: SavedViewRow, pipeline: PipelineRow): boolean {
  return view.pipelineId === null || view.pipelineId === pipeline.id;
}

function savedLeadView(
  views: readonly SavedViewRow[],
  ref: string,
  pipeline: PipelineRow,
  pipelines: readonly PipelineRow[],
): SavedViewRow {
  const leadViews = views.filter((view) => view.object === 'lead');
  const named = ref.toLowerCase();
  const byId = leadViews.find((view) => view.id === ref);
  const matches =
    byId === undefined ? leadViews.filter((view) => view.name.toLowerCase() === named) : [byId];
  const here = matches.filter((view) => servesPipeline(view, pipeline));
  const [only, ...others] = here;
  if (only !== undefined && others.length === 0) return only;
  if (only !== undefined) {
    throw validationFailed(
      `More than one lead view is called ${ref}. Pass one of these ids as view: ${here.map((view) => view.id).join(', ')}.`,
    );
  }
  const [elsewhere] = matches;
  if (elsewhere !== undefined) {
    const key = pipelines.find((entry) => entry.id === elsewhere.pipelineId)?.key ?? 'another';
    throw validationFailed(
      `${elsewhere.name} is a view of the ${key} pipeline, not ${pipeline.key}.`,
    );
  }
  const names = leadViews.filter((view) => servesPipeline(view, pipeline)).map((view) => view.name);
  throw notFound(
    `There is no saved view ${ref}. Lead views: ${names.length === 0 ? 'none yet' : names.join(', ')}.`,
  );
}

function combinedFilter(view: FilterGroup | undefined, raw: FilterGroup | undefined): FilterGroup {
  const parts = [view, raw].filter(
    (group): group is FilterGroup => group !== undefined && !isEmptyFilter(group),
  );
  const [first, second] = parts;
  if (first === undefined) return { kind: 'group', combinator: 'and', children: [] };
  if (second === undefined) return first;
  const merged = first.children.length + second.children.length;
  if (
    first.combinator === 'and' &&
    second.combinator === 'and' &&
    merged <= MAX_FILTER_CONDITIONS
  ) {
    return { kind: 'group', combinator: 'and', children: [...first.children, ...second.children] };
  }
  return { kind: 'group', combinator: 'and', children: [first, second] };
}

function isFilterIssue(error: unknown): error is DomainError {
  return (
    isDomainError(error) &&
    error.code === 'validation_failed' &&
    Array.isArray(error.details?.['issues'])
  );
}

interface LeadPageRequest {
  readonly filter: FilterGroup;
  readonly q: string;
  readonly cursor?: string;
  readonly limit: number;
}

function filterArgument(raw: Record<string, unknown> | undefined): FilterGroup | undefined {
  return raw === undefined ? undefined : filterArgumentSchema.parse({ filter: raw }).filter;
}

async function leadPage<T>(
  principal: Principal,
  pipeline: PipelineRow,
  registry: FilterRegistry<T>,
  request: LeadPageRequest,
) {
  try {
    return await listLeads(principal, { pipelineId: pipeline.id, ...request });
  } catch (error: unknown) {
    if (!isFilterIssue(error)) throw error;
    const properties = registry.properties.map((property) => property.key);
    throw validationFailed(`${error.message} Filter properties: ${properties.join(', ')}.`, {
      ...(error.details === undefined ? {} : { details: error.details }),
    });
  }
}

function listHeading(
  pipeline: PipelineRow,
  view: SavedViewRow | null,
  count: number,
  nextCursor: string | null,
): string {
  const viewed = view === null ? '' : `, view ${view.name}`;
  const more = nextCursor === null ? '' : ', more with the next cursor';
  return `${pipeline.key} ${pipeline.name}${viewed}: ${count} lead${count === 1 ? '' : 's'}${more}`;
}

function registerSearch(server: McpServer, { principal, links }: ToolContext): void {
  defineTool(
    server,
    {
      name: 'search',
      title: 'Search people, companies and leads',
      description:
        'Fuzzy search by name, email, domain or lead key such as ABC-12. Returns people, companies and leads, each with a link.',
      scope: 'read',
      inputSchema: {
        query: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe('Words, an email, a domain or a lead key.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe(`Results per kind, ${SEARCH_RESULT_LIMIT} by default.`),
      },
    },
    async (args) => {
      const result = await searchRecords(principal, {
        q: args.query,
        limit: args.limit ?? SEARCH_RESULT_LIMIT,
      });
      const people = result.people.map((person) => personHit(person, links));
      const companies = result.companies.map((company) => companyHit(company, links));
      const leads = result.leads.map((lead) => leadHit(lead, links));
      return { text: searchText(people, companies, leads), data: { people, companies, leads } };
    },
  );
}

function registerGetContext(server: McpServer, { principal, links }: ToolContext): void {
  defineTool(
    server,
    {
      name: 'get_context',
      title: 'Get context for one record',
      description:
        'A compact, token-budgeted bundle for a person, company or lead: attributes, custom fields, jobs, every lead with owner and stage, and recent activity. Name the record by email, LinkedIn profile URL, domain, lead key such as ABC-12, or id.',
      scope: 'read',
      inputSchema: {
        ref: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .describe('Email, LinkedIn profile URL, domain, lead key or id.'),
        max_tokens: z
          .number()
          .int()
          .optional()
          .transform(clampContextTokens)
          .describe(
            `Upper bound for the text, from ${CONTEXT_TOKENS.min} to ${CONTEXT_TOKENS.max}; a value outside that range is brought inside it. ${CONTEXT_TOKENS.default} by default.`,
          ),
      },
    },
    async (args) => {
      const subject = await resolveRecordRef(principal, args.ref, { links });
      const bundle = await getRecordContext(principal, subject);
      return {
        text: renderRecordContext(bundle, { maxTokens: args.max_tokens, links }),
        data: contextData(subject, bundle, links),
      };
    },
  );
}

function registerListLeads(server: McpServer, { principal, links }: ToolContext): void {
  defineTool(
    server,
    {
      name: 'list_leads',
      title: 'List leads in a pipeline',
      description:
        'Leads in one pipeline, newest first, using the same filter language as the web app (describe_workspace lists stage, member and field ids and the filter shape) and optionally one of your saved lead views by id or name. Pass nextCursor back as cursor for the next page.',
      scope: 'read',
      inputSchema: {
        pipeline: z.string().trim().min(1).max(64).describe('Pipeline key such as ABC, or its id.'),
        filter: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('A filter group: {"kind":"group","combinator":"and","children":[...]}.'),
        view: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .describe('A saved lead view id or name.'),
        query: z
          .string()
          .trim()
          .max(200)
          .optional()
          .describe('Free text over person, email, company and key.'),
        cursor: z.string().max(2048).optional().describe('nextCursor from the previous page.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIST_LIMIT_MAX)
          .optional()
          .describe(`Page size, ${LIST_LIMIT} by default.`),
      },
    },
    async (args) => {
      const [pipelines, views, names, fields] = await Promise.all([
        listPipelines(principal),
        listSavedViews(principal),
        leadNamesFor(principal),
        listFieldDefinitions(principal),
      ]);
      const pipeline = pipelineOf(pipelines, args.pipeline);
      const registry = leadFilterRegistry(fields, pipeline.id);
      const view =
        args.view === undefined ? null : savedLeadView(views, args.view, pipeline, pipelines);
      const viewFilter = view === null ? undefined : safeFilter(view.filter, registry);
      const page = await leadPage(principal, pipeline, registry, {
        filter: combinedFilter(viewFilter, filterArgument(args.filter)),
        q: args.query ?? '',
        ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
        limit: args.limit ?? LIST_LIMIT,
      });
      const leads = page.leads.map((lead) => leadView(lead, names, links));
      return {
        text: [
          listHeading(pipeline, view, leads.length, page.nextCursor),
          ...leads.map(leadLine),
        ].join('\n'),
        data: {
          pipeline: {
            id: pipeline.id,
            key: pipeline.key,
            name: pipeline.name,
            url: links.pipeline(pipeline.key),
          },
          view: view === null ? null : { id: view.id, name: view.name },
          leads,
          nextCursor: page.nextCursor,
        },
      };
    },
  );
}

export function registerRecordTools(server: McpServer, context: ToolContext): void {
  registerSearch(server, context);
  registerGetContext(server, context);
  registerListLeads(server, context);
}
