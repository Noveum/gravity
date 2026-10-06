import { z } from "zod";
import {
  ProviderConfigurationService,
  unipileSettingsInput,
} from "../connectors/configuration";
import {
  deliverySchema,
  listDeliveriesSchema,
  OutboundService,
  reconcileDeliverySchema,
  resolveDeliverySchema,
  sendActionSchema,
  sendReadinessSchema,
  sendTouchSchema,
} from "../connectors/outbound";
import {
  connectInput,
  IntegrationService,
  integrationOverviewInput,
  integrationScope,
  updateConnectionInput,
} from "../connectors/service";
import {
  listAssistantGrants,
  listAssistantGrantsSchema,
  revokeAssistantGrant,
  revokeAssistantSchema,
} from "../core/assistant-grants";
import { publishChange } from "../core/changes";
import {
  attributionListSchema,
  ContactAttributionService,
  contactImportSchema,
  importBatchSchema,
} from "../core/contact-attribution";
import {
  actionChangeSchema,
  actionPlanSchema,
  CrmService,
  conversationSharingSchema,
  folderSchema,
  meetingChangeSchema,
  messageActivitySchema,
  opportunitySchema,
  organizationSchema,
  personSchema,
  pipelineSchema,
  scheduleActionSchema,
  scopeSchema,
  workspaceSchema,
} from "../core/crm";
import {
  folderDeleteSchema,
  folderRenameSchema,
  MaterialService,
  materialStatusSchema,
} from "../core/materials";
import {
  listMembersSchema,
  MemberService,
  reactivateMemberSchema,
} from "../core/members";
import {
  acceptInviteSchema,
  inviteSchema,
  memberAccessSchema,
  OrganizationSettingsService,
  organizationScope,
  organizationSettingsSchema,
  removeMemberSchema,
  revokeInviteSchema,
} from "../core/organization-settings";
import {
  contactPreferencesSchema,
  contactRulesSchema,
  enrollmentChangeSchema,
  enrollSchema,
  OutreachService,
  relationshipChangeSchema,
  sequenceArchiveSchema,
  sequenceCreateSchema,
  sequenceRestoreSchema,
  sequenceUpdateSchema,
  touchApproveSchema,
  touchDraftSchema,
  touchQuerySchema,
  touchReopenSchema,
  touchSentSchema,
  touchSkipSchema,
  touchSnoozeSchema,
} from "../core/outreach";
import {
  archiveStageSchema,
  createStageSchema,
  PipelineService,
  reorderStagesSchema,
  updatePipelineSchema,
  updateStageSchema,
} from "../core/pipelines";
import { authorize, DomainError, type Principal } from "../core/policy";
import { productColorKeys } from "../core/product-colors";
import {
  archiveProductSchema,
  ProductService,
  restoreProductSchema,
  updateProductSchema,
} from "../core/products";
import { RecordListService, recordListSchema } from "../core/record-list";
import {
  RecordMetadataService,
  recordMetadataSchema,
} from "../core/record-metadata";
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
import { fileScope } from "../files/scope";
import * as library from "../files/service";
import {
  fileCompleteSchema,
  fileCreateSchema,
  fileListSchema,
  fileTransferSchema,
  fileUpdateSchema,
  fileUploadSchema,
  MAX_UPLOAD_BYTES,
  publicFileTokenSchema,
} from "../files/validators";
import { downloadAsset, maxFileSize, uploadAsset } from "../storage/files";

