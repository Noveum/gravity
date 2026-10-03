import { scopes } from '@gravity/shared/events';

export function brandScopes(organizationId: string, brandId: string): string[] {
  return [scopes.workspace(organizationId), scopes.brand(brandId)];
}

export function pipelineScopes(
  organizationId: string,
  brandId: string,
  pipelineId: string,
): string[] {
  return [scopes.workspace(organizationId), scopes.brand(brandId), scopes.pipeline(pipelineId)];
}

export function personScopes(organizationId: string, personId: string): string[] {
  return [scopes.workspace(organizationId), scopes.person(personId)];
}

export function companyScopes(organizationId: string, companyId: string): string[] {
  return [scopes.workspace(organizationId), scopes.company(companyId)];
}

export function employmentScopes(
  organizationId: string,
  personId: string,
  companyId: string,
): string[] {
  return [scopes.workspace(organizationId), scopes.person(personId), scopes.company(companyId)];
}

export interface LeadScopeSource {
  readonly brandId: string;
  readonly pipelineId: string;
  readonly personId: string;
  readonly companyId: string | null;
}

export function leadScopes(organizationId: string, lead: LeadScopeSource): string[] {
  return [
    scopes.workspace(organizationId),
    scopes.brand(lead.brandId),
    scopes.pipeline(lead.pipelineId),
    scopes.person(lead.personId),
    ...(lead.companyId === null ? [] : [scopes.company(lead.companyId)]),
  ];
}
