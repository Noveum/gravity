"use client";
import { parseMoney } from "@crm/core/analytics";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { SlidersHorizontal, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useId, useMemo, useState } from "react";
import { useWorkspaceData } from "../crm/crm-context";
import { useFilterVisibility } from "../filter-visibility";
import { minorStep } from "../money";
import { FilterPopover } from "../ui/filter-popover";
import { Select } from "../ui/select";
import { currentViewQuery, replaceViewQuery } from "../view-query";
import { ValueFilter } from "./value-filter";

export interface RecordFacts {
  tags?: readonly string[];
  amountMinor?: number | null;
  currency?: string;
  ownerId?: string;
  ownerIds?: readonly string[];
  qualification?: string;
  qualifications?: readonly string[];
  status?: string;
  submitterIds?: readonly string[];
  sourceMemberIds?: readonly string[];
  attribution?: boolean;
}

export function useRecordIndex() {
  const { data } = useWorkspaceData();
  return useMemo(() => {
    const people = new Map(data.people.map((person) => [person.id, person]));
    const companies = new Map(
      data.companies.map((company) => [company.id, company]),
    );
    const relationships = new Map(
      data.relationships.map((relationship) => [relationship.id, relationship]),
    );
    const byPerson = new Map<string, ClientSnapshot["relationships"]>();
    const byCompany = new Map<string, ClientSnapshot["people"]>();
    for (const relationship of data.relationships) {
      const rows = byPerson.get(relationship.personId) ?? [];
      rows.push(relationship);
      byPerson.set(relationship.personId, rows);
    }
    for (const person of data.people) {
      if (!person.companyId) continue;
      const rows = byCompany.get(person.companyId) ?? [];
      rows.push(person);
      byCompany.set(person.companyId, rows);
    }
    const facts = (relationshipId: string): RecordFacts => {
      const relationship = relationships.get(relationshipId);
      const person = people.get(relationship?.personId ?? "");
      const company = companies.get(person?.companyId ?? "");
      const value = [relationship, person, company].find(
        (row) => row?.amountMinor != null,
      );
      return {
        tags: [
          ...new Set([
            ...(relationship?.tags ?? []),
            ...(person?.tags ?? []),
            ...(company?.tags ?? []),
          ]),
        ],
        amountMinor: value?.amountMinor ?? null,
        currency: value?.currency ?? "USD",
        ownerId: relationship?.ownerId ?? "",
        qualification: relationship?.qualification ?? "",
      };
    };
    return { people, companies, relationships, byPerson, byCompany, facts };
  }, [data]);
}

export function pageWindow(total: number, page: number, size: number) {
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.max(0, Math.min(page, pages - 1));
  return {
    page: current,
    pages,
    start: current * size,
    end: Math.min(total, (current + 1) * size),
  };
}

export function useListPage<T>(
  rows: readonly T[],
  scope: string,
  revealId = "",
) {
  const [state, setState] = useState({ scope: "", page: 0, size: 50 });
  const revealed = revealId
    ? rows.findIndex((row) => (row as { id?: string }).id === revealId)
    : -1;
  const key = `${scope}/${revealId}`;
  const page =
    state.scope === key
      ? state.page
      : revealed >= 0
        ? Math.floor(revealed / state.size)
        : 0;
  const window = pageWindow(rows.length, page, state.size);
  return {
    ...window,
    total: rows.length,
    size: state.size,
    items: rows.slice(window.start, window.end),
    setPage: (next: number) =>
      setState({ scope: key, page: next, size: state.size }),
    setSize: (size: number) => setState({ scope: key, page: 0, size }),
  };
}

