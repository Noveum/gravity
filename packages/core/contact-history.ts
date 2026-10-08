import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import type { Principal } from "./policy";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Transaction;
type Person = Pick<
  typeof s.people.$inferSelect,
  "id" | "email" | "otherEmails" | "linkedinUrl"
>;

export const messageHistoryCursorTimestamp = sql<string>`to_char(${s.messages.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export function messageHistoryCursor(
  message: { id: string; cursorOccurredAt: string } | undefined,
) {
  return message
    ? JSON.stringify({ occurredAt: message.cursorOccurredAt, id: message.id })
    : null;
}

// Identity creation and editing take this organization's update lock. The
// shared lock keeps a component stable while claims/history lock its contacts.
export async function lockContactDirectory(db: Reader, organizationId: string) {
  await db
    .select({ id: s.organizations.id })
    .from(s.organizations)
    .where(eq(s.organizations.id, organizationId))
    .for("share");
}

export function linkedinKey(value: SQL | typeof s.people.linkedinUrl) {
  return sql`rtrim(regexp_replace(regexp_replace(lower(trim(${value})), '^[a-z]+://([a-z0-9-]+[.])*linkedin[.]com', ''), '[?#].*$', ''), '/')`;
}

const emailsFor = (people: Person[]) => [
  ...new Set(
    people
      .flatMap((person) => [person.email ?? "", ...person.otherEmails])
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  ),
];

// Follow the whole connected identity component. A legacy contact can bridge
// two aliases even when the original recipient does not contain both of them.
async function contactIdentities(
  db: Reader,
  organizationId: string,
  person: Person,
) {
  let identities = [person];
  for (;;) {
    const emails = emailsFor(identities);
    const matches: SQL[] = [
      inArray(
        s.people.id,
        identities.map((identity) => identity.id),
      ),
    ];
    if (emails.length)
      matches.push(
        inArray(sql`lower(trim(${s.people.email}))`, emails),
        sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${s.people.otherEmails}) AS alias(value) WHERE lower(trim(alias.value)) IN (${sql.join(
          emails.map((email) => sql`${email}`),
          sql`, `,
        )}))`,
      );
    for (const profile of new Set(
      identities.map((identity) => identity.linkedinUrl.trim()).filter(Boolean),
    ))
      matches.push(
        and(
          ne(s.people.linkedinUrl, ""),
          sql`${linkedinKey(s.people.linkedinUrl)} = ${linkedinKey(sql`${profile}`)}`,
        ) as SQL,
      );
    const rows = await db
      .select({
        id: s.people.id,
        email: s.people.email,
        otherEmails: s.people.otherEmails,
        linkedinUrl: s.people.linkedinUrl,
      })
      .from(s.people)
      .where(and(eq(s.people.organizationId, organizationId), or(...matches)))
      .orderBy(s.people.id);
    if (
      rows.length === identities.length &&
      rows.every((row) =>
        identities.some(
          (identity) =>
            identity.id === row.id &&
            identity.email === row.email &&
            identity.linkedinUrl === row.linkedinUrl &&
            JSON.stringify(identity.otherEmails) ===
              JSON.stringify(row.otherEmails),
        ),
      )
    )
      return rows;
    identities = rows;
    if (!identities.length) return identities;
  }
}

// Identity-level policy also covers duplicate legacy contacts and alternate addresses.
// This query returns IDs only; other products' private contents never enter a result.
export async function contactIdentityIds(
  db: Reader,
  organizationId: string,
  person: Person,
) {
  return (await contactIdentities(db, organizationId, person)).map(
    (identity) => identity.id,
  );
}

