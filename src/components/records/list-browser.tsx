"use client";
import { parseMoney } from "@crm/core/analytics";
import { instantFromZonedInput } from "@crm/core/calendar";
import type { ClientSnapshot } from "@crm/core/dto";
import {
  fieldFilterOperators,
  fieldFilterSchema,
  matchesFieldFilters,
  normalizeFieldLabel,
} from "@crm/core/field-filters";
import type { RelationshipField } from "@crm/core/relationship-context";
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
  submitterIds?: readonly string[];
  sourceMemberIds?: readonly string[];
  attribution?: boolean;
  fieldGroups?: readonly (readonly RelationshipField[])[];
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
        fieldGroups: [relationship?.contextFields ?? []],
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
interface FieldFilterDraft {
  id: string;
  key: string;
  operator: string;
  value: string;
}
export function useRecordBrowser<T>(
  rows: readonly T[],
  read: (row: T) => RecordFacts,
  name: (row: T) => string,
  revealId = "",
) {
  const crm = useWorkspaceData();
  const scope = `${crm.organizationId}/${crm.productId}/${crm.pathname}/${crm.listFilterKey}`;
  const [state, setState] = useState({
    scope,
    filters: emptyFilters,
    fields: [] as FieldFilterDraft[],
  });
  const filters = state.scope === scope ? state.filters : emptyFilters;
  const fieldDrafts = state.scope === scope ? state.fields : [];
  const update = (key: keyof typeof emptyFilters, value: string) =>
    setState({
      scope,
      filters: { ...filters, [key]: value },
      fields: fieldDrafts,
    });
  const facts = rows.map((row) => ({ row, value: read(row) }));
  const fieldDefinitions = [
    ...new Map(
      crm.data.relationships
        .flatMap((relationship) => relationship.contextFields ?? [])
        .map((field) => [
          `${field.type}:${normalizeFieldLabel(field.label)}`,
          {
            key: `${field.type}:${normalizeFieldLabel(field.label)}`,
            label: field.label,
            type: field.type,
          },
        ]),
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label));
  const parsedFields = fieldDrafts
    .filter((draft) => draft.key)
    .map((draft) => {
      const field = fieldDefinitions.find((field) => field.key === draft.key);
      return fieldFilterSchema.safeParse({
        label: field?.label,
        type: field?.type,
        operator: draft.operator,
        ...(!["exists", "missing"].includes(draft.operator)
          ? {
              value:
                field?.type === "number"
                  ? draft.value.trim()
                    ? Number(draft.value)
                    : undefined
                  : field?.type === "boolean"
                    ? draft.value === "true"
                    : field?.type === "datetime"
                      ? instantFromZonedInput(draft.value, crm.timeZone)
                      : draft.value,
            }
          : {}),
      });
    });
  const fieldInvalid = parsedFields.some((result) => !result.success);
  const fieldFilters = parsedFields.flatMap((result) =>
    result.success ? [result.data] : [],
  );
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
    if (invalid || fieldInvalid) return false;
    if (
      fieldFilters.length &&
      !(value.fieldGroups ?? []).some((group) =>
        matchesFieldFilters(group, fieldFilters),
      )
    )
      return false;
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
  if (filters.sort === "name")
    filtered.sort((a, b) => name(a.row).localeCompare(name(b.row)));
  const page = useListPage(
    filtered.map(({ row }) => row),
    `${scope}/${crm.search}/${JSON.stringify(filters)}/${JSON.stringify(fieldDrafts)}`,
    revealId,
  );
  return {
    page,
    rows: filtered.map(({ row }) => row),
    filters,
    update,
    clear: () => setState({ scope, filters: emptyFilters, fields: [] }),
    invalid,
    fieldInvalid,
    fieldDrafts,
    fieldDefinitions,
    hasFieldGroups: facts.some(({ value }) => value.fieldGroups !== undefined),
    addFieldFilter: () =>
      setState({
        scope,
        filters,
        fields: [
          ...fieldDrafts,
          { id: crypto.randomUUID(), key: "", operator: "eq", value: "" },
        ],
      }),
    updateFieldFilter: (index: number, patch: Partial<FieldFilterDraft>) =>
      setState({
        scope,
        filters,
        fields: fieldDrafts.map((draft, position) =>
          position === index ? { ...draft, ...patch } : draft,
        ),
      }),
    removeFieldFilter: (index: number) =>
      setState({
        scope,
        filters,
        fields: fieldDrafts.filter((_, position) => position !== index),
      }),
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
    hasAttribution: facts.some(({ value }) => value.attribution),
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
    members: crm.data.members,
  };
}

