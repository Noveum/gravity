export const STAGE_CATEGORIES = ['open', 'won', 'lost', 'hold'] as const;
export type StageCategory = (typeof STAGE_CATEGORIES)[number];

export const OPEN_STAGE_CATEGORIES: readonly StageCategory[] = ['open', 'hold'];

export function isOpenCategory(category: StageCategory): boolean {
  return OPEN_STAGE_CATEGORIES.includes(category);
}

export const STAGE_CATEGORY_LABELS: Record<StageCategory, string> = {
  open: 'Open',
  won: 'Won',
  lost: 'Lost',
  hold: 'On hold',
};

export const PIPELINE_KINDS = ['people', 'deals'] as const;
export type PipelineKind = (typeof PIPELINE_KINDS)[number];

export const PIPELINE_KEY_PATTERN = /^[A-Z]{2,5}$/;

export interface DefaultStage {
  readonly name: string;
  readonly category: StageCategory;
}

export const DEFAULT_PROSPECTING_STAGES: readonly DefaultStage[] = [
  { name: 'New', category: 'open' },
  { name: 'Researching', category: 'open' },
  { name: 'Ready', category: 'open' },
  { name: 'Contacted', category: 'open' },
  { name: 'Follow-up', category: 'open' },
  { name: 'Replied', category: 'open' },
  { name: 'Meeting booked', category: 'open' },
  { name: 'Meeting held', category: 'open' },
  { name: 'Qualified', category: 'won' },
  { name: 'On hold', category: 'hold' },
  { name: 'Closed: no reply', category: 'lost' },
  { name: 'Closed: not a fit', category: 'lost' },
  { name: 'Do not contact', category: 'lost' },
];

export const DEFAULT_DEAL_STAGES: readonly DefaultStage[] = [
  { name: 'Discovery', category: 'open' },
  { name: 'Proposal', category: 'open' },
  { name: 'Negotiation', category: 'open' },
  { name: 'Won', category: 'won' },
  { name: 'Lost', category: 'lost' },
];

export function defaultStagesFor(kind: PipelineKind): readonly DefaultStage[] {
  return kind === 'deals' ? DEFAULT_DEAL_STAGES : DEFAULT_PROSPECTING_STAGES;
}

export const DEFAULT_PIPELINE_NAME: Record<PipelineKind, string> = {
  people: 'Prospecting',
  deals: 'Deals',
};

export const LEAD_PRIORITIES = [0, 1, 2, 3, 4] as const;
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];

export const LEAD_PRIORITY_LABELS: Record<LeadPriority, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

export const OWED_BY = ['us', 'them', 'none'] as const;
export type OwedBy = (typeof OWED_BY)[number];

export const OWED_BY_LABELS: Record<OwedBy, string> = {
  us: 'We owe a reply',
  them: 'They owe a reply',
  none: 'Nobody owes a reply',
};

export const FIELD_OBJECTS = ['person', 'company', 'lead', 'deal'] as const;
export type FieldObject = (typeof FIELD_OBJECTS)[number];

export const FIELD_TYPES = [
  'text',
  'number',
  'boolean',
  'date',
  'url',
  'email',
  'select',
  'multi_select',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  number: 'Number',
  boolean: 'Yes or no',
  date: 'Date',
  url: 'Link',
  email: 'Email',
  select: 'Single choice',
  multi_select: 'Multiple choice',
};

export const SELECT_FIELD_TYPES: readonly FieldType[] = ['select', 'multi_select'];

export const BRAND_COLORS = [
  'blue',
  'green',
  'amber',
  'red',
  'violet',
  'cyan',
  'orange',
  'gray',
] as const;
export type BrandColor = (typeof BRAND_COLORS)[number];

export const ACTIVITY_ENTITY_TYPES = ['person', 'company', 'lead'] as const;
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];

export const ACTIVITY_KINDS = [
  'person.created',
  'person.updated',
  'company.created',
  'company.updated',
  'employment.started',
  'employment.ended',
  'lead.created',
  'lead.stage_changed',
  'lead.owner_changed',
  'lead.priority_changed',
  'lead.next_action_changed',
  'lead.held',
  'lead.closed',
  'lead.updated',
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const TIMELINE_FILTERS = [
  'all',
  'messages',
  'meetings',
  'notes',
  'facts',
  'changes',
] as const;
export type TimelineFilter = (typeof TIMELINE_FILTERS)[number];

export const TIMELINE_FILTER_LABELS: Record<TimelineFilter, string> = {
  all: 'All',
  messages: 'Messages',
  meetings: 'Meetings',
  notes: 'Notes',
  facts: 'Facts',
  changes: 'Changes',
};

export const TIMELINE_PREFIXES: Record<Exclude<TimelineFilter, 'all'>, readonly string[]> = {
  messages: ['message.', 'conversation.'],
  meetings: ['meeting.'],
  notes: ['note.'],
  facts: ['fact.'],
  changes: ['person.', 'company.', 'employment.', 'lead.'],
};

export function timelineFilterMatches(filter: TimelineFilter, kind: string): boolean {
  if (filter === 'all') return true;
  return TIMELINE_PREFIXES[filter].some((prefix) => kind.startsWith(prefix));
}

export const SAVED_VIEW_OBJECTS = ['lead', 'person', 'company'] as const;
export type SavedViewObject = (typeof SAVED_VIEW_OBJECTS)[number];

export const SAVED_VIEW_VISIBILITIES = ['private', 'workspace'] as const;
export type SavedViewVisibility = (typeof SAVED_VIEW_VISIBILITIES)[number];

export const SAVED_VIEW_VISIBILITY_LABELS: Record<SavedViewVisibility, string> = {
  private: 'Only me',
  workspace: 'Everyone in the workspace',
};

export const MAX_BULK_LEADS = 500;
export const BULK_CONFIRM_THRESHOLD = 50;
export const LEAD_PAGE_SIZE = 500;
export const RECORD_PAGE_SIZE = 200;
export const SEARCH_RESULT_LIMIT = 8;

export const CONTEXT_TOKENS = { min: 200, default: 2000, max: 8000 } as const;

export function clampContextTokens(value: number | undefined): number {
  if (value === undefined) return CONTEXT_TOKENS.default;
  return Math.min(CONTEXT_TOKENS.max, Math.max(CONTEXT_TOKENS.min, value));
}

export function leadPriorityLabel(priority: number): string {
  const known = LEAD_PRIORITIES.find((entry) => entry === priority);
  return known === undefined ? LEAD_PRIORITY_LABELS[0] : LEAD_PRIORITY_LABELS[known];
}
