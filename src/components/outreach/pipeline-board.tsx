"use client";
import { overdueDay } from "@crm/core/calendar";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { type DragEvent, useLayoutEffect, useRef, useState } from "react";
import { dateLabel } from "../client-api";
import { useVerbs, useWorkspaceData } from "../crm/crm-context";
import { focusedRecord } from "../keyboard-navigation";
import { rowKeys } from "../records/peek-keys";
import { RecordDialog } from "../records/record-dialog";
import { personPath } from "../routes";
import { initials } from "../shell/workspace-menu";
import { EmptyState } from "../ui/states";
import { useOutreachSend } from "./outreach-data";
import { StageMenu } from "./stage-menu";

type Relationship = ClientSnapshot["relationships"][number];
type Stage = ClientSnapshot["outreachStages"][number];
const dragType = "application/x-gravity-relationship";

export function outreachPipeline(stages: readonly Stage[], productId: string) {
  return stages
    .filter((stage) => stage.productId === productId && !stage.archivedAt)
    .sort((a, b) => a.position - b.position);
}

export function adjacentOpenStage(
  pipeline: readonly Stage[],
  stageId: string,
  direction: "next" | "previous",
) {
  const current = pipeline.find((stage) => stage.id === stageId);
  if (current?.category !== "open")
    return { stage: undefined, reason: t.relationshipClosedMove };
  const open = pipeline.filter((stage) => stage.category === "open");
  const stage = open[open.indexOf(current) + (direction === "next" ? 1 : -1)];
  return stage
    ? { stage, reason: "" }
    : {
        stage: undefined,
        reason: direction === "next" ? t.relationshipOpenEnd : t.openStageStart,
      };
}

function useBrands() {
  const crm = useWorkspaceData();
  return crm.data.products.filter(
    (product) => product.organizationId === crm.organizationId,
  );
}

function BrandPrompt({ onChoose }: { onChoose: (brand: string) => void }) {
  const products = useBrands();
  const [brand, setBrand] = useState(products[0]?.id ?? "");
  return (
    <EmptyState
      title={t.pipelineChooseBrand}
      description={t.pipelineChooseBrandDetail}
      action={
        <form
          className="pipeline-brand"
          onSubmit={(event) => {
            event.preventDefault();
            if (brand) onChoose(brand);
          }}
        >
          <label htmlFor="pipeline-brand" className="sr-only">
            {t.product}
          </label>
          <select
            id="pipeline-brand"
            value={brand}
            onChange={(event) => setBrand(event.target.value)}
          >
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
          <button type="submit" className="primary" disabled={!brand}>
            {t.pipelineShow}
          </button>
        </form>
      }
    />
  );
}

