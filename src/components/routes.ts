import type { View } from "@crm/core/shortcuts";

export type Section = View | "outreach";

const sectionPaths: Record<Section, string> = {
  actions: "/actions",
  people: "/people",
  companies: "/companies",
  sequences: "/sequences",
  meetings: "/meetings",
  opportunities: "/opportunities",
  materials: "/materials",
  outreach: "/outreach",
  integrations: "/connections",
  settings: "/settings",
};
const recordSections: ReadonlySet<Section> = new Set(["people", "companies"]);
const sections = Object.keys(sectionPaths) as Section[];

export const homePath = sectionPaths.actions;

export interface Route {
  section: Section;
  recordId: string;
}

export function sectionPath(section: Section) {
  return sectionPaths[section];
}

export function routeFor(pathname: string): Route | null {
  const [first, second, ...rest] = pathname.split("/").filter(Boolean);
  const section = sections.find((id) => sectionPaths[id] === `/${first}`);
  if (!section) return null;
  if (second === undefined) return { section, recordId: "" };
  if (!recordSections.has(section) || rest.length) return null;
  try {
    return { section, recordId: decodeURIComponent(second) };
  } catch {
    return null;
  }
}

function withQuery(path: string, query: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value) params.set(key, value);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export function personPath(
  personId: string,
  focus: { relationshipId?: string; actionId?: string } = {},
) {
  return withQuery(`${sectionPaths.people}/${encodeURIComponent(personId)}`, {
    relationship: focus.relationshipId,
    action: focus.actionId,
  });
}

export function companyPath(companyId: string) {
  return `${sectionPaths.companies}/${encodeURIComponent(companyId)}`;
}

export interface ActionFilters {
  kind: string;
  owner: string;
  waiting: boolean;
}

export function actionFilters(query: URLSearchParams): ActionFilters {
  return {
    kind: query.get("kind") ?? "",
    owner: query.get("owner") ?? "",
    waiting: query.get("waiting") === "1",
  };
}

export function actionsPath(filters: Partial<ActionFilters> = {}) {
  return withQuery(sectionPaths.actions, {
    kind: filters.kind,
    owner: filters.owner,
    waiting: filters.waiting ? "1" : undefined,
  });
}
