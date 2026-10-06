"use client";
import { productColorKeys, productColorToken } from "@crm/core/product-colors";
import t from "@crm/i18n/translations/en.json";
import { Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useWorkspaceData } from "../crm/crm-context";
import {
  AdminNotice,
  ConfirmButton,
  SettingsGroup,
  SettingsPanel,
} from "./settings-ui";

interface Product {
  id: string;
  name: string;
  colorKey: string;
}

function ProductDot({ colorKey }: { colorKey: string }) {
  return (
    <span
      className="product-dot"
      aria-hidden
      style={{ background: productColorToken(colorKey) }}
    />
  );
}

function ProductRow({
  product,
  onChange,
  onArchive,
}: {
  product: Product;
  onChange: (change: { name?: string; colorKey?: string }) => Promise<boolean>;
  onArchive: () => Promise<unknown>;
}) {
  const [name, setName] = useState(product.name);
  const dirty = name.trim() !== product.name && !!name.trim();
  return (
    <li className="settings-row" aria-label={product.name}>
      <form
        className="settings-row-main"
        onSubmit={async (event) => {
          event.preventDefault();
          if (dirty) await onChange({ name: name.trim() });
        }}
      >
        <ProductDot colorKey={product.colorKey} />
        <input
          aria-label={t.productNameFor.replace("{name}", product.name)}
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
          aria-label={t.productColorFor.replace("{name}", product.name)}
          value={product.colorKey}
          onChange={(event) => void onChange({ colorKey: event.target.value })}
        >
          {productColorKeys.map((key) => (
            <option key={key} value={key}>
              {t.productColors[key]}
            </option>
          ))}
        </select>
        <ConfirmButton
          label={t.archive}
          confirmLabel={t.archiveProductConfirm}
          onConfirm={onArchive}
        >
          <span className="settings-row-meta">{t.archiveProductDetail}</span>
        </ConfirmButton>
      </div>
    </li>
  );
}

export function ProductSettings() {
  const crm = useWorkspaceData();
  const organizationId = crm.organizationId;
  const active = crm.sourceData.products;
  const archived = crm.sourceData.archivedProducts ?? [];
  const [creating, setCreating] = useState(false);
  const run = async (body: object, announce: string) =>
    (await crm.send({ organizationId, ...body }, announce)).ok;
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      if (await run({ operation: "product", name }, t.productCreated))
        form.reset();
    } finally {
      setCreating(false);
    }
  }
  if (!crm.isAdmin)
    return (
      <SettingsPanel section="brands">
        <ul className="settings-list">
          {active.map((product) => (
            <li
              key={product.id}
              className="settings-row"
              aria-label={product.name}
            >
              <span className="settings-row-main">
                <ProductDot colorKey={product.colorKey} />
                <span>{product.name}</span>
              </span>
            </li>
          ))}
        </ul>
        <AdminNotice />
      </SettingsPanel>
    );
  return (
    <SettingsPanel section="brands">
      <SettingsGroup title={t.activeProducts}>
        <ul className="settings-list">
          {active.map((product) => (
            <ProductRow
              key={`${product.id}:${product.name}`}
              product={product}
              onChange={(change) =>
                run(
                  {
                    operation: "product-update",
                    productId: product.id,
                    ...change,
                  },
                  t.updated,
                )
              }
              onArchive={() =>
                run(
                  { operation: "product-archive", productId: product.id },
                  t.productArchived,
                )
              }
            />
          ))}
        </ul>
        <form className="settings-inline-form" onSubmit={create}>
          <input
            name="name"
            aria-label={t.productName}
            placeholder={t.productName}
            maxLength={100}
            required
            disabled={creating}
          />
          <button type="submit" className="primary" disabled={creating}>
            <Plus size={14} aria-hidden />
            {t.newProduct}
          </button>
        </form>
      </SettingsGroup>
      {!!archived.length && (
        <SettingsGroup
          title={t.archivedProducts}
          detail={t.archivedProductsDetail}
        >
          <ul className="settings-list">
            {archived.map((product) => (
              <li
                key={product.id}
                className="settings-row"
                aria-label={product.name}
              >
                <span className="settings-row-main">
                  <ProductDot colorKey={product.colorKey} />
                  <span>{product.name}</span>
                </span>
                <div className="settings-row-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() =>
                      void run(
                        { operation: "product-restore", productId: product.id },
                        t.productRestored,
                      )
                    }
                  >
                    {t.restore}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </SettingsGroup>
      )}
    </SettingsPanel>
  );
}
