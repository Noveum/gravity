import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "../database/client";
import * as s from "../database/schema";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface DraftSubject {
  personId: string;
  name: string;
  title: string;
  email: string | null;
  companyName: string | null;
  linkedinUrl?: string;
}

export async function draftSubject(
  db: Database | Transaction,
  person: Pick<
    typeof s.people.$inferSelect,
    "id" | "organizationId" | "name" | "title" | "email" | "companyId"
  > & { linkedinUrl?: string },
): Promise<DraftSubject> {
  const [company] = person.companyId
    ? await db
        .select({ name: s.companies.name })
        .from(s.companies)
        .where(
          and(
            eq(s.companies.id, person.companyId),
            eq(s.companies.organizationId, person.organizationId),
          ),
        )
    : [];
  return {
    personId: person.id,
    name: person.name,
    title: person.title,
    email: person.email,
    companyName: company?.name ?? null,
    linkedinUrl: person.linkedinUrl ?? "",
  };
}

export function draftHash(
  input: DraftSubject & {
    draft: string;
    channel: string;
    productId: string;
  },
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        draft: input.draft,
        personId: input.personId,
        name: input.name,
        title: input.title,
        email: input.email,
        companyName: input.companyName,
        linkedinUrl: input.linkedinUrl ?? "",
        channel: input.channel,
        productId: input.productId,
      }),
    )
    .digest("hex");
}
