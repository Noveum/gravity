"use client";
import t from "@crm/i18n/translations/en.json";
import Link from "next/link";
import { useMemo } from "react";
import { label } from "../client-api";
import {
  useCreate,
  usePruneSelection,
  useWorkspaceData,
} from "../crm/crm-context";
import { useWarmContext } from "../crm/record-context";
import { ArchivedList } from "../records/archived-list";
import {
  Pagination,
  RecordFilters,
  useRecordBrowser,
  useRecordIndex,
} from "../records/list-browser";
import { MetadataValues } from "../records/metadata-section";
import { peekLink, peekOnSpace, peekRow, rowKeys } from "../records/peek-keys";
import { companyPath, personPath } from "../routes";
import { EmptyState } from "../ui/states";

export function PeopleView() {
  const crm = useWorkspaceData();
  const { data, search, companyFor, product, peek } = crm;
  const warmContext = useWarmContext();
  const selected = new Set(crm.selection.selected);
  useCreate(() => {
    if (!data.products.length) return false;
    crm.setPersonDialog(true);
    return true;
  });
  const matches = (...values: (string | undefined | null)[]) =>
    values.join(" ").toLowerCase().includes(search.toLowerCase());
  const people = data.people.filter((person) =>
    matches(person.name, person.title, companyFor(person.id)?.name),
  );
  const index = useRecordIndex();
  const attributionByPerson = useMemo(() => {
    const result = new Map<
      string,
      { submitterIds: string[]; sourceMemberIds: string[] }
    >();
    for (const row of data.contactAttribution ?? []) {
      const value = result.get(row.personId) ?? {
        submitterIds: [],
        sourceMemberIds: [],
      };
      if (row.actorId) value.submitterIds.push(row.actorId);
      if (row.sourceMemberId) value.sourceMemberIds.push(row.sourceMemberId);
      result.set(row.personId, value);
    }
    return result;
  }, [data.contactAttribution]);
  const browser = useRecordBrowser(
    people,
    (person) => ({
      ...person,
      attribution: true,
      submitterIds: attributionByPerson.get(person.id)?.submitterIds ?? [],
      sourceMemberIds:
        attributionByPerson.get(person.id)?.sourceMemberIds ?? [],
      ownerIds: (index.byPerson.get(person.id) ?? []).map(
        (relationship) => relationship.ownerId,
      ),
      qualifications: (index.byPerson.get(person.id) ?? []).map(
        (relationship) => relationship.qualification,
      ),
      fieldGroups: (index.byPerson.get(person.id) ?? []).map(
        (relationship) => relationship.contextFields ?? [],
      ),
    }),
    (person) => person.name,
  );
  usePruneSelection(browser.page.items.map((item) => item.id));
  return (
    <div className="table-scroll">
      <RecordFilters browser={browser} />
      {!browser.page.total && <EmptyState title={t.noPeople} compact />}
      <table>
        <thead>
          <tr>
            <th>{t.name}</th>
            <th>{t.company}</th>
            <th>{t.products}</th>
            <th>{t.qualification}</th>
            <th>{t.estimatedDealSize}</th>
            <th>{t.tags}</th>
          </tr>
        </thead>
        <tbody>
          {browser.page.items.map((person) => {
            const relationships = index.byPerson.get(person.id) ?? [];
            const first = relationships[0]?.id ?? "";
            const company = companyFor(person.id);
            return (
              <tr
                key={person.id}
                data-selected={selected.has(person.id) || undefined}
                className="peekable-row"
                onClick={peekRow(() => crm.openPersonRecord(person.id))}
              >
                <td>
                  <Link
                    href={personPath(person.id)}
                    className="text-button identity-link"
                    data-nav-record={person.id}
                    aria-label={person.name}
                    prefetch={false}
                    onClick={peekLink(() => crm.openPersonRecord(person.id))}
                    aria-keyshortcuts="Space Enter X"
                    onFocus={() => warmContext(first)}
                    onKeyDown={rowKeys({
                      peek: () => crm.openPersonRecord(person.id),
                      open: () => crm.go(personPath(person.id)),
                    })}
                  >
                    {person.name}
                    <small>{person.title}</small>
                    {selected.has(person.id) && (
                      <span className="sr-only">{t.selected}</span>
                    )}
                  </Link>
                </td>
                <td>
                  {company ? (
                    <Link
                      href={companyPath(company.id)}
                      className="text-button"
                      prefetch={false}
                      onClick={peekLink(() => crm.openCompany(company.id))}
                      onKeyDown={peekOnSpace(() => crm.openCompany(company.id))}
                    >
                      {company.name}
                    </Link>
                  ) : (
                    <span className="muted">{t.companyMissing}</span>
                  )}
                </td>
                <td>
                  {relationships.map((relationship) => (
                    <button
                      key={relationship.id}
                      type="button"
                      className="badge"
                      aria-pressed={peek.relationshipId === relationship.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        crm.openPerson(relationship.id);
                      }}
                    >
                      {product(relationship.productId)?.name} ·{" "}
                      {label(relationship.purpose)}
                    </button>
                  ))}
                </td>
                <td>
                  {relationships
                    .map((relationship) => label(relationship.qualification))
                    .join(" · ")}
                </td>
                <td>
                  <MetadataValues record={{ ...person, tags: [] }} />
                </td>
                <td>
                  <span className="record-tags">
                    {person.tags.map((tag) => (
                      <span className="badge" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Pagination page={browser.page} />
      <ArchivedList
        records={data.archived.people.map((person) => ({
          id: person.id,
          name: person.name,
          detail: person.title,
          href: personPath(person.id),
        }))}
      />
    </div>
  );
}
