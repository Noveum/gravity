"use client";
import t from "@crm/i18n/translations/en.json";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useVerbs, useWorkspaceData } from "../crm/crm-context";
import { DeliveryChecks, useDeliveryChecks } from "../outreach/delivery-checks";
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
import { StopEnrollmentDialog } from "../outreach/sequence-dialog";
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
  Pagination,
  RecordFilters,
  useRecordBrowser,
  useRecordIndex,
} from "../records/list-browser";
import {
  type OutreachTab,
  outreachPath,
  outreachTabFor,
  sectionPath,
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
  const [stopping, setStopping] = useState<PausedEnrollment | null>(null);
  const deliveries = useDeliveryChecks(tab === "sent");
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
  const index = useRecordIndex();
  const now = Date.now();
  const rows =
    tab === "today"
      ? today
      : tab === "drafts"
        ? drafts
        : tab === "approved"
          ? approved
          : tab === "sent"
            ? sent
            : [];
  const browser = useRecordBrowser(
    tab === "sent" ? rows : byUrgency(rows, now, crm.timeZone),
    (touch) => index.facts(touch.relationshipId),
    (touch) => touch.person.name,
  );
  const pausedBrowser = useRecordBrowser(
    paused,
    (enrollment) => index.facts(enrollment.relationshipId),
    (enrollment) => enrollment.person.name,
  );
  if (!tab) return null;
  const open = (touch: Touch) => crm.openPerson(touch.relationshipId);
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
  async function stop(enrollment: PausedEnrollment) {
    const result = await send<{ version: number }>({
      operation: "enrollment",
      enrollmentId: enrollment.id,
      version: enrollment.version,
      command: "stop",
    });
    if (!result.ok) return result.error;
    crm.notify(
      t.enrollmentStopped.replace("{name}", enrollment.person.name),
      "success",
    );
    await outreach.reload();
    return null;
  }
  const drawerTouch =
    verbs.drawer && (touches.get(verbs.drawer.touch.id) ?? verbs.drawer.touch);
  const flat = (
    touches: readonly QueueTouch[],
    title: string,
    total: number,
  ) =>
    touches.length ? (
      <TouchGroup title={title} count={total}>
        {touches.map(row)}
      </TouchGroup>
    ) : null;
  const loading = tab !== "sequences" && tab !== "pipeline" && !due && !queue;
  const content: Record<OutreachTab, () => ReactNode> = {
    today: () => (
      <FollowUpGroups
        touches={browser.page.items}
        all={browser.rows}
        row={row}
      />
    ),
    drafts: () =>
      flat(
        browser.page.items as QueueTouch[],
        t.outreachTabs.drafts,
        browser.rows.length,
      ),
    approved: () =>
      flat(
        browser.page.items as QueueTouch[],
        t.outreachTabs.approved,
        browser.rows.length,
      ),
    sent: () => (
      <>
        <DeliveryChecks items={deliveries.items} reload={deliveries.reload} />
        {browser.rows.length ? (
          <TouchGroup title={t.outreachTabs.sent} count={browser.rows.length}>
            {browser.page.items.flatMap((touch) => {
              const item = sent.find((row) => row.id === touch.id);
              return item ? [<SentRow key={item.id} touch={item} />] : [];
            })}
          </TouchGroup>
        ) : null}
      </>
    ),
    paused: () =>
      pausedBrowser.rows.length ? (
        <TouchGroup
          title={t.outreachTabs.paused}
          count={pausedBrowser.rows.length}
        >
          {pausedBrowser.page.items.map((enrollment) => (
            <PausedRow
              key={enrollment.id}
              enrollment={enrollment}
              onResume={resume}
              onStop={(target) => {
                if (crm.canLeaveEditor()) setStopping(target);
              }}
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
  const activeBrowser = tab === "paused" ? pausedBrowser : browser;
  const filtered =
    !!search ||
    activeBrowser.fieldInvalid ||
    activeBrowser.fieldDrafts.some((draft) => !!draft.key) ||
    Object.entries(activeBrowser.filters).some(
      ([key, value]) => value && key !== "sort",
    );
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
            relationshipId: verbs.dialog.touch.relationshipId,
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
      {stopping && (
        <StopEnrollmentDialog
          name={stopping.person.name}
          sequenceName={stopping.sequenceName}
          onClose={() => setStopping(null)}
          onSubmit={() => stop(stopping)}
        />
      )}
      <div
        className="outreach-workspace"
        data-editor-open={drawerTouch ? "" : undefined}
      >
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
              {listTab && (
                <RecordFilters
                  browser={tab === "paused" ? pausedBrowser : browser}
                />
              )}
              {content[tab]()}
              {listTab && (
                <Pagination
                  page={tab === "paused" ? pausedBrowser.page : browser.page}
                />
              )}
              {listTab &&
                !(tab === "paused"
                  ? pausedBrowser.page.total
                  : browser.page.total) &&
                !(listTab === "sent" && deliveries.items.length) && (
                  <EmptyState
                    title={filtered ? t.noResults : emptyCopy(listTab)}
                    description={
                      filtered
                        ? t.outreachFilteredDetail
                        : t.outreachEmptyDetails[listTab]
                    }
                    action={
                      <>
                        {filtered && (
                          <button
                            type="button"
                            onClick={() => {
                              activeBrowser.clear();
                              crm.clearSearch();
                            }}
                          >
                            {t.clearFilters}
                          </button>
                        )}
                        {crm.productId && (
                          <button
                            type="button"
                            onClick={() => crm.switchProduct("")}
                          >
                            {t.actionEmpty.viewAllProducts}
                          </button>
                        )}
                        <Link className="button" href={sectionPath("people")}>
                          {t.actionEmpty.reviewPeople}
                        </Link>
                        {listTab === "today" && (
                          <Link
                            className="button"
                            href={outreachPath("drafts")}
                          >
                            {t.outreachTabs.drafts}
                          </Link>
                        )}
                        {listTab === "approved" && (
                          <Link
                            className="button"
                            href={outreachPath("drafts")}
                          >
                            {t.outreachTabs.drafts}
                          </Link>
                        )}
                        <Link
                          className="button"
                          href={outreachPath("sequences")}
                        >
                          {t.sequences}
                        </Link>
                      </>
                    }
                  />
                )}
            </>
          )}
        </section>
        {drawerTouch && verbs.drawer && (
          <TouchDrawer
            key={drawerTouch.id}
            touch={drawerTouch}
            edit={verbs.drawer.edit}
            verbs={verbs}
            onClose={verbs.closeDrawer}
          />
        )}
      </div>
    </>
  );
}
