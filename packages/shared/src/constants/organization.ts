export const ORG_ROLES = ['admin', 'member', 'contributor', 'guest'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  admin: 3,
  member: 2,
  contributor: 1,
  guest: 0,
};

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const RESERVED_WORKSPACE_SLUGS: ReadonlySet<string> = new Set([
  'about',
  'account',
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'billing',
  'blog',
  'brands',
  'callback',
  'companies',
  'contact',
  'dashboard',
  'docs',
  'gravity',
  'help',
  'home',
  'imports',
  'inbox',
  'invite',
  'invites',
  'leads',
  'legal',
  'login',
  'logout',
  'me',
  'new',
  'oauth',
  'onboarding',
  'people',
  'pipelines',
  'pricing',
  'privacy',
  'public',
  'settings',
  'signin',
  'signout',
  'signup',
  'static',
  'status',
  'support',
  'terms',
  'user',
  'users',
  'views',
  'workspace',
  'workspaces',
  'www',
]);

export function isReservedWorkspaceSlug(slug: string): boolean {
  return RESERVED_WORKSPACE_SLUGS.has(slug.trim().toLowerCase());
}
