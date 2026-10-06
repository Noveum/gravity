"use client";
import { money, totals, weightedAmount } from "@crm/core/analytics";
import { productColorToken } from "@crm/core/product-colors";
import t from "@crm/i18n/translations/en.json";
import { Columns3, List, Pencil, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  type DragEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useCreate, useEdit, useWorkspaceData } from "../crm/crm-context";
import { useRevealedRecord } from "../crm/use-revealed-record";
import { pipelineStages, useStageMoves } from "../crm/use-stage-moves";
import { PipelineDialog } from "../deal-dialog";
import { focusedRecord } from "../keyboard-navigation";
import { formatMoney } from "../money";
import {
  Pagination,
  RecordFilters,
  useRecordBrowser,
  useRecordIndex,
} from "../records/list-browser";
import { RecordText } from "../records/record-text";
import { StageCards } from "../records/stage-cards";
import { EmptyState } from "../ui/states";

const dragType = "application/x-gravity-opportunity";

export function OpportunitiesView() {
  const crm = useWorkspaceData();
  const { data, search, productId, personFor } = crm;
  const query = useSearchParams();
  const router = useRouter();
  const dealId = query.get("deal");
  const [pipelineDialog, setPipelineDialog] = useState(false);
  const [layout, setLayout] = useState<"list" | "board">("list");
  const processedDeal = useRef<string | null>(null);
  const chosen = data.opportunities.find((d) => d.id === dealId);
  const closeDeal = useCallback(() => {
    const next = new URLSearchParams(query.toString());
    next.delete("deal");
    router.replace(`/opportunities${next.size ? `?${next}` : ""}`);
  }, [query, router]);
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
    const next = new URLSearchParams(query.toString());
    if (pipelineFilter && !pipeline) next.delete("pipeline");
    next.delete("stage");
    router.replace(`/opportunities${next.size ? `?${next}` : ""}`);
  }, [
    data.pipelines,
    data.stages,
    pipelineFilter,
    stageFilter,
    productId,
    query,
    router,
  ]);
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
    return (
      (!query.get("pipeline") || stage?.pipelineId === query.get("pipeline")) &&
      (!query.get("stage") || opportunity.stageId === query.get("stage")) &&
      (!query.get("owner") ||
        (opportunity.ownerId ??
          index.relationships.get(opportunity.relationshipId)?.ownerId) ===
          query.get("owner")) &&
      matches(opportunity.name, personFor(opportunity.relationshipId)?.name)
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
  const draggedProduct = data.opportunities.find(
    (item) => item.id === dragging,
  )?.productId;
  function endDrag() {
    setDragging("");
    setTarget("");
  }
  function drop(stageId: string, event: DragEvent) {
    event.preventDefault();
    const id = dragging || event.dataTransfer?.getData(dragType);
    endDrag();
    const opportunity = data.opportunities.find((item) => item.id === id);
    if (opportunity) void moves.move(opportunity, stageId);
  }
  return (
    <>
      <div className="deal-controls page-content">
        <label>
          {t.pipeline}
          <select
            aria-label={t.pipeline}
            value={query.get("pipeline") ?? ""}
            onChange={(e) => {
              const next = new URLSearchParams(query.toString());
              if (e.target.value) next.set("pipeline", e.target.value);
              else next.delete("pipeline");
              next.delete("stage");
              router.replace(`/opportunities${next.size ? `?${next}` : ""}`);
            }}
          >
            <option value="">{t.allPipelines}</option>
            {data.pipelines
              .filter((p) => !productId || p.productId === productId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {crm.product(p.productId)?.name} · {p.name}
                </option>
              ))}
          </select>
        </label>
        <button
          type="button"
          className="primary"
          onClick={() => crm.openRecordDialog({ kind: "opportunity" })}
        >
          <Plus size={14} aria-hidden />
          {t.newDeal}
        </button>
        <fieldset className="layout-switch" aria-label={t.inlineEditing.list}>
          <button
            type="button"
            aria-pressed={layout === "list"}
            onClick={() => setLayout("list")}
          >
            <List size={14} />
            {t.inlineEditing.list}
          </button>
          <button
            type="button"
            aria-pressed={layout === "board"}
            onClick={() => setLayout("board")}
          >
            <Columns3 size={14} />
            {t.inlineEditing.board}
          </button>
        </fieldset>
        {crm.isAdmin && (
          <button type="button" onClick={() => setPipelineDialog(true)}>
            <Plus size={14} aria-hidden />
            {t.newPipeline}
          </button>
        )}
      </div>
      <RecordFilters browser={browser} />
      {!browser.rows.length ? (
        <EmptyState
          title={
            data.opportunities.length
              ? t.noResults
              : t.inlineEditing.noOpportunities
          }
          description={t.inlineEditing.opportunitiesHint}
          action={
            <button
              type="button"
              className="primary"
              onClick={() => crm.openRecordDialog({ kind: "opportunity" })}
            >
              <Plus size={14} />
              {t.newDeal}
            </button>
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
        <div className="page-content deal-board">
          {data.pipelines
            .filter(
              (p) =>
                (!productId || p.productId === productId) &&
                (!query.get("pipeline") || p.id === query.get("pipeline")) &&
                browser.rows.some(
                  (opportunity) =>
                    data.stages.find(
                      (stage) => stage.id === opportunity.stageId,
                    )?.pipelineId === p.id,
                ),
            )
            .map((pipeline) => {
              const product = crm.product(pipeline.productId);
              if (!product) return null;
              const stages = pipelineStages(data.stages, product.id).filter(
                (s) =>
                  s.pipelineId === pipeline.id &&
                  !s.archivedAt &&
                  (!query.get("stage") || s.id === query.get("stage")),
              );
              return (
                <div key={pipeline.id} className="product-pipeline">
                  <h2 aria-label={`${product.name} / ${pipeline.name}`}>
                    <span
                      className="product-dot"
                      style={{
                        background: productColorToken(product.colorKey),
                      }}
                    />
                    {product.name}
                    <span className="muted"> / {pipeline.name}</span>
                  </h2>
                  <div
                    className="pipeline-stages"
                    style={{
                      gridTemplateColumns: `repeat(${stages.length}, 280px)`,
                    }}
                  >
                    {stages.map((stage) => {
                      const cards = browser.rows.filter(
                        (opportunity) =>
                          opportunity.stageId === stage.id &&
                          (!query.get("owner") ||
                            (opportunity.ownerId ??
                              data.relationships.find(
                                (r) => r.id === opportunity.relationshipId,
                              )?.ownerId) === query.get("owner")),
                      );
                      const droppable = draggedProduct === product.id;
                      return (
                        <section
                          key={stage.id}
                          aria-label={stage.name}
                          data-stage={stage.id}
                          data-category={stage.category}
                          data-drop-target={
                            droppable && target === stage.id ? "" : undefined
                          }
                          onDragOver={(event) => {
                            if (!droppable) return;
                            event.preventDefault();
                            if (event.dataTransfer)
                              event.dataTransfer.dropEffect = "move";
                            setTarget(stage.id);
                          }}
                          onDragLeave={(event) => {
                            if (
                              !(event.relatedTarget instanceof Node) ||
                              !event.currentTarget.contains(event.relatedTarget)
                            )
                              setTarget((current) =>
                                current === stage.id ? "" : current,
                              );
                          }}
                          onDrop={(event) => {
                            if (droppable) drop(stage.id, event);
                          }}
                        >
                          <div className="group-title">
                            {stage.name}
                            <span>
                              {
                                browser.rows.filter(
                                  (opportunity) =>
                                    opportunity.stageId === stage.id,
                                ).length
                              }
                            </span>
                          </div>
                          <small className="stage-value">
                            {totals(
                              browser.rows.filter(
                                (opportunity) =>
                                  opportunity.stageId === stage.id,
                              ),
                            )
                              .map((r) => money(r.amountMinor, r.currency))
                              .join(" · ") || "—"}
                          </small>
                          <StageCards
                            rows={cards}
                            scope={`${crm.organizationId}:${crm.productId}:${stage.id}:${crm.listFilterKey}:${crm.search}:${JSON.stringify(browser.filters)}`}
                          >
                            {(stageRows) =>
                              stageRows
                                .filter((opportunity) =>
                                  matches(
                                    opportunity.name,
                                    personFor(opportunity.relationshipId)?.name,
                                  ),
                                )
                                .map((opportunity) => (
                                  <article
                                    className={`deal-card ${focusedId === opportunity.id ? "record-highlight" : ""}`}
                                    key={opportunity.id}
                                    data-record-id={opportunity.id}
                                    data-dragging={
                                      dragging === opportunity.id
                                        ? ""
                                        : undefined
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
                                        event.dataTransfer.effectAllowed =
                                          "move";
                                    }}
                                    onDragEnd={endDrag}
                                  >
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
                                    <p>
                                      {
                                        personFor(opportunity.relationshipId)
                                          ?.name
                                      }
                                    </p>
                                    {opportunity.amountMinor !== null && (
                                      <small>
                                        {formatMoney(
                                          opportunity.amountMinor,
                                          opportunity.currency,
                                        )}
                                      </small>
                                    )}
                                    <small>
                                      {crm.member(
                                        opportunity.ownerId ??
                                          data.relationships.find(
                                            (r) =>
                                              r.id ===
                                              opportunity.relationshipId,
                                          )?.ownerId ??
                                          "",
                                      )}
                                    </small>
                                    <span className="record-tags">
                                      {opportunity.tags.map((tag) => (
                                        <span className="badge" key={tag}>
                                          {tag}
                                        </span>
                                      ))}
                                    </span>
                                    {opportunity.probability !== null && (
                                      <small>
                                        {t.probability}:{" "}
                                        {opportunity.probability === null
                                          ? t.unspecified
                                          : `${opportunity.probability}%`}
                                      </small>
                                    )}
                                    {opportunity.amountMinor !== null &&
                                      opportunity.probability !== null && (
                                        <small>
                                          {t.expectedRevenue}:{" "}
                                          {weightedAmount(
                                            opportunity.amountMinor,
                                            opportunity.probability,
                                          ) === null
                                            ? t.forecastUnknown
                                            : formatMoney(
                                                weightedAmount(
                                                  opportunity.amountMinor,
                                                  opportunity.probability,
                                                ),
                                                opportunity.currency,
                                              )}
                                        </small>
                                      )}
                                    {opportunity.description && (
                                      <details className="deal-context">
                                        <summary>{t.dealDescription}</summary>
                                        <RecordText
                                          value={opportunity.description}
                                          limit={160}
                                        />
                                      </details>
                                    )}
                                    {opportunity.expectedCloseDate && (
                                      <small>
                                        {t.expectedCloseDate}:{" "}
                                        {opportunity.expectedCloseDate ??
                                          t.unspecified}
                                      </small>
                                    )}
                                  </article>
                                ))
                            }
                          </StageCards>
                        </section>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>
      )}
      {layout === "list" && browser.rows.length > 0 && (
        <Pagination page={browser.page} />
      )}
      {pipelineDialog && (
        <PipelineDialog
          key={crm.organizationId}
          onClose={() => setPipelineDialog(false)}
        />
      )}
    </>
  );
}
