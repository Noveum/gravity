import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  ProviderConfigurationService,
  unipileSettingsInput,
} from "../connectors/configuration";
import {
  deliverySchema,
  OutboundService,
  reconcileDeliverySchema,
  sendActionSchema,
  sendReadinessSchema,
  sendTouchSchema,
} from "../connectors/outbound";
import {
  connectInput,
  IntegrationService,
  integrationOverviewInput,
  integrationScope,
} from "../connectors/service";
import { publishChange } from "../core/changes";
import {
  actionChangeSchema,
  actionPlanSchema,
  CrmService,
  folderSchema,
  meetingChangeSchema,
  messageActivitySchema,
  opportunitySchema,
  personSchema,
  pipelineSchema,
  scheduleActionSchema,
  scopeSchema,
  workspaceSchema,
} from "../core/crm";
import {
  acceptInvitationSchema,
  createInvitationSchema,
  InvitationService,
  listInvitationsSchema,
  resendInvitationSchema,
  revokeInvitationSchema,
} from "../core/invitations";
import {
  deactivateMemberSchema,
  listMembersSchema,
  MemberService,
  memberProductsSchema,
  memberRoleSchema,
  reactivateMemberSchema,
} from "../core/members";
import {
  contactPreferencesSchema,
  contactRulesSchema,
  enrollmentChangeSchema,
  enrollSchema,
  OutreachService,
  relationshipChangeSchema,
  sequenceCreateSchema,
  sequenceUpdateSchema,
  touchApproveSchema,
  touchDraftSchema,
  touchQuerySchema,
  touchReopenSchema,
  touchSentSchema,
  touchSkipSchema,
  touchSnoozeSchema,
} from "../core/outreach";
import { authorize, DomainError, type Principal } from "../core/policy";
import {
  companyArchiveSchema,
  companySchema,
  meetingSchema,
  opportunityChangeSchema,
  opportunityCreateSchema,
  personArchiveSchema,
  personUpdateSchema,
  RecordService,
} from "../core/records";
import type { Database } from "../database/client";
import { mcpGrants } from "../database/schema";
import { downloadAsset, maxFileSize, uploadAsset } from "../storage/files";

export interface OperationContext {
  db: Database;
  principal: Principal;
}
export interface Operation {
  name: string;
  api: "crm" | "outreach" | "integrations" | "materials" | "grants";
  method: "GET" | "POST" | "DELETE";
  operation: string;
  description: string;
  schema: z.ZodObject;
  idempotent: boolean;
  destructive: boolean;
  permission?: "crm:send";
  execute: (context: OperationContext, input: unknown) => Promise<unknown>;
}

// Both transports use these definitions and their complete domain schemas.
// MCP removes the organization field from discovery and supplies its immutable grant.
function operation<S extends z.ZodObject>(
  definition: Omit<
    Operation,
    "schema" | "execute" | "idempotent" | "destructive"
  > & {
    schema: S;
    run: (context: OperationContext, input: z.output<S>) => Promise<unknown>;
    idempotent?: boolean;
    destructive?: boolean;
    publish?: boolean;
  },
): Operation {
  return {
    ...definition,
    idempotent: definition.idempotent ?? definition.method === "GET",
    destructive: definition.destructive ?? definition.method !== "GET",
    async execute(context, input) {
      const parsed = definition.schema.parse(input);
      const value = await definition.run(context, parsed);
      if (definition.method !== "GET" && definition.publish !== false) {
        const fields = parsed as { organizationId?: string };
        const output = value as
          | { organizationId?: string; id?: string }
          | undefined;
        const organizationId =
          definition.operation === "workspace"
            ? output?.organizationId
            : definition.operation === "organization"
              ? output?.id
              : fields.organizationId;
        if (organizationId) publishChange(organizationId);
      }
      return value ?? { ok: true };
    },
  };
}
const crm = ({ db }: OperationContext) => new CrmService(db);
const records = ({ db }: OperationContext) => new RecordService(db);
const outreach = ({ db }: OperationContext) => new OutreachService(db);
const integrations = ({ db }: OperationContext) => new IntegrationService(db);
const settings = ({ db }: OperationContext) =>
  new ProviderConfigurationService(db);
