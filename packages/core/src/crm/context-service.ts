import { leadPriorityLabel } from '@gravity/shared/constants';
import { notFound } from '@gravity/shared/errors';
import { assertCan, type Principal } from '@gravity/shared/policy';
import type {
  ActivityRow,
  CompanyRow,
  EmploymentRow,
  LeadRow,
  PersonRow,
} from '@gravity/shared/records';
import type { RecordLinks } from '@gravity/shared/utils';
import { listMembers } from '../org/member-service.ts';
import { listTimeline } from './activity-service.ts';
import { getLead } from './lead-service.ts';
import { listPipelines } from './pipeline-service.ts';
import type { ResolvedRecordRef } from './record-ref.ts';
import { getCompanyRecord, getPersonRecord } from './record-service.ts';
import { listStages } from './stage-service.ts';

const TIMELINE_LIMIT = 50;
const CHARS_PER_TOKEN = 4;

export interface ContextNames {
  readonly stages: Readonly<Record<string, string>>;
  readonly pipelines: Readonly<Record<string, string>>;
  readonly members: Readonly<Record<string, string>>;
}

export interface RecordContext {
  readonly subject: ResolvedRecordRef;
  readonly person: PersonRow | null;
  readonly company: CompanyRow | null;
  readonly focusLeadId: string | null;
  readonly employments: readonly EmploymentRow[];
  readonly people: readonly { readonly person: PersonRow; readonly employment: EmploymentRow }[];
  readonly leads: readonly LeadRow[];
  readonly timeline: readonly ActivityRow[];
  readonly names: ContextNames;
}

export interface RenderContextOptions {
  readonly maxTokens: number;
  readonly links: RecordLinks;
}

async function contextNames(principal: Principal): Promise<ContextNames> {
  const [stages, pipelines, members] = await Promise.all([
    listStages(principal),
    listPipelines(principal),
    listMembers(principal),
  ]);
  return {
    stages: Object.fromEntries(stages.map((stage) => [stage.id, stage.name])),
    pipelines: Object.fromEntries(pipelines.map((pipeline) => [pipeline.id, pipeline.name])),
    members: Object.fromEntries(members.map((entry) => [entry.user.id, entry.user.name])),
  };
}

export async function getRecordContext(
  principal: Principal,
  subject: ResolvedRecordRef,
): Promise<RecordContext> {
  assertCan(principal, 'record:read');
  if (subject.type === 'company') {
    const [names, record, timeline] = await Promise.all([
      contextNames(principal),
      getCompanyRecord(principal, subject.id),
      listTimeline(principal, {
        subjectType: 'company',
        subjectId: subject.id,
        limit: TIMELINE_LIMIT,
      }),
    ]);
    return {
      subject,
      person: null,
      company: record.company,
      focusLeadId: null,
      employments: [],
      people: record.people,
      leads: record.leads,
      timeline: timeline.activities,
      names,
    };
  }
  const lead = subject.type === 'lead' ? await getLead(principal, subject.id) : null;
  const personId = lead?.personId ?? subject.id;
  const [names, record, timeline] = await Promise.all([
    contextNames(principal),
    getPersonRecord(principal, personId),
    listTimeline(principal, { subjectType: 'person', subjectId: personId, limit: TIMELINE_LIMIT }),
  ]);
  if (lead !== null && !record.leads.some((live) => live.id === lead.id)) {
    throw notFound('That lead does not exist.');
  }
  return {
    subject,
    person: record.person,
    company: null,
    focusLeadId: lead?.id ?? null,
    employments: record.employments,
    people: [],
    leads: record.leads,
    timeline: timeline.activities,
    names,
  };
}

const SEPARATORS_AND_CONTROLS = /[\p{Cc}\s]+/gu;
const PLAIN_KEY = /^[A-Za-z0-9_.-]+$/;

export function oneLine(text: string): string {
  return text.replace(SEPARATORS_AND_CONTROLS, ' ').trim();
}

