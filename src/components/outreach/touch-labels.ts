import t from "@crm/i18n/translations/en.json";
import { detailText } from "../client-api";
import type { Crm } from "../crm/crm-context";
import type { MergePerson } from "./merge-fields";

export const followUpLabel = (followUp: number) =>
  t.followUpGroups[followUp] ??
  t.stepLabel.replace("{number}", String(followUp));

export function gateReason(
  reason: { code: string; until?: string; cap?: number },
  timeZone: string,
) {
  const template =
    t.gateReasons[reason.code as keyof typeof t.gateReasons] ?? reason.code;
  return template
    .replace("{until}", reason.until ? detailText(reason.until, timeZone) : "")
    .replace("{cap}", String(reason.cap ?? ""));
}

export function mergePerson(
  crm: Pick<Crm, "sourceData" | "companyFor">,
  person: { id: string; name: string },
): MergePerson {
  return {
    name: person.name,
    title: crm.sourceData?.people.find((item) => item.id === person.id)?.title,
    company: crm.companyFor(person.id)?.name,
  };
}
