export const SCOPE_KINDS = ['workspace', 'brand', 'pipeline', 'person', 'company', 'user'] as const;

export type ScopeKind = (typeof SCOPE_KINDS)[number];

export const scopes = {
  workspace: (organizationId: string): string => `workspace:${organizationId}`,
  brand: (brandId: string): string => `brand:${brandId}`,
  pipeline: (pipelineId: string): string => `pipeline:${pipelineId}`,
  person: (personId: string): string => `person:${personId}`,
  company: (companyId: string): string => `company:${companyId}`,
  user: (userId: string): string => `user:${userId}`,
} as const;

export interface ParsedScope {
  readonly kind: ScopeKind;
  readonly id: string;
}

function isScopeKind(value: string): value is ScopeKind {
  return SCOPE_KINDS.some((kind) => kind === value);
}

export function parseScope(scope: string): ParsedScope | null {
  const separator = scope.indexOf(':');
  if (separator <= 0) return null;
  const kind = scope.slice(0, separator);
  const id = scope.slice(separator + 1);
  if (!isScopeKind(kind) || id.length === 0) return null;
  return { kind, id };
}
