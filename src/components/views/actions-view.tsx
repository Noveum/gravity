"use client";
import t from "@crm/i18n/translations/en.json";
import { CircleHelp, Hourglass, UserRound } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { dateLabel, label } from "../client-api";
import { useWorkspaceData } from "../crm/crm-context";
import { useWarmContext } from "../crm/record-context";
import { openOnEnter } from "../records/peek-keys";
import { actionFilters, personPath, sectionPath } from "../routes";
import { initials } from "../shell/workspace-menu";
import { EmptyState } from "../ui/states";

const owedIcons = { us: UserRound, them: Hourglass, unknown: CircleHelp };
const day = 86400000;

export function ActionsView() {
  const crm = useWorkspaceData();
  const { data, search, personFor, companyFor, product, member, peek } = crm;
  const filters = actionFilters(useSearchParams());
  const warmContext = useWarmContext();
  const matches = (...values: (string | undefined | null)[]) =>
    values.join(" ").toLowerCase().includes(search.toLowerCase());
  const visibleActions = data.actions.filter(
    (action) =>
      action.status !== "completed" &&
      (!filters.owner || action.ownerId === filters.owner) &&
      (!filters.kind || action.kind === filters.kind) &&
      (!filters.waiting || action.owedBy === "them") &&
      matches(
        action.title,
        personFor(action.relationshipId)?.name,
        companyFor(personFor(action.relationshipId)?.id ?? "")?.name,
      ),
  );
  const now = Date.now();
  return (
    <>
      {["now", "upcoming"].map((group) => {
        const list = visibleActions.filter((action) =>
          group === "now"
            ? new Date(action.dueAt).getTime() < now + day
            : new Date(action.dueAt).getTime() >= now + day,
        );
        if (!list.length) return null;
        return (
          <div key={group}>
            <div className="group-title">
              {label(group)}
              <span>{list.length}</span>
            </div>
            {list.map((action) => {
              const person = personFor(action.relationshipId);
              const OwedIcon =
                owedIcons[action.owedBy as keyof typeof owedIcons] ??
                CircleHelp;
              return (
                <button
                  type="button"
                  key={action.id}
                  className="action-row"
                  data-nav-record={action.id}
                  data-action-id={action.id}
                  onPointerEnter={() => warmContext(action.relationshipId)}
                  aria-pressed={peek.actionId === action.id}
                  aria-keyshortcuts="Space Enter"
                  onClick={() =>
                    crm.openPerson(action.relationshipId, action.id)
                  }
                  onKeyDown={openOnEnter(() => {
                    if (person)
                      crm.go(
                        personPath(person.id, {
                          relationshipId: action.relationshipId,
                          actionId: action.id,
                        }),
                      );
                  })}
                >
                  <span className="row-avatar" aria-hidden>
                    {initials(person?.name ?? "?")}
                  </span>
                  <span className="row-name">{person?.name}</span>
                  <span className="row-company">
                    {companyFor(person?.id ?? "")?.name}
                  </span>
                  <span className="row-action">{action.title}</span>
                  {action.status === "blocked" && (
                    <span className="badge warning">{t.blocked}</span>
                  )}
                  <span className="row-meta">
                    <span className="row-product">
                      <span
                        className="product-dot"
                        style={{ background: product(action.productId)?.color }}
                      />
                      {product(action.productId)?.name}
                    </span>
                    <span className="row-kind">{label(action.kind)}</span>
                    <span className="row-owner" title={member(action.ownerId)}>
                      <span aria-hidden>
                        {initials(member(action.ownerId))}
                      </span>
                      <span className="sr-only">{member(action.ownerId)}</span>
                    </span>
                  </span>
                  <span
                    className={`row-owed owed-${action.owedBy}`}
                    title={`${t.owedBy} ${label(action.owedBy)}`}
                  >
                    <OwedIcon size={13} aria-hidden />
                    <span className="sr-only">
                      {t.owedBy} {label(action.owedBy)}
                    </span>
                  </span>
                  <span
                    className={`row-due${new Date(action.dueAt).getTime() < now - day ? " overdue" : ""}`}
                  >
                    {dateLabel(action.dueAt, crm.timeZone)}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
      {!visibleActions.length &&
        (!data.people.length && data.products.length ? (
          <EmptyState
            title={t.workspaceReady}
            description={t.workspaceNextStep}
            action={
              <>
                <button
                  type="button"
                  className="primary"
                  onClick={() => crm.setPersonDialog(true)}
                >
                  {t.addPerson}
                </button>
                <Link
                  className="button"
                  href={sectionPath("integrations")}
                  onClick={() => {
                    crm.titleFocus.current = sectionPath("integrations");
                  }}
                >
                  {t.connectTools}
                </Link>
              </>
            }
          />
        ) : data.products.length ? (
          <EmptyState title={t.noResults} compact />
        ) : null)}
    </>
  );
}
