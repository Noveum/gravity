"use client";
import t from "@crm/i18n/translations/en.json";
import Link from "next/link";
import {
  useCreate,
  usePruneSelection,
  useWorkspaceData,
} from "../crm/crm-context";
import { ArchivedList } from "../records/archived-list";
import { peekOnSpace } from "../records/peek-keys";
import { companyPath, personPath } from "../routes";
import { EmptyState } from "../ui/states";

export function CompaniesView() {
  const crm = useWorkspaceData();
  const { data, search, product } = crm;
  const selected = new Set(crm.selection.selected);
  useCreate(() => crm.openRecordDialog({ kind: "company" }));
  const companies = data.companies.filter((company) =>
    [company.name, company.domain]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  usePruneSelection(companies.map((item) => item.id));
  return (
    <div className="table-scroll">
      {!companies.length && <EmptyState title={t.noCompanies} compact />}
      <table>
        <thead>
          <tr>
            <th>{t.company}</th>
            <th>{t.people}</th>
            <th>{t.products}</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((company) => {
            const people = data.people.filter(
              (person) => person.companyId === company.id,
            );
            const relationships = data.relationships.filter((relationship) =>
              people.some((person) => person.id === relationship.personId),
            );
            return (
              <tr
                key={company.id}
                data-selected={selected.has(company.id) || undefined}
              >
                <td>
                  <Link
                    href={companyPath(company.id)}
                    className="text-button"
                    data-nav-record={company.id}
                    aria-keyshortcuts="Space Enter X"
                    onKeyDown={peekOnSpace(() => crm.openCompany(company.id))}
                  >
                    {company.name}
                    {selected.has(company.id) && (
                      <span className="sr-only">{t.selected}</span>
                    )}
                  </Link>
                  <small>{company.domain}</small>
                </td>
                <td>
                  {people.map((person) => {
                    const relationship = relationships.find(
                      (item) => item.personId === person.id,
                    );
                    return (
                      <Link
                        href={personPath(person.id)}
                        className="text-button linked-contact"
                        key={person.id}
                        onKeyDown={peekOnSpace(() =>
                          crm.openPerson(relationship?.id ?? ""),
                        )}
                      >
                        {person.name}
                      </Link>
                    );
                  })}
                </td>
                <td>
                  {[
                    ...new Set(
                      relationships.map(
                        (relationship) => product(relationship.productId)?.name,
                      ),
                    ),
                  ].join(", ")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ArchivedList
        records={data.archived.companies.map((company) => ({
          id: company.id,
          name: company.name,
          detail: company.domain ?? "",
          href: companyPath(company.id),
        }))}
      />
    </div>
  );
}
