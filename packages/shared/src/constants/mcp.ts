export const GRAVITY_READ_SCOPE = 'gravity.read';
export const GRAVITY_WRITE_SCOPE = 'gravity.write';
export const GRAVITY_APPROVE_SCOPE = 'gravity.approve';

export const GRAVITY_SCOPES = [
  GRAVITY_READ_SCOPE,
  GRAVITY_WRITE_SCOPE,
  GRAVITY_APPROVE_SCOPE,
] as const;

export const MCP_OAUTH_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  ...GRAVITY_SCOPES,
] as const;

export const MCP_SCOPE_LABELS: Readonly<Record<string, string>> = {
  [GRAVITY_READ_SCOPE]:
    'Read people, companies, leads, pipelines and saved views in the workspace you choose',
  [GRAVITY_WRITE_SCOPE]: 'Create and update records once write tools arrive in a later release',
  [GRAVITY_APPROVE_SCOPE]: 'Approve outbound messages on your behalf',
  offline_access: 'Stay connected without signing in again',
};

export function scopeList(raw: string): string[] {
  return [...new Set(raw.split(/[\s,]+/).filter((scope) => scope.length > 0))];
}

export function grantsReads(raw: string): boolean {
  return scopeList(raw).includes(GRAVITY_READ_SCOPE);
}

export function grantsWrites(raw: string): boolean {
  return scopeList(raw).includes(GRAVITY_WRITE_SCOPE);
}

export function grantsApproval(raw: string): boolean {
  return scopeList(raw).includes(GRAVITY_APPROVE_SCOPE);
}

const OFFERED_SCOPES: ReadonlySet<string> = new Set(MCP_OAUTH_SCOPES);

export function consentedScopes(requested: readonly string[], allowApproval: boolean): string[] {
  return [...new Set(requested)].filter(
    (scope) => OFFERED_SCOPES.has(scope) && (scope !== GRAVITY_APPROVE_SCOPE || allowApproval),
  );
}
