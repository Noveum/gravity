// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { demoId } from "../packages/database/seed";
import t from "../packages/i18n/translations/en.json";
import { installCrmHarness, mountCrm } from "./support/crm-harness";

vi.mock("next/navigation", () => import("./support/memory-router"));
vi.mock("next/link", () => import("./support/memory-router"));
vi.mock("../src/components/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/components/client-api")>()),
  requestJson: vi.fn(),
}));

const harness = installCrmHarness();
const board = (brand: string) =>
  screen.findByRole("region", {
    name: t.pipelineBoard.replace("{brand}", brand),
  });
const globalFilter = () =>
  screen
    .getAllByLabelText(t.product)
    .find((element) => element.id !== "pipeline-brand") as HTMLSelectElement;

test("showing a pipeline under All products chooses its brand locally and leaves the global filter alone", async () => {
  await mountCrm(harness, "/outreach/pipeline");
  await screen.findByRole("heading", { name: t.pipelineChooseBrand });
  const prompt = screen.getByLabelText(t.product, {
    selector: "#pipeline-brand",
  }) as HTMLSelectElement;
  fireEvent.change(prompt, { target: { value: demoId(11) } });
  fireEvent.click(screen.getByRole("button", { name: t.pipelineShow }));
  expect(await board("API Marketplace")).toBeTruthy();
  expect(globalFilter().value).toBe("");
  expect(document.cookie).not.toMatch(/gravity-brand=[^;]/);
  const switcher = screen.getByLabelText(t.pipelineBrand) as HTMLSelectElement;
  expect(switcher.value).toBe(demoId(11));
  fireEvent.change(switcher, { target: { value: demoId(10) } });
  expect(await board("AI Platform")).toBeTruthy();
  expect(globalFilter().value).toBe("");
});

test("a chosen global product shows its pipeline without asking", async () => {
  await mountCrm(harness, "/outreach/pipeline");
  fireEvent.change(globalFilter(), { target: { value: demoId(10) } });
  expect(await board("AI Platform")).toBeTruthy();
  await waitFor(() =>
    expect(screen.queryByLabelText(t.pipelineBrand)).toBeNull(),
  );
});
