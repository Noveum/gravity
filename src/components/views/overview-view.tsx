"use client";
import { money, overview, totals } from "@crm/core/analytics";
import type { ClientSnapshot } from "@crm/core/dto";
import { productColorToken } from "@crm/core/product-colors";
import t from "@crm/i18n/translations/en.json";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarDays,
  ChartNoAxesCombined,
  Clock3,
  Mail,
  Plus,
  Reply,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { dateLabel, errorText, requestJson } from "../client-api";
import { useWorkspaceData } from "../crm/crm-context";
import { useModalLifecycle } from "../modal-lifecycle";
import { followUpLabel } from "../outreach/touch-labels";

interface Drill {
  title: string;
  kind: "deals" | "actions" | "messages" | "meetings" | "touches";
  ids?: string[];
  ownerId?: string;
  direction?: "inbound" | "outbound";
  day?: string;
}
const values = (rows: ReturnType<typeof totals>) =>
  rows.length
    ? rows.map((r) => money(r.amountMinor, r.currency)).join(" · ")
    : "—";
export function OverviewView() {
  const crm = useWorkspaceData();
  const [days, setDays] = useState(30);
  const [ownerId, setOwner] = useState("");
  const [channel, setChannel] = useState("");
  const [drill, setDrill] = useState<Drill | null>(null);
  const lastScope = useRef(`${crm.organizationId}:${crm.productId}`);
  useEffect(() => {
    const scope = `${crm.organizationId}:${crm.productId}`;
    if (lastScope.current === scope) return;
    lastScope.current = scope;
    setOwner("");
    setDrill(null);
  }, [crm.organizationId, crm.productId]);
  const report = useMemo(
    () =>
      overview(crm.data, { days, timeZone: crm.timeZone, ownerId, channel }),
    [crm.data, days, crm.timeZone, ownerId, channel],
  );
  const activityMaximum = Math.max(
    1,
    ...report.days.map((day) => day.inbound + day.outbound),
  );
  const open = (
    title: string,
    kind: Drill["kind"],
    rows: { id: string }[],
    extra: Partial<Drill> = {},
  ) => setDrill({ title, kind, ids: rows.map((r) => r.id), ...extra });
  const metrics = [
    {
      title: t.overdueFollowups,
      value: String(report.overdue.length),
      icon: Clock3,
      action: () => open(t.overdueFollowups, "actions", report.overdue),
      className: report.overdue.length ? "attention" : "",
    },
    {
      title: t.dueToday,
      value: String(report.dueToday.length),
      icon: CalendarDays,
      action: () => open(t.dueToday, "actions", report.dueToday),
    },
    {
      title: t.messagesSent,
      value: String(report.sent),
      icon: Mail,
      action: () =>
        setDrill({
          title: t.messagesSent,
          kind: "messages",
          direction: "outbound",
          ownerId,
        }),
    },
    {
      title: t.repliesReceived,
      value: String(report.received),
      icon: Reply,
      action: () =>
        setDrill({
          title: t.repliesReceived,
          kind: "messages",
          direction: "inbound",
          ownerId,
        }),
    },
    {
      title: t.pipelineValue,
      value: values(report.pipelineValue),
      icon: BriefcaseBusiness,
      action: () => open(t.openPipeline, "deals", report.open),
    },
    {
      title: t.expectedRevenue,
      value: values(report.weightedValue),
      icon: ChartNoAxesCombined,
      action: () =>
        open(
          t.expectedRevenue,
          "deals",
          report.open.filter(
            (deal) => deal.amountMinor !== null && deal.probability !== null,
          ),
        ),
    },
  ];
  return (
    <div className="page-content overview-page">
      <div className="overview-controls">
        <div>
          <h2>{t.overview}</h2>
          <p className="muted">{t.analyticsFresh}</p>
        </div>
        <div className="overview-filters">
          <label className="sr-only" htmlFor="overview-period">
            {t.reportingPeriod}
          </label>
          <select
            id="overview-period"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>{t.last7Days}</option>
            <option value={30}>{t.last30Days}</option>
            <option value={90}>{t.last90Days}</option>
          </select>
          <label className="sr-only" htmlFor="overview-owner">
            {t.reportOwner}
          </label>
          <select
            id="overview-owner"
            value={ownerId}
            onChange={(e) => setOwner(e.target.value)}
          >
            <option value="">{t.allTeamMembers}</option>
            {crm.data.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="overview-channel">
            {t.channel}
          </label>
          <select
            id="overview-channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          >
            <option value="">{t.allChannels}</option>
            <option value="gmail">{t.gmail}</option>
            <option value="linkedin">{t.linkedin}</option>
          </select>
          <Link className="button primary" href="/opportunities?deal=new">
            <Plus size={14} aria-hidden />
            {t.newDeal}
          </Link>
        </div>
      </div>
      <p className="overview-scope muted">{t.overviewScopeNote}</p>
      <div className="metric-grid">
        {metrics.map((metric) => (
          <button
            type="button"
            key={metric.title}
            className={`metric-card ${metric.className ?? ""}`}
            aria-label={`${metric.title}: ${metric.value}`}
            onClick={metric.action}
          >
            <span className="metric-label">
              <metric.icon size={15} aria-hidden />
              {metric.title}
              <ArrowUpRight size={13} aria-hidden />
            </span>
            <strong>{metric.value}</strong>
          </button>
        ))}
      </div>
      <p className="muted report-note forecast-explanation">
        {t.forecastCoverage
          .replace(
            "{included}",
            String(
              report.open.filter(
                (deal) =>
                  deal.amountMinor !== null && deal.probability !== null,
              ).length,
            ),
          )
          .replace("{total}", String(report.open.length))}{" "}
        {t.forecastFormula}
      </p>
      <div className="overview-grid">
        <section className="report-card report-wide">
          <div className="section-heading">
            <h2>
              <ChartNoAxesCombined size={17} aria-hidden />
              {t.outreachActivity}
            </h2>
            <div className="chart-legend">
              <span className="sent-dot" />
              {t.messagesSent}
              <span className="received-dot" />
              {t.repliesReceived}
            </div>
          </div>
          <div className="activity-chart">
            {report.days.map((day) => {
              return (
                <button
                  type="button"
                  key={day.day}
                  className="chart-day"
                  title={`${day.day}: ${t.messagesSent} ${day.outbound}, ${t.repliesReceived} ${day.inbound}`}
                  aria-label={`${day.day}: ${t.messagesSent} ${day.outbound}, ${t.repliesReceived} ${day.inbound}`}
                  onClick={() =>
                    setDrill({
                      title: day.day,
                      kind: "messages",
                      day: day.day,
                      ownerId,
                    })
                  }
                >
                  <span className="bar-stack">
                    <span
                      className="activity-bar received"
                      style={{
                        height: `${(day.inbound / activityMaximum) * 100}%`,
                      }}
                    />
                    <span
                      className="activity-bar sent"
                      style={{
                        height: `${(day.outbound / activityMaximum) * 100}%`,
                      }}
                    />
                  </span>
                </button>
              );
            })}
          </div>
          <div className="chart-axis">
            <span>{report.from}</span>
            <span>{report.through}</span>
          </div>
          <p className="muted report-note">{t.messageHistoryNote}</p>
        </section>
        <section className="report-card">
          <h2>{t.followupHealth}</h2>
          {[
            [t.followups, report.pending],
            [t.waitingForThem, report.waiting],
            [t.blockedFollowups, report.blocked],
            [t.completedFollowups, report.completed],
          ].map(([title, rows]) => (
            <button
              type="button"
              className="report-row"
              key={String(title)}
              onClick={() =>
                open(
                  String(title),
                  "actions",
                  rows as ClientSnapshot["actions"],
                )
              }
            >
              <span>{String(title)}</span>
              <strong>{(rows as ClientSnapshot["actions"]).length}</strong>
              <ArrowUpRight size={13} aria-hidden />
            </button>
          ))}
          <p className="muted report-note">{t.followupCompletionNote}</p>
        </section>
        <section className="report-card report-wide">
          <div className="section-heading">
            <h2>{t.pipelineByStage}</h2>
            <Link className="text-button" href="/opportunities">
              {t.viewRecords}
              <ArrowUpRight size={13} aria-hidden />
            </Link>
          </div>
          {crm.data.pipelines
            .filter((p) => !crm.productId || p.productId === crm.productId)
            .map((pipeline) => {
              const deals = report.open.filter(
                (d) =>
                  crm.data.stages.find((s) => s.id === d.stageId)
                    ?.pipelineId === pipeline.id,
              );
              return (
                <div className="overview-pipeline" key={pipeline.id}>
                  <Link
                    className="pipeline-heading"
                    href={`/opportunities?pipeline=${pipeline.id}${ownerId ? `&owner=${ownerId}` : ""}`}
                  >
                    <span
                      className="product-dot"
                      style={{
                        background: productColorToken(
                          crm.product(pipeline.productId)?.colorKey ?? "",
                        ),
                      }}
                    />
                    {crm.product(pipeline.productId)?.name}
                    <span className="muted">/</span>
                    {pipeline.name}
                    <strong>{values(totals(deals))}</strong>
                    <ArrowUpRight size={13} aria-hidden />
                  </Link>
                  <div className="stage-chart">
                    {crm.data.stages
                      .filter((s) => s.pipelineId === pipeline.id)
                      .map((stage) => {
                        const matching = report.deals.filter(
                          (d) => d.stageId === stage.id,
                        );
                        return (
                          <button
                            type="button"
                            key={stage.id}
                            className={`stage-summary stage-${stage.category}`}
                            onClick={() =>
                              open(
                                `${pipeline.name} · ${stage.name}`,
                                "deals",
                                matching,
                              )
                            }
                          >
                            <span>{stage.name}</span>
                            <strong>{matching.length}</strong>
                            <small>{values(totals(matching))}</small>
                            <span
                              className="stage-meter"
                              style={{
                                width: `${Math.max(3, (matching.length / Math.max(1, report.deals.length)) * 100)}%`,
                              }}
                            />
                          </button>
                        );
                      })}
                  </div>
                </div>
              );
            })}
          {!crm.data.pipelines.length && (
            <Link href="/opportunities" className="text-button">
              {t.noDealsDescription}
            </Link>
          )}
          <div className="pipeline-summary">
            <button
              type="button"
              onClick={() => open(t.wonValue, "deals", report.won)}
            >
              <span>{t.wonValue}</span>
              <strong>{values(report.wonValue)}</strong>
            </button>
            <button
              type="button"
              onClick={() =>
                open(
                  t.averageDealSize,
                  "deals",
                  report.open.filter((d) => d.amountMinor !== null),
                )
              }
            >
              <span>{t.averageDealSize}</span>
              <strong>{values(report.averageValue)}</strong>
            </button>
            <button
              type="button"
              onClick={() => open(t.closedDeals, "deals", report.closed)}
            >
              <span>{t.winRate}</span>
              <strong>
                {report.winRate === null ? "—" : `${report.winRate}%`}
              </strong>
            </button>
            <button
              type="button"
              onClick={() => open(t.meetingsHeld, "meetings", report.meetings)}
            >
              <span>{t.meetingsHeld}</span>
              <strong>{report.meetings.length}</strong>
            </button>
          </div>
          <p className="muted report-note">{t.moneyCoverageNote}</p>
        </section>
        <section className="report-card">
          <h2>{t.overviewOutreachQueue}</h2>
          {[
            { title: t.outreachDueNow, rows: report.outreachDue },
            { title: t.outreachOverdue, rows: report.outreachOverdue },
            {
              title: t.outreachFollowupsPlanned,
              rows: report.outreachFollowups,
            },
            { title: t.outreachReportedSent, rows: report.reportedSent },
          ].map(({ title, rows }) => (
            <button
              type="button"
              className="report-row"
              key={title}
              onClick={() => open(title, "touches", rows)}
            >
              <span>{title}</span>
              <strong>{rows.length}</strong>
              <ArrowUpRight size={13} aria-hidden />
            </button>
          ))}
          <p className="muted report-note">{t.outreachReportNote}</p>
        </section>
        <section className="report-card">
          <h2>{t.dealDataHealth}</h2>
          {[
            [t.missingAmount, report.missingAmount],
            [t.missingProbability, report.missingProbability],
            [t.missingCloseDate, report.missingCloseDate],
            [t.pastCloseDate, report.pastCloseDate],
            [t.noNextAction, report.noNextAction],
          ].map(([title, rows]) => (
            <button
              type="button"
              className="report-row"
              key={String(title)}
              onClick={() =>
                open(
                  String(title),
                  "deals",
                  rows as ClientSnapshot["opportunities"],
                )
              }
            >
              <span>{String(title)}</span>
              <strong>
                {(rows as ClientSnapshot["opportunities"]).length}
              </strong>
              <ArrowUpRight size={13} aria-hidden />
            </button>
          ))}
        </section>
        <section className="report-card report-wide">
          <h2>{t.teamActivity}</h2>
          <div className="report-table">
            <table>
              <thead>
                <tr>
                  <th>{t.owner}</th>
                  <th>{t.messagesSent}</th>
                  <th>{t.repliesReceived}</th>
                  <th>{t.overdueFollowups}</th>
                  <th>{t.openDeals}</th>
                  <th>{t.pipelineValue}</th>
                </tr>
              </thead>
              <tbody>
                {crm.data.members
                  .filter((m) => !ownerId || m.id === ownerId)
                  .map((member) => {
                    const team = overview(crm.data, {
                      days,
                      timeZone: crm.timeZone,
                      ownerId: member.id,
                      channel,
                    });
                    return (
                      <tr key={member.id}>
                        <td>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => setOwner(member.id)}
                          >
                            {member.name}
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              setDrill({
                                title: `${member.name} · ${t.messagesSent}`,
                                kind: "messages",
                                ownerId: member.id,
                                direction: "outbound",
                              })
                            }
                          >
                            {team.sent}
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              setDrill({
                                title: `${member.name} · ${t.repliesReceived}`,
                                kind: "messages",
                                ownerId: member.id,
                                direction: "inbound",
                              })
                            }
                          >
                            {team.received}
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              open(
                                `${member.name} · ${t.overdueFollowups}`,
                                "actions",
                                team.overdue,
                              )
                            }
                          >
                            {team.overdue.length}
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              open(
                                `${member.name} · ${t.openDeals}`,
                                "deals",
                                team.open,
                              )
                            }
                          >
                            {team.open.length}
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              open(
                                `${member.name} · ${t.pipelineValue}`,
                                "deals",
                                team.open,
                              )
                            }
                          >
                            {values(team.pipelineValue)}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p className="muted report-note">{t.messageOwnerNote}</p>
        </section>
        <section className="report-card">
          <h2>{t.needsYourAttention}</h2>
          {report.overdue.slice(0, 5).map((action) => (
            <button
              type="button"
              className="attention-row"
              key={action.id}
              onClick={() => crm.openPerson(action.relationshipId, action.id)}
            >
              <strong>{crm.personFor(action.relationshipId)?.name}</strong>
              <span>{action.title}</span>
              <small>{dateLabel(action.dueAt, crm.timeZone)}</small>
            </button>
          ))}
          {!report.overdue.length && <p className="muted">{t.noReportRows}</p>}
        </section>
      </div>
      {drill && (
        <ReportDrawer
          key={`${crm.organizationId}:${crm.productId}:${drill.title}`}
          drill={drill}
          from={report.from}
          through={report.through}
          channel={channel}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}
interface MessageRow {
  id: string;
  relationshipId: string;
  productId: string;
  direction: string;
  channel: string;
  occurredAt: string;
  preview: string;
}
function ReportDrawer({
  drill,
  from,
  through,
  channel,
  onClose,
}: {
  drill: Drill;
  from: string;
  through: string;
  channel: string;
  onClose: () => void;
}) {
  const crm = useWorkspaceData();
  const modal = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState(0);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useModalLifecycle(modal);
  useEffect(() => {
    if (drill.kind !== "messages") return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setMessages([]);
    const q = new URLSearchParams({
      operation: "messageActivity",
      organizationId: crm.organizationId,
      from: drill.day ?? from,
      through: drill.day ?? through,
      page: String(page),
      // Refresh open message reports when the live workspace snapshot changes.
      _snapshot: crm.data.asOf,
    });
    if (crm.productId) q.set("productId", crm.productId);
    if (drill.ownerId) q.set("ownerId", drill.ownerId);
    if (drill.direction) q.set("direction", drill.direction);
    if (channel) q.set("channel", channel);
    requestJson<{ items: MessageRow[]; hasMore: boolean }>(`/api/crm?${q}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) {
          setMessages(result.items);
          setMore(result.hasMore);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    drill,
    from,
    through,
    channel,
    page,
    crm.organizationId,
    crm.productId,
    crm.data.asOf,
  ]);
  const ids = new Set(drill.ids ?? []);
  const rows =
    drill.kind === "deals"
      ? crm.data.opportunities.filter((r) => ids.has(r.id))
      : drill.kind === "actions"
        ? crm.data.actions.filter((r) => ids.has(r.id))
        : drill.kind === "meetings"
          ? crm.data.meetings.filter((r) => ids.has(r.id))
          : drill.kind === "touches"
            ? crm.data.touchStats.filter((r) => ids.has(r.id))
            : [];
  return (
    <dialog
      ref={modal}
      className="dialog analytics-drawer"
      aria-labelledby="report-title"
      onCancel={onClose}
    >
      <div className="section-heading">
        <h2 id="report-title">{drill.title}</h2>
        <button type="button" aria-label={t.close} onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </div>
      {loading && <p role="status">{t.loading}</p>}
      {error && <p role="alert">{error}</p>}
      {drill.kind === "messages"
        ? messages.map((message) => (
            <button
              type="button"
              className="drill-row"
              key={message.id}
              onClick={() => {
                onClose();
                crm.openPerson(message.relationshipId);
              }}
            >
              <strong>{crm.personFor(message.relationshipId)?.name}</strong>
              <span>{message.preview}</span>
              <small>
                {message.channel} ·{" "}
                {message.direction === "outbound"
                  ? t.messagesSent
                  : t.repliesReceived}{" "}
                · {dateLabel(message.occurredAt, crm.timeZone)}
              </small>
            </button>
          ))
        : rows.map((row) => (
            <button
              type="button"
              className="drill-row"
              key={row.id}
              onClick={() => {
                onClose();
                if (drill.kind === "deals")
                  crm.go(`/opportunities?deal=${row.id}`);
                else if (drill.kind === "touches" && "status" in row)
                  crm.go(
                    `/outreach/${row.status === "sent" ? "sent" : "today"}?touch=${row.id}`,
                  );
                else if (drill.kind === "actions")
                  crm.openPerson(row.relationshipId, row.id);
                else crm.reveal("meetings", row.id);
              }}
            >
              <strong>
                {"name" in row
                  ? row.name
                  : "title" in row
                    ? row.title
                    : followUpLabel(row.followUp)}
              </strong>
              <span>
                {crm.personFor(row.relationshipId)?.name} ·{" "}
                {crm.product(row.productId)?.name}
              </span>
              <small>
                {"amountMinor" in row
                  ? row.amountMinor === null
                    ? t.amountUnknown
                    : money(row.amountMinor, row.currency)
                  : "dueAt" in row
                    ? dateLabel(row.dueAt, crm.timeZone)
                    : dateLabel(row.startsAt, crm.timeZone)}
              </small>
            </button>
          ))}
      {!loading &&
        !error &&
        !(drill.kind === "messages" ? messages.length : rows.length) && (
          <p className="muted">{t.noReportRows}</p>
        )}
      {drill.kind === "messages" && (
        <div className="dialog-actions">
          <button
            type="button"
            disabled={!page || loading}
            onClick={() => setPage((p) => p - 1)}
          >
            {t.previousPage}
          </button>
          <button
            type="button"
            disabled={!more || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            {t.nextPage}
          </button>
        </div>
      )}
    </dialog>
  );
}