export function Pagination({ page }: { page: ReturnType<typeof useListPage> }) {
  return (
    <nav className="list-pagination" aria-label={t.pagination}>
      <span aria-live="polite">
        {t.pageRange
          .replace("{from}", String(page.total ? page.start + 1 : 0))
          .replace("{to}", String(page.end))
          .replace("{total}", String(page.total))}
      </span>
      <label>
        {t.rowsPerPage}
        <select
          value={page.size}
          onChange={(event) => page.setSize(Number(event.target.value))}
        >
          {[25, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={page.page === 0}
        onClick={() => page.setPage(page.page - 1)}
      >
        {t.previousPage}
      </button>
      <span>
        {t.pageNumber
          .replace("{page}", String(page.page + 1))
          .replace("{pages}", String(page.pages))}
      </span>
      <button
        type="button"
        disabled={page.page + 1 >= page.pages}
        onClick={() => page.setPage(page.page + 1)}
      >
        {t.nextPage}
      </button>
    </nav>
  );
}

export function PagedItems<T>({
  rows,
  scope,
  children,
  label,
}: {
  rows: readonly T[];
  scope: string;
  children: (rows: readonly T[]) => ReactNode;
  label?: string;
}) {
  const page = useListPage(rows, scope);
  return (
    <section aria-label={label}>
      {children(page.items)}
      <Pagination page={page} />
    </section>
  );
}

export const emptyFilters = {
  tag: "",
  ownerId: "",
  submittedBy: "",
  sourceMemberId: "",
  attribution: "",
  qualification: "",
  status: "",
  currency: "",
  minimum: "",
  maximum: "",
  size: "",
  sort: "default",
};
export function useRecordBrowser<T>(
  rows: readonly T[],
  read: (row: T) => RecordFacts,
  name: (row: T) => string,
  revealId = "",
) {
  const crm = useWorkspaceData();
  const scope = `${crm.organizationId}/${crm.productId}/${crm.pathname}/${crm.listFilterKey}`;
  const query = useSearchParams();
  const filters = Object.fromEntries(
    Object.entries(emptyFilters).map(([key, fallback]) => [
      key,
      query.get(key === "ownerId" ? "owner" : key) ?? fallback,
    ]),
  ) as typeof emptyFilters;
  const replace = replaceViewQuery;
  const updateMany = (values: Partial<typeof emptyFilters>) => {
    const next = currentViewQuery();
    for (const [key, value] of Object.entries(values)) {
      const parameter = key === "ownerId" ? "owner" : key;
      if (value && !(key === "sort" && value === "default"))
        next.set(parameter, value);
      else next.delete(parameter);
    }
    replace(next);
  };
  const update = (key: keyof typeof emptyFilters, value: string) =>
    updateMany({ [key]: value });
  const clear = () => {
    const next = currentViewQuery();
    for (const key of Object.keys(emptyFilters))
      next.delete(key === "ownerId" ? "owner" : key);
    replace(next);
  };
  const facts = rows.map((row) => ({ row, value: read(row) }));
  let invalid = false;
  let minimum: number | null = null;
  let maximum: number | null = null;
  try {
    minimum = parseMoney(filters.minimum, filters.currency || "USD");
    maximum = parseMoney(filters.maximum, filters.currency || "USD");
    invalid = minimum !== null && maximum !== null && minimum > maximum;
  } catch {
    invalid = true;
  }
  const filtered = facts.filter(({ value }) => {
    if (invalid) return false;
    if (
      filters.tag &&
      !value.tags?.some((tag) => tag.toLowerCase() === filters.tag)
    )
      return false;
    if (
      filters.ownerId &&
      value.ownerId !== filters.ownerId &&
      !value.ownerIds?.includes(filters.ownerId)
    )
      return false;
    if (
      filters.qualification &&
      value.qualification !== filters.qualification &&
      !value.qualifications?.includes(filters.qualification)
    )
      return false;
    if (
      filters.submittedBy &&
      !value.submitterIds?.includes(filters.submittedBy)
    )
      return false;
    if (
      filters.sourceMemberId &&
      !value.sourceMemberIds?.includes(filters.sourceMemberId)
    )
      return false;
    const contributors = new Set([
      ...(value.submitterIds ?? []),
      ...(value.sourceMemberIds ?? []),
    ]);
    if (filters.attribution === "recorded" && !contributors.size) return false;
    if (filters.attribution === "unknown" && contributors.size) return false;
    if (filters.attribution === "shared" && contributors.size < 2) return false;
    if (filters.status && value.status !== filters.status) return false;
    if (filters.size === "known" && value.amountMinor == null) return false;
    if (filters.size === "unknown" && value.amountMinor != null) return false;
    if (filters.currency && value.currency !== filters.currency) return false;
    if (
      (minimum !== null || maximum !== null) &&
      value.currency !== (filters.currency || "USD")
    )
      return false;
    if (
      minimum !== null &&
      (value.amountMinor == null || value.amountMinor < minimum)
    )
      return false;
    if (
      maximum !== null &&
      (value.amountMinor == null || value.amountMinor > maximum)
    )
      return false;
    return true;
  });
  const idOrder = (a: T, b: T) =>
    String((a as { id?: string }).id ?? "").localeCompare(
      String((b as { id?: string }).id ?? ""),
    );
  const nameOrder = (a: T, b: T) =>
    name(a).localeCompare(name(b)) || idOrder(a, b);
  if (filters.sort === "name" || filters.sort === "name_desc")
    filtered.sort(
      (a, b) =>
        name(a.row).localeCompare(name(b.row)) *
          (filters.sort === "name_desc" ? -1 : 1) || idOrder(a.row, b.row),
    );
  if (filters.sort === "amount_asc" || filters.sort === "amount_desc")
    filtered.sort((a, b) => {
      if (a.value.amountMinor == null && b.value.amountMinor != null) return 1;
      if (b.value.amountMinor == null && a.value.amountMinor != null) return -1;
      const currency = (a.value.currency || "USD").localeCompare(
        b.value.currency || "USD",
      );
      return (
        currency ||
        ((a.value.amountMinor ?? 0) - (b.value.amountMinor ?? 0)) *
          (filters.sort === "amount_desc" ? -1 : 1) ||
        nameOrder(a.row, b.row)
      );
    });
  const page = useListPage(
    filtered.map(({ row }) => row),
    `${scope}/${crm.search}/${JSON.stringify(filters)}`,
    revealId,
  );
  return {
    page,
    rows: filtered.map(({ row }) => row),
    filters,
    update,
    updateMany,
    clear,
    amountMaximum:
      Math.max(
        0,
        ...facts
          .filter(
            ({ value }) =>
              (value.currency || "USD") === (filters.currency || "USD"),
          )
          .map(({ value }) => value.amountMinor ?? 0),
      ) * Number(minorStep(filters.currency || "USD")),
    invalid,
    tags: [
      ...new Map(
        facts
          .flatMap(({ value }) => value.tags ?? [])
          .map((tag) => [tag.toLowerCase(), tag]),
      ).entries(),
    ].sort((a, b) => a[1].localeCompare(b[1])),
    currencies: [
      ...new Set(
        facts
          .map(({ value }) => value.currency)
          .filter((value): value is string => !!value),
      ),
    ].sort(),
    qualifications: [
      ...new Set(
        facts
          .flatMap(({ value }) => [
            value.qualification,
            ...(value.qualifications ?? []),
          ])
          .filter((value): value is string => !!value),
      ),
    ].sort(),
    statuses: [
      ...new Set(
        facts
          .map(({ value }) => value.status)
          .filter((value): value is string => !!value),
      ),
    ].sort(),
    hasOwner: facts.some(
      ({ value }) => !!value.ownerId || !!value.ownerIds?.length,
    ),
    hasAttribution:
      crm.route?.section === "people" ||
      facts.some(({ value }) => value.attribution),
    attributionMembers: [
      ...new Set(
        facts.flatMap(({ value }) => [
          ...(value.submitterIds ?? []),
          ...(value.sourceMemberIds ?? []),
        ]),
      ),
    ].map((id) => ({
      id,
      name:
        crm.data.members.find((m) => m.id === id)?.name ??
        `${t.attribution.memberId}: ${id}`,
    })),
    userId: crm.userId,
    organizationId: crm.organizationId,
    members: crm.data.members,
  };
}

export function RecordSort({
  browser,
}: {
  browser: ReturnType<typeof useRecordBrowser>;
}) {
  const id = useId();
  return (
    <label className="record-sort" htmlFor={id}>
      <span>{t.sortBy}</span>
      <Select
        id={id}
        label={t.sortBy}
        value={browser.filters.sort}
        onChange={(value) => browser.update("sort", value)}
        options={[
          { value: "default", label: t.defaultOrder },
          { value: "name", label: t.name },
          { value: "name_desc", label: t.uiRefresh.nameDescending },
          { value: "amount_desc", label: t.uiRefresh.amountDescending },
          { value: "amount_asc", label: t.uiRefresh.amountAscending },
        ]}
      />
    </label>
  );
}

export function RecordFilters({
  browser,
  hideSort = false,
  hiddenFields = [],
}: {
  browser: ReturnType<typeof useRecordBrowser>;
  hideSort?: boolean;
  hiddenFields?: readonly (keyof typeof emptyFilters)[];
}) {
  const { filters, update } = browser;
  const { visible, setVisible } = useFilterVisibility(browser);
  const id = useId();
  const active = Object.entries(filters).filter(
    ([key, value]) => value && !(key === "sort" && value === "default"),
  ).length;
  const field = (
    key: keyof typeof emptyFilters,
    label: string,
    options: readonly { value: string; label: string }[],
    compact = true,
  ) =>
    hiddenFields.includes(key) ? null : (
      <label className={`filter-field filter-${key}`} htmlFor={`${id}-${key}`}>
        <span className={compact ? "sr-only" : undefined}>{label}</span>
        <Select
          id={`${id}-${key}`}
          label={label}
          value={filters[key]}
          onChange={(value) => update(key, value)}
          options={options}
          displayValue={
            !filters[key] && (key === "qualification" || key === "status")
              ? label
              : undefined
          }
          className={filters[key] ? "filter-active" : ""}
        />
      </label>
    );
  return (
    <section className="record-filters" aria-label={t.filters}>
      <div className="record-filter-row">
        <button
          type="button"
          className="filter-toggle ghost"
          onClick={() => setVisible(!visible)}
          aria-expanded={visible}
          aria-controls={`${id}-controls`}
          aria-describedby={active > 0 ? `${id}-active` : undefined}
          aria-label={
            visible ? t.uiRefresh.hideFilters : t.uiRefresh.showFilters
          }
          title={visible ? t.uiRefresh.hideFilters : t.uiRefresh.showFilters}
        >
          <SlidersHorizontal size={14} aria-hidden />
          <span>{t.filters}</span>
          {active > 0 && (
            <>
              <span className="filter-count" aria-hidden>
                {active}
              </span>
              <span id={`${id}-active`} className="sr-only">
                {t.uiRefresh.activeFilters.replace("{count}", String(active))}
              </span>
            </>
          )}
        </button>
        {visible && (
          <div className="record-filter-controls" id={`${id}-controls`}>
            {(browser.hasOwner || !!filters.ownerId) &&
              field("ownerId", t.owner, [
                { value: "", label: t.everyone },
                ...browser.members.map((member) => ({
                  value: member.id,
                  label: member.name,
                })),
              ])}
            {(!!browser.tags.length || !!filters.tag) &&
              field("tag", t.tags, [
                { value: "", label: t.allTags },
                ...browser.tags.map(([value, label]) => ({ value, label })),
              ])}
            <ValueFilter
              filters={filters}
              amountMaximum={browser.amountMaximum}
              currencies={browser.currencies}
              invalid={browser.invalid}
              onChange={browser.updateMany}
            />
            {(!!browser.qualifications.length || !!filters.qualification) &&
              field("qualification", t.qualification, [
                { value: "", label: t.allQualifications },
                ...browser.qualifications.map((value) => ({
                  value,
                  label: value.replaceAll("_", " "),
                })),
              ])}
            {(!!browser.statuses.length || !!filters.status) &&
              field("status", t.status, [
                { value: "", label: t.allStatuses },
                ...browser.statuses.map((value) => ({ value, label: value })),
              ])}
            {(browser.hasAttribution ||
              !!filters.submittedBy ||
              !!filters.sourceMemberId ||
              !!filters.attribution) && (
              <FilterPopover
                label={t.uiRefresh.attributionFilters}
                summary={t.attribution.title}
                active={
                  !!(
                    filters.submittedBy ||
                    filters.sourceMemberId ||
                    filters.attribution
                  )
                }
              >
                <div className="attribution-filter-fields">
                  {field(
                    "submittedBy",
                    t.attribution.submittedBy,
                    [
                      { value: "", label: t.attribution.allSubmitters },
                      {
                        value: browser.userId,
                        label: t.attribution.submittedByMe,
                      },
                      ...browser.attributionMembers
                        .filter((m) => m.id !== browser.userId)
                        .map((m) => ({ value: m.id, label: m.name })),
                    ],
                    false,
                  )}
                  {field(
                    "sourceMemberId",
                    t.attribution.sourceMember,
                    [
                      { value: "", label: t.attribution.allSources },
                      ...browser.attributionMembers.map((m) => ({
                        value: m.id,
                        label: m.name,
                      })),
                    ],
                    false,
                  )}
                  {field(
                    "attribution",
                    t.attribution.title,
                    [
                      { value: "", label: t.attribution.allCoverage },
                      { value: "recorded", label: t.attribution.recorded },
                      { value: "unknown", label: t.attribution.unknownFilter },
                      { value: "shared", label: t.attribution.shared },
                    ],
                    false,
                  )}
                </div>
              </FilterPopover>
            )}
          </div>
        )}
        {active > 0 && (
          <button
            type="button"
            className="ghost filter-clear"
            onClick={browser.clear}
            aria-label={t.clearFilters}
            title={t.clearFilters}
          >
            <X size={14} aria-hidden />
          </button>
        )}
        {!hideSort && <RecordSort browser={browser} />}
      </div>
      {browser.invalid && (
        <p className="filter-error" role="alert">
          {t.invalidDealRange}
        </p>
      )}
    </section>
  );
}
