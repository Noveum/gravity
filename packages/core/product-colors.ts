export const productColorKeys = [
  "violet",
  "blue",
  "teal",
  "green",
  "yellow",
  "orange",
  "red",
  "pink",
  "gray",
] as const;
export type ProductColorKey = (typeof productColorKeys)[number];
export const defaultProductColorKey: ProductColorKey = "violet";
export const productColorReferences: Record<ProductColorKey, string> = {
  violet: "#7565cf",
  blue: "#4a7fd6",
  teal: "#418ca0",
  green: "#4f9a5e",
  yellow: "#b8962e",
  orange: "#d0803f",
  red: "#cf5a5a",
  pink: "#cf6f93",
  gray: "#7d8290",
};

function channels(hex: string) {
  const value = hex.trim().toLowerCase();
  const full = /^#[0-9a-f]{3}$/.test(value)
    ? `#${[...value.slice(1)].map((digit) => digit + digit).join("")}`
    : value;
  if (!/^#[0-9a-f]{6}$/.test(full)) return undefined;
  return [1, 3, 5].map((start) =>
    Number.parseInt(full.slice(start, start + 2), 16),
  );
}
export function nearestProductColorKey(hex: string): ProductColorKey {
  const target = channels(hex);
  if (!target) return defaultProductColorKey;
  let nearest: ProductColorKey = defaultProductColorKey;
  let best = Number.POSITIVE_INFINITY;
  for (const key of productColorKeys) {
    const reference = channels(productColorReferences[key]) ?? [];
    const distance = target.reduce(
      (sum, channel, index) => sum + (channel - (reference[index] ?? 0)) ** 2,
      0,
    );
    if (distance < best) {
      best = distance;
      nearest = key;
    }
  }
  return nearest;
}
export function isProductColorKey(value: string): value is ProductColorKey {
  return (productColorKeys as readonly string[]).includes(value);
}
export function productColorToken(key: string) {
  return `var(--gravity-product-${isProductColorKey(key) ? key : defaultProductColorKey})`;
}