function quoted(text: string): string {
  return JSON.stringify(oneLine(text));
}

function present(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value !== '';
}

function fieldValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return quoted(value);
  return typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : JSON.stringify(value);
}

function sortedKeys(keys: readonly string[]): string[] {
  return [...keys].sort((a, b) => a.localeCompare(b, 'en'));
}

function fieldsLine(fields: Readonly<Record<string, unknown>>): string[] {
  const entries = sortedKeys(Object.keys(fields)).flatMap((key) => {
    const text = fieldValue(fields[key]);
    return text === null ? [] : [`${PLAIN_KEY.test(key) ? key : quoted(key)}=${text}`];
  });
  return entries.length === 0 ? [] : [`Fields: ${entries.join('; ')}`];
}

function jobLine(job: EmploymentRow): string {
  const ended = job.isCurrent || job.endedAt === null ? '' : ` (until ${job.endedAt})`;
  return `- ${job.title ?? 'Role unknown'} at ${job.companyName}${job.isCurrent ? ' (current)' : ended}`;
}

function personLines(context: RecordContext, person: PersonRow, links: RecordLinks): string[] {
  const works = [person.title, person.companyName].filter(present).join(' at ');
  const where = [person.location, person.timezone].filter(present).join(' · ');
  return [
    `Person: ${person.name}${person.primaryEmail === null ? '' : ` <${person.primaryEmail}>`}`,
    `Link: ${links.person(person.id)}`,
    ...(works === '' ? [] : [`Works as: ${works}`]),
    ...(person.emails.length > 1 ? [`Emails: ${person.emails.join(', ')}`] : []),
    ...(present(person.linkedinUrl) ? [`LinkedIn: ${person.linkedinUrl}`] : []),
    ...(person.phones.length > 0 ? [`Phones: ${person.phones.join(', ')}`] : []),
    ...(where === '' ? [] : [`Location: ${where}`]),
    `Do not contact: ${person.doNotContact ? 'yes' : 'no'}`,
    ...fieldsLine(person.fields),
    ...(context.employments.length === 0 ? [] : ['Jobs:', ...context.employments.map(jobLine)]),
  ];
}

function companyLines(context: RecordContext, company: CompanyRow, links: RecordLinks): string[] {
  const about = [company.size, company.segment, company.location].filter(present).join(' · ');
  return [
    `Company: ${company.name}`,
    `Link: ${links.company(company.id)}`,
    ...(company.domains.length > 0 ? [`Domains: ${company.domains.join(', ')}`] : []),
    ...(about === '' ? [] : [`About: ${about}`]),
    ...fieldsLine(company.fields),
    ...(context.people.length === 0
      ? []
      : [
          'People:',
          ...context.people.map(
            (entry) =>
              `- ${entry.person.name}${present(entry.employment.title) ? `, ${entry.employment.title}` : ''} ${links.person(entry.person.id)}`,
          ),
        ]),
  ];
}

function leadLine(lead: LeadRow, context: RecordContext, links: RecordLinks): string {
  const names = context.names;
  const owner =
    lead.ownerId === null ? 'nobody' : (names.members[lead.ownerId] ?? 'a former member');
  const next = lead.nextActionAt === null ? '' : ` by ${lead.nextActionAt.slice(0, 10)}`;
  const parts = [
    `${lead.key}${lead.id === context.focusLeadId ? ' (in focus)' : ''}`,
    ...(context.company === null ? [] : [quoted(lead.personName)]),
    names.pipelines[lead.pipelineId] ?? 'Unknown pipeline',
    `stage ${names.stages[lead.stageId] ?? 'Unknown stage'} (${lead.stageCategory})`,
    `owner ${owner}`,
    `priority ${leadPriorityLabel(lead.priority)}`,
    ...(present(lead.nextAction) ? [`next: ${quoted(lead.nextAction)}${next}`] : []),
    ...(present(lead.holdReason) ? [`on hold: ${quoted(lead.holdReason)}`] : []),
    links.lead(lead.key),
  ];
  return `- ${parts.join(' · ')}`;
}

