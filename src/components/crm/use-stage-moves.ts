"use client";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { focusedRecord } from "../keyboard-navigation";
import { useCrm } from "./crm-context";

type Opportunity = ClientSnapshot["opportunities"][number];
type Stage = ClientSnapshot["stages"][number];

export function pipelineStages(stages: readonly Stage[], productId: string) {
  return stages
    .filter((stage) => stage.productId === productId)
    .sort((a, b) => a.position - b.position);
}

export function adjacentOpenStage(
  stages: readonly Stage[],
  opportunity: Opportunity,
  direction: "next" | "previous",
) {
  const pipelineId = stages.find(
    (stage) => stage.id === opportunity.stageId,
  )?.pipelineId;
  const pipeline = pipelineStages(stages, opportunity.productId).filter(
    (stage) => stage.pipelineId === pipelineId && !stage.archivedAt,
  );
  const current = pipeline.find((stage) => stage.id === opportunity.stageId);
  if (current?.category !== "open")
    return { stage: undefined, reason: t.closedStageMove };
  const open = pipeline.filter((stage) => stage.category === "open");
  const index = open.indexOf(current);
  const stage = open[index + (direction === "next" ? 1 : -1)];
  return stage
    ? { stage, reason: "" }
    : {
        stage: undefined,
        reason: direction === "next" ? t.openStageEnd : t.openStageStart,
      };
}

export function useStageMoves() {
  const crm = useCrm();
  const refocus = (id: string) => {
    crm.rowFocus.current = id;
  };
  async function move(opportunity: Opportunity, stageId: string) {
    const stages = crm.data?.stages ?? [];
    const target = stages.find((stage) => stage.id === stageId);
    if (!target || stageId === opportunity.stageId) return false;
    const from = opportunity.stageId;
    const { ok, result } = await crm.send(
      {
        operation: "opportunity-change",
        organizationId: crm.organizationId,
        opportunityId: opportunity.id,
        version: opportunity.version,
        stageId,
      },
      false,
    );
    if (!ok) return false;
    const moved = result as Opportunity;
    refocus(opportunity.id);
    crm.notify(
      t.movedToStage
        .replace("{name}", opportunity.name)
        .replace("{stage}", target.name),
      "success",
      {
        label: t.undo,
        run: () => {
          void crm
            .send(
              {
                operation: "opportunity-change",
                organizationId: crm.organizationId,
                opportunityId: moved.id,
                version: moved.version,
                stageId: from,
              },
              t.verbUndone,
            )
            .then(({ ok: undone }) => {
              if (undone) refocus(moved.id);
            });
        },
      },
    );
    return true;
  }
  function step(direction: "next" | "previous") {
    const id = focusedRecord()?.getAttribute("data-nav-record");
    const opportunity = crm.data?.opportunities.find((item) => item.id === id);
    if (!opportunity || !crm.data) return false;
    const { stage, reason } = adjacentOpenStage(
      crm.data.stages,
      opportunity,
      direction,
    );
    if (stage) void move(opportunity, stage.id);
    else crm.notify(reason);
    return true;
  }
  return { move, step };
}
