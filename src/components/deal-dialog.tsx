"use client";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { useWorkspaceData } from "./crm/crm-context";
import { RecordDialog, text } from "./records/record-dialog";
import { OpportunityDialog } from "./records/record-dialogs";

export function DealDialog({
  deal,
  onClose,
}: {
  deal?: ClientSnapshot["opportunities"][number];
  onClose: () => void;
}) {
  return <OpportunityDialog opportunity={deal} onClose={onClose} />;
}

export function PipelineDialog({ onClose }: { onClose: () => void }) {
  const crm = useWorkspaceData();
  return (
    <RecordDialog
      inline
      title={t.newPipeline}
      submitLabel={t.createPipeline}
      onClose={onClose}
      onSubmit={async (fields) => {
        const result = await crm.send({
          operation: "pipeline",
          organizationId: crm.organizationId,
          productId: fields.get("productId"),
          name: text(fields, "name"),
        });
        if (!result.ok) return result.error ?? t.errors.INVALID_INPUT;
        crm.notify(t.pipelineCreated, "success");
        return null;
      }}
    >
      <p className="muted">{t.pipelineHelp}</p>
      <label>
        {t.product}
        <select
          name="productId"
          required
          defaultValue={crm.productId || crm.data.products[0]?.id}
        >
          {crm.data.products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.name}
        <input name="name" data-primary-field required maxLength={100} />
      </label>
    </RecordDialog>
  );
}
