import { createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  ingestReply,
  normalizeUnipileV2,
  verifyUnipileSignature,
} from "../packages/connectors/replies";
import {
  actionPlanSchema,
  CrmService,
  scheduleActionSchema,
} from "../packages/core/crm";
import type { Principal } from "../packages/core/policy";
import { createLocalDatabase, isDemoMode } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import { mcpHandler, principalForGrant } from "../packages/mcp/server";
import { downloadAsset, uploadAsset } from "../packages/storage/files";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let service: CrmService;
const admin: Principal = { userId: demoUser, source: "demo" };
const teammate: Principal = { userId: "demo-teammate", source: "session" };
const restricted: Principal = { userId: "demo-restricted", source: "session" };
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  service = new CrmService(local.db);
});
afterAll(async () => {
  await local.client.close();
});
describe("tenant and product isolation", () => {
  test("a user can belong to two organizations without shared records", async () => {
    expect(await service.organizations(admin)).toHaveLength(2);
    const a = await service.snapshot(admin, { organizationId: demoId(1) });
    const b = await service.snapshot(admin, { organizationId: demoId(2) });
    expect(a.products).toHaveLength(3);
    expect(b.products).toHaveLength(1);
    expect(
      a.people.some((person) =>
        b.people.some((other) => other.id === person.id),
      ),
    ).toBe(false);
    await expect(
      service.snapshot(teammate, { organizationId: demoId(2) }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.context(admin, demoId(1), demoId(307)),
    ).rejects.toMatchObject({ status: 404 });
  });
  test("product-restricted members cannot enumerate another product", async () => {
    const data = await service.snapshot(restricted, {
      organizationId: demoId(1),
    });
    expect(data.products.map((p) => p.id)).toEqual([demoId(11)]);
    expect(
      data.actions.every((action) => action.productId === demoId(11)),
    ).toBe(true);
    await expect(
      service.context(restricted, demoId(1), demoId(300)),
    ).rejects.toMatchObject({ status: 403 });
  });
  test("composite foreign keys reject cross-organization and cross-product links", async () => {
    await expect(
      local.db.insert(s.relationships).values({
        organizationId: demoId(1),
        productId: demoId(13),
        personId: demoId(200),
        ownerId: demoUser,
      }),
    ).rejects.toThrow();
    await expect(
      local.db.insert(s.assets).values({
        organizationId: demoId(1),
        productId: demoId(10),
        folderId: demoId(910),
        name: "Wrong product",
        storageKey: randomUUID(),
        mimeType: "text/plain",
        size: 4,
        sha256: "test",
        uploadedBy: demoUser,
      }),
    ).rejects.toThrow();
  });
  test("private conversations stay private even for another product member", async () => {
    const owner = await service.context(admin, demoId(1), demoId(303));
    const other = await service.context(teammate, demoId(1), demoId(303));
    expect(owner.messages).toHaveLength(1);
    expect(other.messages).toHaveLength(0);
    expect(other.coverage.complete).toBe(false);
  });
});
describe("intentional action handling", () => {
  test("blocked follow-ups cannot be approved or marked complete", async () => {
    await expect(
      service.changeAction(admin, {
        organizationId: demoId(1),
        actionId: demoId(600),
        version: 1,
        command: "approve",
      }),
    ).rejects.toMatchObject({ code: "REPLY_BLOCKED" });
    await expect(
      service.changeAction(admin, {
        organizationId: demoId(1),
        actionId: demoId(600),
        version: 1,
        command: "complete",
      }),
    ).rejects.toMatchObject({ code: "REPLY_BLOCKED" });
    const replaced = await service.changeAction(admin, {
      organizationId: demoId(1),
      actionId: demoId(600),
      version: 1,
      command: "rework",
      draft: "Here is the requested shortlist.",
    });
    expect(replaced.kind).toBe("reply");
    expect(replaced.status).toBe("open");
    const [enrollment] = await local.db
      .select()
      .from(s.enrollments)
      .where(eq(s.enrollments.id, demoId(500)));
    expect(enrollment).toMatchObject({
      status: "paused",
      pauseReason: "reply",
    });
    expect(enrollment.step).toBe(3);
  });
  test("edits invalidate approval and stale writers cannot overwrite a new draft", async () => {
    const approved = await service.changeAction(admin, {
      organizationId: demoId(1),
      actionId: demoId(602),
      version: 1,
      command: "approve",
    });
    expect(approved.approvedHash).toBe(approved.draftHash);
    await expect(
      service.changeAction(admin, {
        organizationId: demoId(1),
        actionId: demoId(602),
        version: 1,
        command: "save",
        draft: "Stale draft",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const edited = await service.changeAction(admin, {
      organizationId: demoId(1),
      actionId: demoId(602),
      version: 2,
      command: "save",
      draft: "Updated scoped proposal.",
    });
    expect(edited.approvedHash).toBeNull();
    expect(edited.approvedBy).toBeNull();
    expect(await local.db.select().from(s.messages)).toHaveLength(3);
  });
  test("meeting commitments require a reviewed due date and are created once", async () => {
    const input = {
      organizationId: demoId(1),
      meetingId: demoId(1000),
      version: 1,
      ownerId: demoUser,
      dueAt: new Date().toISOString(),
    };
    const first = await service.acceptCommitment(admin, input);
    const again = await service.acceptCommitment(admin, {
      ...input,
      version: 2,
    });
    expect(again.actionId).toBe(first.actionId);
    await expect(
      service.acceptCommitment(admin, { ...input, meetingId: demoId(1001) }),
    ).rejects.toMatchObject({ code: "NO_COMMITMENT" });
  });
  test("a reviewed meeting cannot assign a promise to someone outside its product", async () => {
    const [meeting] = await local.db
      .insert(s.meetings)
      .values({
        organizationId: demoId(1),
        productId: demoId(10),
        relationshipId: demoId(300),
        title: "Fictional reviewed meeting",
        startsAt: new Date(),
        status: "held",
        proposedCommitment: "Prepare the reviewed shortlist",
      })
      .returning();
    await expect(
      service.acceptCommitment(admin, {
        organizationId: demoId(1),
        meetingId: meeting.id,
        version: 1,
        ownerId: restricted.userId,
        dueAt: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ code: "OWNER_NOT_ALLOWED" });
    const [unchanged] = await local.db
      .select()
      .from(s.meetings)
      .where(eq(s.meetings.id, meeting.id));
    expect(unchanged.version).toBe(1);
    expect(unchanged.commitmentActionId).toBeNull();
  });
});
describe("creating product relationships", () => {
  test("concurrent creation rejects duplicate email without merging or overwriting identity", async () => {
    const input = {
      organizationId: demoId(1),
      productId: demoId(10),
      name: "Fictional new buyer",
      email: "buyer@example.test",
      title: "Lead",
      purpose: "buyer" as const,
      context: "Needs research",
      review: true,
      channel: "gmail" as const,
    };
    const results = await Promise.allSettled([
      service.createPerson(admin, input),
      service.createPerson(admin, { ...input, email: "BUYER@example.test" }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const snapshot = await service.snapshot(admin, {
      organizationId: demoId(1),
    });
    expect(
      snapshot.people.filter((person) => person.email === "buyer@example.test"),
    ).toHaveLength(1);
    expect(
      snapshot.actions.some(
        (action) => action.title === "Review the new relationship",
      ),
    ).toBe(true);
    expect(await local.db.select().from(s.messages)).toHaveLength(3);
  });
  test("an existing person gains a distinct product relationship with unchanged identity", async () => {
    const input = {
      organizationId: demoId(1),
      productId: demoId(12),
      personId: demoId(200),
      title: "",
      purpose: "partner" as const,
      context: "Potential services partner",
      review: false,
      channel: "linkedin" as const,
    };
    const result = await service.createPerson(admin, input);
    expect(result.personId).toBe(demoId(200));
    const [person] = await local.db
      .select()
      .from(s.people)
      .where(eq(s.people.id, demoId(200)));
    expect(person.name).toBe("Mira Chen");
    await expect(service.createPerson(admin, input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      service.createPerson(admin, { ...input, personId: demoId(206) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.createPerson(
        { userId: "demo-restricted", source: "demo" },
        { ...input, productId: demoId(11), personId: demoId(202) },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
describe("reply ingestion", () => {
  test("Unipile external sends and provider events are not classified as replies", () => {
    const event = {
      id: "evt-test",
      account_id: "demo-linkedin",
      account_provider: "LINKEDIN",
      type: "message.new",
      payload: {
        id: "outbound",
        chat_id: "demo-theo",
        is_sender: true,
        is_event: false,
        text: "Thanks",
        timestamp: new Date().toISOString(),
      },
    };
    expect(normalizeUnipileV2(event)?.direction).toBe("outbound");
    expect(
      normalizeUnipileV2({
        ...event,
        payload: { ...event.payload, is_event: true },
      }),
    ).toBeNull();
  });
  test("an oversized Unipile sender address imports the reply without a sender hint", () => {
    const sender = `${"a".repeat(329)}@example.test`;
    expect(sender).toHaveLength(342);
    const reply = normalizeUnipileV2(
      {
        id: "evt-long-sender",
        account_id: "mailbox",
        account_provider: "GOOGLE",
        type: "email.new",
        payload: {
          folder_id: "inbox",
          email: {
            id: "mail-long-sender",
            thread_id: "thread-long-sender",
            body_plain: "Hello",
            date: new Date().toISOString(),
            from: [{ email: sender }],
          },
        },
      },
      {
        selfEmail: "me@example.test",
        inboxFolderIds: ["inbox"],
        sentFolderIds: ["sent"],
      },
    );
    expect(reply).toMatchObject({ direction: "inbound" });
    expect(reply).not.toHaveProperty("from");
  });
  test("Gmail folder moves are ignored and thread identity is required", () => {
    const event = {
      id: "evt-mail",
      account_id: "mailbox",
      account_provider: "GOOGLE",
      type: "email.new",
      payload: {
        folder_id: "archive",
        email: {
          id: "mail-1",
          thread_id: "thread-1",
          body_plain: "Hello",
          date: new Date().toISOString(),
          from: [{ email: "prospect@example.test" }],
        },
      },
    };
    const mailbox = {
      selfEmail: "me@example.test",
      inboxFolderIds: ["inbox"],
      sentFolderIds: ["sent"],
    };
    expect(normalizeUnipileV2(event, mailbox)).toBeNull();
    expect(
      normalizeUnipileV2(
        { ...event, payload: { ...event.payload, folder_id: "inbox" } },
        mailbox,
      )?.direction,
    ).toBe("inbound");
    expect(() =>
      normalizeUnipileV2(
        {
          ...event,
          payload: {
            ...event.payload,
            email: { ...event.payload.email, thread_id: undefined },
          },
        },
        mailbox,
      ),
    ).toThrow();
  });
  test("signature verification binds exact bytes and rejects stale events", () => {
    const raw = Buffer.from('{"type":"message.new"}');
    const secret = "fictional-webhook-test-key";
    const now = Date.now();
    const timestamp = Math.floor(now / 1000);
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.`)
      .update(raw)
      .digest("hex");
    const header = `t=${timestamp},v0=${signature}`;
    expect(verifyUnipileSignature(raw, header, secret, now)).toBe(true);
    expect(
      verifyUnipileSignature(
        Buffer.from('{ "type":"message.new"}'),
        header,
        secret,
        now,
      ),
    ).toBe(false);
    expect(verifyUnipileSignature(raw, header, secret, now + 301000)).toBe(
      false,
    );
  });
  test("concurrent duplicate events pause once and invalidate approval", async () => {
    const [newAction] = await local.db
      .insert(s.actions)
      .values({
        organizationId: demoId(1),
        productId: demoId(10),
        relationshipId: demoId(304),
        enrollmentId: demoId(501),
        ownerId: demoUser,
        kind: "approval",
        title: "Follow-up",
        reason: "Test",
        owedBy: "us",
        channel: "gmail",
        dueAt: new Date(),
        draft: "Hello",
        draftHash: "hash",
        approvedHash: "hash",
        approvedBy: demoUser,
      })
      .returning();
    const event = {
      provider: "gmail" as const,
      accountId: "demo-gmail",
      messageId: "new-amara-reply",
      threadId: "demo-amara",
      direction: "inbound" as const,
      channel: "gmail" as const,
      body: "Can you share the overview?",
      occurredAt: new Date().toISOString(),
    };
    const results = await Promise.all([
      ingestReply(local.db, event),
      ingestReply(local.db, event),
    ]);
    expect(results.filter((result) => result.duplicate)).toHaveLength(1);
    const [enrollment] = await local.db
      .select()
      .from(s.enrollments)
      .where(eq(s.enrollments.id, demoId(501)));
    expect(enrollment).toMatchObject({
      status: "paused",
      pauseReason: "reply",
    });
    expect(enrollment.version).toBe(2);
    const [blocked] = await local.db
      .select()
      .from(s.actions)
      .where(eq(s.actions.id, newAction.id));
    expect(blocked.status).toBe("blocked");
    expect(blocked.approvedHash).toBeNull();
    const context = await service.context(admin, demoId(1), demoId(304));
    expect(context.messages).toHaveLength(1);
    expect(
      context.actions.filter((action) => action.kind === "reply"),
    ).toHaveLength(1);
  });
  test("private replies create actions only readable by the conversation owner", async () => {
    const otherRevision = await service.revision(teammate, demoId(1));
    const ownerRevision = await service.revision(admin, demoId(1));
    await ingestReply(local.db, {
      provider: "unipile",
      accountId: "demo-linkedin",
      messageId: "private-new",
      threadId: "demo-theo",
      direction: "inbound",
      channel: "linkedin",
      body: "Private body for the owner",
      occurredAt: new Date().toISOString(),
    });
    const owner = await service.context(admin, demoId(1), demoId(303));
    const other = await service.context(teammate, demoId(1), demoId(303));
    expect(
      owner.actions.some((a) => a.sourceConversationId === demoId(711)),
    ).toBe(true);
    expect(
      other.actions.some((a) => a.sourceConversationId === demoId(711)),
    ).toBe(false);
    const snapshot = await service.snapshot(teammate, {
      organizationId: demoId(1),
    });
    expect(
      snapshot.actions.some((a) => a.sourceConversationId === demoId(711)),
    ).toBe(false);
    expect(await service.revision(teammate, demoId(1))).toBe(otherRevision);
    expect(await service.revision(admin, demoId(1))).not.toBe(ownerRevision);
    const reply = owner.actions.find(
      (action) => action.sourceConversationId === demoId(711),
    );
    if (!reply) throw new Error("PRIVATE_REPLY_REQUIRED");
    await service.changeAction(admin, {
      organizationId: demoId(1),
      actionId: reply.id,
      version: reply.version,
      command: "save",
      draft: "A private draft",
    });
    expect(await service.revision(teammate, demoId(1))).toBe(otherRevision);
  });
  test("several replies in one conversation keep one task and invalidate its approved draft", async () => {
    const event = {
      provider: "gmail" as const,
      accountId: "demo-gmail",
      threadId: "demo-amara",
      direction: "inbound" as const,
      channel: "gmail" as const,
      occurredAt: new Date().toISOString(),
      body: "One more question",
    };
    await ingestReply(local.db, { ...event, messageId: "amara-first" });
    const context = await service.context(admin, demoId(1), demoId(304));
    const reply = context.actions.find(
      (a) => a.sourceConversationId === demoId(712) && a.kind === "reply",
    );
    if (!reply) throw new Error("REPLY_ACTION_REQUIRED");
    await service.changeAction(admin, {
      organizationId: demoId(1),
      actionId: reply.id,
      version: reply.version,
      command: "approve",
      draft: "Reviewed response",
    });
    await ingestReply(local.db, { ...event, messageId: "amara-second" });
    const after = await service.context(admin, demoId(1), demoId(304));
    const replies = after.actions.filter(
      (a) => a.sourceConversationId === demoId(712) && a.kind === "reply",
    );
    expect(replies).toHaveLength(1);
    expect(replies[0].approvedHash).toBeNull();
    expect(replies[0].status).toBe("blocked");
  });
  test("unmatched conversations are retained for later classification", async () => {
    const result = await ingestReply(local.db, {
      provider: "gmail",
      accountId: "demo-gmail",
      messageId: "unmatched-new",
      threadId: "new-thread",
      direction: "inbound",
      channel: "gmail",
      body: "Needs classification",
      occurredAt: new Date().toISOString(),
    });
    expect(result.matched).toBe(false);
    const [receipt] = await local.db
      .select()
      .from(s.connectorEvents)
      .where(eq(s.connectorEvents.providerEventId, "unmatched-new"));
    expect(receipt.status).toBe("unmatched");
    expect(
      (
        await ingestReply(local.db, {
          provider: "gmail",
          accountId: "demo-gmail",
          messageId: "unmatched-new",
          threadId: "new-thread",
          direction: "inbound",
          channel: "gmail",
          body: "Needs classification",
          occurredAt: new Date().toISOString(),
        })
      ).matched,
    ).toBe(false);
  });
});
describe("materials and assistant access", () => {
  test("folder parents and file stages cannot point to another product", async () => {
    await expect(
      service.createFolder(admin, {
        organizationId: demoId(1),
        productId: demoId(10),
        name: "Unsafe",
        parentId: demoId(910),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      uploadAsset(local.db, admin, {
        organizationId: demoId(1),
        productId: demoId(10),
        folderId: demoId(900),
        stageIds: [demoId(810)],
        name: "note.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("Note"),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  test("fake PDFs are rejected and real text uploads stay product scoped", async () => {
    const input = {
      organizationId: demoId(1),
      productId: demoId(10),
      folderId: demoId(900),
      stageIds: [demoId(800)],
      name: "overview.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("Fictional product overview"),
    };
    await expect(
      uploadAsset(local.db, admin, {
        ...input,
        name: "fake.pdf",
        mimeType: "application/pdf",
      }),
    ).rejects.toMatchObject({ code: "FILE_TYPE" });
    const asset = await uploadAsset(local.db, admin, input);
    const content = await downloadAsset(local.db, admin, demoId(1), asset.id);
    expect(new TextDecoder().decode(content.bytes)).toBe(
      "Fictional product overview",
    );
    await expect(
      downloadAsset(local.db, restricted, demoId(1), asset.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      downloadAsset(local.db, admin, demoId(2), asset.id),
    ).rejects.toMatchObject({ status: 404 });
  });
  test("MCP grants are immutable, revocable, and cannot approve a draft", async () => {
    const [grant] = await local.db
      .insert(s.mcpGrants)
      .values({
        organizationId: demoId(1),
        userId: demoUser,
        productIds: [demoId(11)],
      })
      .returning();
    const principal = await principalForGrant(local.db, demoUser, grant.id);
    await expect(
      service.context(principal, demoId(1), demoId(300)),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.snapshot(principal, { organizationId: demoId(2) }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.changeAction(principal, {
        organizationId: demoId(1),
        actionId: demoId(601),
        version: 1,
        command: "approve",
      }),
    ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED" });
    await local.db
      .update(s.mcpGrants)
      .set({ active: false })
      .where(eq(s.mcpGrants.id, grant.id));
    await expect(
      principalForGrant(local.db, demoUser, grant.id),
    ).rejects.toMatchObject({ status: 403 });
  });
  test("the MCP transport exposes real tools under the same product policy", async () => {
    const principal: Principal = {
      ...admin,
      source: "mcp",
      readOnly: true,
      organizationId: demoId(1),
      productIds: [demoId(11)],
    };
    const response = await mcpHandler(local.db, principal, demoId(1)).fetch(
      new Request("http://127.0.0.1:3014/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "list_products", arguments: {} },
        }),
      }),
    );
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("API Marketplace");
    expect(body).not.toContain("AI Platform");
    const capabilitiesResponse = await mcpHandler(
      local.db,
      principal,
      demoId(1),
    ).fetch(
      new Request("http://127.0.0.1:3014/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "get_capabilities", arguments: {} },
        }),
      }),
    );
    expect(capabilitiesResponse.status).toBe(200);
    const capabilitiesEnvelope = JSON.parse(
      (await capabilitiesResponse.text())
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6) ?? "{}",
    );
    expect(
      JSON.parse(capabilitiesEnvelope.result.content[0].text),
    ).toMatchObject({
      gmailSync: false,
      calendarSync: false,
      linkedinSync: false,
      firefliesSync: false,
      sendMessages: false,
      approveDrafts: false,
      readContext: true,
    });
    const companyResponse = await mcpHandler(
      local.db,
      principal,
      demoId(1),
    ).fetch(
      new Request("http://127.0.0.1:3014/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "get_company_context",
            arguments: { companyId: demoId(100) },
          },
        }),
      }),
    );
    const companyBody = await companyResponse.text();
    expect(companyResponse.status).toBe(200);
    expect(companyBody).toContain("Northstar Labs");
    const envelope = JSON.parse(
      companyBody
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6) ?? "{}",
    );
    const company = JSON.parse(envelope.result.content[0].text);
    // Shared task prose may mention another product; only granted records may be returned.
    expect(
      company.products.map((product: { id: string }) => product.id),
    ).toEqual([demoId(11)]);
    expect(
      company.relationships.map(
        (relationship: { id: string }) => relationship.id,
      ),
    ).toEqual([demoId(306)]);
    expect(company.meetings).toEqual([]);
    expect(company.opportunities).toEqual([]);
  });
  test("production cannot activate the local demo bypass", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRM_DEMO_MODE", "true");
    expect(isDemoMode()).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("explicit next-action scheduling", () => {
  const input = (extra: object = {}) =>
    scheduleActionSchema.parse({
      organizationId: demoId(1),
      relationshipId: demoId(300),
      ownerId: demoUser,
      kind: "review",
      channel: "gmail",
      owedBy: "us",
      title: "Follow-up 2",
      reason: "Review the product-specific context first",
      dueAt: "2026-10-09T04:30:00.000Z",
      ...extra,
    });
  test("tasks persist in the derived product with UTC dates; paused outreach remains paused", async () => {
    const result = await service.scheduleAction(admin, input());
    const [action] = await local.db
      .select()
      .from(s.actions)
      .where(eq(s.actions.id, result.actionId));
    expect(action.productId).toBe(demoId(10));
    expect(action.dueAt.toISOString()).toBe("2026-10-09T04:30:00.000Z");
    expect(action.approvedHash).toBeNull();
    expect(action.enrollmentId).toBeNull();
    const [enrollment] = await local.db
      .select()
      .from(s.enrollments)
      .where(eq(s.enrollments.id, demoId(500)));
    expect(enrollment).toMatchObject({
      status: "paused",
      pauseReason: "reply",
    });
    const blocked = await service.scheduleAction(
      admin,
      input({ kind: "approval" }),
    );
    const [approval] = await local.db
      .select()
      .from(s.actions)
      .where(eq(s.actions.id, blocked.actionId));
    expect(approval.status).toBe("blocked");
  });
  test("creators and owners must have product access; client product IDs cannot redirect the task", async () => {
    await expect(
      service.scheduleAction(restricted, input()),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      service.scheduleAction(admin, input({ ownerId: "demo-restricted" })),
    ).rejects.toMatchObject({ code: "OWNER_NOT_ALLOWED" });
    await expect(
      service.scheduleAction(admin, input({ productId: demoId(11) })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      service.scheduleAction(admin, input({ organizationId: demoId(2) })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.scheduleAction({ ...admin, source: "mcp" }, input()),
    ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED" });
    const result = await service.scheduleAction(
      admin,
      input({ relationshipId: demoId(306), ownerId: "demo-restricted" }),
    );
    const [action] = await local.db
      .select()
      .from(s.actions)
      .where(eq(s.actions.id, result.actionId));
    expect(action.productId).toBe(demoId(11));
  });
});

describe("connected record details", () => {
  test("person details include company and related work without leaking other products", async () => {
    const context = await service.context(admin, demoId(1), demoId(300));
    expect(context.company?.id).toBe(demoId(100));
    expect(context.relationships.map((r) => r.id)).toEqual(
      expect.arrayContaining([demoId(300), demoId(306)]),
    );
    expect(context.meetings.some((m) => m.id === demoId(1001))).toBe(true);
    expect(context.opportunities.some((o) => o.id === demoId(1101))).toBe(true);
    const narrowed = await service.context(restricted, demoId(1), demoId(306));
    expect(narrowed.relationships.map((r) => r.id)).toEqual([demoId(306)]);
    expect(narrowed.products.map((p) => p.id)).toEqual([demoId(11)]);
    expect(narrowed.meetings).toHaveLength(0);
    expect(narrowed.opportunities).toHaveLength(0);
  });
  test("company details obey org/product and private-source permissions", async () => {
    const context = await service.companyContext(
      admin,
      { organizationId: demoId(1) },
      demoId(100),
    );
    expect(context.people.map((p) => p.id)).toEqual([demoId(200)]);
    expect(context.relationships.map((r) => r.id)).toEqual(
      expect.arrayContaining([demoId(300), demoId(306)]),
    );
    const narrowed = await service.companyContext(
      restricted,
      { organizationId: demoId(1) },
      demoId(100),
    );
    expect(narrowed.relationships.map((r) => r.id)).toEqual([demoId(306)]);
    expect(narrowed.actions.every((a) => a.productId === demoId(11))).toBe(
      true,
    );
    await expect(
      service.companyContext(
        restricted,
        { organizationId: demoId(1) },
        demoId(104),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.companyContext(admin, { organizationId: demoId(1) }, demoId(106)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const privateCompany = await service.companyContext(
      teammate,
      { organizationId: demoId(1) },
      demoId(103),
    );
    expect(
      privateCompany.actions.some(
        (a) => a.sourceConversationId === demoId(711),
      ),
    ).toBe(false);
    const grant = {
      ...admin,
      source: "mcp" as const,
      organizationId: demoId(1),
      productIds: [demoId(11)],
      readOnly: true,
    };
    expect(
      (
        await service.companyContext(
          grant,
          { organizationId: demoId(1) },
          demoId(100),
        )
      ).relationships.map((r) => r.id),
    ).toEqual([demoId(306)]);
  });
});

describe("row verbs on actions", () => {
  const plan = (items: object[], principal: Principal = admin) =>
    service.planActions(
      principal,
      actionPlanSchema.parse({ organizationId: demoId(1), items }),
    );
  test("done, snooze and assign apply together and undo restores every field without touching approval", async () => {
    const [before] = await local.db
      .select()
      .from(s.actions)
      .where(eq(s.actions.id, demoId(603)));
    const [other] = await local.db
      .select()
      .from(s.actions)
      .where(eq(s.actions.id, demoId(604)));
    const later = "2030-01-02T09:00:00.000Z";
    const changed = await plan([
      { actionId: demoId(603), version: before.version, status: "completed" },
      {
        actionId: demoId(604),
        version: other.version,
        dueAt: later,
        ownerId: "demo-teammate",
      },
    ]);
    expect(changed.map((action) => action.status)).toEqual([
      "completed",
      "open",
    ]);
    expect(changed[1]?.dueAt.toISOString()).toBe(later);
    expect(changed[1]?.ownerId).toBe("demo-teammate");
    expect(changed[0]?.draftHash).toBe(before.draftHash);
    expect(changed[0]?.approvedHash).toBe(before.approvedHash);
    const undone = await plan([
      {
        actionId: demoId(603),
        version: changed[0]?.version,
        status: "open",
      },
      {
        actionId: demoId(604),
        version: changed[1]?.version,
        dueAt: other.dueAt.toISOString(),
        ownerId: other.ownerId,
      },
    ]);
    expect(undone[0]?.status).toBe("open");
    expect(undone[1]?.dueAt.toISOString()).toBe(other.dueAt.toISOString());
    expect(undone[1]?.ownerId).toBe(other.ownerId);
    const events = await local.db
      .select()
      .from(s.changeEvents)
      .where(eq(s.changeEvents.entityId, demoId(604)));
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["action.snooze", "action.assign"]),
    );
  });
  test("a failing item rolls back the whole batch and stale, blocked or foreign writes are refused", async () => {
    const [open] = await local.db
      .select()
      .from(s.actions)
      .where(eq(s.actions.id, demoId(603)));
    const { actionId: blocked } = await service.scheduleAction(
      admin,
      scheduleActionSchema.parse({
        organizationId: demoId(1),
        relationshipId: demoId(300),
        ownerId: demoUser,
        kind: "approval",
        channel: "gmail",
        owedBy: "us",
        title: "Paused approval",
        reason: "",
        dueAt: new Date().toISOString(),
      }),
    );
    await expect(
      plan([
        { actionId: demoId(603), version: open.version, status: "completed" },
        { actionId: blocked, version: 1, status: "completed" },
      ]),
    ).rejects.toMatchObject({ code: "REPLY_BLOCKED" });
    const [unchanged] = await local.db
      .select()
      .from(s.actions)
      .where(eq(s.actions.id, demoId(603)));
    expect(unchanged.status).toBe("open");
    expect(unchanged.version).toBe(open.version);
    await expect(
      plan([{ actionId: blocked, version: 1, status: "open" }]),
    ).rejects.toMatchObject({ code: "REPLY_BLOCKED" });
    const [snoozedBlocked] = await plan([
      { actionId: blocked, version: 1, dueAt: "2030-01-01T00:00:00.000Z" },
    ]);
    expect(snoozedBlocked?.status).toBe("blocked");
    await expect(
      plan([
        { actionId: demoId(603), version: open.version + 5, status: "open" },
      ]),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      plan([
        {
          actionId: demoId(603),
          version: open.version,
          ownerId: "demo-restricted",
        },
      ]),
    ).rejects.toMatchObject({ code: "OWNER_NOT_ALLOWED" });
    await expect(
      plan(
        [{ actionId: demoId(603), version: open.version, status: "completed" }],
        restricted,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      plan(
        [{ actionId: demoId(603), version: open.version, status: "completed" }],
        { ...admin, source: "mcp" },
      ),
    ).rejects.toMatchObject({ code: "HUMAN_ACTION_REQUIRED" });
    await expect(
      service.planActions(
        admin,
        actionPlanSchema.parse({
          organizationId: demoId(2),
          items: [
            {
              actionId: demoId(603),
              version: open.version,
              dueAt: new Date().toISOString(),
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(() =>
      actionPlanSchema.parse({
        organizationId: demoId(1),
        items: [{ actionId: demoId(603), version: 1 }],
      }),
    ).toThrow();
  });
});

describe("row verb rules from the Task 3 review", () => {
  const plan = (items: object[], principal: Principal = admin, extra = {}) =>
    service.planActions(
      principal,
      actionPlanSchema.parse({ organizationId: demoId(1), items, ...extra }),
    );
  const current = async (id: string) =>
    (await local.db.select().from(s.actions).where(eq(s.actions.id, id)))[0];
  async function privateAction() {
    const [found] = await local.db
      .select()
      .from(s.actions)
      .where(eq(s.actions.sourceConversationId, demoId(711)));
    if (found) return found;
    await ingestReply(local.db, {
      provider: "unipile",
      accountId: "demo-linkedin",
      messageId: "private-review",
      threadId: "demo-theo",
      direction: "inbound",
      channel: "linkedin",
      body: "Private body for the owner",
      occurredAt: new Date().toISOString(),
    });
    const [created] = await local.db
      .select()
      .from(s.actions)
      .where(eq(s.actions.sourceConversationId, demoId(711)));
    if (!created) throw new Error("PRIVATE_ACTION_REQUIRED");
    return created;
  }
  test("marking an approved draft complete keeps its approval record", async () => {
    const { actionId } = await service.scheduleAction(
      admin,
      scheduleActionSchema.parse({
        organizationId: demoId(1),
        relationshipId: demoId(302),
        ownerId: demoUser,
        kind: "review",
        channel: "gmail",
        owedBy: "us",
        title: "Approval survives completion",
        reason: "",
        dueAt: new Date().toISOString(),
      }),
    );
    const saved = await service.changeAction(admin, {
      organizationId: demoId(1),
      actionId,
      version: 1,
      command: "save",
      draft: "A reviewed note",
    });
    const approved = await service.changeAction(admin, {
      organizationId: demoId(1),
      actionId,
      version: saved.version,
      command: "approve",
    });
    const completed = await service.changeAction(admin, {
      organizationId: demoId(1),
      actionId,
      version: approved.version,
      command: "complete",
    });
    expect(completed.status).toBe("completed");
    expect(completed.approvedHash).toBe(approved.approvedHash);
    expect(completed.approvedBy).toBe(demoUser);
  });
  test("an assignee who cannot read a private source is refused with its own error", async () => {
    const action = await privateAction();
    await expect(
      plan([
        {
          actionId: action.id,
          version: action.version,
          ownerId: "demo-teammate",
        },
      ]),
    ).rejects.toMatchObject({ code: "ASSIGNEE_PRIVATE_SOURCE", status: 403 });
    await expect(
      plan(
        [
          {
            actionId: action.id,
            version: action.version,
            dueAt: "2030-01-01T09:00:00.000Z",
          },
        ],
        teammate,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect((await current(action.id)).version).toBe(action.version);
  });
  test("a read-only principal and a scope naming another product are refused", async () => {
    const action = await current(demoId(604));
    await expect(
      plan(
        [
          {
            actionId: action.id,
            version: action.version,
            dueAt: "2030-01-01T09:00:00.000Z",
          },
        ],
        { ...admin, source: "session", readOnly: true },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      plan(
        [
          {
            actionId: action.id,
            version: action.version,
            dueAt: "2030-01-01T09:00:00.000Z",
          },
        ],
        admin,
        { productId: demoId(11) },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await current(action.id)).version).toBe(action.version);
  });
  test("overlapping batches in opposite orders settle without a partial write", async () => {
    const a = await current(demoId(603));
    const b = await current(demoId(604));
    const due = "2031-02-03T09:00:00.000Z";
    const results = await Promise.allSettled([
      plan([
        { actionId: a.id, version: a.version, dueAt: due },
        { actionId: b.id, version: b.version, dueAt: due },
      ]),
      plan([
        { actionId: b.id, version: b.version, ownerId: "demo-teammate" },
        { actionId: a.id, version: a.version, ownerId: "demo-teammate" },
      ]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "CONFLICT" },
    });
    const [nextA, nextB] = [await current(a.id), await current(b.id)];
    expect(nextA.version).toBe(a.version + 1);
    expect(nextB.version).toBe(b.version + 1);
    expect(
      nextA.dueAt.toISOString() === due && nextB.dueAt.toISOString() === due
        ? "dates"
        : nextA.ownerId === "demo-teammate" && nextB.ownerId === "demo-teammate"
          ? "owners"
          : "mixed",
    ).not.toBe("mixed");
  });
  test("the batch reads its rows in action id order", async () => {
    const a = await current(demoId(603));
    const b = await current(demoId(604));
    const changed = await plan([
      { actionId: b.id, version: b.version, dueAt: "2031-03-03T09:00:00.000Z" },
      { actionId: a.id, version: a.version, dueAt: "2031-03-03T09:00:00.000Z" },
    ]);
    expect(changed.map((row) => row.id)).toEqual([a.id, b.id].sort());
  });
});
