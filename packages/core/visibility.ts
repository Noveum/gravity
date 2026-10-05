import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { DomainError, type Principal } from "./policy";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Transaction;

export async function personVisible(
  db: Reader,
  productIds: string[],
  organizationId: string,
  personId: string,
) {
  if (!productIds.length) return false;
  const [visible] = await db
    .select({ id: s.relationships.id })
    .from(s.relationships)
    .where(
      and(
        eq(s.relationships.organizationId, organizationId),
        eq(s.relationships.personId, personId),
        inArray(s.relationships.productId, productIds),
      ),
    )
    .limit(1);
  return !!visible;
}

export async function companyVisible(
  db: Reader,
  productIds: string[],
  organizationId: string,
  companyId: string,
) {
  const people = await db
    .select({ id: s.people.id, archivedAt: s.people.archivedAt })
    .from(s.people)
    .where(
      and(
        eq(s.people.organizationId, organizationId),
        eq(s.people.companyId, companyId),
      ),
    );
  if (!people.length) return true;
  if (!productIds.length) return false;
  const active = people.filter((person) => !person.archivedAt);
  const deciding = active.length ? active : people;
  const [visible] = await db
    .select({ id: s.relationships.id })
    .from(s.relationships)
    .where(
      and(
        eq(s.relationships.organizationId, organizationId),
        inArray(
          s.relationships.personId,
          deciding.map((person) => person.id),
        ),
        inArray(s.relationships.productId, productIds),
      ),
    )
    .limit(1);
  return !!visible;
}

export async function lockOrganization(db: Reader, organizationId: string) {
  await db
    .select({ id: s.organizations.id })
    .from(s.organizations)
    .where(eq(s.organizations.id, organizationId))
    .for("update");
}

export async function emailTaken(
  db: Reader,
  organizationId: string,
  emails: readonly string[],
  exceptPersonId?: string,
) {
  const lowered = [...new Set(emails.map((email) => email.toLowerCase()))];
  if (!lowered.length) return false;
  const conditions: SQL[] = [
    eq(s.people.organizationId, organizationId),
    or(
      inArray(sql`lower(${s.people.email})`, lowered),
      sql`${s.people.otherEmails} ?| array[${sql.join(
        lowered.map((email) => sql`${email}`),
        sql`, `,
      )}]::text[]`,
    ) as SQL,
  ];
  if (exceptPersonId) conditions.push(ne(s.people.id, exceptPersonId));
  const [taken] = await db
    .select({ id: s.people.id })
    .from(s.people)
    .where(and(...conditions))
    .limit(1);
  return !!taken;
}

export async function clearApprovals(
  db: Reader,
  principal: Principal,
  organizationId: string,
  personId: string,
) {
  const relationships = await db
    .select({ id: s.relationships.id })
    .from(s.relationships)
    .where(
      and(
        eq(s.relationships.organizationId, organizationId),
        eq(s.relationships.personId, personId),
      ),
    );
  if (!relationships.length) return;
  const cleared = await db
    .update(s.actions)
    .set({
      approvedHash: null,
      approvedBy: null,
      version: sql`${s.actions.version} + 1`,
    })
    .where(
      and(
        eq(s.actions.organizationId, organizationId),
        inArray(
          s.actions.relationshipId,
          relationships.map((relationship) => relationship.id),
        ),
        inArray(s.actions.status, ["open", "blocked"]),
        isNotNull(s.actions.approvedHash),
      ),
    )
    .returning();
  if (cleared.length)
    await db.insert(s.changeEvents).values(
      cleared.map((action) => ({
        organizationId: action.organizationId,
        productId: action.productId,
        sourceConversationId: action.sourceConversationId,
        actorId: principal.userId,
        type: "action.approval_invalidated",
        entityId: action.id,
      })),
    );
}

export async function assertActiveRelationships(
  db: Reader,
  organizationId: string,
  relationshipIds: readonly string[],
) {
  if (!relationshipIds.length) return;
  const people = await db
    .select({ archivedAt: s.people.archivedAt })
    .from(s.relationships)
    .innerJoin(
      s.people,
      and(
        eq(s.people.id, s.relationships.personId),
        eq(s.people.organizationId, s.relationships.organizationId),
      ),
    )
    .where(
      and(
        eq(s.relationships.organizationId, organizationId),
        inArray(s.relationships.id, [...new Set(relationshipIds)]),
      ),
    )
    .for("share", { of: s.people });
  if (people.some((person) => person.archivedAt))
    throw new DomainError("RECORD_ARCHIVED", 409);
}

export async function activeCompany(
  db: Reader,
  productIds: string[],
  organizationId: string,
  companyId: string,
) {
  const [company] = await db
    .select()
    .from(s.companies)
    .where(
      and(
        eq(s.companies.id, companyId),
        eq(s.companies.organizationId, organizationId),
        isNull(s.companies.archivedAt),
      ),
    );
  if (
    !company ||
    !(await companyVisible(db, productIds, organizationId, companyId))
  )
    throw new DomainError("NOT_FOUND", 404);
  return company;
}
