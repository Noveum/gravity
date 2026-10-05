"use client";
import t from "@crm/i18n/translations/en.json";
import Link from "next/link";
import { label } from "../client-api";
import { useCreate, useWorkspaceData } from "../crm/crm-context";
import { useWarmContext } from "../crm/record-context";
import { ArchivedList } from "../records/archived-list";
import { peekOnSpace } from "../records/peek-keys";
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
  return (
    <div className="table-scroll">
      {!people.length && <EmptyState title={t.noPeople} compact />}
      <table>
        <thead>
          <tr>
            <th>{t.name}</th>
            <th>{t.company}</th>
            <th>{t.products}</th>
            <th>{t.qualification}</th>
          </tr>
        </thead>
        <tbody>
          {people.map((person) => {
            const relationships = data.relationships.filter(
              (relationship) => relationship.personId === person.id,
            );
            const first = relationships[0]?.id ?? "";
            const company = companyFor(person.id);
            return (
              <tr
                key={person.id}
                data-selected={selected.has(person.id) || undefined}
              >
                <td>
                  <Link
                    href={personPath(person.id)}
                    className="text-button identity-link"
                    data-nav-record={person.id}
                    aria-label={person.name}
                    aria-keyshortcuts="Space Enter X"
                    onFocus={() => warmContext(first)}
                    onKeyDown={peekOnSpace(() => crm.openPerson(first))}
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
                      onClick={() => crm.openPerson(relationship.id)}
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
              </tr>
            );
          })}
        </tbody>
      </table>
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
