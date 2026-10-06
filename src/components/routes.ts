import type { View } from "@crm/core/shortcuts";

export type Section = View | "outreach";

const sectionPaths: Record<Section, string> = {
  overview: "/overview",
  actions: "/actions",
  people: "/people",
  companies: "/companies",
  sequences: "/sequences",
  meetings: "/meetings",
  opportunities: "/opportunities",
  materials: "/materials",
  outreach: "/outreach",
  integrations: "/settings/connections",
  assistants: "/settings/assistants",
  settings: "/settings",
};
const recordSections: ReadonlySet<Section> = new Set(["people", "companies"]);
export const outreachTabs = [
  "today",
  "drafts",
  "approved",
  "sent",
  "paused",
  "sequences",
  "pipeline",
] as const;
export type OutreachTab = (typeof outreachTabs)[number];
export const touchTabs: ReadonlySet<OutreachTab> = new Set([
  "today",
  "drafts",
  "approved",
]);
export const isOutreachTab = (value: string): value is OutreachTab =>
  (outreachTabs as readonly string[]).includes(value);
export const outreachPath = (tab: OutreachTab) =>
  `${sectionPaths.outreach}/${tab}`;
export function outreachTabFor(pathname: string): OutreachTab | null {
  const [first, second, ...rest] = pathname.split("/").filter(Boolean);
  if (`/${first}` !== sectionPaths.outreach || rest.length) return null;
  if (second === undefined) return null;
  return isOutreachTab(second) ? second : null;
}
export const settingsSections = [
  "workspace",
  "brands",
  "pipelines",
  "members",
  "outreach",
  "connections",
  "sending",
  "assistants",
  "preferences",
] as const;
export type SettingsSection = (typeof settingsSections)[number];
export const isSettingsSection = (value: string): value is SettingsSection =>
  (settingsSections as readonly string[]).includes(value);
export const settingsPath = (section: SettingsSection) =>
  `${sectionPaths.settings}/${section}`;
export function settingsSectionFor(pathname: string): SettingsSection | null {
  const [first, second, ...rest] = pathname.split("/").filter(Boolean);
  if (`/${first}` !== sectionPaths.settings || rest.length) return null;
  if (second === undefined) return "workspace";
  return isSettingsSection(second) ? second : null;
}
const settingsHome: Partial<Record<Section, SettingsSection>> = {
  integrations: "connections",
  assistants: "assistants",
  settings: "workspace",
};
const sections = Object.keys(sectionPaths) as Section[];

export const homePath = sectionPaths.actions;

export function legacyDestination(
  query: Record<string, string | string[] | undefined>,
) {
  const section = query.view === "connections" ? "integrations" : query.view;
  const path = sections.includes(section as Section)
    ? sectionPath(section as Section)
    : homePath;
  const notice = new URLSearchParams();
  if (path === sectionPaths.integrations) {
    if (query.integration === "connected" || query.integration === "pending")
      notice.set("integration", query.integration);
    if (typeof query.integrationError === "string")
      notice.set("integrationError", query.integrationError);
  }
  const next = notice.size ? `${path}?${notice}` : path;
  const workspace = new URLSearchParams();
  for (const key of ["workspace", "organizationId", "productId"]) {
    const value = query[key];
    if (typeof value === "string" && value) workspace.set(key, value);
  }
  if (!workspace.has("workspace") && !workspace.has("organizationId"))
    return next;
  workspace.set("next", next);
  return `/api/workspace?${workspace}`;
}
export const requestPathHeader = "x-gravity-path";
const unsafeCharacter = (character: string) => {
  const code = character.charCodeAt(0);
  return code < 32 || code === 127 || character === "\\";
};
const originProbe = "http://gravity.invalid";

export interface Route {
  section: Section;
  recordId: string;
}

export function sectionPath(section: Section) {
  const settings = settingsHome[section];
  if (settings) return settingsPath(settings);
  return section === "sequences"
    ? outreachPath("sequences")
    : sectionPaths[section];
}

export function routeFor(pathname: string): Route | null {
  const [first, second, ...rest] = pathname.split("/").filter(Boolean);
  const section = sections.find((id) => sectionPaths[id] === `/${first}`);
  if (!section) return null;
  if (second === undefined) return { section, recordId: "" };
  if (section === "settings")
    return !rest.length && isSettingsSection(second)
      ? { section, recordId: "" }
      : null;
  if (section === "outreach")
    return !rest.length && isOutreachTab(second)
      ? { section, recordId: "" }
      : null;
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

export const invitePath = "/invite";
export const inviteLinkPath = (token: string) =>
  `${invitePath}#${encodeURIComponent(token)}`;
const isInvitePath = (pathname: string) =>
  /^\/invite(?:\/[^/]+)?$/.test(pathname);

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

export function appPath(value: string | null | undefined) {
  if (
    !value?.startsWith("/") ||
    value.startsWith("//") ||
    [...value].some(unsafeCharacter)
  )
    return null;
  try {
    const url = new URL(value, originProbe);
    if (
      url.origin !== originProbe ||
      !(routeFor(url.pathname) || isInvitePath(url.pathname))
    )
      return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export function signInPath(requested: string | null | undefined) {
  const path = appPath(requested);
  return path ? `/sign-in?callbackURL=${encodeURIComponent(path)}` : "/sign-in";
}