function BrandSwitch({
  brand,
  onChoose,
}: {
  brand: string;
  onChoose: (brand: string) => void;
}) {
  const products = useBrands();
  return (
    <div className="pipeline-brand pipeline-brand-bar">
      <label htmlFor="pipeline-brand-shown">{t.pipelineBrand}</label>
      <select
        id="pipeline-brand-shown"
        value={brand}
        onChange={(event) => onChoose(event.target.value)}
      >
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function PipelineBoard() {
  const crm = useWorkspaceData();
  const products = useBrands();
  const [chosen, setChosen] = useState("");
  if (crm.productId)
    return <Board key={crm.productId} productId={crm.productId} />;
  const brand = products.some((product) => product.id === chosen) ? chosen : "";
  if (!brand) return <BrandPrompt onChoose={setChosen} />;
  return (
    <>
      <BrandSwitch brand={brand} onChoose={setChosen} />
      <Board key={brand} productId={brand} />
    </>
  );
}

function Board({ productId }: { productId: string }) {
  const crm = useWorkspaceData();
  const send = useOutreachSend();
  const pipeline = outreachPipeline(crm.sourceData.outreachStages, productId);
  const [dragging, setDragging] = useState("");
  const [target, setTarget] = useState("");
  const [menu, setMenu] = useState<{
    relationship: Relationship;
    anchor: HTMLElement | null;
  } | null>(null);
  const [closing, setClosing] = useState<{
    relationship: Relationship;
    stage: Stage;
  } | null>(null);
  const refocus = useRef("");
  useLayoutEffect(() => {
    const id = refocus.current;
    if (!id) return;
    const card = document.querySelector<HTMLElement>(
      `#records-panel [data-nav-record="${id}"]`,
    );
    if (!card || card === document.activeElement) return;
    refocus.current = "";
    card.focus();
  });
  const product = crm.product(productId);
  const relationships = crm.data.relationships.filter(
    (relationship) =>
      relationship.productId === productId &&
      [crm.personFor(relationship.id)?.name, relationship.nextStep]
        .join(" ")
        .toLowerCase()
        .includes(crm.search.toLowerCase()),
  );
  const local = useRef(new Map<string, { stageId: string; version: number }>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const latest = (relationship: Relationship) => {
    const mine = local.current.get(relationship.id);
    return mine && mine.version > relationship.version
      ? mine
      : { stageId: relationship.stageId ?? "", version: relationship.version };
  };
  const stageOf = (relationship: Relationship) =>
    pipeline.find((stage) => stage.id === latest(relationship).stageId) ??
    pipeline[0];
  const nameOf = (relationship: Relationship) =>
    crm.personFor(relationship.id)?.name ?? t.unknown;
  function enqueue<T>(task: () => Promise<T>) {
    const next = queue.current.then(task, task);
    queue.current = next.catch(() => undefined);
    return next;
  }
  async function save(relationship: Relationship, stage: Stage) {
    const result = await send<Relationship>({
      operation: "relationship",
      relationshipId: relationship.id,
      version: latest(relationship).version,
      stageId: stage.id,
    });
    if (!result.ok) {
      crm.notify(result.error, "danger");
      return false;
    }
    local.current.set(relationship.id, {
      stageId: result.result.stageId ?? stage.id,
      version: result.result.version,
    });
    refocus.current = relationship.id;
    await crm.refresh();
    return true;
  }
  function move(
    relationship: Relationship,
    pick: (from: Stage) => { stage?: Stage | undefined; reason?: string },
  ) {
    return enqueue(async () => {
      const from = stageOf(relationship);
      if (!from) return false;
      const { stage, reason } = pick(from);
      if (!stage) {
        if (reason) crm.notify(reason);
        return false;
      }
      if (stage.id === from.id) return false;
      if (!(await save(relationship, stage))) return false;
      crm.notify(
        t.movedToStage
          .replace("{name}", nameOf(relationship))
          .replace("{stage}", stage.name),
        "success",
        {
          label: t.undo,
          run: () =>
            void enqueue(async () => {
              if (await save(relationship, from))
                crm.notify(t.verbUndone, "success");
            }),
        },
      );
      return true;
    });
  }
  function request(relationship: Relationship, stageId: string) {
    const stage = pipeline.find((item) => item.id === stageId);
    if (!stage || stage.id === stageOf(relationship)?.id) return;
    if (stage.category === "open") void move(relationship, () => ({ stage }));
    else setClosing({ relationship, stage });
  }
  function focused() {
    const id = focusedRecord()?.getAttribute("data-nav-record");
    return relationships.find((relationship) => relationship.id === id);
  }
  const step = (direction: "next" | "previous") => () => {
    const relationship = focused();
    if (!relationship) return false;
    void move(relationship, (from) =>
      adjacentOpenStage(pipeline, from.id, direction),
    );
    return true;
  };
  useVerbs({
    "move-next": step("next"),
    "move-previous": step("previous"),
    "move-to": () => {
      const relationship = focused();
      if (!relationship) return false;
      setMenu({
        relationship,
        anchor: focusedRecord(),
      });
      return true;
    },
  });
  function closeMenu() {
    const anchor = menu?.anchor;
    setMenu(null);
    if (anchor?.isConnected) anchor.focus();
  }
  function drop(stageId: string, event: DragEvent) {
    event.preventDefault();
    const id = dragging || event.dataTransfer?.getData(dragType);
    setDragging("");
    setTarget("");
    const relationship = relationships.find((item) => item.id === id);
    if (relationship) request(relationship, stageId);
  }
  const now = Date.now();
  return (
    <section
      className="page-content deal-board outreach-board"
      aria-label={t.pipelineBoard.replace("{brand}", product?.name ?? "")}
    >
      <div
        className="pipeline-stages"
        style={{
          gridTemplateColumns: `repeat(${pipeline.length}, minmax(184px, 1fr))`,
        }}
      >
        {pipeline.map((stage) => {
          const cards = relationships.filter(
            (relationship) => stageOf(relationship)?.id === stage.id,
          );
          return (
            <section
              key={stage.id}
              aria-label={stage.name}
              data-stage={stage.id}
              data-category={stage.category}
              data-drop-target={
                dragging && target === stage.id ? "" : undefined
              }
              onDragOver={(event) => {
                if (!dragging) return;
                event.preventDefault();
                if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
                setTarget(stage.id);
              }}
              onDragLeave={(event) => {
                if (
                  !(event.relatedTarget instanceof Node) ||
                  !event.currentTarget.contains(event.relatedTarget)
                )
                  setTarget((current) => (current === stage.id ? "" : current));
              }}
              onDrop={(event) => drop(stage.id, event)}
            >
              <div className="group-title">
                {stage.name}
                <span>{cards.length}</span>
              </div>
              {cards.map((relationship) => {
                const name = nameOf(relationship);
                const owner = crm.member(relationship.ownerId);
                const person = crm.personFor(relationship.id);
                const due = relationship.nextStepDueAt;
                return (
                  <article
                    key={relationship.id}
                    className="deal-card relationship-card"
                    data-dragging={
                      dragging === relationship.id ? "" : undefined
                    }
                    draggable
                    onDragStart={(event) => {
                      setDragging(relationship.id);
                      event.dataTransfer?.setData(dragType, relationship.id);
                      if (event.dataTransfer)
                        event.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDragging("");
                      setTarget("");
                    }}
                  >
                    <div className="deal-card-head">
                      <button
                        type="button"
                        className="text-button"
                        data-nav-record={relationship.id}
                        aria-keyshortcuts="Space Enter Shift+ArrowLeft Shift+ArrowRight M"
                        onClick={() => crm.openPerson(relationship.id)}
                        onKeyDown={rowKeys({
                          peek: () => crm.openPerson(relationship.id),
                          open: () => {
                            if (person)
                              crm.go(
                                personPath(person.id, {
                                  relationshipId: relationship.id,
                                }),
                              );
                          },
                        })}
                      >
                        {name}
                      </button>
                      <span
                        className="row-owner"
                        title={t.ownedBy.replace("{name}", owner)}
                      >
                        <span aria-hidden>{initials(owner)}</span>
                        <span className="sr-only">
                          {t.ownedBy.replace("{name}", owner)}
                        </span>
                      </span>
                    </div>
                    <p className={relationship.nextStep ? "" : "muted"}>
                      {relationship.nextStep || t.noNextStepShort}
                    </p>
                    {due && (
                      <small
                        className={`relationship-due${overdueDay(due, now, crm.timeZone) ? " overdue" : ""}`}
                      >
                        {dateLabel(due, crm.timeZone)}
                      </small>
                    )}
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
      {menu && (
        <StageMenu
          label={t.moveToMenu.replace("{name}", nameOf(menu.relationship))}
          stages={pipeline}
          current={stageOf(menu.relationship)?.id ?? ""}
          anchor={menu.anchor}
          onClose={closeMenu}
          onChoose={(stageId) => {
            const relationship = menu.relationship;
            closeMenu();
            request(relationship, stageId);
          }}
        />
      )}
      {closing && (
        <RecordDialog
          title={t.closeStageTitle
            .replace("{name}", nameOf(closing.relationship))
            .replace("{stage}", closing.stage.name)}
          submitLabel={t.closeStageConfirm.replace(
            "{stage}",
            closing.stage.name,
          )}
          onClose={() => setClosing(null)}
          onSubmit={async () => {
            const stage = closing.stage;
            const moved = await move(closing.relationship, () => ({ stage }));
            return moved ? null : "";
          }}
        >
          <p className="muted">
            {t.closeStageDetail.replace("{stage}", closing.stage.name)}
          </p>
        </RecordDialog>
      )}
    </section>
  );
}
