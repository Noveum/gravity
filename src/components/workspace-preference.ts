export const workspaceCookie = "gravity-workspace";
export const brandCookie = "gravity-brand";
const yearInSeconds = 31536000;

export function chooseWorkspace<T extends { id: string; slug: string }>(
  organizations: T[],
  slug: string | undefined,
  fallbackId = "",
): T | undefined {
  return (
    organizations.find((organization) => slug && organization.slug === slug) ??
    organizations.find((organization) => organization.id === fallbackId) ??
    organizations[0]
  );
}

export function chooseBrand(
  products: { id: string }[],
  productId: string | undefined,
) {
  return products.some((product) => product.id === productId)
    ? (productId ?? "")
    : "";
}

export function preferenceCookie(name: string, value: string, secure = false) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    ...(value
      ? name === brandCookie
        ? []
        : [`Max-Age=${yearInSeconds}`]
      : ["Max-Age=0"]),
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function remember(name: string, value: string) {
  if (typeof document === "undefined") return;
  // biome-ignore lint/suspicious/noDocumentCookie: Firefox has no Cookie Store API, and the server layout reads this preference on the next request.
  document.cookie = preferenceCookie(
    name,
    value,
    window.location.protocol === "https:",
  );
}

export function rememberWorkspace(slug: string) {
  remember(workspaceCookie, slug);
  remember(brandCookie, "");
}

export function reopenWorkspace(
  organizationId: string,
  next: string,
  productId: string,
) {
  window.location.assign(
    `/api/workspace?${new URLSearchParams({ organizationId, next, ...(productId ? { productId } : {}) })}`,
  );
}

export function rememberBrand(productId: string) {
  remember(brandCookie, productId);
}
