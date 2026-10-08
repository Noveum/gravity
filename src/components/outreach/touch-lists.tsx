"use client";
import t from "@crm/i18n/translations/en.json";
import type { ReactNode } from "react";
import type { Touch } from "./outreach-data";
import { followUpLabel } from "./touch-labels";
import { touchOverdue } from "./touch-row";

export function matchesSearch(search: string, ...values: string[]) {
  return values.join(" ").toLowerCase().includes(search.toLowerCase());
}

export function byUrgency<T extends Touch>(
  touches: readonly T[],
  now: number,
  timeZone: string,
) {
  return [...touches].sort(
    (a, b) =>
      Number(touchOverdue(b, now, timeZone)) -
        Number(touchOverdue(a, now, timeZone)) ||
      Date.parse(a.dueAt) - Date.parse(b.dueAt) ||
      a.id.localeCompare(b.id),
  );
}

export function TouchGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <fieldset className="touch-group" aria-label={`${title}: ${count}`}>
      <div className="group-title touch-group-title" aria-hidden>
        {title}
        <span>{count}</span>
      </div>
      {children}
    </fieldset>
  );
}

export function FollowUpGroups<T extends Touch>({
  touches,
  row,
  all = touches,
}: {
  touches: readonly T[];
  row: (touch: T) => ReactNode;
  all?: readonly T[];
}) {
  return [0, 1, 2, 3].map((followUp) => {
    const list = touches.filter((touch) => touch.followUp === followUp);
    if (!list.length) return null;
    return (
      <TouchGroup
        key={followUp}
        title={followUpLabel(followUp)}
        count={all.filter((touch) => touch.followUp === followUp).length}
      >
        {list.map(row)}
      </TouchGroup>
    );
  });
}

export const emptyCopy = (tab: keyof typeof t.outreachEmpty) =>
  t.outreachEmpty[tab];
