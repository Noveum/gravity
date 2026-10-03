"use client";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { errorText, type Organization, requestJson } from "./crm-app";

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <span className="brand-icon">
          <Sparkles size={16} />
        </span>
        <h1>{title}</h1>
        <p>{description}</p>
        {children}
      </div>
    </main>
  );
}
async function authPost(path: string, body: object) {
  return requestJson<{ url?: string; redirect?: boolean }>(`/api/auth${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function navigateAuth(url: string | undefined) {
  if (!url) throw new Error("INTERNAL_ERROR");
  const target = new URL(url, window.location.origin);
  if (!["http:", "https:"].includes(target.protocol))
    throw new Error("INVALID_INPUT");
  window.location.assign(target.href);
}
export function SignIn({
  providers,
  demo,
}: {
  providers: ("google" | "github")[];
  demo: boolean;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const query = useSearchParams();
  return (
    <Card title={t.signIn} description={t.signInSubtitle}>
      {providers.length ? (
        providers.map((provider) => (
          <button
            type="button"
            key={provider}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const callbackURL = query.get("callbackURL") ?? "/";
                const target = new URL(callbackURL, window.location.origin);
                const safe =
                  target.origin === window.location.origin
                    ? `${target.pathname}${target.search}`
                    : "/";
                navigateAuth(
                  (
                    await authPost("/sign-in/social", {
                      provider,
                      callbackURL: safe,
                      ...(query.has("sig")
                        ? { oauth_query: query.toString() }
                        : {}),
                    })
                  ).url,
                );
              } catch (error) {
                setError(errorText(error));
                setBusy(false);
              }
            }}
          >
            {provider === "google" ? t.googleSignIn : t.githubSignIn}
          </button>
        ))
      ) : (
        <p className="callout">{t.authUnavailable}</p>
      )}
      {demo && (
        <a href="/" className="auth-link">
          {t.openDemo}
        </a>
      )}
      <p role="status">{error}</p>
    </Card>
  );
}
export function Authorization() {
  const query = useSearchParams();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [org, setOrg] = useState("");
  const [products, setProducts] = useState<ClientSnapshot["products"]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    requestJson<Organization[]>("/api/crm?operation=organizations")
      .then((orgs) => {
        setOrganizations(orgs);
        setOrg(orgs[0]?.id ?? "");
      })
      .catch((error) => setError(errorText(error)));
  }, []);
  useEffect(() => {
    if (!org) return;
    const controller = new AbortController();
    setProducts([]);
    setSelected([]);
    requestJson<ClientSnapshot>(`/api/crm?organizationId=${org}`, {
      signal: controller.signal,
    })
      .then((snapshot) => setProducts(snapshot.products))
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorText(error));
      });
    return () => controller.abort();
  }, [org]);
  return (
    <Card title={t.authorize} description={t.authorizeDescription}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!selected.length) {
            setError(t.selectionRequired);
            return;
          }
          setBusy(true);
          try {
            await requestJson("/api/grants", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                organizationId: org,
                productIds: selected,
                oauth_query: query.toString(),
              }),
            });
            navigateAuth(
              (
                await authPost("/oauth2/continue", {
                  postLogin: true,
                  oauth_query: query.has("sig") ? query.toString() : undefined,
                })
              ).url,
            );
          } catch (error) {
            setError(errorText(error));
            setBusy(false);
          }
        }}
      >
        <label>
          {t.workspace}
          <select value={org} onChange={(event) => setOrg(event.target.value)}>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </label>
        {products.map((product) => (
          <label key={product.id} className="checkbox-label">
            <input
              type="checkbox"
              checked={selected.includes(product.id)}
              onChange={(event) =>
                setSelected((ids) =>
                  event.target.checked
                    ? [...ids, product.id]
                    : ids.filter((id) => id !== product.id),
                )
              }
            />
            {product.name}
          </label>
        ))}
        <button
          type="submit"
          className="primary"
          disabled={busy || !selected.length}
        >
          {t.continue}
        </button>
      </form>
      <p role="status">{error}</p>
    </Card>
  );
}
export function Consent() {
  const query = useSearchParams();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [grant, setGrant] = useState<{
    organization: string;
    products: string[];
    clientName: string;
  } | null>(null);
  const signedQuery = query.toString();
  useEffect(() => {
    const controller = new AbortController();
    requestJson<{
      organization: string;
      products: string[];
      clientName: string;
    }>(`/api/grants?oauth_query=${encodeURIComponent(signedQuery)}`, {
      signal: controller.signal,
    })
      .then(setGrant)
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorText(error));
      });
    return () => controller.abort();
  }, [signedQuery]);
  async function submit(accept: boolean) {
    setBusy(true);
    try {
      navigateAuth(
        (
          await authPost("/oauth2/consent", {
            accept,
            oauth_query: query.has("sig") ? query.toString() : undefined,
          })
        ).url,
      );
    } catch (error) {
      setError(errorText(error));
      setBusy(false);
    }
  }
  return (
    <Card title={t.consent} description={t.consentDescription}>
      {grant && (
        <div className="callout">
          <strong>{grant.clientName}</strong>
          <p>
            {grant.organization} · {grant.products.join(", ")}
          </p>
          <p>{t.consentReadOnly}</p>
        </div>
      )}
      <p>{t.scopes}</p>
      <code>{query.get("scope") ?? "crm:read"}</code>
      {query.get("claims") && <pre>{query.get("claims")}</pre>}
      <button
        type="button"
        className="primary"
        disabled={busy || !grant}
        onClick={() => void submit(true)}
      >
        {t.accept}
      </button>
      <button type="button" disabled={busy} onClick={() => void submit(false)}>
        {t.decline}
      </button>
      <p role="status">{error}</p>
    </Card>
  );
}
