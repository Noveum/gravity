import t from "@crm/i18n/translations/en.json";

export function minorDigits(currency: string) {
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

export function minorStep(currency: string) {
  const digits = /^[A-Za-z]{3}$/.test(currency) ? minorDigits(currency) : 2;
  return digits ? (10 ** -digits).toFixed(digits) : "1";
}

export function toMinor(value: string, currency: string) {
  if (!value.trim()) return null;
  const amount = Number(value);
  return Number.isFinite(amount)
    ? Math.round(amount * 10 ** minorDigits(currency))
    : Number.NaN;
}

export function fromMinor(amountMinor: number | null, currency: string) {
  return amountMinor === null
    ? ""
    : String(amountMinor / 10 ** minorDigits(currency));
}

export function formatMoney(
  amountMinor: number | null,
  currency: string,
  notation?: Intl.NumberFormatOptions["notation"],
) {
  if (amountMinor === null) return t.amountUnknown;
  const amount = amountMinor / 10 ** minorDigits(currency);
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      notation,
      minimumFractionDigits: notation === "compact" ? 0 : minorDigits(currency),
      maximumFractionDigits: minorDigits(currency),
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(minorDigits(currency))}`;
  }
}
