import type { ShortcutScope } from "@crm/core/shortcuts";
import { outreachTabFor, type Section, touchTabs } from "../routes";

export function shellShortcutScopes({
  hasData,
  section,
  recordId,
  showPeek,
  pathname,
}: {
  hasData: boolean;
  section: Section;
  recordId: string;
  showPeek: boolean;
  pathname: string;
}): ShortcutScope[] {
  const tab = section === "outreach" ? outreachTabFor(pathname) : null;
  const listed =
    hasData &&
    !recordId &&
    [
      "actions",
      "people",
      "companies",
      "meetings",
      "opportunities",
      "materials",
      "sequences",
      "outreach",
    ].includes(section);
  const editable =
    !showPeek &&
    (!!recordId || section === "meetings" || section === "opportunities");
  return [
    "global",
    ...(listed ? (["list"] as const) : []),
    ...(listed && section === "actions" ? (["actions"] as const) : []),
    ...(showPeek ? (["peek", "detail"] as const) : []),
    ...(recordId ? (["detail"] as const) : []),
    ...(hasData && editable ? (["record"] as const) : []),
    ...(listed && (section === "opportunities" || tab === "pipeline")
      ? (["board"] as const)
      : []),
    ...(listed && tab === "pipeline" ? (["pipeline"] as const) : []),
    ...(listed && !showPeek && tab && touchTabs.has(tab)
      ? (["outreach"] as const)
      : []),
  ];
}
