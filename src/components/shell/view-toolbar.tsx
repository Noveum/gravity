"use client";
import { shortcutLabel } from "@crm/core/shortcuts";
import t from "@crm/i18n/translations/en.json";
import { Plus, Search, Send, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import type { RefObject } from "react";
import { label } from "../client-api";
import { useCrm } from "../crm/crm-context";
import { type ActionFilters, actionFilters } from "../routes";
import { Select } from "../ui/select";
import { ShortcutHint } from "../ui/shortcut-hint";
import { currentViewQuery, replaceViewQuery } from "../view-query";

const actionKinds = ["reply", "approval", "review", "commitment", "research"];

export function ViewToolbar({
  searchInput,
  onEnroll,
  onCreateProduct,
}: {
  searchInput: RefObject<HTMLInputElement | null>;
  onEnroll: () => void;
  onCreateProduct: () => boolean;
}) {
  const crm = useCrm();
  const query = useSearchParams();
  const filters = actionFilters(query);
  const section = crm.route?.section ?? "actions";
  const products = (crm.data?.products ?? []).filter(
    (product) => product.organizationId === crm.organizationId,
  );
  const selectedLabel = t.selectedCount.replace(
    "{count}",
    String(crm.selection.selected.length),
  );
  const filter = (change: Partial<ActionFilters>) => {
    const next = currentViewQuery();
    for (const [key, value] of Object.entries(change)) {
      if (value) next.set(key, String(value));
      else next.delete(key);
    }
    replaceViewQuery(next);
  };
  return (
    <div className="toolbar">
      <div className="product-picker">
        <Select
          label={t.product}
          aria-keyshortcuts="P"
          title={`${t.product} (${shortcutLabel("product")})`}
          value={crm.productId}
          onChange={crm.switchProduct}
          options={[
            { value: "", label: t.allProducts },
            ...products.map((product) => ({
              value: product.id,
              label: product.name,
            })),
          ]}
        />
        {crm.productId && (
          <button
            type="button"
            className="ghost product-reset"
            aria-label={t.uiRefresh.clearProduct}
            title={t.allProducts}
            onClick={() => crm.switchProduct("")}
          >
            <X size={14} aria-hidden />
          </button>
        )}
        <ShortcutHint id="product" />
      </div>
      {crm.isAdmin && (
        <button
          type="button"
          className="ghost"
          aria-label={t.newProduct}
          aria-keyshortcuts="Shift+P"
          title={`${t.newProduct} (${shortcutLabel("create-product")})`}
          onClick={onCreateProduct}
        >
          <Plus size={14} aria-hidden />
          <ShortcutHint id="create-product" />
        </button>
      )}
      {section !== "materials" && section !== "overview" && (
        <label className="search">
          <Search size={14} aria-hidden />
          <input
            className="toolbar-search-input"
            ref={searchInput}
            type="search"
            aria-label={t.search}
            placeholder={
              section === "opportunities"
                ? t.uiRefresh.searchDeals
                : t.searchPlaceholder
            }
            value={crm.search}
            onChange={(event) => crm.setSearch(event.target.value)}
          />
          <ShortcutHint id="search" />
        </label>
      )}
      <span className="selection-status" aria-live="polite">
        {crm.selection.selected.length > 0 && (
          <button
            type="button"
            className="chip"
            aria-label={`${selectedLabel}: ${t.clearSelection}`}
            onClick={crm.clearSelection}
          >
            {selectedLabel} <X size={12} aria-hidden />
          </button>
        )}
        {section === "people" && crm.selection.selected.length > 0 && (
          <button type="button" className="chip" onClick={onEnroll}>
            <Send size={12} aria-hidden />
            {t.enrollSelected}
          </button>
        )}
      </span>
      {section === "actions" && (
        <>
          <Select
            label={t.owner}
            value={filters.owner}
            onChange={(value) => filter({ owner: value })}
            options={[
              { value: "", label: t.everyone },
              { value: crm.userId, label: t.mine },
              ...(crm.data?.members ?? [])
                .filter((member) => member.id !== crm.userId)
                .map((member) => ({ value: member.id, label: member.name })),
            ]}
          />
          <Select
            label={t.actionType}
            value={filters.kind}
            onChange={(value) => filter({ kind: value })}
            options={[
              { value: "", label: t.allTypes },
              ...actionKinds.map((kind) => ({
                value: kind,
                label: label(kind),
              })),
            ]}
          />
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
            <ShortcutHint id="schedule" />
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
          <ShortcutHint id="create" />
        </button>
      )}
      {section === "companies" && (
        <button
          type="button"
          className="primary toolbar-primary"
          aria-label={t.newCompany}
          aria-keyshortcuts="C"
          disabled={!crm.data?.products.length}
          onClick={() => crm.openRecordDialog({ kind: "company" })}
        >
          <Plus size={14} aria-hidden />
          {t.newCompany}
          <ShortcutHint id="create" />
        </button>
      )}
      {section === "meetings" && (
        <button
          type="button"
          className="primary toolbar-primary"
          aria-label={t.newMeeting}
          aria-keyshortcuts="C"
          disabled={!crm.data?.relationships.length}
          onClick={() => crm.openRecordDialog({ kind: "meeting" })}
        >
          <Plus size={14} aria-hidden />
          {t.newMeeting}
          <ShortcutHint id="create" />
        </button>
      )}
    </div>
  );
}
