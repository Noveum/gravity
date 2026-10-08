import type { ClientSnapshot } from "@crm/core/dto";

type Stage = Pick<
  ClientSnapshot["stages"][number],
  | "id"
  | "organizationId"
  | "productId"
  | "pipelineId"
  | "pipeline"
  | "name"
  | "category"
  | "position"
  | "archivedAt"
>;
type Pipeline = Pick<
  ClientSnapshot["pipelines"][number],
  "id" | "organizationId" | "productId"
>;
type BoardRow = Pick<
  ClientSnapshot["opportunities"][number],
  "id" | "organizationId" | "productId" | "stageId"
>;

export interface OpportunityColumn<T extends BoardRow = BoardRow> {
  key: string;
  name: string;
  category: Stage["category"];
  position: number;
  stages: Stage[];
  rows: T[];
}

const stageKey = (stage: Stage) =>
  `${stage.category}:${stage.name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase()}`;
const categoryOrder: Record<Stage["category"], number> = {
  open: 0,
  hold: 1,
  won: 2,
  lost: 3,
};

/** Group the visible stages without changing a record's real stage identity. */
export function opportunityColumns<T extends BoardRow>(
  stages: readonly Stage[],
  pipelines: readonly Pipeline[],
  rows: readonly T[],
  scope: {
    organizationId: string;
    productId?: string;
    pipelineId?: string;
    stageId?: string;
  },
): OpportunityColumn<T>[] {
  const pipelinesById = new Map(
    pipelines
      .filter(
        (pipeline) =>
          pipeline.organizationId === scope.organizationId &&
          (!scope.productId || pipeline.productId === scope.productId) &&
          (!scope.pipelineId || pipeline.id === scope.pipelineId),
      )
      .map((pipeline) => [pipeline.id, pipeline]),
  );
  const groups = new Map<string, OpportunityColumn<T>>();
  const byStage = new Map<string, OpportunityColumn<T>>();
  for (const stage of stages) {
    const pipeline = pipelinesById.get(stage.pipelineId ?? "");
    if (
      stage.organizationId !== scope.organizationId ||
      stage.pipeline !== "deal" ||
      stage.archivedAt ||
      !pipeline ||
      pipeline.productId !== stage.productId ||
      (scope.stageId && stage.id !== scope.stageId)
    )
      continue;
    const key = stageKey(stage);
    const group = groups.get(key) ?? {
      key,
      name: stage.name.trim(),
      category: stage.category,
      position: stage.position,
      stages: [],
      rows: [],
    };
    group.position = Math.min(group.position, stage.position);
    group.stages.push(stage);
    groups.set(key, group);
    byStage.set(stage.id, group);
  }
  for (const row of rows) {
    if (row.organizationId !== scope.organizationId) continue;
    const group = byStage.get(row.stageId);
    if (
      group?.stages.some(
        (stage) =>
          stage.id === row.stageId && stage.productId === row.productId,
      )
    )
      group.rows.push(row);
  }
  return [...groups.values()].sort(
    (left, right) =>
      categoryOrder[left.category] - categoryOrder[right.category] ||
      left.position - right.position ||
      left.name.localeCompare(right.name),
  );
}

/** A merged column can only move a deal inside its own product and pipeline. */
export function opportunityDropStage(
  column: OpportunityColumn,
  row: BoardRow,
  stages: readonly Stage[],
): Stage | undefined {
  const from = stages.find(
    (stage) =>
      stage.id === row.stageId &&
      stage.organizationId === row.organizationId &&
      stage.productId === row.productId &&
      stage.pipeline === "deal" &&
      !stage.archivedAt,
  );
  if (!from?.pipelineId) return undefined;
  const eligible = column.stages.filter(
    (stage) =>
      stage.organizationId === row.organizationId &&
      stage.productId === row.productId &&
      stage.pipelineId === from.pipelineId &&
      stage.pipeline === "deal" &&
      !stage.archivedAt,
  );
  if (eligible.length !== 1 || eligible[0]?.id === row.stageId)
    return undefined;
  return eligible[0];
}
