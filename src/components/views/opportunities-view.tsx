"use client";
import { money, totals } from "@crm/core/analytics";
import t from "@crm/i18n/translations/en.json";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useWorkspaceData } from "../crm/crm-context";
import { useRevealedRecord } from "../crm/use-revealed-record";
import { DealDialog, PipelineDialog } from "../deal-dialog";

export function OpportunitiesView() {
  const crm = useWorkspaceData();
  const { data, search, productId, personFor } = crm;
  const query = useSearchParams();
  const router = useRouter();
  const dealId = query.get("deal");
  const [pipelineDialog, setPipelineDialog] = useState(false);
  const chosen =
    dealId && dealId !== "new"
      ? data.opportunities.find((d) => d.id === dealId)
      : undefined;
  const closeDeal = () => {
    const next = new URLSearchParams(query.toString());
    next.delete("deal");
    router.replace(`/opportunities${next.size ? `?${next}` : ""}`);
  };
  const focusedRecord = useRevealedRecord();
  const matches = (...values: (string | undefined)[]) =>
    values.join(" ").toLowerCase().includes(search.toLowerCase());
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
      <div className="page-content deal-board">
        {data.pipelines
          .filter(
            (p) =>
              (!productId || p.productId === productId) &&
              (!query.get("pipeline") || p.id === query.get("pipeline")),
          )
          .map((pipeline) => (
            <div key={pipeline.id} className="product-pipeline">
              <h2>
                <span
                  className="product-dot"
                  style={{ background: crm.product(pipeline.productId)?.color }}
                />
                {crm.product(pipeline.productId)?.name}
                <span className="muted">/ {pipeline.name}</span>
              </h2>
              <div className="pipeline-stages">
                {data.stages
                  .filter(
                    (stage) =>
                      stage.pipelineId === pipeline.id &&
                      (!query.get("stage") || stage.id === query.get("stage")),
                  )
                  .map((stage) => {
                    const rows = data.opportunities.filter(
                      (o) =>
                        o.stageId === stage.id &&
                        (!query.get("owner") ||
                          (o.ownerId ??
                            data.relationships.find(
                              (r) => r.id === o.relationshipId,
                            )?.ownerId) === query.get("owner")) &&
                        matches(o.name, personFor(o.relationshipId)?.name),
                    );
                    return (
                      <section key={stage.id}>
                        <div className="group-title">
                          {stage.name}
                          <span>{rows.length}</span>
                        </div>
                        <small className="stage-value">
                          {totals(rows)
                            .map((r) => money(r.amountMinor, r.currency))
                            .join(" · ") || "—"}
                        </small>
                        {rows.map((opportunity) => (
                          <article
                            className={`deal-card ${focusedRecord === opportunity.id ? "record-highlight" : ""}`}
                            key={opportunity.id}
                            data-record-id={opportunity.id}
                            tabIndex={-1}
                          >
                            <Link
                              data-nav-record={opportunity.id}
                              className="text-button deal-title"
                              href={`/opportunities?${new URLSearchParams({ ...Object.fromEntries(query), deal: opportunity.id })}`}
                            >
                              {opportunity.name}
                            </Link>
                            <p>
                              <button
                                type="button"
                                className="text-button"
                                onClick={() =>
                                  crm.openPerson(opportunity.relationshipId)
                                }
                              >
                                {personFor(opportunity.relationshipId)?.name}
                              </button>
                            </p>
                            <strong>
                              {opportunity.amountMinor === null
                                ? t.amountUnknown
                                : money(
                                    opportunity.amountMinor,
                                    opportunity.currency,
                                  )}
                            </strong>
                            <small>
                              {crm.member(
                                opportunity.ownerId ??
                                  data.relationships.find(
                                    (r) => r.id === opportunity.relationshipId,
                                  )?.ownerId ??
                                  "",
                              )}
                            </small>
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
          ))}
        {!data.opportunities.length && (
          <div className="empty-state">
            <h2>{t.noDealsYet}</h2>
            <p>{t.noDealsDescription}</p>
          </div>
        )}
      </div>
      {(dealId === "new" || chosen) && (
        <DealDialog
          key={`${crm.organizationId}:${dealId}`}
          deal={chosen}
          onClose={closeDeal}
        />
      )}
      {pipelineDialog && (
        <PipelineDialog onClose={() => setPipelineDialog(false)} />
      )}
    </>
  );
}
