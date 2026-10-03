export const NAV_SECTIONS = [
  'today',
  'inbox',
  'meetings',
  'leads',
  'people',
  'companies',
  'deals',
  'sequences',
  'settings',
] as const;

export type NavSection = (typeof NAV_SECTIONS)[number];

export interface NavItem {
  readonly id: NavSection;
  readonly label: string;
  readonly href: string;
  readonly chord: string;
  readonly group: 'work' | 'records' | 'settings';
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'today', label: 'Today', href: '/today', chord: 'g t', group: 'work' },
  { id: 'inbox', label: 'Inbox', href: '/inbox', chord: 'g i', group: 'work' },
  { id: 'meetings', label: 'Meetings', href: '/meetings', chord: 'g m', group: 'work' },
  { id: 'leads', label: 'Leads', href: '/leads', chord: 'g l', group: 'records' },
  { id: 'people', label: 'People', href: '/people', chord: 'g p', group: 'records' },
  { id: 'companies', label: 'Companies', href: '/companies', chord: 'g c', group: 'records' },
  { id: 'deals', label: 'Deals', href: '/deals', chord: 'g d', group: 'records' },
  { id: 'sequences', label: 'Sequences', href: '/sequences', chord: 'g s', group: 'records' },
  { id: 'settings', label: 'Settings', href: '/settings/members', chord: 'g ,', group: 'settings' },
];

export function navItemFor(section: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.id === section);
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return pathname === `/${item.id}` || pathname.startsWith(`/${item.id}/`);
}

export interface Breadcrumb {
  readonly label: string;
  readonly href?: string;
}

function titleCase(segment: string): string {
  return `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`;
}

export function leadsHref(pipelineKey: string): string {
  return `/leads/${pipelineKey}`;
}

export function pipelineKeyOf(pathname: string): string | null {
  const [section, key] = pathname.split('/').filter((segment) => segment.length > 0);
  return section === 'leads' && key !== undefined ? key.toUpperCase() : null;
}

const RECORD_SECTIONS: readonly NavSection[] = ['people', 'companies'];

export function isRecordPath(pathname: string): boolean {
  const [section, id] = pathname.split('/').filter((segment) => segment.length > 0);
  return RECORD_SECTIONS.some((entry) => entry === section) && id !== undefined;
}

export interface BreadcrumbLookup {
  readonly pipeline?: (
    key: string,
  ) => { readonly brandName: string; readonly pipelineName: string } | undefined;
}

export function breadcrumbsFor(pathname: string, lookup: BreadcrumbLookup = {}): Breadcrumb[] {
  const [section, page] = pathname.split('/').filter((segment) => segment.length > 0);
  const item = section === undefined ? undefined : navItemFor(section);
  if (item === undefined) return [];
  if (page === undefined) return [{ label: item.label }];
  if (item.id === 'leads') {
    const key = page.toUpperCase();
    const found = lookup.pipeline?.(key);
    if (found !== undefined) {
      return [
        { label: item.label, href: item.href },
        { label: found.brandName },
        { label: found.pipelineName },
      ];
    }
    return [{ label: item.label, href: item.href }, { label: key }];
  }
  return [{ label: item.label, href: item.href }, { label: titleCase(page) }];
}

export interface ShellWorkspace {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly logo?: string | null | undefined;
}

export interface ShellUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly image?: string | null | undefined;
}
