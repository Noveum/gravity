"use client";
import t from "@crm/i18n/translations/en.json";
import { companyPath, personPath, sectionPath } from "../routes";
import { useCrm } from "./crm-context";

interface Archivable {
  id: string;
  name: string;
  version: number;
}
type Kind = "person" | "company";

const operations = {
  person: { operation: "person-archive", key: "personId" },
  company: { operation: "company-archive", key: "companyId" },
} as const;

export function useArchive() {
  const crm = useCrm();
  async function change(kind: Kind, record: Archivable, archived: boolean) {
    const { operation, key } = operations[kind];
    const { ok, result } = await crm.send(
      {
        operation,
        organizationId: crm.organizationId,
        [key]: record.id,
        version: record.version,
        archived,
      },
      false,
    );
    if (!ok) return null;
    await crm.refresh();
    return result as { version: number };
  }
  const recordPath = (kind: Kind, id: string) =>
    kind === "person" ? personPath(id) : companyPath(id);
  async function restore(kind: Kind, record: Archivable) {
    const restored = await change(kind, record, false);
    if (restored)
      crm.notify(t.recordRestored.replace("{name}", record.name), "success");
    return !!restored;
  }
  async function archive(kind: Kind, record: Archivable) {
    const archived = await change(kind, record, true);
    if (!archived) return false;
    if (!crm.leaveRecord())
      crm.go(sectionPath(kind === "person" ? "people" : "companies"));
    crm.notify(
      (kind === "person" ? t.personArchived : t.companyArchived).replace(
        "{name}",
        record.name,
      ),
      "success",
      {
        label: t.undo,
        run: () => {
          void restore(kind, { ...record, version: archived.version }).then(
            (ok) => {
              if (ok) crm.go(recordPath(kind, record.id));
            },
          );
        },
      },
    );
    return true;
  }
  return { archive, restore };
}
