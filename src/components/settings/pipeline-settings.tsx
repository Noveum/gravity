"use client";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { useWorkspaceData } from "../crm/crm-context";
import {
  AdminNotice,
  ConfirmButton,
  SettingsGroup,
  SettingsPanel,
} from "./settings-ui";

type Stage = ClientSnapshot["stages"][number];
type Kind = "deal" | "outreach";
type Category = Stage["category"];
type Run = (body: object, announce?: string) => Promise<boolean>;

const categoriesFor = (kind: Kind): Category[] =>
  kind === "deal" ? ["open", "won", "lost"] : ["open", "won", "lost", "hold"];

function StageRow({
  stage,
  stages,
  kind,
  editable,
  run,
  onMove,
}: {
  stage: Stage;
  stages: Stage[];
  kind: Kind;
  editable: boolean;
  run: Run;
  onMove: (offset: number) => void;
}) {
  const [name, setName] = useState(stage.name);
  const others = stages.filter((item) => item.id !== stage.id);
  const [target, setTarget] = useState(
    others.find((item) => item.category === "open")?.id ?? others[0]?.id ?? "",
  );
  const index = stages.indexOf(stage);
  const dirty = name.trim() !== stage.name && !!name.trim();
  if (!editable)
    return (
      <li className="settings-row" aria-label={stage.name}>
        <span className="settings-row-main">
          <span>{stage.name}</span>
        </span>
        <span className="badge">{t.stageCategory[stage.category]}</span>
      </li>
    );
  return (
    <li className="settings-row" aria-label={stage.name}>
      <form
        className="settings-row-main"
        onSubmit={async (event) => {
          event.preventDefault();
          if (dirty)
            await run({
              operation: "stage-update",
              stageId: stage.id,
              name: name.trim(),
            });
        }}
      >
        <input
          aria-label={t.stageNameFor.replace("{name}", stage.name)}
          value={name}
          maxLength={100}
          required
          onChange={(event) => setName(event.target.value)}
        />
        {dirty && (
          <button type="submit" className="accent-soft">
            {t.save}
          </button>
        )}
      </form>
      <div className="settings-row-actions">
        <select
          aria-label={t.stageCategoryFor.replace("{name}", stage.name)}
          value={stage.category}
          onChange={(event) =>
            void run({
              operation: "stage-update",
              stageId: stage.id,
              category: event.target.value,
            })
          }
        >
          {categoriesFor(kind).map((category) => (
            <option key={category} value={category}>
              {t.stageCategory[category]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="icon-button"
          aria-label={t.moveStageUp.replace("{name}", stage.name)}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp size={14} aria-hidden />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t.moveStageDown.replace("{name}", stage.name)}
          disabled={index === stages.length - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown size={14} aria-hidden />
        </button>
        <ConfirmButton
          label={t.archive}
          confirmLabel={t.archiveStageConfirm}
          disabled={!others.length}
          onConfirm={() =>
            run(
              {
                operation: "stage-archive",
                stageId: stage.id,
                moveToStageId: target,
              },
              t.stageArchived,
            )
          }
        >
          <select
            aria-label={t.archiveStageInto.replace("{name}", stage.name)}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            {others.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </ConfirmButton>
      </div>
    </li>
  );
}

function StageGroup({
  title,
  productId,
  kind,
  pipelineId,
  stages,
  editable,
  run,
  actions,
}: {
  title: string;
  productId: string;
  kind: Kind;
  pipelineId?: string;
  stages: Stage[];
  editable: boolean;
  run: Run;
  actions?: ReactNode;
}) {
  const pipeline = pipelineId ? { pipelineId } : {};
  function move(stage: Stage, offset: number) {
    const ids = stages.map((item) => item.id);
    const from = ids.indexOf(stage.id);
    const to = from + offset;
    const swapped = ids[to];
    if (swapped === undefined) return;
    ids[to] = stage.id;
    ids[from] = swapped;
    void run({
      operation: "stage-order",
      productId,
      pipeline: kind,
      ...pipeline,
      stageIds: ids,
    });
  }
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const name = String(values.get("name") ?? "").trim();
    if (!name) return;
    if (
      await run({
        operation: "stage",
        productId,
        pipeline: kind,
        ...pipeline,
        name,
        category: values.get("category"),
      })
    )
      form.reset();
  }
  return (
    <SettingsGroup title={title} actions={actions}>
      <ul className="settings-list">
        {stages.map((stage) => (
          <StageRow
            key={`${stage.id}:${stage.name}`}
            stage={stage}
            stages={stages}
            kind={kind}
            editable={editable}
            run={run}
            onMove={(offset) => move(stage, offset)}
          />
        ))}
      </ul>
      {editable && (
        <form className="settings-inline-form" onSubmit={add}>
          <input
            name="name"
            aria-label={t.newStageIn.replace("{name}", title)}
            placeholder={t.stageName}
            maxLength={100}
            required
          />
          <select name="category" aria-label={t.stageCategoryLabel}>
            {categoriesFor(kind).map((category) => (
              <option key={category} value={category}>
                {t.stageCategory[category]}
              </option>
            ))}
          </select>
          <button type="submit">
            <Plus size={14} aria-hidden />
            {t.addStage}
          </button>
        </form>
      )}
    </SettingsGroup>
  );
}

function PipelineName({
  pipeline,
  run,
}: {
  pipeline: { id: string; name: string };
  run: Run;
}) {
  const [name, setName] = useState(pipeline.name);
  return (
    <form
      className="settings-inline-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (name.trim() && name.trim() !== pipeline.name)
          await run({
            operation: "pipeline-update",
            pipelineId: pipeline.id,
            name: name.trim(),
          });
      }}
    >
      <input
        aria-label={t.pipelineNameFor.replace("{name}", pipeline.name)}
        value={name}
        maxLength={100}
        required
        onChange={(event) => setName(event.target.value)}
      />
      <button type="submit" className="ghost">
        {t.renamePipeline}
      </button>
    </form>
  );
}

export function PipelineSettings() {
  const crm = useWorkspaceData();
  const products = crm.sourceData.products;
  const [chosen, setChosen] = useState(crm.productId);
  const productId = products.some((product) => product.id === chosen)
    ? chosen
    : (products[0]?.id ?? "");
  const editable = crm.isAdmin;
  const run: Run = async (body, announce = t.updated) =>
    (
      await crm.send(
        { organizationId: crm.organizationId, productId, ...body },
        announce,
      )
    ).ok;
  const active = (rows: Stage[]) =>
    rows
      .filter((stage) => stage.productId === productId && !stage.archivedAt)
      .sort((a, b) => a.position - b.position);
  const pipelines = crm.sourceData.pipelines.filter(
    (pipeline) => pipeline.productId === productId,
  );
  async function createPipeline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    if (name && (await run({ operation: "pipeline", name }, t.pipelineCreated)))
      form.reset();
  }
  return (
    <SettingsPanel
      section="pipelines"
      actions={
        products.length > 1 && (
          <select
            aria-label={t.product}
            value={productId}
            onChange={(event) => setChosen(event.target.value)}
          >
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        )
      }
    >
      {!editable && <AdminNotice />}
      <StageGroup
        key={`outreach:${productId}`}
        title={t.outreachPipelineTitle}
        productId={productId}
        kind="outreach"
        stages={active(crm.sourceData.outreachStages)}
        editable={editable}
        run={run}
      />
      {pipelines.map((pipeline) => (
        <StageGroup
          key={pipeline.id}
          title={pipeline.name}
          productId={productId}
          kind="deal"
          pipelineId={pipeline.id}
          stages={active(
            crm.sourceData.stages.filter(
              (stage) => stage.pipelineId === pipeline.id,
            ),
          )}
          editable={editable}
          run={run}
          actions={
            editable && (
              <PipelineName
                key={`${pipeline.id}:${pipeline.name}`}
                pipeline={pipeline}
                run={run}
              />
            )
          }
        />
      ))}
      {editable && (
        <form className="settings-inline-form" onSubmit={createPipeline}>
          <input
            name="name"
            aria-label={t.pipelineName}
            placeholder={t.pipelineName}
            maxLength={100}
            required
          />
          <button type="submit" className="primary">
            <Plus size={14} aria-hidden />
            {t.createPipeline}
          </button>
        </form>
      )}
    </SettingsPanel>
  );
}
