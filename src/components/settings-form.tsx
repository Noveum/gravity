"use client";
import t from "@crm/i18n/translations/en.json";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { submitOnModEnter } from "./modal-lifecycle";
import { ShortcutHint } from "./ui/shortcut-hint";

export function SettingsForm({
  organizationId,
  canCreateProduct = false,
  mutate,
  onOrganizations,
}: {
  organizationId: string;
  canCreateProduct?: boolean;
  mutate: (body: object) => Promise<boolean>;
  onOrganizations: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  return (
    <div className="settings-forms">
      {[
        "organization",
        ...(organizationId && canCreateProduct ? ["product"] : []),
      ].map((kind) => (
        <form
          key={kind}
          onKeyDown={submitOnModEnter}
          onSubmit={async (event) => {
            event.preventDefault();
            if (submitting.current) return;
            const form = event.currentTarget;
            const values = new FormData(form);
            submitting.current = true;
            setBusy(true);
            try {
              if (
                await mutate({
                  operation: kind,
                  organizationId,
                  name: values.get("name"),
                })
              ) {
                form.reset();
                await onOrganizations();
              }
            } finally {
              submitting.current = false;
              setBusy(false);
            }
          }}
        >
          <label>
            {kind === "organization" ? t.organizationName : t.productName}
            <input name="name" required maxLength={100} disabled={busy} />
          </label>
          <button
            className="primary"
            type="submit"
            title={t.submitHint}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            disabled={busy}
          >
            <Plus size={14} />
            {busy
              ? t.saving
              : kind === "organization"
                ? t.newOrganization
                : t.newProduct}
            <ShortcutHint keys={t.keys.submit} />
          </button>
        </form>
      ))}
    </div>
  );
}
