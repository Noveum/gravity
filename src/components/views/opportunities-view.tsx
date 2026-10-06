"use client";
import { money, totals } from "@crm/core/analytics";
import t from "@crm/i18n/translations/en.json";
import { Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type DragEvent, useLayoutEffect, useState } from "react";
import { useCreate, useEdit, useWorkspaceData } from "../crm/crm-context";
import { useRevealedRecord } from "../crm/use-revealed-record";
import { pipelineStages, useStageMoves } from "../crm/use-stage-moves";
import { DealDialog, PipelineDialog } from "../deal-dialog";
import { focusedRecord } from "../keyboard-navigation";
import { formatMoney } from "../money";
import {
  Pagination,
  RecordFilters,
  useRecordBrowser,
  useRecordIndex,
} from "../records/list-browser";

const dragType = "application/x-gravity-opportunity";

export function OpportunitiesView() {
  const crm = useWorkspaceData();
  const { data, search, productId, personFor } = crm;
  const query = useSearchParams();
  const router = useRouter();
  const dealId = query.get("deal");
  const [pipelineDialog, setPipelineDialog] = useState(false);
  const chosen = data.opportunities.find((d) => d.id === dealId);
  const closeDeal = () => {
    const next = new URLSearchParams(query.toString());
    next.delete("deal");
    router.replace(`/opportunities${next.size ? `?${next}` : ""}`);
  };
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
            {data.pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {crm.product(p.productId)?.name} · {p.name}
              </option>
            ))}
          </select>
        </label>
        <Link className="button primary" href="/opportunities?deal=new">
          <Plus size={14} aria-hidden />
          {t.newDeal}
        </Link>
        {crm.isAdmin && (
          <button type="button" onClick={() => setPipelineDialog(true)}>
            <Plus size={14} aria-hidden />
            {t.newPipeline}
          </button>
        )}
      </div>
      <RecordFilters browser={browser} />
      <div className="page-content deal-board">
        {data.pipelines
          .filter(
            (p) =>
              (!productId || p.productId === productId) &&
              (!query.get("pipeline") || p.id === query.get("pipeline")),
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
                    style={{ background: product.color }}
                  />
                  {product.name}
                  <span className="muted"> / {pipeline.name}</span>
                </h2>
                <div
                  className="pipeline-stages"
                  style={{
                    gridTemplateColumns: `repeat(${stages.length}, minmax(176px, 1fr))`,
                  }}
                >
                  {stages.map((stage) => {
                    const cards = browser.page.items.filter(
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
                              (opportunity) => opportunity.stageId === stage.id,
                            ),
                          )
                            .map((r) => money(r.amountMinor, r.currency))
                            .join(" · ") || "—"}
                        </small>
                        {cards
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
                              <div className="deal-card-head">
                                <button
                                  data-nav-record={opportunity.id}
                                  type="button"
                                  className="text-button"
                                  aria-keyshortcuts="Shift+ArrowLeft Shift+ArrowRight E"
                                  onClick={() =>
                                    crm.openPerson(opportunity.relationshipId)
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
                                {personFor(opportunity.relationshipId)?.name}
                              </p>
                              <small>
                                {formatMoney(
                                  opportunity.amountMinor,
                                  opportunity.currency,
                                )}
                              </small>
                              <small>
                                {crm.member(
                                  opportunity.ownerId ??
                                    data.relationships.find(
                                      (r) =>
                                        r.id === opportunity.relationshipId,
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
                              <small>
                                {t.probability}:{" "}
                                {opportunity.probability === null
                                  ? t.unspecified
                                  : `${opportunity.probability}%`}
                              </small>
                              <small>
                                {t.expectedCloseDate}:{" "}
                                {opportunity.expectedCloseDate ?? t.unspecified}
                              </small>
                            </article>
                          ))}
                      </section>
                    );
                  })}
                </div>
              </div>
            );
          })}
      </div>
      <Pagination page={browser.page} />
      {(dealId === "new" || chosen) && (
        <DealDialog
          key={`${crm.organizationId}:${dealId}`}
          deal={chosen}
          onClose={closeDeal}
        />
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