function leadLines(context: RecordContext, links: RecordLinks): string[] {
  if (context.leads.length === 0) return ['Leads: none'];
  return ['Leads:', ...context.leads.map((lead) => leadLine(lead, context, links))];
}

function textOf(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function changedKeys(payload: Record<string, unknown>): string[] {
  const changes = payload['changes'];
  return typeof changes === 'object' && changes !== null && !Array.isArray(changes)
    ? sortedKeys(Object.keys(changes))
    : [];
}

function actorName(activity: ActivityRow, names: ContextNames): string {
  if (activity.actor.name !== undefined) return quoted(activity.actor.name);
  if (activity.actor.type === 'user') return names.members[activity.actor.id] ?? 'A former member';
  if (activity.actor.type === 'system') return 'Gravity';
  return activity.actor.type === 'agent' ? 'An agent' : 'An integration';
}

function activityLine(activity: ActivityRow, names: ContextNames): string {
  const subject = textOf(activity.payload, 'key') ?? textOf(activity.payload, 'name');
  const changes = changedKeys(activity.payload);
  return `${activity.occurredAt.slice(0, 10)} ${actorName(activity, names)}: ${activity.kind}${subject === null ? '' : ` ${subject}`}${changes.length === 0 ? '' : ` (${changes.join(', ')})`}`;
}

function clip(text: string, length: number): string {
  if (text.length <= length) return text;
  const end = text.charCodeAt(length - 1);
  const splitsPair = end >= 0xd800 && end <= 0xdbff;
  return text.slice(0, splitsPair ? length - 1 : length);
}

function subjectLines(context: RecordContext, links: RecordLinks): string[] {
  if (context.person !== null) return personLines(context, context.person, links);
  if (context.company !== null) return companyLines(context, context.company, links);
  return [];
}

export function renderRecordContext(context: RecordContext, options: RenderContextOptions): string {
  const core = [...subjectLines(context, options.links), ...leadLines(context, options.links)].map(
    oneLine,
  );
  const timeline = context.timeline.map((activity) =>
    oneLine(activityLine(activity, context.names)),
  );
  const budget = options.maxTokens * CHARS_PER_TOKEN;
  const compose = (count: number) => {
    const omitted = timeline.length - count;
    const notice =
      omitted === 0
        ? []
        : [
            count === 0
              ? `(${omitted} activity entries left out to fit ${options.maxTokens} tokens)`
              : `(${omitted} older entries left out to fit ${options.maxTokens} tokens)`,
          ];
    return [
      ...core,
      ...(count === 0
        ? []
        : ['Recent activity:', ...timeline.slice(0, count).map((line) => `- ${line}`)]),
      ...notice,
    ].join('\n');
  };
  let count = timeline.length;
  let text = compose(count);
  while (text.length > budget && count > 0) {
    count -= 1;
    text = compose(count);
  }
  if (text.length <= budget) return text;
  return cutLines(core, timeline.length === 0 ? 0 : timeline.length + 1, options.maxTokens, budget);
}

function cutLines(
  lines: readonly string[],
  extraLines: number,
  maxTokens: number,
  budget: number,
): string {
  const total = lines.length + extraLines;
  const render = (keep: number, text: readonly string[]) =>
    [...text, `(${total - keep} more lines omitted to fit ${maxTokens} tokens)`].join('\n');
  let keep = lines.length;
  while (keep > 1 && render(keep, lines.slice(0, keep)).length > budget) keep -= 1;
  const kept = lines.slice(0, keep);
  const text = render(keep, kept);
  if (text.length <= budget) return text;
  const first = kept[0] ?? '';
  const spare = budget - (text.length - first.length);
  return render(keep, [clip(first, Math.max(0, spare)), ...kept.slice(1)]);
}
