import { z } from "zod";
export const integrationProvider = z.enum([
  "gmail",
  "calendar",
  "linkedin",
  "fireflies",
]);
export type IntegrationProvider = z.infer<typeof integrationProvider>;
export const importRecordSchema = z.object({
  externalId: z.string().min(1).max(1000),
  threadId: z.string().max(1000).optional(),
  kind: z.enum(["message", "meeting"]),
  title: z.string().max(1000),
  body: z.string().max(100000),
  occurredAt: z.iso.datetime(),
  participants: z.array(z.string().max(500)).max(100),
  direction: z.enum(["inbound", "outbound"]).optional(),
  from: z.string().trim().max(320).optional(),
  canceled: z.boolean().optional(),
  proposedCommitment: z.string().max(20000).optional(),
});
export type ImportRecord = z.infer<typeof importRecordSchema>;
export interface ProviderPage {
  records: ImportRecord[];
  cursor: Record<string, unknown>;
  more: boolean;
}
export interface ProviderCredentials {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  apiKey?: string;
  apiVersion?: "v1" | "v2";
  dsn?: string;
}
