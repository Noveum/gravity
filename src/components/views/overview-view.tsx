"use client";
import { money, overview, totals, weightedAmount } from "@crm/core/analytics";
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
import { followUpLabel } from "../outreach/touch-labels";
import { Pagination, useListPage } from "../records/list-browser";
import { Select } from "../ui/select";
import "./overview.css";

interface Drill {
  title: string;
  kind: "deals" | "actions" | "messages" | "meetings" | "touches";
  ids?: string[];
  ownerId?: string;
  direction?: "inbound" | "outbound";
  day?: string;
  revenue?: "open" | "weighted";
}
const values = (rows: ReturnType<typeof totals>) =>
  rows.length
    ? rows.map((r) => money(r.amountMinor, r.currency)).join(" · ")
    : "—";
const reportDayLabel = (day: string) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
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
  const activityCount = report.sent + report.received;
  const rawMaximum = Math.max(
    1,
    ...report.days.map((day) => Math.max(day.inbound, day.outbound)),
  );
  const activityStep = Math.max(1, Math.ceil(rawMaximum / 4));
  const activityTicks =
    rawMaximum <= 4
      ? Array.from({ length: rawMaximum + 1 }, (_, index) => rawMaximum - index)
      : [4, 3, 2, 1, 0].map((step) => step * activityStep);
  const activityMaximum = activityTicks[0];
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
      className: "metric-money",
      action: () =>
        open(t.openPipeline, "deals", report.open, { revenue: "open" }),
    },
    {
      title: t.expectedRevenue,
      value: values(report.weightedValue),
      icon: ChartNoAxesCombined,
      className: "metric-money",
      action: () =>
        open(
          t.expectedRevenue,
          "deals",
          report.open.filter(
            (deal) => deal.amountMinor !== null && deal.probability !== null,
          ),
          { revenue: "weighted" },
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
          <div className="overview-filter">
            <span>{t.reportingPeriod}</span>
            <Select
              label={t.reportingPeriod}
              value={String(days)}
              onChange={(value) => {
                setDays(Number(value));
                setDrill(null);
              }}
              options={[
                { value: "7", label: t.last7Days },
                { value: "30", label: t.last30Days },
                { value: "90", label: t.last90Days },
              ]}
            />
          </div>
          <div className="overview-filter">
            <span>{t.reportOwner}</span>
            <Select
              label={t.reportOwner}
              value={ownerId}
              onChange={(value) => {
                setOwner(value);
                setDrill(null);
              }}
              options={[
                { value: "", label: t.allTeamMembers },
                ...crm.data.members.map((member) => ({
                  value: member.id,
                  label: member.name,
                })),
              ]}
            />
          </div>
          <div className="overview-filter">
            <span>{t.channel}</span>
            <Select
              label={t.channel}
              value={channel}
              onChange={(value) => {
                setChannel(value);
                setDrill(null);
              }}
              options={[
                { value: "", label: t.allChannels },
                { value: "gmail", label: t.gmail },
                { value: "linkedin", label: t.linkedin },
              ]}
            />
          </div>
          <button
            type="button"
            className="primary"
            onClick={() => crm.openRecordDialog({ kind: "opportunity" })}
          >
            <Plus size={14} aria-hidden />
            {t.newDeal}
          </button>
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
              {t.messagesSent} <strong>{report.sent}</strong>
              <span className="received-dot" />
              {t.repliesReceived} <strong>{report.received}</strong>
            </div>
          </div>
          <div className="activity-summary">
            <div>
              <span>{t.activityTotal}</span>
              <strong>{activityCount}</strong>
            </div>
            <div>
              <span>{t.activityActiveDays}</span>
              <strong>
                {
                  report.days.filter((day) => day.inbound + day.outbound > 0)
                    .length
                }
                <small> / {days}</small>
              </strong>
            </div>
            <p className="muted">
              {reportDayLabel(report.from)} – {reportDayLabel(report.through)}
            </p>
          </div>
          {activityCount ? (
            <fieldset className="activity-plot" aria-label={t.messageActivity}>
              <div className="activity-y-axis" aria-hidden>
                {activityTicks.map((count) => (
                  <span key={count}>{count}</span>
                ))}
              </div>
              <div className="activity-plot-body">
                <div className="activity-gridlines" aria-hidden>
                  {activityTicks.map((count) => (
                    <span key={count} />
                  ))}
                </div>
                <div className="activity-chart">
                  {report.days.map((day) => (
                    <button
                      type="button"
                      key={day.day}
                      className="chart-day"
                      title={`${day.day}: ${t.messagesSent} ${day.outbound}, ${t.repliesReceived} ${day.inbound}`}
                      aria-label={`${day.day}: ${t.messagesSent} ${day.outbound}, ${t.repliesReceived} ${day.inbound}`}
                      onClick={() =>
                        setDrill({
                          title: reportDayLabel(day.day),
                          kind: "messages",
                          day: day.day,
                          ownerId,
                        })
                      }
                    >
                      <span className="activity-series">
                        {(
                          [
                            ["sent", day.outbound],
                            ["received", day.inbound],
                          ] as const
                        ).map(([series, count]) => (
                          <span
                            key={series}
                            className={`activity-bar ${series}`}
                            style={{
                              height: `${(count / activityMaximum) * 100}%`,
                            }}
                          >
                            {count > 0 && days <= 30 && (
                              <span className="activity-bar-count" aria-hidden>
                                {count}
                              </span>
                            )}
                          </span>
                        ))}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="chart-axis" aria-hidden>
                  {[0, Math.floor((days - 1) / 2), days - 1].map((index) => (
                    <span key={index}>
                      {new Intl.DateTimeFormat("en", {
                        month: "short",
                        day: "numeric",
                        timeZone: "UTC",
                      }).format(
                        new Date(`${report.days[index].day}T12:00:00Z`),
                      )}
                    </span>
                  ))}
                </div>
              </div>
            </fieldset>
          ) : (
            <div className="activity-empty">
              <Mail size={24} aria-hidden />
              <strong>{t.activityEmptyTitle}</strong>
              <p>{t.activityEmptyDescription}</p>
              <Link className="text-button" href="/settings/connections">
                {t.reviewConnections}
                <ArrowUpRight size={14} aria-hidden />
              </Link>
            </div>
          )}
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
            .filter(
              (p) =>
                (!crm.productId || p.productId === crm.productId) &&
                report.deals.some(
                  (deal) =>
                    crm.data.stages.find((stage) => stage.id === deal.stageId)
                      ?.pipelineId === p.id,
                ),
            )
            .map((pipeline) => {
              const deals = report.open.filter(
                (d) =>
                  crm.data.stages.find((s) => s.id === d.stageId)
                    ?.pipelineId === pipeline.id,
              );
              return (
                <div className="overview-pipeline" key={pipeline.id}>
                  <button
                    type="button"
                    className="pipeline-heading"
                    onClick={() =>
                      open(
                        `${crm.product(pipeline.productId)?.name} / ${pipeline.name}`,
                        "deals",
                        deals,
                      )
                    }
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
                  </button>
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
          {!report.deals.length && (
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
                            onClick={() => {
                              setOwner(member.id);
                              setDrill(null);
                            }}
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
  const heading = useRef<HTMLHeadingElement>(null);
  const [page, setPage] = useState(0);
  const [messageResponse, setMessageResponse] = useState<{
    scope: string;
    items: MessageRow[];
    hasMore: boolean;
    loading: boolean;
    error: string;
  } | null>(null);
  const messageScope = useMemo(() => {
    if (drill.kind !== "messages") return "";
    const query = new URLSearchParams({
      operation: "messageActivity",
      organizationId: crm.organizationId,
      from: drill.day ?? from,
      through: drill.day ?? through,
      page: String(page),
      _snapshot: crm.data.asOf,
    });
    if (crm.productId) query.set("productId", crm.productId);
    if (drill.ownerId) query.set("ownerId", drill.ownerId);
    if (drill.direction) query.set("direction", drill.direction);
    if (channel) query.set("channel", channel);
    return query.toString();
  }, [
    drill.kind,
    drill.day,
    drill.ownerId,
    drill.direction,
    from,
    through,
    channel,
    page,
    crm.organizationId,
    crm.productId,
    crm.data.asOf,
  ]);
  // A refreshed snapshot may revoke access before the fetch effect runs.
  const currentResponse =
    messageResponse?.scope === messageScope ? messageResponse : null;
  const messages = currentResponse?.items ?? [];
  const more = currentResponse?.hasMore ?? false;
  const loading = !!messageScope && (currentResponse?.loading ?? true);
  const error = currentResponse?.error ?? "";
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        event.target instanceof Node &&
        heading.current?.closest("section")?.contains(event.target)
      ) {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "nearest" });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (!messageScope) return;
    const controller = new AbortController();
    setMessageResponse({
      scope: messageScope,
      items: [],
      hasMore: false,
      loading: true,
      error: "",
    });
    requestJson<{ items: MessageRow[]; hasMore: boolean }>(
      `/api/crm?${messageScope}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted)
          setMessageResponse({
            scope: messageScope,
            ...result,
            loading: false,
            error: "",
          });
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setMessageResponse({
            scope: messageScope,
            items: [],
            hasMore: false,
            loading: false,
            error: errorText(cause),
          });
      });
    return () => controller.abort();
  }, [messageScope]);
  const ids = new Set(drill.ids ?? []);
  const deals = crm.data.opportunities.filter((deal) => ids.has(deal.id));
  const rows =
    drill.kind === "deals"
      ? deals
      : drill.kind === "actions"
        ? crm.data.actions.filter((r) => ids.has(r.id))
        : drill.kind === "meetings"
          ? crm.data.meetings.filter((r) => ids.has(r.id))
          : drill.kind === "touches"
            ? crm.data.touchStats.filter((r) => ids.has(r.id))
            : [];
  const rowPage = useListPage<(typeof rows)[number]>(rows, drill.title);
  return (
    <section className="inline-report" aria-labelledby="report-title">
      <div className="section-heading">
        <h2 ref={heading} tabIndex={-1} id="report-title">
          {drill.title}
          <span className="report-record-count">
            {drill.kind === "messages" ? "" : rows.length}
          </span>
        </h2>
        <button type="button" aria-label={t.close} onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </div>
      {drill.kind === "deals" && drill.revenue && (
        <>
          <div className="revenue-summary">
            <div>
              <span>
                {drill.revenue === "weighted"
                  ? t.expectedRevenue
                  : t.pipelineValue}
              </span>
              <strong>
                {values(totals(deals, drill.revenue === "weighted"))}
              </strong>
            </div>
            <div>
              <span>
                {drill.revenue === "weighted"
                  ? t.forecastIncludedDeals
                  : t.openDeals}
              </span>
              <strong>{deals.length}</strong>
            </div>
            <div>
              <span>
                {drill.revenue === "weighted" ? t.pipelineValue : t.pricedDeals}
              </span>
              <strong>
                {drill.revenue === "weighted"
                  ? values(totals(deals))
                  : deals.filter((deal) => deal.amountMinor !== null).length}
              </strong>
            </div>
          </div>
          {drill.revenue && (
            <p className="muted report-description">
              {drill.revenue === "weighted"
                ? t.forecastFormula
                : t.pipelineValueNote}
            </p>
          )}
        </>
      )}
      {loading && <p role="status">{t.loading}</p>}
      {error && <p role="alert">{error}</p>}
      {drill.kind === "deals" && rows.length > 0 && (
        <div className="report-table drill-table">
          <table>
            <thead>
              <tr>
                <th scope="col">{t.dealName}</th>
                <th scope="col">{t.product}</th>
                <th scope="col">{t.stage}</th>
                <th scope="col">{t.owner}</th>
                <th scope="col" className="numeric">
                  {t.dealAmount}
                </th>
                <th scope="col" className="numeric">
                  {t.forecastProbability}
                </th>
                <th scope="col" className="numeric">
                  {t.expectedRevenue}
                </th>
                <th scope="col">{t.expectedCloseDate}</th>
              </tr>
            </thead>
            <tbody>
              {(rowPage.items as ClientSnapshot["opportunities"]).map(
                (deal) => {
                  const expected = weightedAmount(
                    deal.amountMinor,
                    deal.probability,
                  );
                  const dealOwner =
                    deal.ownerId ??
                    crm.data.relationships.find(
                      (relationship) => relationship.id === deal.relationshipId,
                    )?.ownerId;
                  return (
                    <tr key={deal.id}>
                      <td className="drill-identity">
                        <button
                          type="button"
                          className="text-button drill-record-button"
                          onClick={() =>
                            crm.openRecordDialog({
                              kind: "opportunity",
                              id: deal.id,
                            })
                          }
                        >
                          {deal.name}
                        </button>
                        <span className="muted">
                          {crm.personFor(deal.relationshipId)?.name}
                        </span>
                      </td>
                      <td>
                        {crm.product(deal.productId)?.name ?? t.unspecified}
                      </td>
                      <td>
                        {crm.data.stages.find(
                          (stage) => stage.id === deal.stageId,
                        )?.name ?? t.unspecified}
                      </td>
                      <td>
                        {crm.data.members.find(
                          (member) => member.id === dealOwner,
                        )?.name ?? t.unspecified}
                      </td>
                      <td
                        className="numeric"
                        title={
                          deal.amountMinor === null
                            ? t.amountUnknown
                            : undefined
                        }
                      >
                        {deal.amountMinor === null
                          ? "—"
                          : money(deal.amountMinor, deal.currency)}
                      </td>
                      <td className="numeric">
                        {deal.probability === null
                          ? "—"
                          : `${deal.probability}%`}
                      </td>
                      <td
                        className="numeric forecast-cell"
                        title={
                          expected === null ? t.forecastUnknown : undefined
                        }
                      >
                        {expected === null
                          ? "—"
                          : money(expected, deal.currency)}
                      </td>
                      <td>
                        {deal.expectedCloseDate
                          ? reportDayLabel(deal.expectedCloseDate)
                          : "—"}
                      </td>
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </div>
      )}
      {drill.kind === "messages" && messages.length > 0 && (
        <div className="report-table drill-table">
          <table>
            <thead>
              <tr>
                <th scope="col">{t.person}</th>
                <th scope="col">{t.messageActivity}</th>
                <th scope="col">{t.channel}</th>
                <th scope="col">{t.activityDate}</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((message) => (
                <tr key={message.id}>
                  <td>
                    <button
                      type="button"
                      className="text-button drill-record-button"
                      onClick={() => crm.openPerson(message.relationshipId)}
                    >
                      {crm.personFor(message.relationshipId)?.name}
                    </button>
                  </td>
                  <td className="drill-message">
                    <span>{message.preview}</span>
                    <small className="muted">
                      {message.direction === "outbound"
                        ? t.messagesSent
                        : t.repliesReceived}
                    </small>
                  </td>
                  <td>{message.channel === "gmail" ? t.gmail : t.linkedin}</td>
                  <td>{dateLabel(message.occurredAt, crm.timeZone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {drill.kind !== "messages" &&
        drill.kind !== "deals" &&
        rows.length > 0 && (
          <div className="report-table drill-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.name}</th>
                  <th scope="col">{t.person}</th>
                  <th scope="col">{t.product}</th>
                  <th scope="col">{t.activityDate}</th>
                </tr>
              </thead>
              <tbody>
                {rowPage.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button
                        type="button"
                        className="text-button drill-record-button"
                        onClick={() => {
                          if (drill.kind === "touches")
                            crm.openPerson(row.relationshipId);
                          else if (drill.kind === "actions")
                            crm.openPerson(row.relationshipId, row.id);
                          else
                            crm.openRecordDialog({
                              kind: "meeting",
                              id: row.id,
                            });
                        }}
                      >
                        {"name" in row
                          ? row.name
                          : "title" in row
                            ? row.title
                            : followUpLabel(row.followUp)}
                      </button>
                    </td>
                    <td>{crm.personFor(row.relationshipId)?.name}</td>
                    <td>{crm.product(row.productId)?.name}</td>
                    <td>
                      {"dueAt" in row
                        ? dateLabel(row.dueAt, crm.timeZone)
                        : "startsAt" in row
                          ? dateLabel(row.startsAt, crm.timeZone)
                          : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {!loading &&
        !error &&
        !(drill.kind === "messages" ? messages.length : rows.length) && (
          <p className="muted">{t.noReportRows}</p>
        )}
      {drill.kind !== "messages" && rows.length > rowPage.size && (
        <Pagination page={rowPage} />
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
    </section>
  );
}