const members = ({ db }: OperationContext) => new MemberService(db);
const invitations = ({ db }: OperationContext) => new InvitationService(db);
const nameSchema = z.string().trim().min(1).max(100);
const overviewSchema = scopeSchema.extend({
  days: z.coerce
    .number()
    .refine((value) => [7, 30, 90].includes(value))
    .default(30),
  ownerId: z.string().optional(),
  channel: z.enum(["gmail", "linkedin"]).optional(),
});
export const materialUploadSchema = scopeSchema.extend({
  productId: z.uuid(),
  folderId: z.uuid(),
  stageIds: z.array(z.uuid()).max(100).default([]),
  name: z.string().trim().min(1).max(200),
  mimeType: z.string().min(1).max(100),
  dataBase64: z
    .string()
    .min(1)
    .max(Math.ceil(maxFileSize / 3) * 4),
});
export function materialBytes(value: string) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value)
    throw new DomainError("INVALID_INPUT", 400);
  return new Uint8Array(bytes);
}

export const operations: Operation[] = [
  operation({
    api: "crm",
    method: "GET",
    operation: "permissions",
    name: "get_permission_audit",
    description:
      "Audit effective OAuth permissions, administrator role, product grant and per-operation requirements. Use before configuring products, policies, provider connections, sequences or sending. Owner/product checks are evaluated again on each specific record.",
    schema: scopeSchema,
    run: (c, input) => permissionAudit(c, input.organizationId),
  }),
  operation({
    api: "outreach",
    method: "GET",
    operation: "send-readiness",
    name: "get_send_readiness",
    description:
      "Preview an owned touch or follow-up send: current version, approved draft, recipient, connection and blocking policies. Does not send. Supply exactly one touchId/actionId, current version and your connectionId. Gmail drafts must begin with Subject: followed by a blank line and the body.",
    schema: sendReadinessSchema,
    run: (c, input) => new OutboundService(c.db).readiness(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "GET",
    operation: "delivery",
    name: "get_delivery",
    description:
      "Read your durable delivery receipt/status. Unknown means the provider may have sent it; do not retry with a different idempotency key.",
    schema: deliverySchema,
    run: (c, input) => new OutboundService(c.db).get(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "POST",
    operation: "send-touch",
    name: "send_touch",
    permission: "crm:send",
    idempotent: true,
    description:
      "Actually send the exact approved sequence touch through your Gmail or LinkedIn account. Requires crm:send, current version, due time and contact-policy eligibility. Gmail needs separate gmail.send consent. Reuse the same idempotencyKey for retries; inspect get_delivery after unknown outcomes. Approval/enrollment alone never sends.",
    schema: sendTouchSchema,
    run: (c, input) => new OutboundService(c.db).send(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "POST",
    operation: "send-action",
    name: "send_action",
    permission: "crm:send",
    idempotent: true,
    description:
      "Actually send an owned, approved follow-up/reply using your connected Gmail or LinkedIn account. Requires crm:send and current version; supply the same idempotencyKey on retry. Source conversation ownership, opt-outs and contact policies apply. Gmail draft format: Subject: title, blank line, body.",
    schema: sendActionSchema,
    run: (c, input) => new OutboundService(c.db).send(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "POST",
    operation: "reconcile-delivery",
    name: "reconcile_delivery",
    permission: "crm:send",
    idempotent: true,
    description:
      "Verify a provider receipt for an ambiguous delivery without resending. Gmail searches its unique Message-ID. LinkedIn requires an externalMessageId in the original chat; a missing receipt leaves the outcome unknown, never authorizes a retry.",
    schema: reconcileDeliverySchema,
    run: (c, input) => new OutboundService(c.db).reconcile(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "GET",
    operation: "records",
    name: "list_records",
    description:
      "Page authorized people/clients, companies, relationships, deals, meetings, sequences or materials. Search is applied only to readable records.",
    schema: scopeSchema.extend({
      entity: z.enum([
        "people",
        "companies",
        "relationships",
        "opportunities",
        "meetings",
        "sequences",
        "folders",
        "assets",
      ]),
      query: z.string().trim().max(200).default(""),
      offset: z.coerce.number().int().min(0).max(100000).default(0),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
    run: async (c, input) => {
      const snapshot = await crm(c).snapshot(c.principal, input);
      const term = input.query.toLowerCase();
      const rows = snapshot[input.entity].filter(
        (row) => !term || JSON.stringify(row).toLowerCase().includes(term),
      );
      return {
        items: rows.slice(input.offset, input.offset + input.limit),
        total: rows.length,
        nextOffset:
          input.offset + input.limit < rows.length
            ? input.offset + input.limit
            : null,
        asOf: snapshot.asOf,
      };
    },
  }),
  operation({
    api: "crm",
    method: "GET",
    operation: "sequence",
    name: "get_sequence",
    description:
      "Read a permitted sequence, its ordered steps and current enrollments.",
    schema: scopeSchema.extend({ sequenceId: z.uuid() }),
    run: async (c, input) => {
      const snapshot = await crm(c).snapshot(c.principal, input);
      const sequence = snapshot.sequences.find(
        (row) => row.id === input.sequenceId,
      );
      if (!sequence) throw new DomainError("NOT_FOUND", 404);
      return {
        sequence,
        enrollments: snapshot.enrollments.filter(
          (row) => row.sequenceId === sequence.id,
        ),
      };
    },
  }),
  operation({
    api: "outreach",
    method: "POST",
    operation: "create-sequence",
    name: "create_sequence",
    description:
      "Create a product sequence with ordered steps, delays, channels and templates. This never sends messages.",
    schema: sequenceCreateSchema,
    destructive: false,
    run: (c, input) => outreach(c).createSequence(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "GET",
    operation: "organizations",
    name: "list_organizations",
    description:
      "List accessible organizations. MCP is limited to the organization selected during consent.",
    schema: z.object({}),
    run: (c) => crm(c).organizations(c.principal),
  }),
  operation({
    api: "crm",
    method: "GET",
    operation: "snapshot",
    name: "get_workspace",
    description:
      "Read permitted people, companies, products, relationships, sequences, meetings, materials and versions.",
    schema: scopeSchema,
    run: (c, input) => crm(c).snapshot(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "GET",
    operation: "context",
    name: "get_person_context",
    description:
      "Read a product relationship, permitted conversations, evidence and actions. Missing history is not evidence of no history.",
    schema: scopeSchema.extend({ relationshipId: z.uuid() }),
    run: (c, input) =>
      crm(c).context(c.principal, input.organizationId, input.relationshipId),
  }),
  operation({
    api: "crm",
    method: "GET",
    operation: "person",
    name: "get_person",
    description:
      "Read a person's company and all relationships permitted by this grant.",
    schema: scopeSchema.extend({ personId: z.uuid() }),
    run: (c, input) =>
      crm(c).personContext(c.principal, input.organizationId, input.personId),
  }),
  operation({
    api: "crm",
    method: "GET",
    operation: "company",
    name: "get_company_context",
    description:
      "Read a company and permitted contacts, relationships and work.",
    schema: scopeSchema.extend({ companyId: z.uuid() }),
    run: (c, input) =>
      crm(c).companyContext(c.principal, input, input.companyId),
  }),
  operation({
    api: "crm",
    method: "GET",
    operation: "revision",
    name: "get_workspace_revision",
    description:
      "Read the current authorized workspace revision for instant refresh.",
    schema: scopeSchema,
    run: async (c, input) => ({
      revision: await crm(c).revision(c.principal, input.organizationId),
    }),
  }),
  operation({
    api: "crm",
    method: "GET",
    operation: "overview",
    name: "get_overview",
    description:
      "Read sales/outreach analytics. Currencies stay separate; drafts are not sent messages.",
    schema: overviewSchema,
    run: (c, input) => crm(c).overview(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "GET",
    operation: "messageActivity",
    name: "get_message_activity",
    description:
      "Page synced message activity with product and private conversation restrictions.",
    schema: messageActivitySchema,
    run: (c, input) => crm(c).messageActivity(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "deal",
    name: "save_deal",
    description:
      "Create or update a deal: value, currency, owner, probability, close date, stage, outcome and context. Updates require its current ID/version.",
    schema: opportunitySchema,
    run: (c, input) => crm(c).saveOpportunity(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "pipeline",
    name: "create_pipeline",
    description:
      "Create a product sales pipeline with open/won/lost stages. Requires organization admin access.",
    schema: pipelineSchema,
    destructive: false,
    run: (c, input) => crm(c).createPipeline(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "workspace",
    name: "create_workspace",
    description:
      "Create an organization with its first product and timezone. MCP requires admin/all-products access in its current organization; the new organization needs separate consent.",
    schema: workspaceSchema,
    destructive: false,
    run: (c, input) => crm(c).createWorkspace(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "organization",
    name: "create_organization",
    description:
      "Create an organization owned by the acting user. MCP requires admin/all-products access; this never widens the current grant.",
    schema: z.object({ name: nameSchema }),
    destructive: false,
    run: (c, input) => crm(c).createOrganization(c.principal, input.name),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "product",
    name: "create_product",
    description:
      "Create a product with default stages and material folder. Requires admin membership and an all-products MCP grant.",
    schema: scopeSchema.extend({ name: nameSchema }),
    destructive: false,
    run: (c, input) =>
      crm(c).createProduct(c.principal, input.organizationId, input.name),
  }),
  operation({
    api: "crm",
    method: "GET",
    operation: "members",
    name: "list_members",
    description:
      "List workspace members with name, email, role, active state, explicit product access and counts of owned relationships, open actions and open touches in products you can read.",
    schema: listMembersSchema,
    run: (c, input) => members(c).list(c.principal, input.organizationId),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "member-role",
    name: "change_member_role",
    description:
      "Switch a member between admin and member. The last active admin cannot be demoted. Requires admin membership and an all-products grant.",
    schema: memberRoleSchema,
    run: (c, input) => members(c).changeRole(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "member-products",
    name: "set_member_products",
    description:
      "Replace the products a member can access with the supplied product IDs; an empty list removes all product access. Admins already see every product. Requires admin membership and an all-products grant.",
    schema: memberProductsSchema,
    run: (c, input) => members(c).setProducts(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "member-deactivate",
    name: "deactivate_member",
    description:
      "Deactivate a member. Their relationships, open actions and open touches move in one transaction to reassignToUserId (default: you), approvals on moved touches and actions are cleared, and their assistant grants and sessions for this organization stop working. Actions from their private conversations stay with them. The last active admin cannot be deactivated. Requires admin membership and an all-products grant.",
    schema: deactivateMemberSchema,
    run: (c, input) => members(c).deactivate(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "member-reactivate",
    name: "reactivate_member",
    description:
      "Reactivate a deactivated member. Reassigned work and revoked assistant grants are not restored. Requires admin membership and an all-products grant.",
    schema: reactivateMemberSchema,
    run: (c, input) => members(c).reactivate(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "GET",
    operation: "invitations",
    name: "list_invitations",
    description:
      "List workspace invitations with email, role, products, status and expiry. Tokens are never returned. Requires admin membership and an all-products grant.",
    schema: listInvitationsSchema,
    run: (c, input) => invitations(c).list(c.principal, input.organizationId),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "invitation",
    name: "create_invitation",
    description:
      "Invite an email address as admin or member with optional product access. Expires after expiresInDays (default 7). Returns a one-time accept link to share; the email is also sent when Resend is configured. Deployment and workspace email-domain allowlists apply. Requires admin membership and an all-products grant.",
    schema: createInvitationSchema,
    destructive: false,
    run: (c, input) => invitations(c).create(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "invitation-resend",
    name: "resend_invitation",
    description:
      "Issue a fresh accept link for a pending or expired invitation and send it again. The previous link stops working. Requires admin membership and an all-products grant.",
    schema: resendInvitationSchema,
    run: (c, input) => invitations(c).resend(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "invitation-revoke",
    name: "revoke_invitation",
    description:
      "Revoke a pending invitation so its link can no longer be accepted. Requires admin membership and an all-products grant.",
    schema: revokeInvitationSchema,
    run: (c, input) => invitations(c).revoke(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "invitation-accept",
    name: "accept_invitation",
    description:
      "Accept an invitation with its token as the signed-in person whose verified email matches it. Creates the membership and product access. Assistants cannot accept on a person's behalf.",
    schema: acceptInvitationSchema,
    destructive: false,
    publish: false,
    run: async (c, input) => {
      const accepted = await invitations(c).accept(c.principal, input);
      publishChange(accepted.organizationId);
      return accepted;
    },
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "person",
    name: "create_person",
    description:
      "Create a person/product relationship or add an existing person to a product. Optionally schedule research.",
    schema: personSchema,
    destructive: false,
    run: (c, input) => crm(c).createPerson(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "person-update",
    name: "update_person",
    description:
      "Edit contact fields, company and summary with optimistic version checking. Email/channel edits invalidate affected approvals.",
    schema: personUpdateSchema,
    run: (c, input) => records(c).updatePerson(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "person-archive",
    name: "archive_person",
    description:
      "Archive or restore a person using its current version; archive pauses dependent outreach.",
    schema: personArchiveSchema,
    run: (c, input) => records(c).archivePerson(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "company",
    name: "save_company",
    description:
      "Create or update a company with domain and description. Updates require its current version.",
    schema: companySchema,
    run: (c, input) => records(c).saveCompany(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "company-archive",
    name: "archive_company",
    description: "Archive or restore a company using its current version.",
    schema: companyArchiveSchema,
    run: (c, input) => records(c).archiveCompany(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "meeting",
    name: "save_meeting",
    description:
      "Create or update a scheduled, held or canceled meeting and its summary. Updates require the current version.",
    schema: meetingSchema,
    run: (c, input) => records(c).saveMeeting(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "opportunity",
    name: "create_opportunity",
    description:
      "Create a basic opportunity for a relationship in an authorized sales stage.",
    schema: opportunityCreateSchema,
    destructive: false,
    run: (c, input) => records(c).createOpportunity(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "opportunity-change",
    name: "change_opportunity",
    description:
      "Move or edit an opportunity with its current version. Won/lost dates follow stage outcomes.",
    schema: opportunityChangeSchema,
    run: (c, input) => records(c).changeOpportunity(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "schedule",
    name: "schedule_next_action",
    description:
      "Schedule an assigned follow-up. Scheduling never sends a message.",
    schema: scheduleActionSchema,
    destructive: false,
    run: (c, input) => crm(c).scheduleAction(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "action",
    name: "change_action",
    description:
      "Save, approve, complete or reopen an action with its current version. Editing invalidates approval. No messages are sent.",
    schema: actionChangeSchema,
    run: (c, input) => crm(c).changeAction(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "plan",
    name: "plan_actions",
    description:
      "Atomically update up to 100 action dates, owners or completion states. All versions and product/private access must match.",
    schema: actionPlanSchema,
    run: (c, input) => crm(c).planActions(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "folder",
    name: "create_material_folder",
    description:
      "Create a product material folder, optionally inside another folder in the same product.",
    schema: folderSchema,
    destructive: false,
    run: (c, input) => crm(c).createFolder(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "commitment",
    name: "accept_meeting_commitment",
    description:
      "Accept a held meeting's proposed commitment as an assigned follow-up using its current version.",
    schema: meetingChangeSchema,
    destructive: false,
    idempotent: true,
    run: (c, input) => crm(c).acceptCommitment(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "GET",
    operation: "due",
    name: "list_due_touches",
    description:
      "Read today's due outreach touches, drafts and send-gate warnings in the workspace timezone.",
    schema: scopeSchema,
    run: (c, input) => outreach(c).dueTouches(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "GET",
    operation: "queue",
    name: "get_outreach_queue",
    description:
      "Read outreach enrollments and queue across authorized products.",
    schema: scopeSchema,
    run: (c, input) => outreach(c).queue(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "GET",
    operation: "touch",
    name: "get_touch",
    description:
      "Read an outreach touch, its relationship and permitted conversation context.",
    schema: touchQuerySchema,
    run: (c, input) => outreach(c).touch(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "GET",
    operation: "rules",
    name: "get_contact_rules",
    description: "Read workspace contact cooldown, daily cap and quiet hours.",
    schema: scopeSchema,
    run: (c, input) =>
      outreach(c).contactRules(c.principal, input.organizationId),
  }),
  operation({
    api: "outreach",
    method: "POST",
    operation: "advance",
    name: "advance_sequences",
    description:
      "Plan the next eligible sequence touches. Does not send messages.",
    schema: scopeSchema,
    destructive: false,
    run: (c, input) => outreach(c).advanceEnrollments(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "POST",
    operation: "enroll",
    name: "enroll_in_sequence",
    description:
      "Enroll product relationships in an outreach sequence; dryRun previews eligibility without creating enrollments.",
    schema: enrollSchema,
    destructive: false,
    run: (c, input) => outreach(c).enroll(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "POST",
    operation: "draft",
    name: "edit_touch_draft",
    description:
      "Save an outreach draft using its current version; editing clears prior approval.",
    schema: touchDraftSchema,
    run: (c, input) => outreach(c).editDraft(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "POST",
    operation: "approve",
    name: "approve_touch",
    description:
      "Approve the current draft, recipient and channel with its current version. Approval does not dispatch anything.",
    schema: touchApproveSchema,
    run: (c, input) => outreach(c).approve(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "POST",
    operation: "sent",
    name: "record_touch_sent",
    description:
      "Record a message already sent externally, optionally with its external ID/time. This tool does not send a message.",
    schema: touchSentSchema,
    run: (c, input) => outreach(c).markSent(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "POST",
    operation: "skip",
    name: "skip_touch",
    description: "Skip an outreach touch with a reason and current version.",
    schema: touchSkipSchema,
    run: (c, input) => outreach(c).skip(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "POST",
    operation: "reopen",
    name: "reopen_touch",
    description: "Reopen a skipped touch using its current version.",
    schema: touchReopenSchema,
    run: (c, input) => outreach(c).reopen(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "POST",
    operation: "snooze",
    name: "snooze_touch",
    description:
      "Reschedule an outreach touch to a supplied ISO due time with its current version.",
    schema: touchSnoozeSchema,
    run: (c, input) => outreach(c).snooze(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "POST",
    operation: "enrollment",
    name: "change_enrollment",
    description:
      "Pause, resume or stop an enrollment using its current version.",
    schema: enrollmentChangeSchema,
    run: (c, input) => outreach(c).changeEnrollment(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "POST",
    operation: "relationship",
    name: "change_relationship",
    description:
      "Update outreach stage, priority, next step/date or owner with its current version. A new ownerId must be an active member with access to the product; the relationship's open touches move to the new sender and lose their approval.",
    schema: relationshipChangeSchema,
    run: (c, input) => outreach(c).changeRelationship(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "POST",
    operation: "sequence",
    name: "update_sequence",
    description:
      "Edit a sequence's ordered steps, delays, channels, templates and name using its current version. Pending drafts/approvals are recomputed.",
    schema: sequenceUpdateSchema,
    run: (c, input) => outreach(c).updateSequence(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "POST",
    operation: "rules",
    name: "update_contact_rules",
    description:
      "Update workspace cooldown, daily cap and quiet hours. Requires admin and current version; product-restricted grants cannot change organization-wide rules.",
    schema: contactRulesSchema,
    run: (c, input) => outreach(c).updateContactRules(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "POST",
    operation: "contact",
    name: "set_contact_preferences",
    description:
      "Set do-not-contact and contact timezone with current person version. Respects cross-product visibility.",
    schema: contactPreferencesSchema,
    run: (c, input) => outreach(c).setContactPreferences(c.principal, input),
  }),
  operation({
    api: "integrations",
    method: "GET",
    operation: "overview",
    name: "get_integrations",
    description:
      "Read the acting user's authorized connections and paged import-review items. Provider secrets are never returned.",
    schema: integrationOverviewInput,
    publish: false,
    run: (c, input) => integrations(c).overview(c.principal, input),
  }),
  operation({
    api: "integrations",
    method: "POST",
    operation: "connect",
    name: "connect_integration",
    description:
      "Start an owned Gmail, Calendar or LinkedIn authorization, or configure Fireflies with a supplied key. OAuth returns an authorization URL for the owner to approve; it never bypasses provider consent.",
    schema: connectInput,
    publish: false,
    destructive: false,
    run: (c, input) => integrations(c).connect(c.principal, input),
  }),
  operation({
    api: "integrations",
    method: "POST",
    operation: "sync",
    name: "sync_integration",
    description:
      "Sync a page from the acting user's authorized provider connection. Imported items still require explicit product-context review.",
    schema: integrationScope.extend({ connectionId: z.uuid() }),
    publish: false,
    run: (c, input) =>
      integrations(c).sync(
        c.principal,
        input.organizationId,
        input.connectionId,
      ),
  }),
  operation({
    api: "integrations",
    method: "POST",
    operation: "disconnect",
    name: "disconnect_integration",
    description:
      "Disconnect the acting user's connection, erase stored credentials and cancel pending authorization flows.",
    schema: integrationScope.extend({ connectionId: z.uuid() }),
    publish: false,
    run: (c, input) =>
      integrations(c).disconnect(
        c.principal,
        input.organizationId,
        input.connectionId,
      ),
  }),
  operation({
    api: "integrations",
    method: "POST",
    operation: "link",
    name: "link_import",
    description:
      "Explicitly attach an owned imported conversation/meeting to an authorized product relationship.",
    schema: integrationScope.extend({
      itemId: z.uuid(),
      relationshipId: z.uuid(),
    }),
    run: (c, input) =>
      integrations(c).link(
        c.principal,
        input.organizationId,
        input.itemId,
        input.relationshipId,
      ),
  }),
  operation({
    api: "integrations",
    method: "POST",
    operation: "ignore",
    name: "ignore_import",
    description:
      "Ignore an owned import-review item without attaching it as product context.",
    schema: integrationScope.extend({ itemId: z.uuid() }),
    run: (c, input) =>
      integrations(c).link(c.principal, input.organizationId, input.itemId),
  }),
  operation({
    api: "integrations",
    method: "POST",
    operation: "configure-unipile",
    name: "configure_unipile",
    description:
      "Store the acting user's encrypted Unipile API key/webhook secret. Existing setup requires its configurationId. MCP requires all-products access. Keys are never returned.",
    schema: z.object(unipileSettingsInput.shape),
    publish: false,
    run: (c, input) =>
      settings(c).configure(c.principal, unipileSettingsInput.parse(input)),
  }),
  operation({
    api: "integrations",
    method: "POST",
    operation: "remove-unipile",
    name: "remove_unipile",
    description:
      "Remove the acting user's Unipile setup and disconnect its accounts. MCP requires all-products access.",
    schema: integrationScope.extend({ configurationId: z.uuid() }),
    publish: false,
    run: (c, input) =>
      settings(c).remove(
        c.principal,
        input.organizationId,
        input.configurationId,
      ),
  }),
  operation({
    api: "materials",
    method: "GET",
    operation: "download",
    name: "download_material",
    description:
      "Download an authorized PDF/text/Markdown file as base64 with its metadata. Includes contract PDFs stored as materials; no contract-signature workflow exists.",
    schema: scopeSchema.extend({ assetId: z.uuid() }),
    run: async (c, input) => {
      const { asset, bytes } = await downloadAsset(
        c.db,
        c.principal,
        input.organizationId,
        input.assetId,
      );
      return {
        assetId: asset.id,
        name: asset.name,
        version: asset.version,
        mimeType: asset.mimeType,
        size: bytes.length,
        sha256: asset.sha256,
        dataBase64: Buffer.from(bytes).toString("base64"),
      };
    },
  }),
  operation({
    api: "materials",
    method: "POST",
    operation: "upload",
    name: "upload_material",
    description:
      "Upload a PDF/text/Markdown document as canonical base64 into an authorized product folder, with optional stage associations. Stored as a draft. Maximum decoded size is 10 MiB; hosting request limits also apply.",
    schema: materialUploadSchema,
    destructive: false,
    run: (c, input) =>
      uploadAsset(c.db, c.principal, {
        ...input,
        bytes: materialBytes(input.dataBase64),
      }),
  }),
  operation({
    api: "grants",
    method: "DELETE",
    operation: "revoke",
    name: "revoke_assistant",
    description:
      "Revoke an assistant grant owned by the acting user in the current organization. Revoking this connection invalidates subsequent calls.",
    schema: z.object({
      organizationId: z.uuid().optional(),
      grantId: z.uuid(),
    }),
    run: async (c, input) => {
      const [grant] = await c.db
        .select()
        .from(mcpGrants)
        .where(
          and(
            eq(mcpGrants.id, input.grantId),
            eq(mcpGrants.userId, c.principal.userId),
          ),
        );
      if (!grant) throw new DomainError("NOT_FOUND", 404);
      if (c.principal.source === "mcp")
        await authorize(
          c.db,
          c.principal,
          grant.organizationId,
          undefined,
          true,
        );
      await c.db
        .update(mcpGrants)
        .set({ active: false })
        .where(
          and(
            eq(mcpGrants.id, grant.id),
            eq(mcpGrants.userId, c.principal.userId),
          ),
        );
      publishChange(grant.organizationId);
      return { revoked: true };
    },
    publish: false,
  }),
];

const defaults = {
  crm: "snapshot",
  outreach: "due",
  integrations: "overview",
  materials: "download",
  grants: "revoke",
};
export function apiOperation(
  api: Operation["api"],
  method: Operation["method"],
  name?: unknown,
) {
  const found = operations.find(
    (item) =>
      item.api === api &&
      item.method === method &&
      item.operation === (name ?? defaults[api]),
  );
  if (!found) throw new DomainError("INVALID_INPUT", 400);
  return found;
}
export function operationInput(item: Operation) {
  const { organizationId: _organizationId, ...shape } = item.schema.shape;
  return z.object(shape);
}
const memberAdministration = [
  "change_member_role",
  "set_member_products",
  "deactivate_member",
  "reactivate_member",
  "list_invitations",
  "create_invitation",
  "resend_invitation",
  "revoke_invitation",
];
const adminOperations = new Set([
  "create_workspace",
  "create_organization",
  "create_product",
  "create_pipeline",
  "update_contact_rules",
  ...memberAdministration,
]);
const allProductOperations = new Set([
  "create_workspace",
  "create_organization",
  "create_product",
  "update_contact_rules",
  "configure_unipile",
  "remove_unipile",
  ...memberAdministration,
]);
const humanSessionOperations = new Set(["accept_invitation"]);
const ownerOperations = new Set([
  "get_integrations",
  "connect_integration",
  "sync_integration",
  "disconnect_integration",
  "link_import",
  "ignore_import",
  "configure_unipile",
  "remove_unipile",
  "revoke_assistant",
  "get_delivery",
  "get_send_readiness",
  "send_touch",
  "send_action",
  "reconcile_delivery",
]);
export function operationRequirements(item: Operation) {
  return {
    scopes:
      item.method === "GET"
        ? ["crm:read"]
        : [
            "crm:read",
            "crm:write",
            ...(item.permission ? [item.permission] : []),
          ],
    administrator: adminOperations.has(item.name),
    allProducts: allProductOperations.has(item.name),
    currentAccountOrSourceOwner: ownerOperations.has(item.name),
    humanSession: humanSessionOperations.has(item.name),
    productAuthorization: true,
  };
}
export function operationAvailable(
  item: Operation,
  principal: Principal,
  role: string,
) {
  const requirements = operationRequirements(item);
  return (
    (item.method === "GET" ||
      principal.source === "session" ||
      principal.readOnly === false) &&
    (!item.permission ||
      principal.source === "session" ||
      principal.canSend === true) &&
    (!requirements.administrator || role === "admin") &&
    (!requirements.allProducts || principal.productIds === undefined) &&
    (!requirements.humanSession || principal.source !== "mcp")
  );
}
export async function permissionAudit(
  context: OperationContext,
  organizationId: string,
) {
  const { membership, products } = await authorize(
    context.db,
    context.principal,
    organizationId,
  );
  const writable =
    context.principal.source === "session" ||
    context.principal.readOnly === false;
  const canSend =
    context.principal.source === "session" ||
    (writable && context.principal.canSend === true);
  return {
    organizationId,
    userId: context.principal.userId,
    role: membership.role,
    allProducts: context.principal.productIds === undefined,
    productIds: products.map((product) => product.id),
    permissions: [
      "crm:read",
      ...(writable ? ["crm:write"] : []),
      ...(canSend ? ["crm:send"] : []),
    ],
    providerConsentSeparate: true,
    currentMembershipRequired: true,
    deploymentSecretsExposed: false,
    operations: operations.map((item) => ({
      name: item.name,
      api: `/api/${item.api}`,
      method: item.method,
      operation: item.operation,
      available: operationAvailable(item, context.principal, membership.role),
      requirements: operationRequirements(item),
      description: item.description,
    })),
  };
}
export async function executeMcpOperation(
  item: Operation,
  context: OperationContext,
  organizationId: string,
  input: unknown,
) {
  if (item.permission === "crm:send" && context.principal.canSend !== true)
    throw new DomainError("SEND_PERMISSION_REQUIRED", 403);
  await authorize(
    context.db,
    context.principal,
    organizationId,
    undefined,
    item.method !== "GET",
  );
  const parsed = operationInput(item).parse(input);
  return item.execute(context, {
    ...parsed,
    ...(item.schema.shape.organizationId ? { organizationId } : {}),
  });
}