export function RecordFilters({
  browser,
}: {
  browser: ReturnType<typeof useRecordBrowser>;
}) {
  const { filters, update } = browser;
  const active =
    Object.entries(filters).filter(
      ([key, value]) => value && !(key === "sort" && value === "default"),
    ).length + browser.fieldDrafts.filter((draft) => draft.key).length;
  return (
    <details className="record-filters">
      <summary>
        {t.filters}
        {active ? ` (${active})` : ""}
      </summary>
      <div className="record-filter-fields">
        {browser.hasFieldGroups && !!browser.fieldDefinitions.length && (
          <>
            <small>{t.fieldFilters.hint}</small>
            {browser.fieldDrafts.map((draft, index) => {
              const field = browser.fieldDefinitions.find(
                (field) => field.key === draft.key,
              );
              return (
                <fieldset key={draft.id} className="context-editor-card">
                  <legend>
                    {t.fieldFilters.field} {index + 1}
                  </legend>
                  <label>
                    {t.fieldFilters.field}
                    <select
                      value={draft.key}
                      onChange={(event) =>
                        browser.updateFieldFilter(index, {
                          key: event.target.value,
                          operator: "eq",
                          value: "",
                        })
                      }
                    >
                      <option value="">{t.fieldFilters.allFields}</option>
                      {browser.fieldDefinitions.map((field) => (
                        <option key={field.key} value={field.key}>
                          {field.label} ·{" "}
                          {t.contextFields.fieldTypes[field.type]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {field && (
                    <>
                      <label>
                        {t.fieldFilters.operator}
                        <select
                          value={draft.operator}
                          onChange={(event) =>
                            browser.updateFieldFilter(index, {
                              operator: event.target.value,
                            })
                          }
                        >
                          {fieldFilterOperators(field.type).map((operator) => (
                            <option key={operator} value={operator}>
                              {t.fieldFilters[operator]}
                            </option>
                          ))}
                        </select>
                      </label>
                      {!["exists", "missing"].includes(draft.operator) && (
                        <label htmlFor={`field-filter-value-${draft.id}`}>
                          {t.fieldFilters.value}
                          {field.type === "boolean" ? (
                            <select
                              id={`field-filter-value-${draft.id}`}
                              value={draft.value || "false"}
                              onChange={(event) =>
                                browser.updateFieldFilter(index, {
                                  value: event.target.value,
                                })
                              }
                            >
                              <option value="true">
                                {t.contextFields.yes}
                              </option>
                              <option value="false">
                                {t.contextFields.no}
                              </option>
                            </select>
                          ) : (
                            <input
                              id={`field-filter-value-${draft.id}`}
                              type={
                                field.type === "datetime"
                                  ? "datetime-local"
                                  : field.type === "number" ||
                                      field.type === "date"
                                    ? field.type
                                    : "text"
                              }
                              step={
                                field.type === "number"
                                  ? "any"
                                  : field.type === "datetime"
                                    ? "0.001"
                                    : undefined
                              }
                              value={draft.value}
                              onChange={(event) =>
                                browser.updateFieldFilter(index, {
                                  value: event.target.value,
                                })
                              }
                            />
                          )}
                        </label>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => browser.removeFieldFilter(index)}
                  >
                    {t.contextFields.removeField}
                  </button>
                </fieldset>
              );
            })}
            <button
              type="button"
              disabled={browser.fieldDrafts.length >= 10}
              onClick={browser.addFieldFilter}
            >
              {t.contextFields.addField}
            </button>
          </>
        )}
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
        {browser.hasAttribution && (
          <>
            <label>
              {t.attribution.submittedBy}
              <select
                value={filters.submittedBy}
                onChange={(e) => update("submittedBy", e.target.value)}
              >
                <option value="">{t.attribution.allSubmitters}</option>
                <option value={browser.userId}>
                  {t.attribution.submittedByMe}
                </option>
                {browser.attributionMembers
                  .filter((m) => m.id !== browser.userId)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {t.attribution.sourceMember}
              <select
                value={filters.sourceMemberId}
                onChange={(e) => update("sourceMemberId", e.target.value)}
              >
                <option value="">{t.attribution.allSources}</option>
                {browser.attributionMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.attribution.title}
              <select
                value={filters.attribution}
                onChange={(e) => update("attribution", e.target.value)}
              >
                <option value="">{t.attribution.allCoverage}</option>
                <option value="recorded">{t.attribution.recorded}</option>
                <option value="unknown">{t.attribution.unknownFilter}</option>
                <option value="shared">{t.attribution.shared}</option>
              </select>
            </label>
          </>
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
        {browser.fieldInvalid && <p role="alert">{t.fieldFilters.invalid}</p>}
      </div>
    </details>
  );
}
