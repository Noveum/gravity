import type { ActivityEntityType, TimelineFilter } from '@gravity/shared/constants';

export const BOOTSTRAP_ROOT = 'bootstrap';
export const LEADS_ROOT = 'leads';
export const LEAD_ROOT = 'lead';
export const PEOPLE_ROOT = 'people';
export const PERSON_ROOT = 'person';
export const COMPANIES_ROOT = 'companies';
export const COMPANY_ROOT = 'company';
export const TIMELINE_ROOT = 'timeline';
export const SEARCH_ROOT = 'search';
export const DUPLICATES_ROOT = 'duplicates';

export const queryKeys = {
  workspaces: ['workspaces'] as const,
  mcpGrants: ['mcp-grants'] as const,
  bootstrap: [BOOTSTRAP_ROOT] as const,
  leads: (pipelineId: string, search: string) => [LEADS_ROOT, pipelineId, search] as const,
  lead: (id: string) => [LEAD_ROOT, id] as const,
  people: (search: string) => [PEOPLE_ROOT, search] as const,
  person: (id: string) => [PERSON_ROOT, id] as const,
  companies: (search: string) => [COMPANIES_ROOT, search] as const,
  company: (id: string) => [COMPANY_ROOT, id] as const,
  timeline: (subjectType: ActivityEntityType, subjectId: string, filter: TimelineFilter) =>
    [TIMELINE_ROOT, subjectType, subjectId, filter] as const,
  search: (term: string) => [SEARCH_ROOT, term] as const,
  duplicates: (probe: string) => [DUPLICATES_ROOT, probe] as const,
} as const;
