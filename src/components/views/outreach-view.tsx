"use client";
import t from "@crm/i18n/translations/en.json";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { useWorkspaceData } from "../crm/crm-context";
import {
  type QueueTouch,
  type Touch,
  useOutreachData,
} from "../outreach/outreach-data";
import { OutreachTabs } from "../outreach/outreach-tabs";
import { PausedRow } from "../outreach/paused-list";
import { SentRow } from "../outreach/sent-list";
import {
  byUrgency,
  emptyCopy,
  FollowUpGroups,
  matchesSearch,
  TouchGroup,
} from "../outreach/touch-lists";
import { TouchRow } from "../outreach/touch-row";
import {
  type OutreachTab,
  outreachPath,
  outreachTabFor,
  personPath,
} from "../routes";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";
import { SequencesView } from "./sequences-view";

export function OutreachView() {
  const crm = useWorkspaceData();
  const router = useRouter();
  const tab = outreachTabFor(crm.pathname);
  useEffect(() => {
    if (!tab) router.replace(outreachPath("today"));
  }, [tab, router]);
  const outreach = useOutreachData();
  if (!tab) return null;
  const { due, queue } = outreach;
  const search = crm.search;
  const visible = <T extends Touch>(touches: readonly T[]) =>
    touches.filter((touch) =>
      matchesSearch(search, touch.person.name, touch.draft),
    );
  const today = visible(due?.groups.flatMap((group) => group.touches) ?? []);
  const drafts = visible(queue?.drafts ?? []);
  const approved = visible(queue?.approved ?? []);
  const sent = visible(queue?.sent ?? []);
  const paused = (queue?.paused ?? []).filter((enrollment) =>
    matchesSearch(search, enrollment.person.name, enrollment.sequenceName),
  );
  const now = Date.now();
  const open = (touch: Touch) =>
    crm.go(
      personPath(touch.person.id, { relationshipId: touch.relationshipId }),
    );
  const row = (touch: Touch) => (
    <TouchRow
      key={touch.id}
      touch={touch}
      now={now}
      onPeek={() => open(touch)}
      onOpen={() => open(touch)}
    />
  );
  const flat = (touches: readonly QueueTouch[], title: string) =>
    touches.length ? (
      <TouchGroup title={title} count={touches.length}>
        {byUrgency(touches, now, crm.timeZone).map(row)}
      </TouchGroup>
    ) : null;
  const loading = tab !== "sequences" && tab !== "pipeline" && !due && !queue;
  const content: Record<OutreachTab, () => ReactNode> = {
    today: () => <FollowUpGroups touches={today} now={now} row={row} />,
    drafts: () => flat(drafts, t.outreachTabs.drafts),
    approved: () => flat(approved, t.outreachTabs.approved),
    sent: () =>
      sent.length ? (
        <TouchGroup title={t.outreachTabs.sent} count={sent.length}>
          {sent.map((touch) => (
            <SentRow key={touch.id} touch={touch} />
          ))}
        </TouchGroup>
      ) : null,
    paused: () =>
      paused.length ? (
        <TouchGroup title={t.outreachTabs.paused} count={paused.length}>
          {paused.map((enrollment) => (
            <PausedRow
              key={enrollment.id}
              enrollment={enrollment}
              onResume={() => undefined}
            />
          ))}
        </TouchGroup>
      ) : null,
    sequences: () => <SequencesView />,
    pipeline: () => null,
  };
  const counts: Record<keyof typeof t.outreachEmpty, number> = {
    today: today.length,
    drafts: drafts.length,
    approved: approved.length,
    sent: sent.length,
    paused: paused.length,
  };
  const listTab = tab in counts ? (tab as keyof typeof counts) : null;
  return (
    <>
      <OutreachTabs
        tab={tab}
        counts={{
          today: counts.today,
          drafts: counts.drafts,
          approved: counts.approved,
          paused: counts.paused,
        }}
      />
      <section
        aria-label={`${t.outreach}: ${t.outreachTabs[tab]}`}
        className="outreach-panel"
      >
        {outreach.failed && !due && !queue ? (
          <ErrorState
            title={t.outreachLoadError}
            onRetry={() => void outreach.reload()}
          />
        ) : loading ? (
          <LoadingState />
        ) : (
          <>
            {content[tab]()}
            {listTab && !counts[listTab] && (
              <EmptyState
                title={emptyCopy(listTab)}
                description={t.outreachEmptyDetail}
                compact
              />
            )}
          </>
        )}
      </section>
    </>
  );
}
