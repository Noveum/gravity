"use client";
import { parseMoney } from "@crm/core/analytics";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { type ReactNode, useMemo, useState } from "react";
import { useWorkspaceData } from "../crm/crm-context";
import { minorStep } from "../money";

export interface RecordFacts {
  tags?: readonly string[];
  amountMinor?: number | null;
  currency?: string;
  ownerId?: string;
  ownerIds?: readonly string[];
  qualification?: string;
  qualifications?: readonly string[];
  status?: string;
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

const emptyFilters = {
  tag: "",
  ownerId: "",
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
  const [state, setState] = useState({ scope, filters: emptyFilters });
  const filters = state.scope === scope ? state.filters : emptyFilters;
  const update = (key: keyof typeof emptyFilters, value: string) =>
    setState({ scope, filters: { ...filters, [key]: value } });
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
  if (filters.sort === "name")
    filtered.sort((a, b) => name(a.row).localeCompare(name(b.row)));
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
    clear: () => setState({ scope, filters: emptyFilters }),
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
    members: crm.data.members,
  };
}

export function RecordFilters({
  browser,
}: {
  browser: ReturnType<typeof useRecordBrowser>;
}) {
  const { filters, update } = browser;
  const active = Object.entries(filters).filter(
    ([key, value]) => value && !(key === "sort" && value === "default"),
  ).length;
  return (
    <details className="record-filters">
      <summary>
        {t.filters}
        {active ? ` (${active})` : ""}
      </summary>
      <div className="record-filter-fields">
        <label>
          {t.tags}
          <select
            value={filters.tag}
            onChange={(e) => update("tag", e.target.value)}
          >
            <option value="">{t.allTags}</option>
            {browser.tags.map(([key, tag]) => (
              <option key={key} value={key}>
                {tag}
              </option>
            ))}
          </select>
        </label>
        {browser.hasOwner && (
          <label>
            {t.owner}
            <select
              value={filters.ownerId}
              onChange={(e) => update("ownerId", e.target.value)}
            >
              <option value="">{t.everyone}</option>
              {browser.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!!browser.qualifications.length && (
          <label>
            {t.qualification}
            <select
              value={filters.qualification}
              onChange={(e) => update("qualification", e.target.value)}
            >
              <option value="">{t.allQualifications}</option>
              {browser.qualifications.map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        )}
        {!!browser.statuses.length && (
          <label>
            {t.status}
            <select
              value={filters.status}
              onChange={(e) => update("status", e.target.value)}
            >
              <option value="">{t.allStatuses}</option>
              {browser.statuses.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {t.dealSize}
          <select
            value={filters.size}
            onChange={(e) => update("size", e.target.value)}
          >
            <option value="">{t.anyDealSize}</option>
            <option value="known">{t.knownDealSize}</option>
            <option value="unknown">{t.amountUnknown}</option>
          </select>
        </label>
        <label>
          {t.currency}
          <select
            value={filters.currency}
            onChange={(e) => update("currency", e.target.value)}
          >
            <option value="">{t.allCurrencies}</option>
            {[...new Set(["USD", ...browser.currencies])].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.minimumDealSize}
          <input
            type="number"
            min="0"
            step={minorStep(filters.currency || "USD")}
            value={filters.minimum}
            onChange={(e) => update("minimum", e.target.value)}
          />
        </label>
        <label>
          {t.maximumDealSize}
          <input
            type="number"
            min="0"
            step={minorStep(filters.currency || "USD")}
            value={filters.maximum}
            onChange={(e) => update("maximum", e.target.value)}
          />
        </label>
        <small>
          {t.dealFilterCurrency.replace(
            "{currency}",
            filters.currency || "USD",
          )}
        </small>
        <label>
          {t.sortBy}
          <select
            value={filters.sort}
            onChange={(e) => update("sort", e.target.value)}
          >
            <option value="default">{t.defaultOrder}</option>
            <option value="name">{t.name}</option>
          </select>
        </label>
        <button type="button" onClick={browser.clear} disabled={!active}>
          {t.clearFilters}
        </button>
        {browser.invalid && <p role="alert">{t.invalidDealRange}</p>}
      </div>
    </details>
  );
}
