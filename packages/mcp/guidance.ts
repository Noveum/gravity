import { z } from "zod";
import { authorize, type Principal } from "../core/policy";
import type { Database } from "../database/client";
import t from "../i18n/translations/en.json";
import {
  operationAvailable,
  operationRequirements,
  operations,
} from "../operations/catalog";

export const guideTopics = [
  "getting-started",
  "sequences",
  "sending",
  "connections",
  "records",
  "imports",
  "files",
  "troubleshooting",
] as const;
export type GuideTopic = (typeof guideTopics)[number];
export const agentGuideOutputSchema = z.object({
  topic: z.enum(guideTopics),
  title: z.string(),
  summary: z.string(),
  steps: z.array(z.string()),
  topics: z.array(
    z.object({
      topic: z.enum(guideTopics),
      title: z.string(),
      uri: z.string(),
    }),
  ),
  tools: z.array(
    z.object({
      name: z.string(),
      available: z.boolean(),
      requirements: z
        .object({
          scopes: z.array(z.string()),
          administrator: z.boolean(),
          allProducts: z.boolean(),
          currentAccountOrSourceOwner: z.boolean(),
          humanSession: z.boolean(),
          productAuthorization: z.boolean(),
        })
        .optional(),
    }),
  ),
  permissionNote: z.string(),
});

// Business tools remain registered from the operation catalog. These references
// connect that catalog to task guidance without adding another execution path.
export const guideTools: Record<GuideTopic, readonly string[]> = {
  "getting-started": [
    "get_me",
    "list_products",
    "get_capabilities",
    "list_records",
    "get_permission_audit",
  ],
  sequences: [
    "list_records",
    "get_sequence",
    "get_contact_rules",
    "get_person_context",
    "create_sequence",
    "update_sequence",
    "enroll_in_sequence",
    "advance_sequences",
    "get_outreach_queue",
    "get_touch",
    "edit_touch_draft",
    "approve_touch",
    "change_enrollment",
  ],
  sending: [
    "get_me",
    "get_person_context",
    "get_touch",
    "list_records",
    "get_integrations",
    "edit_touch_draft",
    "approve_touch",
    "change_action",
    "get_send_readiness",
    "send_touch",
    "send_action",
    "get_delivery",
    "list_deliveries",
    "reconcile_delivery",
  ],
  connections: [
    "get_integrations",
    "connect_integration",
    "sync_integration",
    "link_import",
    "ignore_import",
    "update_connection",
    "disconnect_integration",
  ],
  records: [
    "list_records",
    "get_person_context",
    "get_company_context",
    "update_person",
    "change_relationship",
    "update_record_metadata",
    "save_deal",
    "get_overview",
  ],
  imports: [
    "create_contact_import_batch",
    "create_person",
    "record_contact_import",
    "get_contact_attribution",
    "ingest_history",
    "list_message_history",
    "ingest_draft",
    "list_native_drafts",
    "edit_native_draft",
    "schedule_native_draft",
  ],
  files: [
    "list_files",
    "get_file",
    "download_file",
    "create_file",
    "update_file",
    "reserve_file_upload",
    "complete_file_upload",
    "transfer_files",
    "list_materials",
    "read_material",
    "download_material",
    "upload_material",
  ],
  troubleshooting: [
    "get_me",
    "get_capabilities",
    "get_permission_audit",
    "get_integrations",
    "get_delivery",
    "list_deliveries",
    "reconcile_delivery",
  ],
};

export function guideText(topic: GuideTopic) {
  const guide = t.mcpWorkflowGuides[topic];
  return `${guide.title}\n${guide.summary}\n\n${guide.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`;
}

export async function agentGuide(
  db: Database,
  principal: Principal,
  organizationId: string,
  topic: GuideTopic,
) {
  const { membership } = await authorize(db, principal, organizationId);
  return {
    topic,
    ...t.mcpWorkflowGuides[topic],
    topics: guideTopics.map((name) => ({
      topic: name,
      title: t.mcpWorkflowGuides[name].title,
      uri: `gravity://guides/${name}`,
    })),
    tools: guideTools[topic].map((name) => {
      const operation = operations.find((item) => item.name === name);
      return operation
        ? {
            name,
            available: operationAvailable(
              operation,
              principal,
              membership.role,
            ),
            requirements: operationRequirements(operation),
          }
        : { name, available: true };
    }),
    permissionNote: t.mcpGuidePermissionNote,
  };
}
