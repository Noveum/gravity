import { fireEvent, screen } from "@testing-library/react";
import t from "../../packages/i18n/translations/en.json";

export async function contactTab(name: string) {
  fireEvent.click(await screen.findByRole("tab", { name }));
}
export async function archiveRecord() {
  const trigger = await screen.findByRole("button", {
    name: t.contactWorkspace.more,
  });
  fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: t.archive }));
}
