import { expect, test } from "vitest";
import t from "../packages/i18n/translations/en.json";
import {
  movedWorkText,
  ownedWorkText,
} from "../src/components/settings/member-settings";

test("owned and moved work counts use singular and plural forms", () => {
  expect(ownedWorkText({ relationships: 1, actions: 0, touches: 1 })).toBe(
    "1 relationship · 0 actions · 1 touch",
  );
  expect(ownedWorkText({ relationships: 3, actions: 1, touches: 2 })).toBe(
    "3 relationships · 1 action · 2 touches",
  );
  expect(movedWorkText({ relationships: 1, actions: 1, touches: 1 })).toBe(
    "Member deactivated. Moved 1 relationship, 1 action and 1 touch.",
  );
  expect(movedWorkText({ relationships: 0, actions: 2, touches: 5 })).toBe(
    "Member deactivated. Moved 0 relationships, 2 actions and 5 touches.",
  );
});

test("assistant consent copy describes the three access levels", () => {
  const steps = t.mcpSteps.join(" ");
  for (const level of [
    t.consentLevelRead,
    t.consentLevelWrite,
    t.consentLevelSend,
  ])
    expect(`${t.mcpQualification} ${steps}`).toContain(level);
  expect(steps).not.toContain("Approve CRM read, write and approved sending");
});
