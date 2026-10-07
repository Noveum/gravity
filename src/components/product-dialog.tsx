"use client";
import t from "@crm/i18n/translations/en.json";
import { RecordDialog, text } from "./records/record-dialog";

export function ProductDialog({
  organizationId,
  organizationName,
  onSubmit,
  onClose,
}: {
  organizationId: string;
  organizationName: string;
  onSubmit: (body: object) => Promise<string | null>;
  onClose: () => void;
}) {
  return (
    <RecordDialog
      inline
      className="product-editor"
      title={t.newProduct}
      submitLabel={t.newProduct}
      onClose={onClose}
      onSubmit={(fields) =>
        onSubmit({
          operation: "product",
          organizationId,
          name: text(fields, "name"),
        })
      }
    >
      <span className="eyebrow">{organizationName}</span>
      <p className="muted">{t.productCreationDetail}</p>
      <label>
        {t.productName}
        <input
          name="name"
          required
          maxLength={100}
          placeholder={t.productNamePlaceholder}
          data-primary-field
        />
      </label>
    </RecordDialog>
  );
}
