import { specTypeSchemas } from "@modelcontextprotocol/server";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { z } from "zod";
import type { Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import {
  agentGuideOutputSchema,
  guideTools,
  guideTopics,
} from "../packages/mcp/guidance";
import { createMcpHarness, parseSpec } from "./support/mcp-harness";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const organizationId = demoId(1);
const reader: Principal = {
  userId: demoUser,
  source: "mcp",
  organizationId,
  productIds: [demoId(10)],
  readOnly: true,
  canSend: false,
};
const { rpc, rpcResult } = createMcpHarness(
  () => local.db,
  organizationId,
  reader,
);

beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => local.client.close());

async function tool(
  name: string,
  args: Record<string, unknown> = {},
  principal = reader,
) {
  return rpcResult(
    specTypeSchemas.CallToolResult,
    "tools/call",
    { name, arguments: args },
    principal,
  );
}

function textContent(content: readonly unknown[]) {
  const blocks = z
    .array(z.object({ type: z.literal("text"), text: z.string() }))
    .parse(content);
  const first = blocks[0];
  if (!first) throw new Error("Missing text result");
  return first.text;
}

test("topic guides validate their structured output and current permission availability", async () => {
  const writer = { ...reader, readOnly: false };
  const sender = { ...writer, canSend: true };
  const listed = await rpc("tools/list", {}, sender);
  if ("error" in listed) throw new Error(listed.error.message);
  const names = parseSpec(
    specTypeSchemas.ListToolsResult,
    listed.result,
  ).tools.map((entry) => entry.name);
  const resources = await rpc("resources/list", {});
  if ("error" in resources) throw new Error(resources.error.message);
  const resourceUris = parseSpec(
    specTypeSchemas.ListResourcesResult,
    resources.result,
  ).resources.map((entry) => entry.uri);
  for (const topic of guideTopics) {
    const response = await tool("get_agent_guide", { topic });
    expect(response.isError).not.toBe(true);
    const guide = agentGuideOutputSchema.parse(response.structuredContent);
    const textValue: unknown = JSON.parse(textContent(response.content ?? []));
    expect(agentGuideOutputSchema.parse(textValue)).toEqual(guide);
    expect(guide.topic).toBe(topic);
    expect(guide.steps.length).toBeGreaterThan(0);
    for (const entry of guide.tools) {
      expect(names).toContain(entry.name);
      if (entry.requirements?.scopes.includes("crm:write"))
        expect(entry.available).toBe(false);
      if (!entry.requirements) expect(entry.available).toBe(true);
    }
    const uri = `gravity://guides/${topic}`;
    expect(resourceUris).toContain(uri);
    const resource = await rpc("resources/read", { uri });
    if ("error" in resource) throw new Error(resource.error.message);
    const contents = parseSpec(
      specTypeSchemas.ReadResourceResult,
      resource.result,
    ).contents;
    const resourceText = contents
      .flatMap((entry) => ("text" in entry ? [entry.text] : []))
      .join("\n");
    for (const step of guide.steps) expect(resourceText).toContain(step);
  }
  const sendingFor = async (principal: Principal) =>
    agentGuideOutputSchema
      .parse(
        (await tool("get_agent_guide", { topic: "sending" }, principal))
          .structuredContent,
      )
      .tools.find((entry) => entry.name === "send_touch")?.available;
  expect(await sendingFor(writer)).toBe(false);
  expect(await sendingFor(sender)).toBe(true);
  expect(
    agentGuideOutputSchema.parse(
      (await tool("get_agent_guide")).structuredContent,
    ).topic,
  ).toBe("getting-started");
});

test.each([
  ["manage-sequence", "sequences"],
  ["configure-connections", "connections"],
  ["send-approved-message", "sending"],
] as const)(
  "prompt %s uses the same workflow steps as its guide",
  async (name, topic) => {
    const guide = agentGuideOutputSchema.parse(
      (await tool("get_agent_guide", { topic })).structuredContent,
    );
    const response = await rpc("prompts/get", { name });
    if ("error" in response) throw new Error(response.error.message);
    const prompt = parseSpec(specTypeSchemas.GetPromptResult, response.result);
    const content = prompt.messages[0]?.content;
    if (content?.type !== "text") throw new Error("Missing prompt text");
    for (const step of guide.steps) expect(content.text).toContain(step);
  },
);

