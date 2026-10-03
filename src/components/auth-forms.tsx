"use client";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { errorText, type Organization, requestJson } from "./client-api";

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
  const submitting = useRef(false);
  return (
    <Card title={t.signIn} description={t.signInSubtitle}>
      {providers.length ? (
        providers.map((provider) => (
          <button
            type="button"
            key={provider}
            disabled={busy}
            onClick={async () => {
              if (submitting.current) return;
              submitting.current = true;
              setError("");
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
              } finally {
                submitting.current = false;
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
      <p role={error ? "alert" : "status"}>{error}</p>
    </Card>
  );
}
export function Authorization() {
  const query = useSearchParams();
  const signedQuery = query.toString();
  const activeQuery = useRef(signedQuery);
  activeQuery.current = signedQuery;
  const hasFlow = query.has("sig") && query.has("client_id");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [org, setOrg] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [orgLoading, setOrgLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<{
    org: string;
    products: ClientSnapshot["products"];
    loading: boolean;
    error: string;
  }>({ org: "", products: [], loading: true, error: "" });
  const submitting = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is an explicit retry trigger.
  useEffect(() => {
    if (!hasFlow) return;
    const controller = new AbortController();
    setOrgLoading(true);
    setError("");
    requestJson<Organization[]>("/api/crm?operation=organizations", {
      signal: controller.signal,
    })
      .then((orgs) => {
        if (!controller.signal.aborted) {
          setOrganizations(orgs);
          setOrg((previous) =>
            orgs.some((row) => row.id === previous)
              ? previous
              : orgs[0]?.id || "",
          );
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setOrgLoading(false);
      });
    return () => controller.abort();
  }, [hasFlow, attempt]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt also retries failed product reads.
  useEffect(() => {
    if (!hasFlow || !org) return;
    const controller = new AbortController();
    setScope({ org, products: [], loading: true, error: "" });
    setSelected([]);
    requestJson<ClientSnapshot>(`/api/crm?organizationId=${org}`, {
      signal: controller.signal,
    })
      .then((snapshot) => {
        if (!controller.signal.aborted)
          setScope({
            org,
            products: snapshot.products,
            loading: false,
            error: "",
          });
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setScope({
            org,
            products: [],
            loading: false,
            error: errorText(cause),
          });
      });
    return () => controller.abort();
  }, [hasFlow, org, attempt]);
  const products = scope.org === org && !scope.loading ? scope.products : [];
  const loading = orgLoading || (!!org && (scope.org !== org || scope.loading));
  const failure = error || (scope.org === org ? scope.error : "");
  if (!hasFlow)
    return (
      <Card title={t.authorize} description={t.authorizeDescription}>
        <p className="callout">{t.authFlowMissing}</p>
        <a className="auth-link" href="/">
          {t.backToWorkspace}
        </a>
      </Card>
    );
  return (
    <Card title={t.authorize} description={t.authorizeDescription}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (
            submitting.current ||
            loading ||
            failure ||
            !org ||
            !selected.length ||
            selected.some(
              (id) => !products.some((product) => product.id === id),
            )
          )
            return;
          const selection = {
            organizationId: org,
            productIds: [...selected],
            oauth_query: query.toString(),
          };
          submitting.current = true;
          setBusy(true);
          setError("");
          try {
            await requestJson("/api/grants", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(selection),
            });
            if (activeQuery.current !== selection.oauth_query) return;
            const response = await authPost("/oauth2/continue", {
              postLogin: true,
              oauth_query: selection.oauth_query,
            });
            if (activeQuery.current === selection.oauth_query)
              navigateAuth(response.url);
          } catch (cause) {
            if (activeQuery.current === selection.oauth_query)
              setError(errorText(cause));
          } finally {
            submitting.current = false;
            setBusy(false);
          }
        }}
      >
        <fieldset className="dialog-fields" disabled={busy || orgLoading}>
          <label>
            {t.workspace}
            <select
              value={org}
              onChange={(event) => {
                setOrg(event.target.value);
                setSelected([]);
                setError("");
              }}
            >
              {organizations.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
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
        </fieldset>
        {loading && (
          <p role="status">
            {orgLoading ? t.authOrgLoading : t.authProductsLoading}
          </p>
        )}
        {!loading && !failure && !organizations.length && (
          <>
            <p>{t.authNoOrganizations}</p>
            <a
              className="auth-link"
              href={`/onboarding?oauth_query=${encodeURIComponent(signedQuery)}`}
            >
              {t.createWorkspace}
            </a>
          </>
        )}
        {!loading && !failure && org && !products.length && (
          <p>{t.authNoProducts}</p>
        )}
        <button
          type="submit"
          className="primary"
          disabled={busy || loading || !!failure || !selected.length}
        >
          {busy ? t.saving : t.continue}
        </button>
      </form>
      {failure && (
        <>
          <p role="alert">{failure}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setSelected([]);
              setAttempt((value) => value + 1);
            }}
          >
            {t.authRetry}
          </button>
        </>
      )}
    </Card>
  );
}
export function Consent() {
  const query = useSearchParams();
  const signedQuery = query.toString();
  const hasFlow = query.has("sig") && query.has("client_id");
  const activeQuery = useRef(signedQuery);
  activeQuery.current = signedQuery;
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [grant, setGrant] = useState<{
    query: string;
    organization: string;
    products: string[];
    clientName: string;
  } | null>(null);
  const selectedGrant = grant?.query === signedQuery ? grant : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the explicit retry trigger.
  useEffect(() => {
    if (!hasFlow) return;
    const controller = new AbortController();
    setGrant(null);
    setError("");
    requestJson<{
      organization: string;
      products: string[];
      clientName: string;
    }>(`/api/grants?oauth_query=${encodeURIComponent(signedQuery)}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted)
          setGrant({ ...result, query: signedQuery });
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      });
    return () => controller.abort();
  }, [signedQuery, hasFlow, attempt]);
  async function submit(accept: boolean) {
    if (submitting.current || !hasFlow || (accept && !selectedGrant)) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const flow = signedQuery;
    try {
      const response = await authPost("/oauth2/consent", {
        accept,
        oauth_query: flow,
      });
      if (activeQuery.current === flow) navigateAuth(response.url);
    } catch (cause) {
      if (activeQuery.current === flow) setError(errorText(cause));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  if (!hasFlow)
    return (
      <Card title={t.consent} description={t.consentDescription}>
        <p className="callout">{t.authFlowMissing}</p>
        <a className="auth-link" href="/">
          {t.backToWorkspace}
        </a>
      </Card>
    );
  return (
    <Card title={t.consent} description={t.consentDescription}>
      {selectedGrant ? (
        <div className="callout">
          <strong>{selectedGrant.clientName}</strong>
          <p>
            {selectedGrant.organization} · {selectedGrant.products.join(", ")}
          </p>
          <p>{t.consentReadOnly}</p>
        </div>
      ) : (
        !error && <p role="status">{t.authFlowLoading}</p>
      )}
      <p>{t.scopes}</p>
      <code>{query.get("scope") ?? "crm:read"}</code>
      <button
        type="button"
        className="primary"
        disabled={busy || !selectedGrant}
        onClick={() => void submit(true)}
      >
        {t.accept}
      </button>
      <button type="button" disabled={busy} onClick={() => void submit(false)}>
        {t.decline}
      </button>
      {error && (
        <>
          <p role="alert">{error}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t.authRetry}
          </button>
        </>
      )}
    </Card>
  );
}
