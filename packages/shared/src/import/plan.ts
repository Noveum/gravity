import { LEAD_PRIORITIES, LEAD_PRIORITY_LABELS, type StageCategory } from '../constants/crm.ts';
import type { FieldDefinitionLike, FieldValue } from '../validators/fields.ts';
import {
  type CompanyInput,
  type CompanyRef,
  companyInputSchema,
  type PersonInput,
  personInputSchema,
} from '../validators/records.ts';
import { booleanOf, coerceFieldValue, instantOf } from './coerce.ts';
import type { ImportTarget } from './constants.ts';
import {
  customFieldOf,
  type ImportColumn,
  type ImportFieldObject,
  type ImportMapping,
} from './mapping.ts';
import type { ImportIssueCode } from './report.ts';
import type { ImportTable } from './table.ts';

export interface ImportIssue {
  readonly row: number;
  readonly column: string | null;
  readonly code: ImportIssueCode;
  readonly message: string;
}

export interface ImportMember {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
}

export interface ImportStage {
  readonly id: string;
  readonly name: string;
  readonly category: StageCategory;
}

export interface ImportSetup {
  readonly target: ImportTarget;
  readonly pipelineId: string | null;
  readonly stages: readonly ImportStage[];
  readonly members: readonly ImportMember[];
  readonly fields: Readonly<Record<ImportFieldObject, readonly FieldDefinitionLike[]>>;
  readonly defaultOwnerId: string | null;
}

export interface PlannedLead {
  readonly stageId: string | undefined;
  readonly stageCategory: StageCategory | null;
  readonly ownerId: string | null;
  readonly priority: number;
  readonly nextAction: string | null;
  readonly nextActionAt: string | null;
  readonly fields: Record<string, FieldValue>;
}

export interface PlannedRow {
  readonly row: number;
  readonly label: string;
  readonly sourceId: string | null;
  readonly person: PersonInput | null;
  readonly company: CompanyInput | null;
  readonly lead: PlannedLead | null;
  readonly issues: readonly ImportIssue[];
  readonly duplicateOf: number | null;
}

interface Cell {
  readonly header: string;
  readonly value: string;
}

type Cells = ReadonlyMap<ImportColumn, readonly Cell[]>;

const MAX_SOURCE_ID_LENGTH = 200;
const MAX_NEXT_ACTION_LENGTH = 280;

const PERSON_COLUMNS: Readonly<Record<string, ImportColumn>> = {
  name: 'person.name',
  emails: 'person.email',
  phones: 'person.phone',
  linkedinUrl: 'person.linkedinUrl',
  linkedinProviderId: 'person.linkedinProviderId',
  location: 'person.location',
  timezone: 'person.timezone',
  title: 'person.title',
  doNotContact: 'person.doNotContact',
  company: 'company.name',
};

const COMPANY_COLUMNS: Readonly<Record<string, ImportColumn>> = {
  name: 'company.name',
  domains: 'company.domain',
  size: 'company.size',
  segment: 'company.segment',
  location: 'company.location',
};

class RowIssues {
  readonly list: ImportIssue[] = [];
  readonly row: number;

  constructor(row: number) {
    this.row = row;
  }

  add(column: string | null, message: string): void {
    this.list.push({ row: this.row, column, code: 'invalid', message });
  }
}

function collect(
  cells: readonly string[],
  headers: readonly string[],
  columns: readonly ImportColumn[],
): Cells {
  const collected = new Map<ImportColumn, Cell[]>();
  columns.forEach((column, index) => {
    const header = headers[index];
    const value = (cells[index] ?? '').trim();
    if (column === 'ignore' || header === undefined || value.length === 0) return;
    const list = collected.get(column) ?? [];
    list.push({ header, value });
    collected.set(column, list);
  });
  return collected;
}

function firstCell(cells: Cells, column: ImportColumn): Cell | null {
  return cells.get(column)?.[0] ?? null;
}

function textOf(cells: Cells, column: ImportColumn): string | null {
  return firstCell(cells, column)?.value ?? null;
}

