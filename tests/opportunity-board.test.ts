import { describe, expect, test } from "vitest";
import {
  opportunityColumns,
  opportunityDropStage,
} from "../src/components/records/opportunity-board";

function stage(
  id: string,
  productId: string,
  pipelineId: string,
  name: string,
  category: "open" | "won" | "lost" = "open",
  position = 0,
) {
  return {
    id,
    organizationId: "fictional-org",
    productId,
    pipelineId,
    name,
    category,
    position,
    pipeline: "deal" as const,
    archivedAt: null,
  };
}

const pipelines = [
  { id: "alpha-sales", organizationId: "fictional-org", productId: "alpha" },
  { id: "alpha-partners", organizationId: "fictional-org", productId: "alpha" },
  { id: "beta-sales", organizationId: "fictional-org", productId: "beta" },
];
const stages = [
  stage("alpha-discovery", "alpha", "alpha-sales", "Discovery"),
  stage("alpha-proposal", "alpha", "alpha-sales", "Proposal", "open", 1),
  stage("alpha-won", "alpha", "alpha-sales", "Won", "won", 2),
  stage("partner-proposal", "alpha", "alpha-partners", "Proposal", "open", 1),
  stage("beta-discovery", "beta", "beta-sales", " discovery "),
  stage("beta-proposal", "beta", "beta-sales", "Proposal", "open", 1),
  stage("beta-won", "beta", "beta-sales", "Won", "won", 2),
];
const rows = [
  {
    id: "deal-alpha",
    organizationId: "fictional-org",
    productId: "alpha",
    stageId: "alpha-discovery",
  },
  {
    id: "deal-beta",
    organizationId: "fictional-org",
    productId: "beta",
    stageId: "beta-discovery",
  },
] as const;
const scope = { organizationId: "fictional-org" };

function required<T>(item: T | undefined): T {
  if (!item) throw new Error("Missing board test fixture");
  return item;
}

describe("combined opportunity board", () => {
  test("combines equivalent stages across products and pipelines into one ordered board", () => {
    const columns = opportunityColumns(stages, pipelines, rows, scope);
    expect(columns.map((column) => column.name)).toEqual([
      "Discovery",
      "Proposal",
      "Won",
    ]);
    expect(columns[0]?.rows.map((row) => row.id)).toEqual([
      "deal-alpha",
      "deal-beta",
    ]);
    expect(columns[1]?.stages.map((item) => item.id)).toEqual([
      "alpha-proposal",
      "partner-proposal",
      "beta-proposal",
    ]);
    expect(columns[0]?.rows[1]?.stageId).toBe("beta-discovery");
  });

  test("keeps equal names with different business categories separate", () => {
    const columns = opportunityColumns(
      [
        ...stages,
        stage("alpha-open-won", "alpha", "alpha-sales", "Won", "open", 3),
      ],
      pipelines,
      [],
      scope,
    );
    expect(
      columns
        .filter((column) => column.name === "Won")
        .map((column) => column.category),
    ).toEqual(["open", "won"]);
  });

  test("respects selected product, pipeline and stage while keeping empty columns available", () => {
    const columns = opportunityColumns(stages, pipelines, rows, {
      ...scope,
      productId: "alpha",
      pipelineId: "alpha-sales",
    });
    expect(
      columns.flatMap((column) => column.stages.map((item) => item.productId)),
    ).toEqual(["alpha", "alpha", "alpha"]);
    expect(
      columns.flatMap((column) => column.rows.map((row) => row.id)),
    ).toEqual(["deal-alpha"]);
    expect(columns[1]?.rows).toEqual([]);
    expect(
      opportunityColumns(stages, pipelines, rows, {
        ...scope,
        stageId: "beta-discovery",
      }).map((column) => column.rows[0]?.id),
    ).toEqual(["deal-beta"]);
  });

  test("rejects foreign organizations, mismatched product references, archived and outreach stages", () => {
    const foreign = stage("foreign-stage", "alpha", "alpha-sales", "Foreign");
    const invalid = [
      { ...foreign, organizationId: "foreign-org" },
      { ...foreign, id: "archived", archivedAt: "2026-01-01" },
      { ...foreign, id: "outreach", pipeline: "outreach" as const },
      { ...foreign, id: "mismatch", productId: "beta" },
    ];
    const badRows = [
      { ...rows[0], id: "foreign-deal", organizationId: "foreign-org" },
      { ...rows[0], id: "wrong-product", productId: "beta" },
    ];
    const columns = opportunityColumns(
      [...stages, ...invalid],
      pipelines,
      [...rows, ...badRows],
      scope,
    );
    expect(columns.map((column) => column.name)).toEqual([
      "Discovery",
      "Proposal",
      "Won",
    ]);
    expect(
      columns.flatMap((column) => column.rows.map((row) => row.id)),
    ).toEqual(["deal-alpha", "deal-beta"]);
  });

  test("a drop resolves to the deal's own product and pipeline only", () => {
    const proposal = required(
      opportunityColumns(stages, pipelines, rows, scope).find(
        (column) => column.name === "Proposal",
      ),
    );
    expect(opportunityDropStage(proposal, rows[0], stages)?.id).toBe(
      "alpha-proposal",
    );
    expect(opportunityDropStage(proposal, rows[1], stages)?.id).toBe(
      "beta-proposal",
    );
    const betaOnly = {
      ...proposal,
      stages: proposal.stages.filter((item) => item.productId === "beta"),
    };
    expect(opportunityDropStage(betaOnly, rows[0], stages)).toBeUndefined();
    const anotherPipeline = {
      ...proposal,
      stages: proposal.stages.filter((item) => item.id === "partner-proposal"),
    };
    expect(
      opportunityDropStage(anotherPipeline, rows[0], stages),
    ).toBeUndefined();
    expect(
      opportunityDropStage(
        proposal,
        { ...rows[0], organizationId: "foreign-org" },
        stages,
      ),
    ).toBeUndefined();
  });

  test("ambiguous and no-op drops never choose a stage arbitrarily", () => {
    const columns = opportunityColumns(stages, pipelines, rows, scope);
    const proposal = required(
      columns.find((column) => column.name === "Proposal"),
    );
    const duplicate = {
      ...required(proposal.stages[0]),
      id: "duplicate-proposal",
    };
    expect(
      opportunityDropStage(
        { ...proposal, stages: [...proposal.stages, duplicate] },
        rows[0],
        stages,
      ),
    ).toBeUndefined();
    expect(
      opportunityDropStage(required(columns[0]), rows[0], stages),
    ).toBeUndefined();
  });
});