export interface OperationContext {
  db: Database;
  principal: Principal;
}
export interface Operation {
  name: string;
  api: "crm" | "outreach" | "integrations" | "materials" | "grants" | "files";
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
        const organizationId = ["workspace", "invitation-accept"].includes(
          definition.operation,
        )
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
const products = ({ db }: OperationContext) => new ProductService(db);
const pipelines = ({ db }: OperationContext) => new PipelineService(db);
const materials = ({ db }: OperationContext) => new MaterialService(db);
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
    api: "files",
    method: "GET",
    operation: "list",
    name: "list_files",
    description:
      "List readable folders and files in one product with their current access and ancestors.",
    schema: fileListSchema.extend({
      organizationId: z.uuid(),
      productId: z.uuid(),
    }),
    run: async (c, input) => {
      const scope = await fileScope(c.db, c.principal, input);
      return library.listFiles(c.db, scope.principal, input);
    },
  }),
  operation({
    api: "files",
    method: "GET",
    operation: "detail",
    name: "get_file",
    description:
      "Read an authorized file and Markdown contents, enforcing all ancestors and the current product grant.",
    schema: scopeSchema.extend({ productId: z.uuid(), id: z.uuid() }),
    run: async (c, input) => {
      const scope = await fileScope(c.db, c.principal, input);
      return library.getFile(c.db, scope.principal, input.id);
    },
  }),
  operation({
    api: "files",
    method: "POST",
    operation: "create",
    name: "create_file",
    description:
      "Create a product folder or editable Markdown document with private, product-workspace, public, inherited or specific-member access. Public includes anonymous link access.",
    schema: fileCreateSchema.extend({
      organizationId: z.uuid(),
      productId: z.uuid(),
    }),
    run: async (c, input) =>
      library.createFile(
        await fileScope(c.db, c.principal, input, true),
        input,
      ),
  }),
  operation({
    api: "files",
    method: "POST",
    operation: "update",
    name: "update_file",
    description:
      "Rename or edit Markdown with expectedSyncId. Only the owner can change sharing; recipient membership and product authorization still apply.",
    schema: fileUpdateSchema.extend({
      organizationId: z.uuid(),
      productId: z.uuid(),
      id: z.uuid(),
    }),
    run: async (c, input) =>
      library.updateFile(
        await fileScope(c.db, c.principal, input, true),
        input.id,
        input,
      ),
  }),
  operation({
    api: "files",
    method: "POST",
    operation: "transfer",
    name: "transfer_files",
    description:
      "Atomically move, copy or delete up to 1000 product files and folders. All ancestors apply; moving/deleting requires ownership of every descendant. Copies start private.",
    schema: fileTransferSchema.extend({
      organizationId: z.uuid(),
      productId: z.uuid(),
    }),
    run: async (c, input) =>
      library.transferFiles(
        await fileScope(c.db, c.principal, input, true),
        input,
      ),
  }),
  operation({
    api: "files",
    method: "POST",
    operation: "reserve",
    name: "reserve_file_upload",
    destructive: false,
    description:
      "Reserve a private upload up to 100 MiB. PUT bytes to the returned 10-minute URL, then complete. Large bytes go directly to object storage.",
    schema: fileUploadSchema.extend({
      organizationId: z.uuid(),
      productId: z.uuid(),
    }),
    run: async (c, input) => {
      const scope = await fileScope(c.db, c.principal, input, true);
      return library.startFileUpload(c.db, scope.principal, input);
    },
  }),
  operation({
    api: "files",
    method: "POST",
    operation: "complete",
    name: "complete_file_upload",
    description:
      "Seal an owned upload into an immutable file after size verification. Rechecks destination access and expiration.",
    schema: fileCompleteSchema.extend({
      organizationId: z.uuid(),
      productId: z.uuid(),
    }),
    run: async (c, input) =>
      library.completeFileUpload(
        await fileScope(c.db, c.principal, input, true),
        input,
      ),
  }),
  operation({
    api: "files",
    method: "POST",
    operation: "upload-bytes",
    name: "put_local_file_upload",
    publish: false,
    description:
      "Local demo transport for an owned upload. Disabled in production; production uses the reservation signed PUT URL.",
    schema: scopeSchema.extend({
      productId: z.uuid(),
      uploadId: z.uuid(),
      dataBase64: z.string().max(Math.ceil(MAX_UPLOAD_BYTES / 3) * 4),
    }),
    run: async (c, input) =>
      library.putLocalUpload(
        await fileScope(c.db, c.principal, input, true),
        input.uploadId,
        materialBytes(input.dataBase64),
      ),
  }),
  operation({
    api: "files",
    method: "GET",
    operation: "download",
    name: "download_file",
    description:
      "Authorize and return a short-lived private download URL or Markdown content. Previously issued URLs expire in 60 seconds.",
    schema: scopeSchema.extend({
      productId: z.uuid(),
      id: z.uuid(),
      preview: z.enum(["true", "false"]).default("false"),
    }),
    run: async (c, input) => {
      const scope = await fileScope(c.db, c.principal, input);
      return library.fileDownload(
        c.db,
        scope.principal,
        input.id,
        input.preview === "true",
      );
    },
  }),
  operation({
    api: "files",
    method: "GET",
    operation: "public",
    name: "get_public_file",
    description:
      "Read a deliberately published document or folder by its unguessable public token. Every ancestor must permit anonymous access.",
    schema: z.object({ token: publicFileTokenSchema }),
    run: (c, input) => library.getPublicFile(c.db, input.token),
  }),
  operation({
    api: "files",
    method: "GET",
    operation: "public-download",
    name: "download_public_file",
    description:
      "Download a deliberately public document by token, with current anonymous access checked again.",
    schema: z.object({
      token: publicFileTokenSchema,
      preview: z.enum(["true", "false"]).default("false"),
    }),
    run: (c, input) =>
      library.fileDownload(c.db, null, input.token, input.preview === "true"),
  }),

  operation({
    api: "crm",
    method: "POST",
    operation: "invitation-preview",
    name: "preview_invitation",
    description:
      "Preview the workspace and product access in an invitation as its verified recipient, without accepting it. The token travels in the request body, never in a URL. A recipient who is already an active member gets alreadyMember true. Requires a human session, never an MCP grant.",
    schema: acceptInviteSchema,
    destructive: false,
    publish: false,
    run: (c, input) =>
      new OrganizationSettingsService(c.db).preview(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "member-remove",
    name: "remove_member",
    description:
      "Deactivate a workspace membership. Their relationships, open actions and open touches move in one transaction to reassignToUserId (default: you), approvals on moved touches and actions are cleared, their assistant grants for this organization stop working, and invitations they sent that are still pending are revoked. Actions from their private conversations stay with them. The last administrator cannot be removed. Historical records are preserved. Requires admin and all-products access. Assistants may remove members.",
    schema: removeMemberSchema,
    run: (c, input) =>
      new OrganizationSettingsService(c.db).removeMember(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "GET",
    operation: "invitations",
    name: "list_invitations",
    description:
      "List pending workspace invitations with email, role, products and expiry. Tokens are never returned. Requires admin and all-products access; a read-only grant may list.",
    schema: organizationScope,
    run: (c, input) =>
      new OrganizationSettingsService(c.db).invitations(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "invitation",
    name: "create_invitation",
    description:
      "Create a 14-day invitation for a verified email with explicit role and active product access, replacing any open invitation for that email. Returns acceptUrl, a one-time /invite#TOKEN link to share, and emailStatus: the email is sent when Resend is configured. Deployment and workspace email-domain allowlists apply. Requires admin and all-products access and a signed-in person: granting access is human-only, so assistants get HUMAN_ACTION_REQUIRED.",
    schema: inviteSchema,
    run: (c, input) =>
      new OrganizationSettingsService(c.db).invite(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "invitation-revoke",
    name: "revoke_invitation",
    description:
      "Revoke a pending invitation so its link can no longer be accepted. Idempotent. Requires admin and all-products access. Assistants may revoke invitations.",
    schema: revokeInviteSchema,
    run: (c, input) =>
      new OrganizationSettingsService(c.db).revoke(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "invitation-accept",
    name: "accept_invitation",
    description:
      "Accept an invitation as its verified recipient. Grants the invited role and the invited products that are still active. Requires a human session, never an MCP grant.",
    schema: acceptInviteSchema,
    run: (c, input) =>
      new OrganizationSettingsService(c.db).accept(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "member-access",
    name: "update_member_access",
    description:
      "Change an active workspace member role and product access. Requires admin and all-products access; the last administrator cannot be demoted. Assistants may demote a member or remove product access; a call that promotes to admin or adds any product grants access and returns HUMAN_ACTION_REQUIRED as a whole.",
    schema: memberAccessSchema,
    run: (c, input) =>
      new OrganizationSettingsService(c.db).updateMember(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "organization-settings",
    name: "update_organization",
    description:
      "Change any of the organization name, IANA time zone, URL slug (unique, lowercase letters, digits and single hyphens) or email domain allowlist (lowercased and deduplicated; empty means no workspace restriction). Supply at least one. Requires admin and all-products access. The time zone sets quiet hours, so assistants changing it get HUMAN_ACTION_REQUIRED.",
    schema: organizationSettingsSchema,
    run: (c, input) =>
      new OrganizationSettingsService(c.db).updateOrganization(
        c.principal,
        input,
      ),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "record-metadata",
    name: "update_record_metadata",
    description:
      "Set custom tags and amountMinor/currency on a permitted person, company, relationship or opportunity using its current version. amountMinor uses ISO minor units (USD cents, JPY whole yen, KWD thousandths); null is unknown, zero is recorded. Person/company/relationship amounts are estimates excluded from revenue forecasts. Use save_deal for opportunity probability, close date and other deal fields.",
    schema: recordMetadataSchema,
    run: (c, input) => new RecordMetadataService(c.db).save(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "conversation-sharing",
    name: "set_conversation_visibility",
    description:
      "Explicitly share one of your imported threads with authorized members of its product, or make it private again. Sharing includes past and future messages in that thread; it never shares credentials, unrelated threads or sending access. Get conversationId and expectedVisibility from get_person_context, explain the scope to the user and apply their sharing preference. Only the conversation owner can change visibility, including when an administrator makes the request.",
    schema: conversationSharingSchema,
    run: (c, input) => crm(c).shareConversation(c.principal, input),
  }),
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
    method: "GET",
    operation: "deliveries",
    name: "list_deliveries",
    description:
      "List unresolved deliveries (sending, unknown or accepted) in products you can read. You see your own; an admin with an all-products grant sees everyone's. canReconcile marks your own settled deliveries for reconcile_delivery; canResolve marks those a human admin may close with resolve_delivery. Never resend an unknown delivery with a new idempotency key.",
    schema: listDeliveriesSchema,
    run: (c, input) => new OutboundService(c.db).list(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "POST",
    operation: "send-touch",
    name: "send_touch",
    permission: "crm:send",
    idempotent: true,
    description:
      "Actually send the exact approved sequence touch through your Gmail or LinkedIn account. Requires crm:send, current version, due time and contact-policy eligibility. Refused with DO_NOT_CONTACT when the person, or anyone in the organization sharing their email or LinkedIn profile, is do-not-contact, and with PRODUCT_ARCHIVED or SEQUENCE_ARCHIVED for archived work. Gmail needs separate gmail.send consent. Reuse the same idempotencyKey for retries; inspect get_delivery after unknown outcomes. Approval/enrollment alone never sends.",
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
      "Actually send an owned, approved reply, approval or commitment action owed by us through your connected Gmail or LinkedIn account. Review/research tasks and actions owed by them/unknown cannot send. Schedule a separate reply action after reviewing the history. Requires crm:send and current version; supply the same idempotencyKey on retry. Source conversation ownership, opt-outs (including anyone sharing the person's email or LinkedIn profile) and contact policies apply; an archived product refuses with PRODUCT_ARCHIVED. Gmail draft format: Subject: title, blank line, body.",
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
    api: "outreach",
    method: "POST",
    operation: "resolve-delivery",
    name: "resolve_delivery",
    idempotent: false,
    description:
      "Close a stuck delivery that is unknown, or abandoned while sending or accepted, as sent or failed with a reason. This never contacts the provider. Marking it failed lets the sender try again, so confirm first that nothing went out; a delivery the provider accepted (status accepted or a provider message ID) can only be resolved as sent, and failed returns DELIVERY_PROVIDER_ACCEPTED. Requires a human admin session and confirm=true; deliveries still inside the live sending window are refused.",
    schema: resolveDeliverySchema,
    run: (c, input) => new OutboundService(c.db).resolve(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "GET",
    operation: "records",
    name: "list_records",
    description:
      "Page authorized people/clients, companies, relationships, deals, meetings, sequences or materials. Search is applied only to readable records.",
    schema: recordListSchema,
    run: (c, input) => new RecordListService(c.db).page(c.principal, input),
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
    api: "outreach",
    method: "POST",
    operation: "sequence-archive",
    name: "archive_sequence",
    description:
      "Archive a sequence with its current version. Its running enrollments pause with reason manual, it refuses new enrollments and paused enrollments cannot resume until it is restored. Steps, history and enrollments are kept. Requires write access to the sequence's product.",
    schema: sequenceArchiveSchema,
    run: (c, input) => outreach(c).archiveSequence(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "POST",
    operation: "sequence-restore",
    name: "restore_sequence",
    description:
      "Restore an archived sequence with its current version so it accepts enrollments again. Paused enrollments stay paused until resumed. Requires write access to the sequence's product.",
    schema: sequenceRestoreSchema,
    run: (c, input) => outreach(c).restoreSequence(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "GET",
    operation: "organizations",
    name: "list_organizations",
    description:
      "List accessible organizations with name, slug, time zone and email domain allowlist. MCP is limited to the organization selected during consent.",
    schema: z.object({}),
    run: (c) => crm(c).organizations(c.principal),
  }),
  operation({
    api: "crm",
    method: "GET",
    operation: "snapshot",
    name: "get_workspace",
    description:
      'Read permitted workspace records, products, stages, sequences and versions. For large workspaces use compact="true" (a string) to omit long notes, context/source details and action draft bodies, then fetch get_person_context/get_company_context for the specific record. Use list_records for paginated browsing. compact="false" returns full prose and can be very large; omitted/empty compact fields are not evidence of absent history.',
    schema: scopeSchema.extend({
      compact: z.enum(["true", "false"]).default("false"),
    }),
    run: (c, input) =>
      crm(c).snapshot(c.principal, input, input.compact === "true"),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "import-batch",
    name: "create_contact_import_batch",
    idempotent: true,
    destructive: false,
    description:
      "Create an immutable contact import batch. submittedBy, transport and MCP client/grant are server assigned. sourceMemberId is an explicitly declared source member, not the uploader. Use a stable submissionKey for retries; changed metadata conflicts. Source member must currently access this product. No file contents or credentials in label/key.",
    schema: importBatchSchema,
    run: (c, input) =>
      new ContactAttributionService(c.db).createBatch(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "contact-import",
    name: "record_contact_import",
    idempotent: true,
    destructive: false,
    description:
      "Append reviewed import provenance to an existing contact with a relationship in this product, without changing original creator or owner. Requires current person version, your own batchId and stable sourceRecordId. Exact retries are idempotent; changing the source row's target conflicts. For new contacts pass importSource to create_person. Never infer the historical importer from ownership.",
    schema: contactImportSchema,
    run: (c, input) =>
      new ContactAttributionService(c.db).recordImport(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "GET",
    operation: "contact-attribution",
    name: "get_contact_attribution",
    description:
      "Page recorded creator, submitters, declared source members, edit history and owner-private provider import metadata. Unknown historical attribution remains null; owners are separate from contributors. Names remain readable for inactive members. Never exposes private transcript bodies or another member's provider metadata.",
    schema: attributionListSchema,
    run: (c, input) =>
      new ContactAttributionService(c.db).list(c.principal, input),
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
      "Create or update a deal: amountMinor, currency, owner, probability, expectedCloseDate, stage, outcome and context. amountMinor uses ISO minor units (USD cents, JPY whole yen, KWD thousandths). Unknown amount/probability is null; zero is valid. Probability is an integer percentage 0-100. Open deals with both fields contribute amount times probability to forecasts, separately by currency. Do not infer amounts from contact estimates or company revenue. Updates require its current ID/version.",
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
      "Create an organization owned by the acting user, with an IANA time zone (default UTC). MCP requires admin/all-products access; this never widens the current grant.",
    schema: organizationSchema,
    destructive: false,
    run: (c, input) =>
      crm(c).createOrganization(c.principal, input.name, input.timezone),
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
    method: "POST",
    operation: "product-update",
    name: "update_product",
    description: `Rename or recolour a product. colorKey is one of ${productColorKeys.join(", ")}. Requires admin membership and access to the product.`,
    schema: updateProductSchema,
    run: (c, input) => products(c).update(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "product-archive",
    name: "archive_product",
    description:
      "Archive a product: it leaves switchers, filters and new-record forms, its running sequence enrollments pause with reason manual, and its records are kept. The last active product cannot be archived. Requires admin membership and an all-products grant.",
    schema: archiveProductSchema,
    run: (c, input) => products(c).archive(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "product-restore",
    name: "restore_product",
    description:
      "Restore an archived product. Paused enrollments stay paused until resumed. Requires admin membership and an all-products grant.",
    schema: restoreProductSchema,
    run: (c, input) => products(c).restore(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "stage",
    name: "create_stage",
    description:
      "Add a stage at the end of a deal pipeline (pipeline deal with pipelineId) or a product's outreach pipeline (pipeline outreach). Category is open, won, lost or hold; deal stages cannot be hold. Requires admin membership and access to the product.",
    schema: createStageSchema,
    destructive: false,
    run: (c, input) => pipelines(c).createStage(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "stage-update",
    name: "update_stage",
    description:
      "Rename a stage or change its category. Changing a deal stage's category moves its deals to the matching outcome. Every pipeline keeps at least one open stage. Requires admin membership and access to the product.",
    schema: updateStageSchema,
    run: (c, input) => pipelines(c).updateStage(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "stage-order",
    name: "reorder_stages",
    description:
      "Set the order of a pipeline's stages. stageIds must list every active stage of that pipeline exactly once. Requires admin membership and access to the product.",
    schema: reorderStagesSchema,
    idempotent: true,
    run: (c, input) => pipelines(c).reorderStages(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "stage-archive",
    name: "archive_stage",
    description:
      "Archive a stage and move its deals or outreach relationships, and its material links, to moveToStageId in the same pipeline in one transaction. Every pipeline keeps at least one open stage. Requires admin membership and access to the product.",
    schema: archiveStageSchema,
    run: (c, input) => pipelines(c).archiveStage(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "pipeline-update",
    name: "update_pipeline",
    description:
      "Rename a deal pipeline. Names are unique per product. Requires admin membership and access to the product.",
    schema: updatePipelineSchema,
    run: (c, input) => pipelines(c).updatePipeline(c.principal, input),
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
    operation: "member-reactivate",
    name: "reactivate_member",
    description:
      "Reactivate a deactivated member. Reassigned work and revoked assistant grants are not restored. Requires admin membership, an all-products grant and a signed-in person: granting access is human-only, so assistants get HUMAN_ACTION_REQUIRED.",
    schema: reactivateMemberSchema,
    run: (c, input) => members(c).reactivate(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "person",
    name: "create_person",
    description:
      "Create a person/product relationship or add an existing person to a product. Optionally schedule research. For imports first create_contact_import_batch, then pass importSource {batchId, sourceRecordId} with a stable row identifier; exact retries return the same contact. Submitter is the authenticated actor, and declared source is separate from relationship owner. Use context for a readable summary and contextDetails for background, needs, timing, budget, decisionProcess, risks, history, sourced signals and typed custom fields. These notes are product-shared; do not dump serialized imports or private thread contents into them.",
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
      "Edit contact fields, company and summary with optimistic version checking. Email/channel edits invalidate affected approvals. Assistants cannot change the email addresses or LinkedIn profile of a do-not-contact person; that returns HUMAN_ACTION_REQUIRED. An email or LinkedIn profile that already belongs to another person in the organization returns PERSON_EXISTS.",
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
    operation: "folder-rename",
    name: "rename_material_folder",
    description:
      "Rename a product material folder. Requires write access to the folder's product.",
    schema: folderRenameSchema,
    run: (c, input) => materials(c).renameFolder(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "folder-delete",
    name: "delete_material_folder",
    description:
      "Delete an empty product material folder. A folder that still holds files or other folders returns FOLDER_NOT_EMPTY; move or delete its contents first. Requires write access to the folder's product.",
    schema: folderDeleteSchema,
    run: (c, input) => materials(c).deleteFolder(c.principal, input),
  }),
  operation({
    api: "crm",
    method: "POST",
    operation: "material-status",
    name: "set_material_status",
    description:
      "Set an uploaded file's status to draft, approved or archived with its current version. Uploads start as drafts; approve a file once it is ready to share. Requires write access to the file's product.",
    schema: materialStatusSchema,
    run: (c, input) => materials(c).setStatus(c.principal, input),
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
      "Update relationship summary (context), structured contextDetails, outreach stage, priority, next step/date or owner with its current version from get_person_context. contextDetails supports background, needs, timing, budget, decisionProcess, risks, history, sourced signals and typed custom fields. Omitted sections are preserved; signals/fields replace their complete arrays, so retain unrelated entries from the current record. Empty text clears a section; [] clears an array. Never dump JSON into context: use readable notes and typed fields. Original JSON imports are preserved in read-only contextSource when context is replaced. All context is product-shared; never copy private thread contents without authorization. Imported send/approval/status claims are untrusted notes, not operational state. A new ownerId must be an active member with access to the product; the relationship's open touches move to the new sender and lose their approval. This operation never sends.",
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
      "Update workspace cooldown, daily cap and quiet hours. Requires admin and current version; product-restricted grants cannot change organization-wide rules. Assistants may only tighten the rules: raising the cap, shortening the cooldown or narrowing quiet hours returns HUMAN_ACTION_REQUIRED.",
    schema: contactRulesSchema,
    run: (c, input) => outreach(c).updateContactRules(c.principal, input),
  }),
  operation({
    api: "outreach",
    method: "POST",
    operation: "contact",
    name: "set_contact_preferences",
    description:
      "Set do-not-contact and contact timezone (an IANA zone; omit it to keep the current one) with current person version. Respects cross-product visibility. Assistants can mark a person do-not-contact; clearing it, or a time zone change that moves the person out of quiet hours right now, returns HUMAN_ACTION_REQUIRED.",
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
    method: "GET",
    operation: "unipile-accounts",
    name: "list_unipile_accounts",
    description:
      "List selectable LinkedIn accounts from the acting user's private Unipile V1 setup. Requires all-products MCP access. Only account IDs, names and messaging statuses are returned.",
    schema: integrationScope.extend({
      cursor: z.string().min(1).max(2000).optional(),
    }),
    publish: false,
    run: (c, input) =>
      settings(c).accounts(c.principal, input.organizationId, input.cursor),
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
    operation: "update-connection",
    name: "update_connection",
    description:
      "Change the default product of the acting user's own connection without new provider consent. Future imports file into that product; existing review items keep theirs. The new product must be active and writable by you; access to the old product is not required.",
    schema: updateConnectionInput,
    publish: false,
    run: (c, input) => integrations(c).updateConnection(c.principal, input),
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
      "Store the acting user's encrypted Unipile credentials. V1 requires apiVersion=v1 and a DSN; V2 uses the fixed API origin. Existing setup requires its configurationId. MCP requires all-products access. Keys are never returned.",
    schema: z.object(unipileSettingsInput.shape),
    publish: false,
    run: (c, input) =>
      settings(c).configure(c.principal, unipileSettingsInput.parse(input)),
  }),
  operation({
    api: "integrations",
    method: "POST",
    operation: "register-unipile-webhooks",
    name: "register_unipile_webhooks",
    description:
      "Register private, account-scoped Unipile V1 messaging and status webhooks using the acting owner's saved API key. Generates an encrypted webhook token and reuses matching registrations on retry. Requires an owned connected account and all-products MCP access. Never sends LinkedIn messages.",
    schema: integrationScope.extend({ connectionId: z.uuid() }),
    publish: false,
    run: (c, input) =>
      settings(c).registerWebhooks(
        c.principal,
        input.organizationId,
        input.connectionId,
      ),
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
    api: "crm",
    method: "GET",
    operation: "assistant-grants",
    name: "list_assistant_grants",
    description:
      "List every active assistant grant in the workspace with its member's name and email, product scope and creation time. Requires admin membership and an all-products grant.",
    schema: listAssistantGrantsSchema,
    run: (c, input) =>
      listAssistantGrants(c.db, c.principal, input.organizationId),
  }),
  operation({
    api: "grants",
    method: "DELETE",
    operation: "revoke",
    name: "revoke_assistant",
    description:
      "Revoke an assistant grant. You may revoke your own grant; a workspace admin signed in to Gravity may also revoke a teammate's grant. Revoking this connection invalidates subsequent calls.",
    schema: revokeAssistantSchema,
    run: (c, input) => revokeAssistantGrant(c.db, c.principal, input),
    publish: false,
  }),
];

const defaults = {
  crm: "snapshot",
  outreach: "due",
  integrations: "overview",
  materials: "download",
  files: "list",
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
  "update_member_access",
  "remove_member",
  "reactivate_member",
  "list_invitations",
  "create_invitation",
  "revoke_invitation",
];
const productAdministration = [
  "update_product",
  "create_stage",
  "update_stage",
  "reorder_stages",
  "archive_stage",
  "update_pipeline",
];
const workspaceAdministration = [
  "update_organization",
  "archive_product",
  "restore_product",
];
const adminOperations = new Set([
  "list_assistant_grants",
  "resolve_delivery",
  "create_workspace",
  "create_organization",
  "create_product",
  "create_pipeline",
  "update_contact_rules",
  ...memberAdministration,
  ...productAdministration,
  ...workspaceAdministration,
]);
const allProductOperations = new Set([
  "list_assistant_grants",
  "resolve_delivery",
  "create_workspace",
  "create_organization",
  "create_product",
  "update_contact_rules",
  ...workspaceAdministration,
  "configure_unipile",
  "remove_unipile",
  "list_unipile_accounts",
  "register_unipile_webhooks",
  ...memberAdministration,
]);
const humanSessionOperations = new Set([
  "preview_invitation",
  "accept_invitation",
  "resolve_delivery",
  "create_invitation",
  "reactivate_member",
]);
const ownerOperations = new Set([
  "list_unipile_accounts",
  "register_unipile_webhooks",
  "set_conversation_visibility",
  "get_integrations",
  "connect_integration",
  "sync_integration",
  "disconnect_integration",
  "update_connection",
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
