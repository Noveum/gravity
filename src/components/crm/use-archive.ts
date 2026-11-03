"use client";
import t from "@crm/i18n/translations/en.json";
import { useRef } from "react";
import { companyPath, personPath } from "../routes";
import { currentViewQuery } from "../view-query";
import { useCrm } from "./crm-context";

interface Archivable {
  id: string;
  name: string;
  version: number;
  productId?: string;
}
type Kind = "person" | "company" | "opportunity";

const operations = {
  person: { operation: "person-archive", key: "personId" },
  company: { operation: "company-archive", key: "companyId" },
  opportunity: { operation: "opportunity-delete", key: "opportunityId" },
} as const;

export function useArchive() {
  const crm = useCrm();
  const current = useRef(crm);
  current.current = crm;
  async function change(
    kind: Kind,
    record: Archivable,
    archived: boolean,
    stageId?: string,
  ) {
    const { key } = operations[kind];
    const operation =
      kind === "opportunity" && !archived
        ? "opportunity-restore"
        : operations[kind].operation;
    const { ok, result } = await crm.send(
      {
        operation,
        organizationId: crm.organizationId,
        [key]: record.id,
        version: record.version,
        ...(kind === "opportunity"
          ? {
              productId: record.productId,
              ...(!archived && stageId ? { stageId } : {}),
            }
          : { archived }),
      },
      false,
    );
    if (!ok) return null;
    await crm.refresh();
    return result as { version: number };
  }
  const recordPath = (kind: Kind, id: string) => {
    if (kind === "person") return personPath(id);
    if (kind === "company") return companyPath(id);
    const query =
      crm.pathname === "/opportunities"
        ? currentViewQuery()
        : new URLSearchParams();
    query.set("deal", id);
    return `/opportunities?${query}`;
  };
  async function restore(kind: Kind, record: Archivable, stageId?: string) {
    const restored = await change(kind, record, false, stageId);
    if (restored)
      crm.notify(t.recordRestored.replace("{name}", record.name), "success");
    return !!restored;
  }
  async function archive(kind: Kind, record: Archivable) {
    if (!crm.canLeaveEditor()) return false;
    const returnPath = recordPath(kind, record.id);
    const archived = await change(kind, crm.currentRecord(record), true);
    if (!archived) return false;
    crm.closePeek(true);
    crm.leaveRecord();
    crm.notify(
      (kind === "person"
        ? t.personArchived
        : kind === "company"
          ? t.companyArchived
          : t.dealArchived
      ).replace("{name}", record.name),
      "success",
      {
        label: t.undo,
        run: () => {
          void restore(kind, { ...record, version: archived.version }).then(
            (ok) => {
              if (ok && current.current.organizationId === crm.organizationId)
                current.current.go(returnPath);
            },
          );
        },
      },
    );
    return true;
  }
  return { archive, restore };
}