export async function contactIdsForParticipants(
  db: Reader,
  organizationId: string,
  participants: readonly string[],
) {
  const values = [
    ...new Set(
      participants.map((value) => value.trim().toLowerCase()).filter(Boolean),
    ),
  ];
  if (!values.length) return [];
  const matches: SQL[] = [
    inArray(sql`lower(trim(${s.people.email}))`, values),
    sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${s.people.otherEmails}) AS alias(value) WHERE lower(trim(alias.value)) IN (${sql.join(
      values.map((value) => sql`${value}`),
      sql`, `,
    )}))`,
  ];
  for (const profile of values.filter((value) =>
    /^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\/in\//.test(value),
  ))
    matches.push(
      and(
        ne(s.people.linkedinUrl, ""),
        sql`${linkedinKey(s.people.linkedinUrl)} = ${linkedinKey(sql`${profile}`)}`,
      ) as SQL,
    );
  const people = await db
    .select()
    .from(s.people)
    .where(and(eq(s.people.organizationId, organizationId), or(...matches)));
  const identities = new Set<string>();
  for (const person of people)
    for (const id of await contactIdentityIds(db, organizationId, person))
      identities.add(id);
  return [...identities].sort();
}

export async function contactHistoryChecks(
  db: Reader,
  principal: Principal,
  organizationId: string,
  person: Person,
  productIds: string[],
) {
  const people = await contactIdentities(db, organizationId, person);
  const identities = people.map((identity) => identity.id);
  const related = await db
    .select({ id: s.relationships.id })
    .from(s.relationships)
    .where(
      and(
        eq(s.relationships.organizationId, organizationId),
        inArray(s.relationships.personId, identities),
      ),
    );
  const relationshipIds = related.map((row) => row.id);
  const relevant = and(
    eq(s.conversations.organizationId, organizationId),
    inArray(s.conversations.relationshipId, relationshipIds),
  );
  const readable = and(
    inArray(s.conversations.productId, productIds),
    or(
      eq(s.conversations.ownerId, principal.userId),
      eq(s.conversations.visibility, "product"),
    ),
  );
  const hiddenHistory = db
    .select({ id: s.messages.id })
    .from(s.messages)
    .innerJoin(
      s.conversations,
      eq(s.conversations.id, s.messages.conversationId),
    )
    .where(
      and(
        relevant,
        or(
          sql`${s.conversations.productId} NOT IN (${sql.join(
            productIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`,
          and(
            eq(s.conversations.visibility, "private"),
            ne(s.conversations.ownerId, principal.userId),
          ),
        ),
      ),
    )
    .limit(1);
  const readableHistory = db
    .select({
      id: s.messages.id,
      conversationId: s.messages.conversationId,
      channel: s.conversations.channel,
      direction: s.messages.direction,
      body: s.messages.body,
      occurredAt: s.messages.occurredAt,
      provenance: s.conversations.provenance,
    })
    .from(s.messages)
    .innerJoin(
      s.conversations,
      eq(s.conversations.id, s.messages.conversationId),
    )
    .where(and(relevant, readable))
    .orderBy(desc(s.messages.occurredAt), desc(s.messages.id))
    .limit(12)
    .as("readable_history");
  const history = await db
    .select({
      hidden: sql<boolean>`EXISTS (${hiddenHistory})`,
      message: {
        id: readableHistory.id,
        conversationId: readableHistory.conversationId,
        channel: readableHistory.channel,
        direction: readableHistory.direction,
        body: readableHistory.body,
        occurredAt: readableHistory.occurredAt,
        provenance: readableHistory.provenance,
      },
    })
    .from(s.organizations)
    .leftJoin(readableHistory, sql`true`)
    .where(eq(s.organizations.id, organizationId))
    .orderBy(desc(readableHistory.occurredAt), desc(readableHistory.id));
  const hidden = history.some((row) => row.hidden);
  const messages = history.flatMap((row) => (row.message ? [row.message] : []));
  const emails = emailsFor(people);
  const participantMatches: SQL[] = [];
  if (emails.length)
    participantMatches.push(
      inArray(sql`lower(trim(${s.integrationItems.record}->>'from'))`, emails),
      sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${s.integrationItems.record}->'participants') AS participant(value) WHERE lower(trim(participant.value)) IN (${sql.join(
        emails.map((email) => sql`${email}`),
        sql`, `,
      )}))`,
    );
  for (const profile of new Set(
    people.map((identity) => identity.linkedinUrl.trim()).filter(Boolean),
  ))
    participantMatches.push(
      sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${s.integrationItems.record}->'participants') AS participant(value) WHERE ${linkedinKey(sql`participant.value`)} = ${linkedinKey(sql`${profile}`)})`,
    );
  // LinkedIn polls omit participants. A committed item on a linked thread is
  // still relevant history while its separate materialization is pending.
  // The linked product remains authoritative if the account's default differs.
  const pending = await db
    .select({
      ownerId: s.connections.ownerId,
      productId: sql<string>`coalesce(${s.conversations.productId}, ${s.integrationItems.productId})`,
    })
    .from(s.integrationItems)
    .innerJoin(
      s.connections,
      eq(s.connections.id, s.integrationItems.connectionId),
    )
    .leftJoin(
      s.conversations,
      and(
        eq(s.conversations.organizationId, organizationId),
        eq(s.conversations.connectionId, s.integrationItems.connectionId),
        sql`${s.conversations.externalThreadId} = ${s.integrationItems.record}->>'threadId'`,
      ),
    )
    .where(
      and(
        eq(s.integrationItems.organizationId, organizationId),
        eq(s.integrationItems.status, "unmatched"),
        sql`${s.integrationItems.record}->>'kind' = 'message'`,
        or(
          inArray(s.conversations.relationshipId, relationshipIds),
          ...participantMatches,
        ),
      ),
    );
  const rawPending = await db
    .select({
      ownerId: s.conversations.ownerId,
      productId: s.conversations.productId,
    })
    .from(s.integrationReceipts)
    .innerJoin(
      s.conversations,
      and(
        eq(s.conversations.connectionId, s.integrationReceipts.connectionId),
        sql`${s.conversations.externalThreadId} = ${s.integrationReceipts.payload}->>'chat_id'`,
      ),
    )
    .where(
      and(
        eq(s.integrationReceipts.organizationId, organizationId),
        eq(s.integrationReceipts.provider, "unipile"),
        isNull(s.integrationReceipts.processedAt),
        relevant,
      ),
    );
  const unresolved = [...pending, ...rawPending];
  return {
    identities,
    blockedBy:
      hidden ||
      unresolved.some(
        (item) =>
          item.ownerId !== principal.userId ||
          !productIds.includes(item.productId),
      )
        ? "PRIVATE_HISTORY_REVIEW_REQUIRED"
        : unresolved.length
          ? "PENDING_HISTORY_REVIEW_REQUIRED"
          : null,
    messages,
    coverage: { complete: false as const, pageSize: 12 },
  };
}
