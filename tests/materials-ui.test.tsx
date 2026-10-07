// @vitest-environment jsdom

import { randomUUID } from "node:crypto";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { describe, expect, test, vi } from "vitest";
import * as s from "../packages/database/schema";
import { demoId, demoUser } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { installCrmHarness, mountCrm } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));

const harness = installCrmHarness();
const proof = demoId(901);

async function addAsset(folderId: string, name = "Fictional brief.md") {
  const [asset] = await harness.local.db
    .insert(s.assets)
    .values({
      organizationId: demoId(1),
      productId: demoId(10),
      folderId,
      name,
      storageKey: randomUUID(),
      mimeType: "text/markdown",
      size: 12,
      sha256: "0".repeat(64),
      uploadedBy: demoUser,
    })
    .returning();
  if (!asset) throw new Error("asset fixture");
  return asset;
}
async function openFolder(name: string) {
  const sidebar = await screen.findByRole("complementary", { name: t.folders });
  const group = within(sidebar).getByText("AI Platform", {
    selector: ".nav-label",
  }).parentElement;
  if (!(group instanceof HTMLElement)) throw new Error("product group");
  fireEvent.click(
    within(group).getByRole("button", { name: new RegExp(`^${name}`) }),
  );
}
async function folder(id: string) {
  const [row] = await harness.local.db
    .select()
    .from(s.folders)
    .where(eq(s.folders.id, id));
  return row;
}

describe("material folders", () => {
  test("Rename folder renames the selected folder", async () => {
    await mountCrm(harness, "/materials");
    await openFolder("Proof & case studies");
    fireEvent.click(screen.getByRole("button", { name: t.renameFolder }));
    const dialog = await screen.findByRole("region", {
      name: t.renameFolder,
    });
    const field = within(dialog).getByLabelText(t.folderName);
    expect((field as HTMLInputElement).value).toBe("Proof & case studies");
    fireEvent.change(field, { target: { value: "Case studies" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t.save }));
    await screen.findByText(t.folderRenamed.replace("{name}", "Case studies"));
    expect((await folder(proof))?.name).toBe("Case studies");
    expect(
      harness.posts.find((post) => post.operation === "folder-rename"),
    ).toMatchObject({ folderId: proof, name: "Case studies" });
  });

  test("Delete folder removes an empty folder after confirming", async () => {
    await mountCrm(harness, "/materials");
    await openFolder("Proof & case studies");
    fireEvent.click(screen.getByRole("button", { name: t.deleteFolder }));
    const dialog = await screen.findByRole("region", {
      name: t.deleteFolder,
    });
    expect(dialog.textContent).toContain(
      t.deleteFolderDetail.replace("{name}", "Proof & case studies"),
    );
    expect(await folder(proof)).toBeDefined();
    fireEvent.click(within(dialog).getByRole("button", { name: t.delete }));
    await screen.findByText(
      t.folderDeleted.replace("{name}", "Proof & case studies"),
    );
    expect(await folder(proof)).toBeUndefined();
  });

  test("a folder that holds a file cannot be deleted from the page", async () => {
    await addAsset(proof);
    await mountCrm(harness, "/materials");
    await openFolder("Proof & case studies");
    const remove = screen.getByRole("button", { name: t.deleteFolder });
    expect((remove as HTMLButtonElement).disabled).toBe(true);
    expect(remove.getAttribute("title")).toBe(t.folderNotEmptyHint);
  });
});

describe("material status", () => {
  test("an uploaded draft can be approved from its row", async () => {
    const asset = await addAsset(proof, "Pilot plan.md");
    await mountCrm(harness, "/materials");
    const select = (await screen.findByLabelText(
      t.materialStatusFor.replace("{name}", "Pilot plan.md"),
    )) as HTMLSelectElement;
    expect(select.value).toBe("draft");
    fireEvent.change(select, { target: { value: "approved" } });
    await screen.findByText(
      t.materialStatusSaved
        .replace("{name}", "Pilot plan.md")
        .replace("{status}", t.approvedAsset),
    );
    expect(
      harness.posts.find((post) => post.operation === "material-status"),
    ).toMatchObject({ assetId: asset.id, version: 1, status: "approved" });
    const [saved] = await harness.local.db
      .select()
      .from(s.assets)
      .where(eq(s.assets.id, asset.id));
    expect(saved).toMatchObject({ status: "approved", version: 2 });
    await waitFor(() =>
      expect(
        (
          screen.getByLabelText(
            t.materialStatusFor.replace("{name}", "Pilot plan.md"),
          ) as HTMLSelectElement
        ).value,
      ).toBe("approved"),
    );
  });
});
