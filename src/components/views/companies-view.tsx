"use client";
import t from "@crm/i18n/translations/en.json";
import Link from "next/link";
import { useWorkspaceData } from "../crm/crm-context";
import { peekOnSpace } from "../records/peek-keys";
import { companyPath, personPath } from "../routes";
import { EmptyState } from "../ui/states";

export function CompaniesView() {
  const crm = useWorkspaceData();
  const { data, search, product } = crm;
  const companies = data.companies.filter((company) =>
    [company.name, company.domain]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
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
              <tr key={company.id}>
                <td>
                  <Link
                    href={companyPath(company.id)}
                    className="text-button"
                    data-nav-record={company.id}
                    aria-keyshortcuts="Space Enter"
                    onKeyDown={peekOnSpace(() => crm.openCompany(company.id))}
                  >
                    {company.name}
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
    </div>
  );
}