test("guide rejects unknown topics without executing a database query", async () => {
  const select = vi.spyOn(local.db, "select");
  const response = await tool("get_agent_guide", { topic: "unknown-topic" });
  expect(response.isError).toBe(true);
  expect(textContent(response.content ?? [])).toContain("topic");
  expect(select).not.toHaveBeenCalled();
});

test("guide marks stale tool references unavailable", async () => {
  const original = guideTools["getting-started"];
  guideTools["getting-started"] = [...original, "nonexistent_tool_fixture"];
  try {
    const guide = agentGuideOutputSchema.parse(
      (await tool("get_agent_guide")).structuredContent,
    );
    expect(
      guide.tools.find((entry) => entry.name === "nonexistent_tool_fixture"),
    ).toEqual({ name: "nonexistent_tool_fixture", available: false });
  } finally {
    guideTools["getting-started"] = original;
  }
});

test("guide rejects a different organization grant with a safe domain error", async () => {
  const response = await tool(
    "get_agent_guide",
    {},
    {
      ...reader,
      organizationId: demoId(2),
    },
  );
  expect(response.isError).toBe(true);
  const error: unknown = JSON.parse(textContent(response.content ?? []));
  expect(error).toEqual({ error: "FORBIDDEN" });
});

test("guide tools, resources and prompts recheck current membership", async () => {
  await local.db
    .update(s.memberships)
    .set({ active: false })
    .where(
      and(
        eq(s.memberships.organizationId, organizationId),
        eq(s.memberships.userId, demoUser),
      ),
    );
  try {
    const guide = await tool("get_agent_guide");
    expect(guide.isError).toBe(true);
    expect(guide.structuredContent).toEqual({ error: "FORBIDDEN" });
    for (const [method, params] of [
      ["resources/read", { uri: "gravity://guides/sequences" }],
      ["prompts/get", { name: "manage-sequence" }],
    ] as const) {
      const response = await rpc(method, params);
      expect(response).toMatchObject({ error: { message: "FORBIDDEN" } });
    }
  } finally {
    await local.db
      .update(s.memberships)
      .set({ active: true })
      .where(
        and(
          eq(s.memberships.organizationId, organizationId),
          eq(s.memberships.userId, demoUser),
        ),
      );
  }
});

test.each(["get_agent_guide", "get_me", "get_capabilities", "list_products"])(
  "tool %s sanitizes unexpected database failures",
  async (name) => {
    vi.spyOn(local.db, "select").mockImplementationOnce(() => {
      throw new Error("private SQL parameters fixture");
    });
    const response = await tool(name);
    expect(response.isError).toBe(true);
    expect(response.structuredContent).toEqual({ error: "INTERNAL_ERROR" });
    const error: unknown = JSON.parse(textContent(response.content ?? []));
    expect(error).toEqual({ error: "INTERNAL_ERROR" });
  },
);

test.each([
  ["resources/read", { uri: "gravity://guides/sequences" }],
  ["resources/read", { uri: "gravity://agent-guide" }],
  ["resources/read", { uri: "gravity://permissions" }],
  ["prompts/get", { name: "manage-sequence" }],
] as const)(
  "%s sanitizes unexpected database failures for %j",
  async (method, params) => {
    vi.spyOn(local.db, "select").mockImplementationOnce(() => {
      throw new Error("private SQL parameters fixture");
    });
    const response = await rpc(method, params);
    expect(response).toMatchObject({ error: { message: "INTERNAL_ERROR" } });
    expect(JSON.stringify(response)).not.toContain(
      "private SQL parameters fixture",
    );
  },
);

test("object results preserve JSON dates and arrays retain their text response", async () => {
  const workspace = await tool("get_workspace", {
    productId: demoId(10),
    compact: "true",
  });
  expect(workspace.isError).not.toBe(true);
  const structured = z
    .object({
      products: z.array(z.object({ createdAt: z.iso.datetime() }).loose()),
      asOf: z.iso.datetime(),
    })
    .loose()
    .parse(workspace.structuredContent);
  const textValue: unknown = JSON.parse(textContent(workspace.content ?? []));
  expect(structured).toEqual(textValue);
  const products = await tool("list_products");
  expect(products.isError).not.toBe(true);
  expect(products.structuredContent).toBeUndefined();
  const productText: unknown = JSON.parse(textContent(products.content ?? []));
  expect(
    z
      .array(z.object({ id: z.uuid(), createdAt: z.iso.datetime() }).loose())
      .parse(productText),
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: demoId(10) })]),
  );
});
