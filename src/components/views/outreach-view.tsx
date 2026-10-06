"use client";
import t from "@crm/i18n/translations/en.json";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";
import { useVerbs, useWorkspaceData } from "../crm/crm-context";
import {
  type PausedEnrollment,
  type QueueTouch,
  type Touch,
  useOutreachData,
  useOutreachSend,
} from "../outreach/outreach-data";
import { OutreachTabs } from "../outreach/outreach-tabs";
import { PausedRow } from "../outreach/paused-list";
import { PipelineBoard } from "../outreach/pipeline-board";
import { SendDialog } from "../outreach/send-dialog";
import { SentRow } from "../outreach/sent-list";
import { TouchActions } from "../outreach/touch-actions";
import { MarkSentDialog, SkipDialog } from "../outreach/touch-dialogs";
import { TouchDrawer } from "../outreach/touch-drawer";
import {
  byUrgency,
  emptyCopy,
  FollowUpGroups,
  matchesSearch,
  TouchGroup,
} from "../outreach/touch-lists";
import { TouchRow } from "../outreach/touch-row";
import { useTouchVerbs } from "../outreach/use-touch-verbs";
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
  const queryTouch = useSearchParams().get("touch");
  const openedQuery = useRef("");
  const tab = outreachTabFor(crm.pathname);
  useEffect(() => {
    if (!tab) router.replace(outreachPath("today"));
  }, [tab, router]);
  const outreach = useOutreachData();
  const { due, queue } = outreach;
  const send = useOutreachSend();
  const touches = new Map<string, Touch>(
    [
      ...(due?.groups.flatMap((group) => group.touches) ?? []),
      ...(queue?.drafts ?? []),
      ...(queue?.approved ?? []),
      ...(queue?.sent ?? []),
    ].map((touch) => [touch.id, touch]),
  );
  const verbs = useTouchVerbs({ touches, reload: outreach.reload });
  useEffect(() => {
    const key = `${crm.organizationId}:${queryTouch}`;
    if (!queryTouch || openedQuery.current === key) return;
    const touch = touches.get(queryTouch);
    if (!touch) return;
    openedQuery.current = key;
    verbs.peek(touch);
  }, [crm.organizationId, queryTouch, touches, verbs]);
  useVerbs(verbs.keys);
  if (!tab) return null;
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
      onPeek={() => verbs.peek(touch)}
      onOpen={() => open(touch)}
      actions={<TouchActions touch={touch} verbs={verbs} />}
    />
  );
  async function resume(enrollment: PausedEnrollment) {
    const result = await send<{ version: number }>({
      operation: "enrollment",
      enrollmentId: enrollment.id,
      version: enrollment.version,
      command: "resume",
    });
    if (!result.ok) return crm.notify(result.error, "danger");
    crm.notify(t.resumed.replace("{name}", enrollment.person.name), "success");
    await outreach.reload();
  }
  const drawerTouch =
    verbs.drawer && (touches.get(verbs.drawer.touch.id) ?? verbs.drawer.touch);
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
              onResume={resume}
            />
          ))}
        </TouchGroup>
      ) : null,
    sequences: () => <SequencesView />,
    pipeline: () => <PipelineBoard />,
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
      {drawerTouch && verbs.drawer && (
        <TouchDrawer
          key={drawerTouch.id}
          touch={drawerTouch}
          edit={verbs.drawer.edit}
          verbs={verbs}
          onClose={verbs.closeDrawer}
        />
      )}
      {verbs.dialog?.kind === "sent" && (
        <MarkSentDialog
          name={verbs.dialog.touch.person.name}
          onClose={verbs.closeDialog}
          onSubmit={(link) =>
            verbs.dialog
              ? verbs.markSent(verbs.dialog.touch, link)
              : Promise.resolve(null)
          }
        />
      )}
      {verbs.dialog?.kind === "send" && (
        <SendDialog
          key={verbs.dialog.touch.id}
          source={{
            kind: "touch",
            id: verbs.dialog.touch.id,
            version: verbs.versionOf(verbs.dialog.touch),
            channel: verbs.dialog.touch.channel,
            name: verbs.dialog.touch.person.name,
          }}
          onClose={verbs.closeDialog}
          onSent={() => {
            verbs.closeDrawer();
            void outreach.reload();
          }}
        />
      )}
      {verbs.dialog?.kind === "skip" && (
        <SkipDialog
          name={verbs.dialog.touch.person.name}
          onClose={verbs.closeDialog}
          onSubmit={(reason) =>
            verbs.dialog
              ? verbs.skip(verbs.dialog.touch, reason)
              : Promise.resolve(null)
          }
        />
      )}
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
