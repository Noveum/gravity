import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { DomainError } from "./policy";

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
  const active = await db
    .select({ id: s.people.id })
    .from(s.people)
    .where(
      and(
        eq(s.people.organizationId, organizationId),
        eq(s.people.companyId, companyId),
        isNull(s.people.archivedAt),
      ),
    );
  if (!active.length) return true;
  if (!productIds.length) return false;
  const [visible] = await db
    .select({ id: s.relationships.id })
    .from(s.relationships)
    .where(
      and(
        eq(s.relationships.organizationId, organizationId),
        inArray(
          s.relationships.personId,
          active.map((person) => person.id),
        ),
        inArray(s.relationships.productId, productIds),
      ),
    )
    .limit(1);
  return !!visible;
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