function listOf(cells: Cells, column: ImportColumn, separator: RegExp): string[] {
  return (cells.get(column) ?? [])
    .flatMap((cell) => cell.value.split(separator))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function headerOf(cells: Cells, column: ImportColumn | undefined): string | null {
  if (column === undefined) return null;
  const own = firstCell(cells, column)?.header;
  if (own !== undefined) return own;
  return column === 'company.name' ? (firstCell(cells, 'company.domain')?.header ?? null) : null;
}

function customValues(
  cells: Cells,
  object: ImportFieldObject,
  definitions: readonly FieldDefinitionLike[],
  issues: RowIssues,
): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  for (const [column, entries] of cells) {
    const custom = customFieldOf(column);
    const entry = entries[0];
    if (custom === null || custom.object !== object || entry === undefined) continue;
    const definition = definitions.find((candidate) => candidate.key === custom.key);
    if (definition === undefined) continue;
    const coerced = coerceFieldValue(definition, entry.value);
    if (coerced.ok) values[custom.key] = coerced.value;
    else issues.add(entry.header, coerced.message);
  }
  return values;
}

function joinedName(first: string | null, last: string | null): string | null {
  const name = [first, last]
    .filter((part): part is string => part !== null)
    .join(' ')
    .trim();
  return name.length === 0 ? null : name;
}

function planCompany(
  cells: Cells,
  setup: ImportSetup,
  issues: RowIssues,
  required: boolean,
): CompanyInput | null {
  const domain = textOf(cells, 'company.domain');
  const name = textOf(cells, 'company.name') ?? domain;
  const fields = customValues(cells, 'company', setup.fields.company, issues);
  const size = textOf(cells, 'company.size');
  const segment = textOf(cells, 'company.segment');
  const location = textOf(cells, 'company.location');
  if (name === null) {
    if (required) {
      issues.add(null, 'This row has no company name or domain.');
    } else if (
      size !== null ||
      segment !== null ||
      location !== null ||
      Object.keys(fields).length > 0
    ) {
      issues.add(null, 'Give the company a name or a domain.');
    }
    return null;
  }
  const parsed = companyInputSchema.safeParse({
    name,
    domains: domain === null ? [] : [domain],
    size,
    segment,
    location,
    fields,
  });
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) {
    issues.add(headerOf(cells, COMPANY_COLUMNS[String(issue.path[0])]), issue.message);
  }
  return null;
}

function companyRefOf(company: CompanyInput | null): CompanyRef | null {
  if (company === null) return null;
  const domain = company.domains[0];
  return domain === undefined ? { name: company.name } : { domain, name: company.name };
}

interface PlannedPerson {
  readonly person: PersonInput | null;
  readonly company: CompanyInput | null;
  readonly label: string;
}

function planPerson(
  row: number,
  cells: Cells,
  setup: ImportSetup,
  issues: RowIssues,
): PlannedPerson {
  const name =
    textOf(cells, 'person.name') ??
    joinedName(textOf(cells, 'person.firstName'), textOf(cells, 'person.lastName'));
  const emails = listOf(cells, 'person.email', /[;,]/);
  const label = name ?? emails[0] ?? `Row ${row}`;
  if (name === null) issues.add(null, 'This row has no name.');
  const doNotContactCell = firstCell(cells, 'person.doNotContact');
  let doNotContact = false;
  if (doNotContactCell !== null) {
    const parsed = booleanOf(doNotContactCell.value);
    if (parsed === null) {
      issues.add(doNotContactCell.header, `Use yes or no, not ${doNotContactCell.value}.`);
    } else {
      doNotContact = parsed;
    }
  }
  const fields = customValues(cells, 'person', setup.fields.person, issues);
  const company = planCompany(cells, setup, issues, false);
  if (name === null) return { person: null, company, label };
  const parsed = personInputSchema.safeParse({
    name,
    emails,
    phones: listOf(cells, 'person.phone', /;/),
    linkedinUrl: textOf(cells, 'person.linkedinUrl'),
    linkedinProviderId: textOf(cells, 'person.linkedinProviderId'),
    location: textOf(cells, 'person.location'),
    timezone: textOf(cells, 'person.timezone'),
    doNotContact,
    title: textOf(cells, 'person.title'),
    company: companyRefOf(company),
    fields,
  });
  if (parsed.success) return { person: parsed.data, company, label };
  for (const issue of parsed.error.issues) {
    issues.add(headerOf(cells, PERSON_COLUMNS[String(issue.path[0])]), issue.message);
  }
  return { person: null, company, label };
}

