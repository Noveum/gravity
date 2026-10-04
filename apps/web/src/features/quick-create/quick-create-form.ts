import type { LeadRow, PipelineRow, StageRow } from '@gravity/shared/records';
import { type IdentityInput, normalizeDomain, parseIdentityInput } from '@gravity/shared/utils';
import type { CompanyRef } from '@gravity/shared/validators';
import type { QuickCreateBody } from '@/lib/query/use-lead-mutations.ts';

export interface QuickCreateDraft {
  readonly identity: string;
  readonly name: string;
  readonly companyName: string;
  readonly companyDomain: string;
  readonly pipelineId: string;
  readonly ownerId: string | null;
}

export interface QuickCreateContext {
  readonly leadId: string;
  readonly pipeline: PipelineRow;
  readonly stages: readonly StageRow[];
  readonly organizationId: string;
  readonly now: Date;
}

export interface BuiltQuickCreate {
  readonly body: QuickCreateBody;
  readonly preview: LeadRow;
}

const MISSING_IDENTITY = 'Add a name, an email or a LinkedIn URL.';
const BAD_DOMAIN = 'Enter the company domain like acme.com.';

function companyOf(draft: QuickCreateDraft): CompanyRef | null | 'invalid' {
  const typedDomain = draft.companyDomain.trim();
  const domain = typedDomain.length === 0 ? null : normalizeDomain(typedDomain);
  if (typedDomain.length > 0 && domain === null) return 'invalid';
  const name = draft.companyName.trim();
  if (domain !== null) return name.length > 0 ? { domain, name } : { domain };
  return name.length > 0 ? { name } : null;
}

function companyLabel(company: CompanyRef | null): string | null {
  if (company === null || 'id' in company) return null;
  if ('domain' in company) return company.name ?? company.domain;
  return company.name;
}

function personName(identity: IdentityInput, typed: string): string {
  if (identity.kind === 'name') return identity.name;
  if (typed.length > 0) return typed;
  if (identity.kind === 'email') return identity.email.split('@')[0] ?? '';
  return identity.linkedinUrl.split('/in/')[1] ?? '';
}

function firstOpenStage(stages: readonly StageRow[], pipelineId: string): StageRow | undefined {
  return stages
    .filter(
      (stage) =>
        stage.pipelineId === pipelineId && stage.archivedAt === null && stage.category === 'open',
    )
    .sort((a, b) => a.sortOrder - b.sortOrder)[0];
}

export function buildQuickCreate(
  draft: QuickCreateDraft,
  context: QuickCreateContext,
): BuiltQuickCreate | { error: string } {
  const identity = parseIdentityInput(draft.identity);
  if (identity === null) return { error: MISSING_IDENTITY };
  const name = personName(identity, draft.name.trim());
  if (name.length === 0) return { error: MISSING_IDENTITY };
  const stage = firstOpenStage(context.stages, context.pipeline.id);
  if (stage === undefined)
    return { error: 'This pipeline has no open stage. Add one in Settings.' };
  const company = companyOf(draft);
  if (company === 'invalid') return { error: BAD_DOMAIN };
  const email = identity.kind === 'email' ? identity.email : null;
  const linkedinUrl = identity.kind === 'linkedin' ? identity.linkedinUrl : null;
  const at = context.now.toISOString();
  return {
    body: {
      leadId: context.leadId,
      pipelineId: draft.pipelineId,
      ownerId: draft.ownerId,
      person: { name, emails: email === null ? [] : [email], linkedinUrl, company },
    },
    preview: {
      id: context.leadId,
      organizationId: context.organizationId,
      pipelineId: context.pipeline.id,
      brandId: context.pipeline.brandId,
      number: 0,
      key: `${context.pipeline.key}-new`,
      personId: `pending-${context.leadId}`,
      personName: name,
      personEmail: email,
      personLinkedinUrl: linkedinUrl,
      companyId: null,
      companyName: companyLabel(company),
      ownerId: draft.ownerId,
      stageId: stage.id,
      stageCategory: 'open',
      source: 'manual',
      priority: 0,
      holdReason: null,
      holdUntil: null,
      nextAction: null,
      nextActionAt: null,
      owedBy: 'none',
      lastInboundAt: null,
      lastOutboundAt: null,
      fields: {},
      syncId: 0,
      createdAt: at,
      updatedAt: at,
      archivedAt: null,
    },
  };
}
