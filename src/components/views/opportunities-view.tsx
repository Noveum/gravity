"use client";
import t from "@crm/i18n/translations/en.json";
import { Pencil } from "lucide-react";
import { type DragEvent, useLayoutEffect, useState } from "react";
import { useCreate, useEdit, useWorkspaceData } from "../crm/crm-context";
import { useRevealedRecord } from "../crm/use-revealed-record";
import { pipelineStages, useStageMoves } from "../crm/use-stage-moves";
import { focusedRecord } from "../keyboard-navigation";
import { formatMoney } from "../money";

const dragType = "application/x-gravity-opportunity";

export function OpportunitiesView() {
  const crm = useWorkspaceData();
  const { data, search, productId, personFor } = crm;
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
    <div className="page-content deal-board">
      {data.products
        .filter((product) => !productId || product.id === productId)
        .map((product) => {
          const stages = pipelineStages(data.stages, product.id);
          return (
            <div key={product.id} className="product-pipeline">
              <h2>
                <span
                  className="product-dot"
                  style={{ background: product.color }}
                />
                {product.name}
              </h2>
              <div
                className="pipeline-stages"
                style={{
                  gridTemplateColumns: `repeat(${stages.length}, minmax(176px, 1fr))`,
                }}
              >
                {stages.map((stage) => {
                  const cards = data.opportunities.filter(
                    (opportunity) => opportunity.stageId === stage.id,
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
                        <span>{cards.length}</span>
                      </div>
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
                            <p>{personFor(opportunity.relationshipId)?.name}</p>
                            <small>
                              {formatMoney(
                                opportunity.amountMinor,
                                opportunity.currency,
                              )}
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
  );
}
