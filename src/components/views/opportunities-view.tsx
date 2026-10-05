"use client";
import t from "@crm/i18n/translations/en.json";
import { useWorkspaceData } from "../crm/crm-context";
import { useRevealedRecord } from "../crm/use-revealed-record";

export function OpportunitiesView() {
  const crm = useWorkspaceData();
  const { data, search, productId, personFor } = crm;
  const focusedRecord = useRevealedRecord();
  const matches = (...values: (string | undefined)[]) =>
    values.join(" ").toLowerCase().includes(search.toLowerCase());
  return (
    <div className="page-content deal-board">
      {data.products
        .filter((product) => !productId || product.id === productId)
        .map((product) => (
          <div key={product.id} className="product-pipeline">
            <h2>
              <span
                className="product-dot"
                style={{ background: product.color }}
              />
              {product.name}
            </h2>
            <div className="pipeline-stages">
              {data.stages
                .filter((stage) => stage.productId === product.id)
                .map((stage) => (
                  <section key={stage.id}>
                    <div className="group-title">
                      {stage.name}
                      <span>
                        {
                          data.opportunities.filter(
                            (opportunity) => opportunity.stageId === stage.id,
                          ).length
                        }
                      </span>
                    </div>
                    {data.opportunities
                      .filter(
                        (opportunity) =>
                          opportunity.stageId === stage.id &&
                          matches(
                            opportunity.name,
                            personFor(opportunity.relationshipId)?.name,
                          ),
                      )
                      .map((opportunity) => (
                        <article
                          className={`deal-card ${focusedRecord === opportunity.id ? "record-highlight" : ""}`}
                          key={opportunity.id}
                          data-record-id={opportunity.id}
                          tabIndex={-1}
                        >
                          <button
                            data-nav-record={opportunity.id}
                            type="button"
                            className="text-button"
                            onClick={() =>
                              crm.openPerson(opportunity.relationshipId)
                            }
                          >
                            {opportunity.name}
                          </button>
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
                          <small>
                            {opportunity.amountMinor !== null
                              ? new Intl.NumberFormat("en", {
                                  style: "currency",
                                  currency: opportunity.currency,
                                  maximumFractionDigits: 0,
                                }).format(opportunity.amountMinor / 100)
                              : t.amountUnknown}
                          </small>
                        </article>
                      ))}
                  </section>
                ))}
            </div>
          </div>
        ))}
    </div>
  );
}
