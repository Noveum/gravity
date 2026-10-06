"use client";
import t from "@crm/i18n/translations/en.json";
import Link from "next/link";
import {
  useCreate,
  usePruneSelection,
  useWorkspaceData,
} from "../crm/crm-context";
import { formatMoney } from "../money";
import { ArchivedList } from "../records/archived-list";
import {
  Pagination,
  RecordFilters,
  useRecordBrowser,
  useRecordIndex,
} from "../records/list-browser";
import { peekLink, peekOnSpace, peekRow, rowKeys } from "../records/peek-keys";
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
  const index = useRecordIndex();
  const browser = useRecordBrowser(
    companies,
    (company) => company,
    (company) => company.name,
  );
  usePruneSelection(browser.page.items.map((item) => item.id));
  return (
    <div className="table-scroll">
      <RecordFilters browser={browser} />
      {!browser.page.total && <EmptyState title={t.noCompanies} compact />}
      <table>
        <thead>
          <tr>
            <th>{t.company}</th>
            <th>{t.people}</th>
            <th>{t.products}</th>
            <th>{t.estimatedDealSize}</th>
            <th>{t.tags}</th>
          </tr>
        </thead>
        <tbody>
          {browser.page.items.map((company) => {
            const people = index.byCompany.get(company.id) ?? [];
            const relationships = people.flatMap(
              (person) => index.byPerson.get(person.id) ?? [],
            );
            return (
              <tr
                key={company.id}
                data-selected={selected.has(company.id) || undefined}
                className="peekable-row"
                onClick={peekRow(() => crm.openCompany(company.id))}
              >
                <td>
                  <Link
                    href={companyPath(company.id)}
                    className="text-button"
                    data-nav-record={company.id}
                    prefetch={false}
                    onClick={peekLink(() => crm.openCompany(company.id))}
                    aria-keyshortcuts="Space Enter X"
                    onKeyDown={rowKeys({
                      peek: () => crm.openCompany(company.id),
                      open: () => crm.go(companyPath(company.id)),
                    })}
                  >
                    {company.name}
                    {selected.has(company.id) && (
                      <span className="sr-only">{t.selected}</span>
                    )}
                  </Link>
                  <small>{company.domain}</small>
                </td>
                <td>
                  {people.slice(0, 3).map((person) => {
                    const relationship = index.byPerson.get(person.id)?.[0];
                    return (
                      <Link
                        href={personPath(person.id)}
                        className="text-button linked-contact"
                        key={person.id}
                        prefetch={false}
                        onClick={peekLink(() =>
                          crm.openPerson(relationship?.id ?? ""),
                        )}
                        onKeyDown={peekOnSpace(() =>
                          crm.openPerson(relationship?.id ?? ""),
                        )}
                      >
                        {person.name}
                      </Link>
                    );
                  })}
                  {people.length > 3 && (
                    <span className="muted">
                      {t.morePeople.replace(
                        "{count}",
                        String(people.length - 3),
                      )}
                    </span>
                  )}
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
                <td>{formatMoney(company.amountMinor, company.currency)}</td>
                <td>
                  <span className="record-tags">
                    {company.tags.map((tag) => (
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
