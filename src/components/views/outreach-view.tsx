"use client";
import t from "@crm/i18n/translations/en.json";
import Link from "next/link";
import { sectionPath } from "../routes";
import { EmptyState } from "../ui/states";

export function OutreachView() {
  return (
    <EmptyState
      title={t.outreachSoon}
      description={t.outreachSoonDetail}
      action={
        <Link className="button" href={sectionPath("sequences")}>
          {t.sequences}
        </Link>
      }
    />
  );
}
