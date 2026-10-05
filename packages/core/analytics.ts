import type { ClientSnapshot } from "./dto";

export function dateKey(value: Date | string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
export function currencyDigits(currency: string) {
  return (
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}
export function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    maximumFractionDigits: currencyDigits(currency),
  }).format(amountMinor / 10 ** currencyDigits(currency));
}
export function parseMoney(value: string, currency: string): number | null {
  if (!value.trim()) return null;
  const digits = currencyDigits(currency);
  if (
    !new RegExp(`^\\d+(?:\\.\\d{1,${Math.max(digits, 1)}})?$`).test(value) ||
    (digits === 0 && value.includes("."))
  )
    throw new Error("INVALID_INPUT");
  const [whole, decimal = ""] = value.split(".");
  const minor =
    Number(whole) * 10 ** digits + Number(decimal.padEnd(digits, "0"));
  if (!Number.isSafeInteger(minor) || minor > 2147483647)
    throw new Error("INVALID_INPUT");
  return minor;
}
export function totals(
  deals: ClientSnapshot["opportunities"],
  weighted = false,
) {
  const currencies = new Map<
    string,
    { currency: string; amountMinor: number; count: number }
  >();
  for (const deal of deals) {
    if (deal.amountMinor === null || (weighted && deal.probability === null))
      continue;
    const row = currencies.get(deal.currency) ?? {
      currency: deal.currency,
      amountMinor: 0,
      count: 0,
    };
    row.amountMinor += weighted
      ? Math.round((deal.amountMinor * (deal.probability ?? 0)) / 100)
      : deal.amountMinor;
    row.count++;
    currencies.set(deal.currency, row);
  }
  return [...currencies.values()].sort((a, b) =>
    a.currency.localeCompare(b.currency),
  );
}
export function overview(
  data: ClientSnapshot,
  options: {
    days: number;
    timeZone: string;
    ownerId?: string;
    channel?: string;
    now?: Date;
  },
) {
  const now = options.now ?? new Date();
  const today = dateKey(now, options.timeZone);
  const from = new Date(
    Date.parse(`${today}T00:00:00Z`) - (options.days - 1) * 86400000,
  )
    .toISOString()
    .slice(0, 10);
  const owner = (id: string | null | undefined) =>
    !options.ownerId || id === options.ownerId;
  const relationshipOwners = new Map(
    data.relationships.map((r) => [r.id, r.ownerId]),
  );
  const relationshipOwner = (id: string) => relationshipOwners.get(id);
  const deals = data.opportunities.filter((d) =>
    owner(d.ownerId ?? relationshipOwner(d.relationshipId)),
  );
  const actions = data.actions.filter((a) => owner(a.ownerId));
  const pending = actions.filter((a) => a.status !== "completed");
  const overdue = pending.filter(
    (a) => a.owedBy !== "them" && dateKey(a.dueAt, options.timeZone) < today,
  );
  const dueToday = pending.filter(
    (a) => a.owedBy !== "them" && dateKey(a.dueAt, options.timeZone) === today,
  );
  const open = deals.filter((d) => d.status === "open");
  const closed = deals.filter(
    (d) =>
      d.status !== "open" &&
      d.closedAt &&
      new Date(d.closedAt).getTime() <= now.getTime() &&
      dateKey(d.closedAt, options.timeZone) >= from &&
      dateKey(d.closedAt, options.timeZone) <= today,
  );
  const won = closed.filter((d) => d.status === "won");
  const lost = closed.filter((d) => d.status === "lost");
  const stats = data.messageStats.filter(
    (row) =>
      row.day >= from &&
      row.day <= today &&
      owner(row.ownerId) &&
      (!options.channel || row.channel === options.channel),
  );
  const daily = new Map<string, { inbound: number; outbound: number }>();
  for (const row of stats) {
    const count = daily.get(row.day) ?? { inbound: 0, outbound: 0 };
    count.inbound += row.inbound;
    count.outbound += row.outbound;
    daily.set(row.day, count);
  }
  const days = Array.from({ length: options.days }, (_, i) =>
    new Date(Date.parse(`${from}T00:00:00Z`) + i * 86400000)
      .toISOString()
      .slice(0, 10),
  ).map((day) => ({
    day,
    inbound: daily.get(day)?.inbound ?? 0,
    outbound: daily.get(day)?.outbound ?? 0,
  }));
  const meetings = data.meetings.filter(
    (m) =>
      m.status === "held" &&
      new Date(m.startsAt).getTime() <= now.getTime() &&
      owner(relationshipOwner(m.relationshipId)) &&
      dateKey(m.startsAt, options.timeZone) >= from &&
      dateKey(m.startsAt, options.timeZone) <= today,
  );
  const pendingRelationships = new Set(pending.map((a) => a.relationshipId));
  const touches = data.touchStats.filter(
    (t) =>
      owner(t.sentBy ?? t.senderId) &&
      (!options.channel || t.channel === options.channel),
  );
  const outreachPending = touches.filter(
    (t) =>
      t.enrollmentStatus === "running" &&
      (t.status === "planned" || t.status === "approved"),
  );
  for (const touch of outreachPending)
    pendingRelationships.add(touch.relationshipId);
  const outreachDue = outreachPending.filter(
    (t) => dateKey(t.dueAt, options.timeZone) <= today,
  );
  const reportedSent = touches.filter(
    (t) =>
      t.status === "sent" &&
      t.sentAt &&
      new Date(t.sentAt).getTime() <= now.getTime() &&
      dateKey(t.sentAt, options.timeZone) >= from &&
      dateKey(t.sentAt, options.timeZone) <= today,
  );
  return {
    today,
    from,
    through: today,
    days,
    deals,
    open,
    closed,
    won,
    lost,
    pending,
    overdue,
    dueToday,
    meetings,
    stats,
    sent: stats.reduce((n, r) => n + r.outbound, 0),
    received: stats.reduce((n, r) => n + r.inbound, 0),
    pipelineValue: totals(open),
    weightedValue: totals(open, true),
    wonValue: totals(won),
    averageValue: totals(open).map((r) => ({
      ...r,
      amountMinor: Math.round(r.amountMinor / r.count),
    })),
    winRate: closed.length
      ? Math.round((won.length / closed.length) * 100)
      : null,
    missingAmount: open.filter((d) => d.amountMinor === null),
    missingProbability: open.filter((d) => d.probability === null),
    missingCloseDate: open.filter((d) => !d.expectedCloseDate),
    pastCloseDate: open.filter(
      (d) => d.expectedCloseDate && d.expectedCloseDate < today,
    ),
    noNextAction: open.filter(
      (d) => !pendingRelationships.has(d.relationshipId),
    ),
    waiting: pending.filter((a) => a.owedBy === "them"),
    blocked: pending.filter((a) => a.status === "blocked"),
    completed: actions.filter((a) => a.status === "completed"),
    outreachPending,
    outreachDue,
    outreachOverdue: outreachDue.filter(
      (t) => dateKey(t.dueAt, options.timeZone) < today,
    ),
    outreachFollowups: outreachPending.filter((t) => t.followUp > 0),
    reportedSent,
  };
}
