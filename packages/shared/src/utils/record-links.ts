export const WORKSPACE_LINK_PARAM = 'w';

export const RECORD_LINK_PATHS = {
  app: '/leads',
  pipeline: '/leads/',
  lead: '/l/',
  person: '/people/',
  company: '/companies/',
} as const;

export interface RecordLinks {
  readonly base: string;
  readonly workspace: string;
  readonly app: string;
  readonly pipeline: (key: string) => string;
  readonly lead: (key: string) => string;
  readonly person: (id: string) => string;
  readonly company: (id: string) => string;
}

export function recordLinks(baseUrl: string, workspaceSlug: string): RecordLinks {
  const base = baseUrl.replace(/\/+$/, '');
  const query = `?${WORKSPACE_LINK_PARAM}=${encodeURIComponent(workspaceSlug)}`;
  const at = (path: string, segment = '') => `${base}${path}${encodeURIComponent(segment)}${query}`;
  return {
    base,
    workspace: workspaceSlug,
    app: at(RECORD_LINK_PATHS.app),
    pipeline: (key) => at(RECORD_LINK_PATHS.pipeline, key),
    lead: (key) => at(RECORD_LINK_PATHS.lead, key),
    person: (id) => at(RECORD_LINK_PATHS.person, id),
    company: (id) => at(RECORD_LINK_PATHS.company, id),
  };
}

export function linkedWorkspace(link: string): string | null {
  const query = link.split('#')[0]?.split('?')[1];
  if (query === undefined) return null;
  const slug = new URLSearchParams(query).get(WORKSPACE_LINK_PARAM)?.trim().toLowerCase() ?? '';
  return slug.length === 0 ? null : slug;
}
