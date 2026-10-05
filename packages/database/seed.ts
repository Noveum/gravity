import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { draftHash } from "../core/drafts";
import type { Database } from "./client";
import * as s from "./schema";
export const demoId = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
export const demoUser = "demo-you";
const stepTemplates = [
  "Hi {first name}, I noticed your team is evaluating model testing. Would a short overview of how others approach it be useful?",
  "Hi {first name}, following up on my note. Happy to share a two-page summary instead of a call.",
  "Hi {first name}, one more idea: a fictional case study from a similar team. Should I send it?",
  "Hi {first name}, I will close the loop here. If timing changes, reply and I will pick it up.",
];
const steps = (index: number) => stepTemplates[index] ?? "";
const outreachStage = (product: number, position: number) =>
  demoId(1200 + product * 10 + position);
const stagePosition = {
  new: 0,
  researching: 1,
  contacted: 2,
  followUp: 3,
  replied: 4,
  meeting: 5,
  won: 6,
  lost: 7,
  notNow: 8,
} as const;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function seedOutreach(tx: Transaction, due: (offset: number) => Date) {
  const placements: [number, number, keyof typeof stagePosition][] = [
    [300, 0, "replied"],
    [301, 1, "contacted"],
    [302, 2, "meeting"],
    [303, 2, "followUp"],
    [304, 0, "contacted"],
    [305, 1, "researching"],
    [306, 1, "new"],
    [307, 3, "new"],
  ];
  for (const [relationship, product, stage] of placements)
    await tx
      .update(s.relationships)
      .set({ stageId: outreachStage(product, stagePosition[stage]) })
      .where(eq(s.relationships.id, demoId(relationship)));
  await tx.insert(s.people).values([
    {
      id: demoId(207),
      organizationId: demoId(1),
      name: "Noor Haddad",
      title: "Head of data",
      summary: "Fictional prospect working from Berlin.",
      email: "person7@example.test",
      timeZone: "Europe/Berlin",
    },
    {
      id: demoId(208),
      organizationId: demoId(1),
      name: "Owen Blake",
      title: "Platform lead",
      summary: "Asked not to be contacted again. Fictional.",
      email: "person8@example.test",
      doNotContact: true,
    },
  ]);
  await tx.insert(s.relationships).values([
    {
      id: demoId(308),
      organizationId: demoId(1),
      productId: demoId(10),
      personId: demoId(207),
      ownerId: demoUser,
      context: "Fictional outbound prospect for the AI Platform.",
      stageId: outreachStage(0, stagePosition.followUp),
      priority: "high",
      nextStep: "Send follow-up 2 with the case study",
      nextStepDueAt: due(0),
    },
    {
      id: demoId(309),
      organizationId: demoId(1),
      productId: demoId(10),
      personId: demoId(208),
      ownerId: demoUser,
      context: "Fictional prospect who opted out.",
      stageId: outreachStage(0, stagePosition.notNow),
      priority: "low",
    },
  ]);
  await tx.insert(s.enrollments).values([
    {
      id: demoId(502),
      organizationId: demoId(1),
      productId: demoId(10),
      relationshipId: demoId(308),
      sequenceId: demoId(400),
      status: "running",
      step: 3,
      enrolledAt: due(-8),
    },
    {
      id: demoId(503),
      organizationId: demoId(1),
      productId: demoId(10),
      relationshipId: demoId(309),
      sequenceId: demoId(400),
      status: "stopped",
      step: 2,
      enrolledAt: due(-10),
    },
    {
      id: demoId(504),
      organizationId: demoId(1),
      productId: demoId(11),
      relationshipId: demoId(305),
      sequenceId: demoId(401),
      status: "running",
      step: 1,
      enrolledAt: due(0),
    },
  ]);
  const people = new Map(
    (await tx.select().from(s.people)).map((person) => [person.id, person]),
  );
  const relationships = new Map(
    (await tx.select().from(s.relationships)).map((row) => [row.id, row]),
  );
  const companies = new Map(
    (await tx.select().from(s.companies)).map((row) => [row.id, row.name]),
  );
  const touch = (spec: {
    id: number;
    relationship: number;
    enrollment: number;
    product: number;
    step: number;
    status: "planned" | "drafted" | "approved" | "sent" | "skipped" | "expired";
    dueAt: Date;
    draft: string;
    at?: Date;
    skipReason?: string;
  }) => {
    const relationship = relationships.get(demoId(spec.relationship));
    const person = people.get(relationship?.personId ?? "");
    const channel = "gmail" as const;
    const hash = draftHash({
      draft: spec.draft,
      personId: person?.id ?? "",
      name: person?.name ?? "",
      title: person?.title ?? "",
      email: person?.email ?? null,
      companyName: companies.get(person?.companyId ?? "") ?? null,
      channel,
      productId: demoId(spec.product),
    });
    return {
      id: demoId(spec.id),
      organizationId: demoId(1),
      productId: demoId(spec.product),
      relationshipId: demoId(spec.relationship),
      enrollmentId: demoId(spec.enrollment),
      stepNumber: spec.step,
      followUp: spec.step - 1,
      channel,
      senderId: relationship?.ownerId ?? demoUser,
      dueAt: spec.dueAt,
      status: spec.status,
      draft: spec.draft,
      draftHash: hash,
      approvedHash: spec.status === "approved" ? hash : null,
      approvedBy: spec.status === "approved" ? demoUser : null,
      sentBy: spec.status === "sent" ? demoUser : null,
      sentAt: spec.status === "sent" ? (spec.at ?? spec.dueAt) : null,
      skipReason: spec.skipReason ?? null,
      closedAt: ["sent", "skipped", "expired"].includes(spec.status)
        ? (spec.at ?? spec.dueAt)
        : null,
    };
  };
  const intro = steps(0);
  await tx.insert(s.touches).values([
    touch({
      id: 1300,
      relationship: 300,
      enrollment: 500,
      product: 10,
      step: 1,
      status: "sent",
      dueAt: due(-9),
      draft:
        "Hi Mira, I noticed your team is evaluating model testing. Would a short overview help?",
    }),
    touch({
      id: 1301,
      relationship: 300,
      enrollment: 500,
      product: 10,
      step: 2,
      status: "sent",
      dueAt: due(-6),
      draft:
        "Hi Mira, following up with a two-page summary of the evaluation workflow.",
    }),
    touch({
      id: 1302,
      relationship: 300,
      enrollment: 500,
      product: 10,
      step: 3,
      status: "drafted",
      dueAt: due(-1),
      draft:
        "Hi Mira, following up on my earlier note. Would you like to take a look?",
    }),
    touch({
      id: 1303,
      relationship: 304,
      enrollment: 501,
      product: 10,
      step: 1,
      status: "sent",
      dueAt: due(-3),
      draft:
        "Hi Amara, a short overview of how teams approach model testing. Useful?",
    }),
    touch({
      id: 1304,
      relationship: 304,
      enrollment: 501,
      product: 10,
      step: 2,
      status: "approved",
      dueAt: due(0),
      draft:
        "Hi Amara, following up with a two-page summary instead of a call.",
    }),
    touch({
      id: 1305,
      relationship: 308,
      enrollment: 502,
      product: 10,
      step: 1,
      status: "skipped",
      dueAt: due(-8),
      draft: intro,
      skipReason: "Introduced at a fictional meetup instead.",
    }),
    touch({
      id: 1306,
      relationship: 308,
      enrollment: 502,
      product: 10,
      step: 2,
      status: "sent",
      dueAt: due(-5),
      draft:
        "Hi Noor, good to meet you at the meetup. Here is the two-page summary.",
    }),
    touch({
      id: 1307,
      relationship: 308,
      enrollment: 502,
      product: 10,
      step: 3,
      status: "planned",
      dueAt: due(0),
      draft: steps(2),
    }),
    touch({
      id: 1308,
      relationship: 309,
      enrollment: 503,
      product: 10,
      step: 1,
      status: "sent",
      dueAt: due(-10),
      draft:
        "Hi Owen, a short overview of how platform teams approach model testing.",
    }),
    touch({
      id: 1309,
      relationship: 309,
      enrollment: 503,
      product: 10,
      step: 2,
      status: "expired",
      dueAt: due(-7),
      draft: steps(1),
      at: due(-2),
    }),
    touch({
      id: 1310,
      relationship: 305,
      enrollment: 504,
      product: 11,
      step: 1,
      status: "planned",
      dueAt: due(0),
      draft: intro,
    }),
  ]);
  const sent: [number, number, Date][] = [
    [300, 2, due(-6)],
    [304, 1, due(-3)],
    [308, 1, due(-5)],
    [309, 1, due(-10)],
  ];
  for (const [relationship, touchCount, lastOutboundAt] of sent)
    await tx
      .update(s.relationships)
      .set({ touchCount, lastOutboundAt })
      .where(eq(s.relationships.id, demoId(relationship)));
  for (const [relationship, lastInboundAt] of [
    [300, due(-1)],
    [303, due(-2)],
  ] as const)
    await tx
      .update(s.relationships)
      .set({ lastInboundAt })
      .where(eq(s.relationships.id, demoId(relationship)));
}

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
    const sequenceSteps = [
      "Initial message",
      "Follow-up 1",
      "Follow-up 2",
      "Follow-up 3",
    ].map((name, i) => ({
      number: i + 1,
      name,
      delayDays: i === 0 ? 0 : i === 1 ? 3 : 5,
      channel: "gmail" as const,
      template: steps(i),
      followUp: i,
    }));
    await tx.insert(s.sequences).values(
      [10, 11, 12, 13].map((p, i) => ({
        id: demoId(400 + i),
        organizationId: demoId(p === 13 ? 2 : 1),
        productId: demoId(p),
        name: i === 2 ? "Pilot conversation" : "Thoughtful introduction",
        steps: sequenceSteps,
      })),
    );
    await tx.insert(s.enrollments).values([
      {
        id: demoId(500),
        organizationId: demoId(1),
        productId: demoId(10),
        relationshipId: demoId(300),
        sequenceId: demoId(400),
        status: "paused",
        pauseReason: "reply",
        step: 3,
        enrolledAt: new Date(Date.now() - 9 * 86400000),
      },
      {
        id: demoId(501),
        organizationId: demoId(1),
        productId: demoId(10),
        relationshipId: demoId(304),
        sequenceId: demoId(400),
        status: "running",
        step: 2,
        enrolledAt: new Date(Date.now() - 3 * 86400000),
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
      await tx.insert(s.stages).values(
        (
          [
            ["Discovery", "open"],
            ["Evaluation", "open"],
            ["Proposal", "open"],
            ["Won", "won"],
            ["Lost", "lost"],
          ] as const
        ).map(([name, category], j) => ({
          id: demoId(800 + i * 10 + j),
          organizationId: org,
          productId: demoId(p),
          name,
          position: j,
          category,
        })),
      );
      await tx.insert(s.stages).values(
        (
          [
            ["New", "open"],
            ["Researching", "open"],
            ["Contacted", "open"],
            ["Follow-up", "open"],
            ["Replied", "open"],
            ["Meeting", "open"],
            ["Won", "won"],
            ["Lost", "lost"],
            ["Not now", "hold"],
          ] as const
        ).map(([name, category], j) => ({
          id: outreachStage(i, j),
          organizationId: org,
          productId: demoId(p),
          name,
          position: j,
          pipeline: "outreach" as const,
          category,
        })),
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
    await seedOutreach(tx, due);
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
