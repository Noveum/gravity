"use client";
import t from "@crm/i18n/translations/en.json";
import * as Slider from "@radix-ui/react-slider";
import { useId } from "react";
import { formatMoney, minorStep } from "../money";
import { FilterPopover } from "../ui/filter-popover";
import { Select } from "../ui/select";

export type ValueFilters = {
  minimum: string;
  maximum: string;
  currency: string;
  size: string;
};

export function ValueFilter({
  filters,
  amountMaximum,
  currencies,
  invalid,
  onChange,
}: {
  filters: ValueFilters;
  amountMaximum: number;
  currencies: readonly string[];
  invalid: boolean;
  onChange: (values: Partial<ValueFilters>) => void;
}) {
  const id = useId();
  const unit = Number(minorStep(filters.currency || "USD"));
  const digits = Math.max(0, Math.round(-Math.log10(unit)));
  const number = (value: string, fallback: number) => {
    const parsed = Number(value);
    return value.trim() && Number.isFinite(parsed) && parsed >= 0
      ? parsed
      : fallback;
  };
  const largest = Math.max(
    amountMaximum || 10000,
    invalid ? 0 : number(filters.minimum, 0),
    invalid ? 0 : number(filters.maximum, 0),
    unit,
  );
  const scale = 10 ** Math.floor(Math.log10(largest));
  // Match parseMoney's minor-unit ceiling so dragging never creates an invalid amount.
  const limit = Math.min(Math.ceil(largest / scale) * scale, 2147483647 * unit);
  const step = Math.max(unit, Number((limit / 100).toFixed(digits)));
  // The final discrete stop represents an unset upper bound, even when rounding
  // the supported ceiling leaves that stop a few minor units below the ceiling.
  const upperEndpoint = Math.min(
    limit,
    Number((Math.round(limit / step) * step).toFixed(digits)),
  );
  const active = !!(
    filters.minimum ||
    filters.maximum ||
    filters.currency ||
    filters.size
  );
  const amountLabel = (value: string) =>
    formatMoney(
      Math.round(number(value, 0) * 10 ** digits),
      filters.currency || "USD",
      "compact",
    );
  const summary = invalid
    ? t.uiRefresh.invalidRange
    : filters.minimum || filters.maximum
      ? `${filters.minimum ? amountLabel(filters.minimum) : "0"} – ${filters.maximum ? amountLabel(filters.maximum) : t.uiRefresh.noLimit}`
      : filters.size === "unknown"
        ? t.amountUnknown
        : filters.size === "known"
          ? t.knownDealSize
          : filters.currency || t.uiRefresh.dealValue;
  return (
    <FilterPopover
      label={t.uiRefresh.dealValue}
      summary={summary}
      active={active}
    >
      <div className="value-filter-selects">
        <label htmlFor={`${id}-size`}>
          <span>{t.dealSize}</span>
          <Select
            id={`${id}-size`}
            label={t.dealSize}
            value={filters.size}
            onChange={(size) => onChange({ size })}
            options={[
              { value: "", label: t.anyDealSize },
              { value: "known", label: t.knownDealSize },
              { value: "unknown", label: t.amountUnknown },
            ]}
          />
        </label>
        <label htmlFor={`${id}-currency-select`}>
          <span>{t.currency}</span>
          <Select
            id={`${id}-currency-select`}
            label={t.currency}
            value={filters.currency}
            onChange={(currency) => onChange({ currency })}
            options={[
              { value: "", label: t.allCurrencies },
              ...[...new Set(["USD", ...currencies])].map((value) => ({
                value,
                label: value,
              })),
            ]}
          />
        </label>
      </div>
      <Slider.Root
        className="value-range-slider"
        min={0}
        max={limit}
        step={step}
        disabled={invalid}
        value={
          invalid
            ? [0, limit]
            : [number(filters.minimum, 0), number(filters.maximum, limit)]
        }
        onValueChange={([minimum = 0, maximum = limit]) =>
          onChange({
            minimum: minimum <= 0 ? "" : minimum.toFixed(digits),
            maximum: maximum >= upperEndpoint ? "" : maximum.toFixed(digits),
          })
        }
      >
        <Slider.Track className="value-range-track">
          <Slider.Range className="value-range-fill" />
        </Slider.Track>
        <Slider.Thumb
          className="value-range-thumb"
          aria-label={t.uiRefresh.minimumSlider}
        />
        <Slider.Thumb
          className="value-range-thumb"
          aria-label={t.uiRefresh.maximumSlider}
          aria-valuetext={filters.maximum || t.uiRefresh.noLimit}
        />
      </Slider.Root>
      <div className="filter-amount-range" aria-describedby={`${id}-currency`}>
        <label className="filter-amount-field">
          <span>{t.minimumDealSize}</span>
          <input
            className="filter-amount-input"
            type="number"
            min="0"
            step={unit}
            placeholder="0"
            value={filters.minimum}
            onChange={(event) => onChange({ minimum: event.target.value })}
            aria-invalid={invalid}
          />
        </label>
        <span className="range-separator" aria-hidden>
          –
        </span>
        <label className="filter-amount-field">
          <span>{t.maximumDealSize}</span>
          <input
            className="filter-amount-input"
            type="number"
            min="0"
            step={unit}
            placeholder={String(amountMaximum || 10000)}
            value={filters.maximum}
            onChange={(event) => onChange({ maximum: event.target.value })}
            aria-invalid={invalid}
          />
        </label>
      </div>
      <small id={`${id}-currency`} className="filter-range-note">
        {t.dealFilterCurrency.replace("{currency}", filters.currency || "USD")}
      </small>
      <small className="value-range-help">{t.uiRefresh.rangeHelp}</small>
      <button
        type="button"
        className="ghost value-filter-reset"
        disabled={!active}
        onClick={() =>
          onChange({ minimum: "", maximum: "", currency: "", size: "" })
        }
      >
        {t.uiRefresh.resetValue}
      </button>
    </FilterPopover>
  );
}
