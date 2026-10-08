"use client";
import { money, totals, weightedAmount } from "@crm/core/analytics";
import { productColorToken } from "@crm/core/product-colors";
import t from "@crm/i18n/translations/en.json";
import { CalendarDays, Columns3, List, Pencil, Plus, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  type DragEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  useCreate,
  useEdit,
  useVerbs,
  useWorkspaceData,
} from "../crm/crm-context";
import { useRevealedRecord } from "../crm/use-revealed-record";
import { useStageMoves } from "../crm/use-stage-moves";
import { PipelineDialog } from "../deal-dialog";
import { focusedRecord } from "../keyboard-navigation";
import { formatMoney } from "../money";
import {
  Pagination,
  RecordFilters,
  RecordSort,
  useRecordBrowser,
  useRecordIndex,
} from "../records/list-browser";
import {
  type OpportunityColumn,
  opportunityColumns,
  opportunityDropStage,
} from "../records/opportunity-board";
import { RecordText } from "../records/record-text";
import { StageCards } from "../records/stage-cards";
import { Select } from "../ui/select";
import { EmptyState } from "../ui/states";
import { currentViewQuery, replaceViewQuery } from "../view-query";
import "./opportunities.css";

const dragType = "application/x-gravity-opportunity";

export function OpportunitiesView() {
  const crm = useWorkspaceData();
  const { data, search, productId, personFor } = crm;
  const query = useSearchParams();
  const dealId = query.get("deal");
  const [pipelineDialog, setPipelineDialog] = useState(false);
  const layout = query.get("layout") === "list" ? "list" : "board";
  const setLayout = (value: "list" | "board") => {
    const next = currentViewQuery();
    if (value === "list") next.set("layout", value);
    else next.delete("layout");
    replaceViewQuery(next);
  };
  useVerbs({
    "board-layout": () => {
      setLayout("board");
      return true;
    },
    "list-layout": () => {
      setLayout("list");
      return true;
    },
  });
  const processedDeal = useRef<string | null>(null);
  const chosen = data.opportunities.find((d) => d.id === dealId);
  const closeDeal = useCallback(() => {
    const next = currentViewQuery();
    next.delete("deal");
    replaceViewQuery(next);
  }, []);
  useEffect(() => {
    if (processedDeal.current === dealId) return;
    if (dealId === "new" || chosen) {
      processedDeal.current = dealId;
      crm.openRecordDialog({
        kind: "opportunity",
        ...(chosen ? { id: chosen.id } : {}),
      });
      closeDeal();
    }
  }, [dealId, chosen, closeDeal, crm.openRecordDialog]);
  const pipelineFilter = query.get("pipeline");
  const stageFilter = query.get("stage");
  useEffect(() => {
    const pipeline = data.pipelines.find(
      (item) =>
        item.id === pipelineFilter &&
        (!productId || item.productId === productId),
    );
    const stage = data.stages.find(
      (item) =>
        item.id === stageFilter &&
        (!productId || item.productId === productId) &&
        (!pipelineFilter || item.pipelineId === pipeline?.id),
    );
    if ((!pipelineFilter || pipeline) && (!stageFilter || stage)) return;
    const next = currentViewQuery();
    if (pipelineFilter && !pipeline) next.delete("pipeline");
    next.delete("stage");
    replaceViewQuery(next);
  }, [data.pipelines, data.stages, pipelineFilter, stageFilter, productId]);
  const focusedId = useRevealedRecord();
  const moves = useStageMoves();
  const [dragging, setDragging] = useState("");
  const [target, setTarget] = useState("");
  const { rowFocus } = crm;
  useLayoutEffect(() => {
    const id = rowFocus.current;
    if (!id) return;
    const card = document.querySelector<HTMLElement>(
      `[data-nav-record="${id}"]`,
    );
    if (!card) return;
    rowFocus.current = "";
    card.focus();
  });
  useCreate(() =>
    data.relationships.length
      ? crm.openRecordDialog({ kind: "opportunity" })
      : false,
  );
  useEdit(() => {
    const id = focusedRecord()?.getAttribute("data-nav-record") ?? "";
    if (!data.opportunities.some((item) => item.id === id)) return false;
    return crm.openRecordDialog({ kind: "opportunity", id });
  });
  const matches = (...values: (string | undefined)[]) =>
    values.join(" ").toLowerCase().includes(search.toLowerCase());
  const index = useRecordIndex();
  const opportunities = data.opportunities.filter((opportunity) => {
    const stage = data.stages.find((stage) => stage.id === opportunity.stageId);
    const person = personFor(opportunity.relationshipId);
    const company = index.companies.get(person?.companyId ?? "");
    return (
      (!query.get("pipeline") || stage?.pipelineId === query.get("pipeline")) &&
      (!query.get("stage") || opportunity.stageId === query.get("stage")) &&
      (!query.get("owner") ||
        (opportunity.ownerId ??
          index.relationships.get(opportunity.relationshipId)?.ownerId) ===
          query.get("owner")) &&
      matches(opportunity.name, person?.name, person?.title, company?.name)
    );
  });
  const browser = useRecordBrowser(
    opportunities,
    (opportunity) => ({
      ...index.facts(opportunity.relationshipId),
      ...opportunity,
      tags: [
        ...new Set([
          ...(index.facts(opportunity.relationshipId).tags ?? []),
          ...opportunity.tags,
        ]),
      ],
      ownerId:
        opportunity.ownerId ??
        index.relationships.get(opportunity.relationshipId)?.ownerId ??
        "",
    }),
    (opportunity) => opportunity.name,
    focusedId,
  );
  const columns = opportunityColumns(
    data.stages,
    data.pipelines,
    browser.rows,
    {
      organizationId: crm.organizationId,
      productId,
      pipelineId: pipelineFilter ?? "",
      stageId: stageFilter ?? "",
    },
  );
  const dragged = browser.rows.find((item) => item.id === dragging);
  const hasOpportunities = crm.sourceData.opportunities.length > 0;
  const hasFilters =
    !!search ||
    !!pipelineFilter ||
    !!stageFilter ||
    Object.entries(browser.filters).some(
      ([key, value]) => value && !(key === "sort" && value === "default"),
    );
  function clearFilters() {
    const next = currentViewQuery();
    for (const key of Object.keys(browser.filters))
      next.delete(key === "ownerId" ? "owner" : key);
    next.delete("pipeline");
    next.delete("stage");
    crm.clearSearch();
    replaceViewQuery(next);
  }
  function endDrag() {
    setDragging("");
    setTarget("");
  }
  function drop(column: OpportunityColumn, event: DragEvent) {
    event.preventDefault();
    const id = dragging || event.dataTransfer?.getData(dragType);
    endDrag();
    const opportunity = browser.rows.find((item) => item.id === id);
    if (!opportunity) return;
    const stage = opportunityDropStage(column, opportunity, data.stages);
    if (stage) void moves.move(opportunity, stage.id);
  }
  return (
    <div className="opportunity-workspace" data-layout={layout}>
      <div className="opportunity-controls">
        <fieldset
          className="layout-switch"
          aria-label={t.opportunityBoard.layout}
        >
          <button
            type="button"
            aria-pressed={layout === "board"}
            aria-keyshortcuts="B"
            title={`${t.inlineEditing.board} (B)`}
            onClick={() => setLayout("board")}
          >
            <Columns3 size={14} aria-hidden />
            {t.inlineEditing.board}
            <kbd aria-hidden>B</kbd>
          </button>
          <button
            type="button"
            aria-pressed={layout === "list"}
            aria-keyshortcuts="L"
            title={`${t.inlineEditing.list} (L)`}
            onClick={() => setLayout("list")}
          >
            <List size={14} aria-hidden />
            {t.inlineEditing.list}
            <kbd aria-hidden>L</kbd>
          </button>
        </fieldset>
        <div className="opportunity-pipeline-filter">
          <Select
            label={t.pipeline}
            value={query.get("pipeline") ?? ""}
            onChange={(value) => {
              const next = currentViewQuery();
              if (value) next.set("pipeline", value);
              else next.delete("pipeline");
              next.delete("stage");
              replaceViewQuery(next);
            }}
            options={[
              { value: "", label: t.allPipelines },
              ...data.pipelines
                .filter((p) => !productId || p.productId === productId)
                .map((p) => ({
                  value: p.id,
                  label: productId
                    ? p.name
                    : `${crm.product(p.productId)?.name} · ${p.name}`,
                })),
            ]}
          />
        </div>
        {stageFilter && (
          <button
            type="button"
            className="opportunity-stage-filter"
            aria-label={`${t.clearFilters}: ${t.stage}`}
            title={t.clearFilters}
            onClick={() => {
              const next = currentViewQuery();
              next.delete("stage");
              replaceViewQuery(next);
            }}
          >
            {t.stage}:{" "}
            {data.stages.find((stage) => stage.id === stageFilter)?.name}
            <X size={12} aria-hidden />
          </button>
        )}
        <span className="opportunity-result-count" aria-live="polite">
          {(browser.rows.length === 1
            ? t.opportunityBoard.deal
            : t.opportunityBoard.deals
          ).replace("{count}", String(browser.rows.length))}
        </span>
        <div className="opportunity-control-actions">
          <RecordSort browser={browser} />
          <button
            type="button"
            className="primary"
            onClick={() => crm.openRecordDialog({ kind: "opportunity" })}
          >
            <Plus size={14} aria-hidden />
            {t.newDeal}
          </button>
          {crm.isAdmin && (
            <button
              type="button"
              onClick={() => {
                if (crm.canLeaveEditor()) setPipelineDialog(true);
              }}
            >
              <Plus size={14} aria-hidden />
              {t.newPipeline}
            </button>
          )}
        </div>
      </div>
      {pipelineDialog && (
        <PipelineDialog
          key={crm.organizationId}
          onClose={() => setPipelineDialog(false)}
        />
      )}
      <RecordFilters browser={browser} hideSort />
      {!browser.rows.length ? (
        <EmptyState
          title={
            hasOpportunities ? t.noResults : t.inlineEditing.noOpportunities
          }
          description={
            hasOpportunities
              ? t.uiRefresh.noMatchingDeals
              : t.inlineEditing.opportunitiesHint
          }
          action={
            hasOpportunities ? (
              <>
                {hasFilters && (
                  <button type="button" onClick={clearFilters}>
                    {t.clearFilters}
                  </button>
                )}
                {productId && (
                  <button type="button" onClick={() => crm.switchProduct("")}>
                    {t.actionEmpty.viewAllProducts}
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                className="primary"
                onClick={() => crm.openRecordDialog({ kind: "opportunity" })}
              >
                <Plus size={14} />
                {t.newDeal}
              </button>
            )
          }
        />
      ) : layout === "list" ? (
        <div className="deal-list">
          <table>
            <thead>
              <tr>
                <th>{t.name}</th>
                <th>{t.person}</th>
                <th>{t.product}</th>
                <th>{t.stage}</th>
                <th>{t.dealSize}</th>
                <th>{t.owner}</th>
              </tr>
            </thead>
            <tbody>
              {browser.page.items.map((opportunity) => (
                <tr key={opportunity.id}>
                  <td>
                    <button
                      type="button"
                      className="text-button"
                      data-nav-record={opportunity.id}
                      onClick={() =>
                        crm.openRecordDialog({
                          kind: "opportunity",
                          id: opportunity.id,
                        })
                      }
                    >
                      {opportunity.name}
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => crm.openPerson(opportunity.relationshipId)}
                    >
                      {personFor(opportunity.relationshipId)?.name}
                    </button>
                  </td>
                  <td>{crm.product(opportunity.productId)?.name}</td>
                  <td>
                    {
                      data.stages.find(
                        (stage) => stage.id === opportunity.stageId,
                      )?.name
                    }
                  </td>
                  <td>
                    {opportunity.amountMinor === null
                      ? ""
                      : formatMoney(
                          opportunity.amountMinor,
                          opportunity.currency,
                        )}
                  </td>
                  <td>
                    {crm.member(
                      opportunity.ownerId ??
                        index.relationships.get(opportunity.relationshipId)
                          ?.ownerId ??
                        "",
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <section
          className="opportunity-board"
          aria-label={t.opportunityBoard.title}
        >
          <div
            className="pipeline-stages opportunity-columns"
            style={{
              gridTemplateColumns: `repeat(${columns.length}, minmax(260px, 1fr))`,
            }}
          >
            {columns.map((column) => {
              const droppable =
                !!dragged &&
                !!opportunityDropStage(column, dragged, data.stages);
              return (
                <section
                  key={column.key}
                  aria-label={column.name}
                  data-stage={
                    column.stages.length === 1
                      ? column.stages[0]?.id
                      : undefined
                  }
                  data-stage-group={column.key}
                  data-category={column.category}
                  data-drop-target={
                    droppable && target === column.key ? "" : undefined
                  }
                  onDragOver={(event) => {
                    if (!droppable) return;
                    event.preventDefault();
                    if (event.dataTransfer)
                      event.dataTransfer.dropEffect = "move";
                    setTarget(column.key);
                  }}
                  onDragLeave={(event) => {
                    if (
                      !(event.relatedTarget instanceof Node) ||
                      !event.currentTarget.contains(event.relatedTarget)
                    )
                      setTarget((current) =>
                        current === column.key ? "" : current,
                      );
                  }}
                  onDrop={(event) => {
                    if (droppable) drop(column, event);
                  }}
                >
                  <header className="opportunity-column-head">
                    <div className="group-title">
                      <span>{column.name}</span>
                      <span className="opportunity-column-count">
                        {column.rows.length}
                      </span>
                    </div>
                    <small className="stage-value">
                      {totals(column.rows)
                        .map((row) => money(row.amountMinor, row.currency))
                        .join(" · ") || "—"}
                    </small>
                  </header>
                  <StageCards
                    rows={column.rows}
                    revealId={focusedId}
                    scope={`${crm.organizationId}:${crm.productId}:${column.key}:${crm.listFilterKey}:${crm.search}:${JSON.stringify(browser.filters)}`}
                  >
                    {(stageRows) =>
                      stageRows.map((opportunity) => {
                        const product = crm.product(opportunity.productId);
                        const owner = crm.member(
                          opportunity.ownerId ??
                            index.relationships.get(opportunity.relationshipId)
                              ?.ownerId ??
                            "",
                        );
                        const extraTags = opportunity.tags.slice(2);
                        return (
                          <article
                            className={`deal-card opportunity-card ${focusedId === opportunity.id ? "record-highlight" : ""}`}
                            key={opportunity.id}
                            data-record-id={opportunity.id}
                            data-product-id={opportunity.productId}
                            data-dragging={
                              dragging === opportunity.id ? "" : undefined
                            }
                            tabIndex={-1}
                            draggable
                            onDragStart={(event) => {
                              setDragging(opportunity.id);
                              event.dataTransfer?.setData(
                                dragType,
                                opportunity.id,
                              );
                              if (event.dataTransfer)
                                event.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={endDrag}
                          >
                            {!productId && product && (
                              <span className="opportunity-product">
                                <span
                                  className="product-dot"
                                  style={{
                                    background: productColorToken(
                                      product.colorKey,
                                    ),
                                  }}
                                />
                                {product.name}
                              </span>
                            )}
                            <div className="deal-card-head">
                              <button
                                data-nav-record={opportunity.id}
                                type="button"
                                className="text-button"
                                aria-keyshortcuts="Shift+ArrowLeft Shift+ArrowRight E"
                                onClick={() =>
                                  crm.openRecordDialog({
                                    kind: "opportunity",
                                    id: opportunity.id,
                                  })
                                }
                              >
                                {opportunity.name}
                              </button>
                              <button
                                type="button"
                                className="icon-button deal-card-edit"
                                aria-label={`${t.editOpportunity}: ${opportunity.name}`}
                                title={t.editOpportunity}
                                onClick={() =>
                                  crm.openRecordDialog({
                                    kind: "opportunity",
                                    id: opportunity.id,
                                  })
                                }
                              >
                                <Pencil size={12} aria-hidden />
                              </button>
                            </div>
                            <p className="opportunity-person">
                              {personFor(opportunity.relationshipId)?.name}
                            </p>
                            <div className="opportunity-card-value">
                              <strong
                                className={
                                  opportunity.amountMinor === null
                                    ? "muted"
                                    : ""
                                }
                              >
                                {opportunity.amountMinor === null
                                  ? t.amountUnknown
                                  : formatMoney(
                                      opportunity.amountMinor,
                                      opportunity.currency,
                                    )}
                              </strong>
                              {opportunity.probability !== null && (
                                <span
                                  title={`${t.probability}: ${opportunity.probability}%`}
                                >
                                  {opportunity.probability}%
                                </span>
                              )}
                            </div>
                            <div
                              className="opportunity-card-owner"
                              title={t.ownedBy.replace("{name}", owner)}
                            >
                              {owner}
                            </div>
                            {opportunity.expectedCloseDate && (
                              <small
                                className="opportunity-close-date"
                                title={t.expectedCloseDate}
                              >
                                <CalendarDays size={12} aria-hidden />
                                {opportunity.expectedCloseDate}
                              </small>
                            )}
                            {!!opportunity.tags.length && (
                              <span className="record-tags">
                                {opportunity.tags.slice(0, 2).map((tag) => (
                                  <span className="badge" key={tag}>
                                    {tag}
                                  </span>
                                ))}
                                {!!extraTags.length && (
                                  <span
                                    className="badge opportunity-more-tags"
                                    title={extraTags.join(", ")}
                                  >
                                    <span aria-hidden>+{extraTags.length}</span>
                                    <span className="sr-only">
                                      {t.opportunityBoard.moreTags.replace(
                                        "{tags}",
                                        extraTags.join(", "),
                                      )}
                                    </span>
                                  </span>
                                )}
                              </span>
                            )}
                            {(opportunity.description ||
                              (opportunity.amountMinor !== null &&
                                opportunity.probability !== null)) && (
                              <details className="deal-context">
                                <summary>{t.dealDescription}</summary>
                                {opportunity.amountMinor !== null &&
                                  opportunity.probability !== null && (
                                    <small>
                                      {t.expectedRevenue}:{" "}
                                      {formatMoney(
                                        weightedAmount(
                                          opportunity.amountMinor,
                                          opportunity.probability,
                                        ),
                                        opportunity.currency,
                                      )}
                                    </small>
                                  )}
                                {opportunity.description && (
                                  <RecordText
                                    value={opportunity.description}
                                    limit={160}
                                  />
                                )}
                              </details>
                            )}
                          </article>
                        );
                      })
                    }
                  </StageCards>
                </section>
              );
            })}
          </div>
        </section>
      )}
      {layout === "list" && browser.rows.length > 0 && (
        <Pagination page={browser.page} />
      )}
    </div>
  );
}
