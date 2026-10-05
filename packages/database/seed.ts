import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "./client";
import * as s from "./schema";
export const demoId = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
export const demoUser = "demo-you";
export async function seedDemo(db: Database) {
  const [existing] = await db
    .select()
    .from(s.organizations)
    .where(eq(s.organizations.id, demoId(1)));
  if (existing) return;
  await db.transaction(async (tx) => {
    await tx
      .insert(s.user)
      .values([
        { id: demoUser, name: "Alex Morgan", email: "alex@example.test" },
        { id: "demo-teammate", name: "Sam Rivera", email: "sam@example.test" },
        {
          id: "demo-restricted",
          name: "Restricted member",
          email: "restricted@example.test",
        },
      ])
      .onConflictDoNothing();
    await tx.insert(s.organizations).values([
      {
        id: demoId(1),
        name: "Northstar Collective",
        slug: "northstar",
        timezone: "Asia/Kolkata",
      },
      {
        id: demoId(2),
        name: "Lunar Studio",
        slug: "lunar",
        timezone: "Europe/London",
      },
    ]);
    await tx.insert(s.memberships).values([
      { organizationId: demoId(1), userId: demoUser, role: "admin" },
      { organizationId: demoId(2), userId: demoUser, role: "admin" },
      { organizationId: demoId(1), userId: "demo-teammate", role: "member" },
      { organizationId: demoId(1), userId: "demo-restricted", role: "member" },
    ]);
    await tx.insert(s.products).values([
      {
        id: demoId(10),
        organizationId: demoId(1),
        name: "AI Platform",
        color: "#7565cf",
      },
      {
        id: demoId(11),
        organizationId: demoId(1),
        name: "API Marketplace",
        color: "#418ca0",
      },
      {
        id: demoId(12),
        organizationId: demoId(1),
        name: "Services",
        color: "#ca9058",
      },
      {
        id: demoId(13),
        organizationId: demoId(2),
        name: "Design Partners",
        color: "#cf6f93",
      },
    ]);
    await tx.insert(s.productMemberships).values(
      [10, 11, 12]
        .map((n) => ({
          organizationId: demoId(1),
          productId: demoId(n),
          userId: "demo-teammate",
        }))
        .concat([
          {
            organizationId: demoId(1),
            productId: demoId(11),
            userId: "demo-restricted",
          },
        ]),
    );
    const names = [
      "Northstar Labs",
      "Harbor Analytics",
      "Cedar Systems",
      "Horizon Studio",
      "Lantern AI",
      "Vale Software",
      "Moonlit Design",
    ];
    await tx.insert(s.companies).values(
      names.map((name, i) => ({
        id: demoId(100 + i),
        organizationId: demoId(i === 6 ? 2 : 1),
        name,
        domain: `${name.toLowerCase().replaceAll(" ", "-")}.example.test`,
        description: "Fictional company for development.",
      })),
    );
    const prospects = [
      [
        "Mira Chen",
        "Engineering lead",
        "Existing evaluation workflow confirmed. Budget remains unverified.",
      ],
      [
        "Jonah Reed",
        "Founder",
        "Requested API documentation; no purchase decision confirmed.",
      ],
      [
        "Leena Rao",
        "Operations director",
        "Pilot scope discussed. Commercial terms remain open.",
      ],
      [
        "Theo Grant",
        "Technical partner",
        "Partner relationship. Promised to ask their CTO next week.",
      ],
      [
        "Amara Stone",
        "Product lead",
        "Possible model testing initiative. Fit is a hypothesis.",
      ],
      [
        "Ellis Park",
        "Engineering manager",
        "Hiring signal suggests relevance, not buying intent.",
      ],
      [
        "Rowan Cole",
        "Design lead",
        "Separate organization; no shared identity or conversation history.",
      ],
    ];
    await tx.insert(s.people).values(
      prospects.map(([name, title, summary], i) => ({
        id: demoId(200 + i),
        organizationId: demoId(i === 6 ? 2 : 1),
        companyId: demoId(100 + i),
        name,
        title,
        summary,
        email: `person${i}@example.test`,
      })),
    );
    const relationshipSpecs = [
      [200, 10],
      [201, 11],
      [202, 12],
      [203, 12],
      [204, 10],
      [205, 11],
      [200, 11],
      [206, 13],
    ];
    await tx.insert(s.relationships).values(
      relationshipSpecs.map(([person, product], i) => ({
        id: demoId(300 + i),
        organizationId: demoId(product === 13 ? 2 : 1),
        productId: demoId(product),
        personId: demoId(person),
        ownerId: i === 1 || i === 5 || i === 6 ? "demo-teammate" : demoUser,
        purpose: i === 3 ? "partner" : "buyer",
        qualification: i < 3 ? "engaged" : "unverified",
        context: prospects[person - 200][2],
      })),
    );
    const steps = [
      "Initial message",
      "Follow-up 1",
      "Follow-up 2",
      "Follow-up 3",
    ].map((name, i) => ({
      number: i + 1,
      name,
      delayDays: i === 0 ? 0 : i === 1 ? 3 : 5,
      channel: "gmail" as const,
    }));
    await tx.insert(s.sequences).values(
      [10, 11, 12, 13].map((p, i) => ({
        id: demoId(400 + i),
        organizationId: demoId(p === 13 ? 2 : 1),
        productId: demoId(p),
        name: i === 2 ? "Pilot conversation" : "Thoughtful introduction",
        steps,
      })),
    );
    await tx.insert(s.enrollments).values([
      {
        id: demoId(500),
        organizationId: demoId(1),
        productId: demoId(10),
        relationshipId: demoId(300),
        sequenceId: demoId(400),
        status: "paused_reply",
        step: 3,
      },
      {
        id: demoId(501),
        organizationId: demoId(1),
        productId: demoId(10),
        relationshipId: demoId(304),
        sequenceId: demoId(400),
        status: "running",
        step: 2,
      },
    ]);
    const now = new Date();
    const due = (offset: number) => new Date(now.getTime() + offset * 86400000);
    const actionSpecs = [
      {
        id: demoId(600),
        productId: demoId(10),
        relationshipId: demoId(300),
        enrollmentId: demoId(500),
        ownerId: demoUser,
        kind: "approval" as const,
        title: "Follow-up 2 paused by a reply",
        reason:
          "Mira asked for a shortlist. Replace this follow-up with a relevant answer.",
        owedBy: "us" as const,
        channel: "gmail" as const,
        status: "blocked" as const,
        dueAt: due(0),
        draft:
          "Hi Mira, following up on my earlier note. Would you like to take a look?",
      },
      {
        id: demoId(601),
        productId: demoId(11),
        relationshipId: demoId(301),
        ownerId: "demo-teammate",
        kind: "reply" as const,
        title: "Answer the API format question",
        reason: "Their question needs an answer before another pitch.",
        owedBy: "us" as const,
        channel: "gmail" as const,
        dueAt: due(0),
        draft:
          "Hi Jonah, here is the response format and trial limit overview you requested. Which endpoint would you like to test first?",
      },
      {
        id: demoId(602),
        productId: demoId(12),
        relationshipId: demoId(302),
        ownerId: demoUser,
        kind: "commitment" as const,
        title: "Prepare the pilot proposal",
        reason: "You promised a scoped proposal after the meeting.",
        owedBy: "us" as const,
        channel: "gmail" as const,
        dueAt: due(-1),
        draft:
          "Hi Leena, here is a bounded pilot scope for your review. Acceptance criteria and open questions are separate.",
      },
      {
        id: demoId(603),
        productId: demoId(12),
        relationshipId: demoId(303),
        ownerId: demoUser,
        kind: "review" as const,
        title: "Review their promised introduction",
        reason:
          "They offered to ask their CTO. This date is a reminder to review.",
        owedBy: "them" as const,
        channel: "linkedin" as const,
        dueAt: due(2),
        draft: "",
      },
      {
        id: demoId(604),
        productId: demoId(10),
        relationshipId: demoId(304),
        enrollmentId: demoId(501),
        ownerId: demoUser,
        kind: "review" as const,
        title: "Check history before follow-up 1",
        reason: "Refresh the conversation before choosing the next step.",
        owedBy: "them" as const,
        channel: "gmail" as const,
        dueAt: due(4),
        draft: "",
      },
      {
        id: demoId(605),
        productId: demoId(11),
        relationshipId: demoId(305),
        ownerId: "demo-teammate",
        kind: "research" as const,
        title: "Verify role and buying context",
        reason: "A public hiring signal needs context and verification.",
        owedBy: "unknown" as const,
        channel: "research" as const,
        dueAt: due(0),
        draft: "",
      },
      {
        id: demoId(606),
        productId: demoId(11),
        relationshipId: demoId(306),
        ownerId: "demo-teammate",
        kind: "research" as const,
        title: "Coordinate across products",
        reason:
          "Mira has an active AI Platform conversation. Coordinate before reaching out.",
        owedBy: "us" as const,
        channel: "research" as const,
        dueAt: due(0),
        draft: "",
      },
      {
        id: demoId(607),
        productId: demoId(13),
        relationshipId: demoId(307),
        ownerId: demoUser,
        kind: "research" as const,
        title: "Prepare design partner research",
        reason: "New relationship in Lunar Studio.",
        owedBy: "us" as const,
        channel: "research" as const,
        dueAt: due(1),
        draft: "",
      },
    ];
    await tx.insert(s.actions).values(
      actionSpecs.map((a) => ({
        ...a,
        organizationId: demoId(a.productId === demoId(13) ? 2 : 1),
        draftHash: a.draft
          ? createHash("sha256").update(a.draft).digest("hex")
          : null,
      })),
    );
    await tx.insert(s.connections).values([
      {
        id: demoId(700),
        organizationId: demoId(1),
        ownerId: demoUser,
        provider: "gmail",
        externalAccountId: "demo-gmail",
        status: "demo",
      },
      {
        id: demoId(701),
        organizationId: demoId(1),
        ownerId: demoUser,
        provider: "unipile",
        externalAccountId: "demo-linkedin",
        status: "demo",
      },
    ]);
    await tx.insert(s.conversations).values([
      {
        id: demoId(710),
        organizationId: demoId(1),
        productId: demoId(10),
        relationshipId: demoId(300),
        connectionId: demoId(700),
        externalThreadId: "demo-mira",
        ownerId: demoUser,
        visibility: "product",
        channel: "gmail",
      },
      {
        id: demoId(711),
        organizationId: demoId(1),
        productId: demoId(12),
        relationshipId: demoId(303),
        connectionId: demoId(701),
        externalThreadId: "demo-theo",
        ownerId: demoUser,
        visibility: "private",
        channel: "linkedin",
      },
      {
        id: demoId(712),
        organizationId: demoId(1),
        productId: demoId(10),
        relationshipId: demoId(304),
        connectionId: demoId(700),
        externalThreadId: "demo-amara",
        ownerId: demoUser,
        visibility: "product",
        channel: "gmail",
      },
    ]);
    await tx.insert(s.messages).values([
      {
        organizationId: demoId(1),
        productId: demoId(10),
        conversationId: demoId(710),
        connectionId: demoId(700),
        providerMessageId: "mira-1",
        direction: "outbound",
        body: "Here is the evaluation workflow we discussed. Happy to help with the shortlist.",
        occurredAt: due(-3),
      },
      {
        organizationId: demoId(1),
        productId: demoId(10),
        conversationId: demoId(710),
        connectionId: demoId(700),
        providerMessageId: "mira-2",
        direction: "inbound",
        body: "We can review the evaluation setup on Monday. Please send your shortlist.",
        occurredAt: due(-1),
      },
      {
        organizationId: demoId(1),
        productId: demoId(12),
        conversationId: demoId(711),
        connectionId: demoId(701),
        providerMessageId: "theo-1",
        direction: "inbound",
        body: "I will ask our CTO next week and come back to you.",
        occurredAt: due(-2),
      },
    ]);
    for (const [index, [person, product]] of relationshipSpecs.entries()) {
      await tx.insert(s.evidence).values({
        organizationId: demoId(product === 13 ? 2 : 1),
        productId: demoId(product),
        relationshipId: demoId(300 + index),
        title:
          index === 4
            ? "Possible evaluation initiative"
            : "Relationship context",
        excerpt: prospects[person - 200][2],
        source: "Fictional development example",
        classification: index < 3 ? "fact" : "hypothesis",
        observedAt: due(-1),
      });
    }
    for (const [i, p] of [10, 11, 12, 13].entries()) {
      const org = demoId(p === 13 ? 2 : 1);
      await tx.insert(s.pipelines).values({
        id: demoId(1200 + p),
        organizationId: org,
        productId: demoId(p),
        name: "Sales pipeline",
      });
      await tx.insert(s.stages).values(
        ["Discovery", "Evaluation", "Proposal", "Won", "Lost"].map(
          (name, j) => ({
            id: demoId(800 + i * 10 + j),
            organizationId: org,
            productId: demoId(p),
            name,
            position: j,
            pipelineId: demoId(1200 + p),
            kind:
              j === 3
                ? ("won" as const)
                : j === 4
                  ? ("lost" as const)
                  : ("open" as const),
          }),
        ),
      );
      await tx.insert(s.folders).values(
        ["Overview", "Proof & case studies", "Commercial"].map((name, j) => ({
          id: demoId(900 + i * 10 + j),
          organizationId: org,
          productId: demoId(p),
          name,
        })),
      );
    }
    await tx.insert(s.meetings).values([
      {
        id: demoId(1000),
        organizationId: demoId(1),
        productId: demoId(12),
        relationshipId: demoId(302),
        title: "Pilot scope discussion",
        startsAt: due(-1),
        status: "held",
        summary:
          "Discussed a bounded pilot and success criteria. Budget and final scope are open.",
        proposedCommitment: "Share a written pilot scope for review.",
      },
      {
        id: demoId(1001),
        organizationId: demoId(1),
        productId: demoId(10),
        relationshipId: demoId(300),
        title: "Evaluation review",
        startsAt: due(2),
        status: "scheduled",
        summary: "Booked, attendance and outcome are not yet recorded.",
      },
    ]);
    await tx.insert(s.opportunities).values([
      {
        id: demoId(1100),
        organizationId: demoId(1),
        productId: demoId(12),
        relationshipId: demoId(302),
        stageId: demoId(821),
        name: "Cedar workflow pilot",
        amountMinor: 500000,
        ownerId: demoUser,
        probability: 60,
        expectedCloseDate: due(14).toISOString().slice(0, 10),
        createdAt: due(-15),
        updatedAt: due(-1),
      },
      {
        id: demoId(1101),
        organizationId: demoId(1),
        productId: demoId(10),
        relationshipId: demoId(300),
        stageId: demoId(801),
        name: "Northstar evaluation project",
      },
    ]);
  });
}
