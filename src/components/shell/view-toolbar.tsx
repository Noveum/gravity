"use client";
import t from "@crm/i18n/translations/en.json";
import { Plus, Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import type { RefObject } from "react";
import { label } from "../client-api";
import { useCrm } from "../crm/crm-context";
import { type ActionFilters, actionFilters, actionsPath } from "../routes";
import { ShortcutHint } from "../ui/shortcut-hint";

const actionKinds = ["reply", "approval", "review", "commitment", "research"];

export function ViewToolbar({
  searchInput,
  onCreateProduct,
}: {
  searchInput: RefObject<HTMLInputElement | null>;
  onCreateProduct: () => boolean;
}) {
  const crm = useCrm();
  const router = useRouter();
  const filters = actionFilters(useSearchParams());
  const section = crm.route?.section ?? "actions";
  const products = (crm.data?.products ?? []).filter(
    (product) => product.organizationId === crm.organizationId,
  );
  const filter = (change: Partial<ActionFilters>) =>
    router.replace(actionsPath({ ...filters, ...change }), { scroll: false });
  return (
    <div className="toolbar">
      <div className="product-picker">
        <select
          aria-label={t.product}
          aria-keyshortcuts="P"
          title={`${t.product} (${t.keys.product})`}
          value={crm.productId}
          onChange={(event) => crm.switchProduct(event.target.value)}
        >
          <option value="">{t.allProducts}</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
        <ShortcutHint keys={t.keys.product} />
      </div>
      {crm.isAdmin && (
        <button
          type="button"
          className="ghost"
          aria-label={t.newProduct}
          aria-keyshortcuts="Shift+P"
          title={`${t.newProduct} (${t.keys.createProduct})`}
          onClick={onCreateProduct}
        >
          <Plus size={14} aria-hidden />
          <ShortcutHint keys={t.keys.createProduct} />
        </button>
      )}
      {section !== "materials" && section !== "overview" && (
        <label className="search">
          <Search size={14} aria-hidden />
          <input
            ref={searchInput}
            type="search"
            aria-label={t.search}
            placeholder={t.searchPlaceholder}
            value={crm.search}
            onChange={(event) => crm.setSearch(event.target.value)}
          />
          <ShortcutHint keys={t.keys.search} />
        </label>
      )}
      {section === "actions" && (
        <>
          <select
            aria-label={t.owner}
            value={filters.owner}
            onChange={(event) => filter({ owner: event.target.value })}
          >
            <option value="">{t.everyone}</option>
            <option value={crm.userId}>{t.mine}</option>
            {crm.data?.members
              .filter((member) => member.id !== crm.userId)
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
          </select>
          <select
            aria-label={t.actionType}
            value={filters.kind}
            onChange={(event) => filter({ kind: event.target.value })}
          >
            <option value="">{t.allTypes}</option>
            {actionKinds.map((kind) => (
              <option key={kind} value={kind}>
                {label(kind)}
              </option>
            ))}
          </select>
          {filters.waiting && (
            <button
              type="button"
              className="chip"
              aria-label={`${t.waiting}: ${t.clearFilters}`}
              onClick={() => filter({ waiting: false })}
            >
              {t.waiting} <X size={12} aria-hidden />
            </button>
          )}
          <button
            type="button"
            className="primary toolbar-primary"
            aria-label={t.scheduleAction}
            aria-keyshortcuts="N"
            disabled={!crm.data?.relationships.length}
            onClick={() => crm.setActionDialog(true)}
          >
            <Plus size={14} aria-hidden />
            {t.newAction}
            <ShortcutHint keys={t.keys.schedule} />
          </button>
        </>
      )}
      {section === "people" && (
        <button
          type="button"
          className="primary toolbar-primary"
          aria-label={t.addPerson}
          aria-keyshortcuts="C"
          disabled={!crm.data?.products.length}
          onClick={() => crm.setPersonDialog(true)}
        >
          <Plus size={14} aria-hidden />
          {t.addPerson}
          <ShortcutHint keys={t.keys.create} />
        </button>
      )}
    </div>
  );
}