function priorityOf(raw: string): number | null {
  const needle = raw.trim().toLowerCase();
  const byNumber = LEAD_PRIORITIES.find((priority) => String(priority) === needle);
  if (byNumber !== undefined) return byNumber;
  return (
    LEAD_PRIORITIES.find((priority) => LEAD_PRIORITY_LABELS[priority].toLowerCase() === needle) ??
    null
  );
}

type OwnerMatch =
  | { readonly kind: 'found'; readonly userId: string }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'none' };

function ownerOf(members: readonly ImportMember[], raw: string): OwnerMatch {
  const needle = raw.toLowerCase();
  const byEmail = members.find((member) => member.email.toLowerCase() === needle);
  if (byEmail !== undefined) return { kind: 'found', userId: byEmail.userId };
  const byName = members.filter((member) => member.name.toLowerCase() === needle);
  const [only] = byName;
  if (only === undefined) return { kind: 'none' };
  return byName.length === 1 ? { kind: 'found', userId: only.userId } : { kind: 'ambiguous' };
}

function planStage(cells: Cells, setup: ImportSetup, issues: RowIssues): ImportStage | undefined {
  const cell = firstCell(cells, 'lead.stage');
  if (cell === null) return undefined;
  const found = setup.stages.find(
    (candidate) => candidate.name.toLowerCase() === cell.value.toLowerCase(),
  );
  if (found === undefined) {
    const startable = setup.stages
      .filter((candidate) => candidate.category !== 'hold')
      .map((candidate) => candidate.name);
    issues.add(
      cell.header,
      `There is no stage called ${cell.value}. Stages: ${startable.join(', ')}.`,
    );
    return undefined;
  }
  if (found.category === 'hold') {
    issues.add(
      cell.header,
      `Leads cannot start in ${found.name}. Import them into an open stage, then put them on hold with a reason.`,
    );
    return undefined;
  }
  return found;
}

function planOwner(cells: Cells, setup: ImportSetup, issues: RowIssues): string | null {
  const cell = firstCell(cells, 'lead.owner');
  if (cell === null) return setup.defaultOwnerId;
  const match = ownerOf(setup.members, cell.value);
  if (match.kind === 'found') return match.userId;
  issues.add(
    cell.header,
    match.kind === 'ambiguous'
      ? `Several members are called ${cell.value}. Use a member's email.`
      : `No member matches ${cell.value}. Use a member's email.`,
  );
  return setup.defaultOwnerId;
}

function planLead(cells: Cells, setup: ImportSetup, issues: RowIssues): PlannedLead {
  const stage = planStage(cells, setup, issues);
  const ownerId = planOwner(cells, setup, issues);
  const priorityCell = firstCell(cells, 'lead.priority');
  let priority = 0;
  if (priorityCell !== null) {
    const parsed = priorityOf(priorityCell.value);
    if (parsed === null) {
      issues.add(
        priorityCell.header,
        `Use a priority from 0 to 4 or a label such as Urgent or Low, not ${priorityCell.value}.`,
      );
    } else {
      priority = parsed;
    }
  }
  const nextActionCell = firstCell(cells, 'lead.nextAction');
  let nextAction: string | null = null;
  if (nextActionCell !== null) {
    if (nextActionCell.value.length > MAX_NEXT_ACTION_LENGTH) {
      issues.add(
        nextActionCell.header,
        `Keep the next action under ${MAX_NEXT_ACTION_LENGTH} characters.`,
      );
    } else {
      nextAction = nextActionCell.value;
    }
  }
  const atCell = firstCell(cells, 'lead.nextActionAt');
  let nextActionAt: string | null = null;
  if (atCell !== null) {
    nextActionAt = instantOf(atCell.value);
    if (nextActionAt === null) {
      issues.add(atCell.header, `Use a date like 2031-03-04, not ${atCell.value}.`);
    }
  }
  return {
    stageId: stage?.id,
    stageCategory: stage?.category ?? null,
    ownerId,
    priority,
    nextAction,
    nextActionAt,
    fields: customValues(cells, 'lead', setup.fields.lead, issues),
  };
}

function planRow(
  row: number,
  cells: readonly string[],
  headers: readonly string[],
  columns: readonly ImportColumn[],
  setup: ImportSetup,
): PlannedRow {
  const issues = new RowIssues(row);
  if (
    cells.length > headers.length &&
    cells.slice(headers.length).some((cell) => cell.trim() !== '')
  ) {
    issues.add(null, `This row has ${cells.length} cells but the header has ${headers.length}.`);
  }
  const collected = collect(cells, headers, columns);
  if (setup.target === 'companies') {
    const company = planCompany(collected, setup, issues, true);
    return {
      row,
      label:
        company?.name ??
        textOf(collected, 'company.name') ??
        textOf(collected, 'company.domain') ??
        `Row ${row}`,
      sourceId: null,
      person: null,
      company,
      lead: null,
      issues: issues.list,
      duplicateOf: null,
    };
  }
  const sourceCell = firstCell(collected, 'sourceId');
  const sourceTooLong = sourceCell !== null && sourceCell.value.length > MAX_SOURCE_ID_LENGTH;
  if (sourceCell !== null && sourceTooLong) {
    issues.add(sourceCell.header, `Keep source ids under ${MAX_SOURCE_ID_LENGTH} characters.`);
  }
  const planned = planPerson(row, collected, setup, issues);
  const lead = setup.target === 'leads' ? planLead(collected, setup, issues) : null;
  return {
    row,
    label: planned.label,
    sourceId: sourceCell === null || sourceTooLong ? null : sourceCell.value,
    person: planned.person,
    company: planned.company,
    lead,
    issues: issues.list,
    duplicateOf: null,
  };
}

interface Identity {
  readonly lookup: readonly string[];
  readonly claim: readonly string[];
}

function personIdentity(row: PlannedRow): Identity {
  const person = row.person;
  if (person === null) return { lookup: [], claim: [] };
  const keys = [
    ...(row.sourceId === null ? [] : [`source:${row.sourceId}`]),
    ...(person.linkedinProviderId === null ? [] : [`provider:${person.linkedinProviderId}`]),
    ...person.emails.map((email) => `email:${email}`),
    ...(person.linkedinUrl === null ? [] : [`linkedin:${person.linkedinUrl}`]),
  ];
  return { lookup: keys, claim: keys };
}

function companyIdentity(row: PlannedRow): Identity {
  const company = row.company;
  if (company === null) return { lookup: [], claim: [] };
  const name = `name:${company.name.toLowerCase()}`;
  const domains = company.domains.map((domain) => `domain:${domain}`);
  return { lookup: domains.length > 0 ? domains : [name], claim: [...domains, name] };
}

function markDuplicates(rows: readonly PlannedRow[], target: ImportTarget): PlannedRow[] {
  const owners = new Map<string, number>();
  return rows.map((row) => {
    if (row.issues.length > 0) return row;
    const identity = target === 'companies' ? companyIdentity(row) : personIdentity(row);
    const earlier = identity.lookup
      .map((key) => owners.get(key))
      .find((owner) => owner !== undefined);
    if (earlier !== undefined) return { ...row, duplicateOf: earlier };
    for (const key of identity.claim) {
      if (!owners.has(key)) owners.set(key, row.row);
    }
    return row;
  });
}

function columnOf(mapping: ImportMapping, header: string): ImportColumn {
  return Object.hasOwn(mapping, header) ? (mapping[header] ?? 'ignore') : 'ignore';
}

export function planImport(
  table: ImportTable,
  mapping: ImportMapping,
  setup: ImportSetup,
): PlannedRow[] {
  const columns = table.headers.map((header) => columnOf(mapping, header));
  const planned = table.rows.map((cells, index) =>
    planRow(index + 1, cells, table.headers, columns, setup),
  );
  return markDuplicates(planned, setup.target);
}
