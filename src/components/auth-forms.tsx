"use client";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { ArrowLeft, ArrowRight, BookOpen, Mail, RotateCw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { errorText, type Organization, requestJson } from "./client-api";
import { GravityMark } from "./gravity-logo";
import { OneTimeCode } from "./one-time-code";
import { Preferences } from "./preferences";
import {
  authenticatedSignInDestination,
  signInDestination,
} from "./sign-in-destination";

export function AuthLayout({
  title,
  description,
  children,
  isSignIn = false,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  isSignIn?: boolean;
}) {
  return (
    <main className={`auth-page ${isSignIn ? "auth-sign-in" : ""}`}>
      <header className="auth-header">
        <a href="/welcome" className="auth-wordmark">
          <GravityMark size={34} />
          <span>{t.brand}</span>
        </a>
        <div className="auth-header-actions">
          <a href="/docs">
            <BookOpen size={14} aria-hidden="true" />
            {t.authHelp}
          </a>
          <Preferences showDensity={false} />
        </div>
      </header>
      <div className="auth-layout">
        {isSignIn && (
          <aside className="auth-story">
            <p className="auth-eyebrow">{t.brandSub}</p>
            <h2>{t.authStoryTitle}</h2>
            <p className="auth-story-description">{t.authStoryDescription}</p>
            <div className="auth-orbit" aria-hidden="true">
              <div className="auth-orbit-ring auth-orbit-outer" />
              <div className="auth-orbit-ring auth-orbit-middle" />
              <div className="auth-orbit-ring auth-orbit-inner" />
              <div className="auth-orbit-core">
                <GravityMark size={68} />
              </div>
              <span className="auth-orbit-label auth-orbit-people">
                {t.people}
              </span>
              <span className="auth-orbit-label auth-orbit-context">
                {t.authContext}
              </span>
              <span className="auth-orbit-label auth-orbit-actions">
                {t.actions}
              </span>
            </div>
            <div className="auth-story-footer">
              <span>{t.authOpenSource}</span>
              <span>{t.authLicense}</span>
            </div>
          </aside>
        )}
        <section className="auth-form-region" aria-label={title}>
          <div className="auth-card">
            <h1>{title}</h1>
            <p className="auth-description">{description}</p>
            {children}
          </div>
        </section>
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
  emailEnabled = false,
}: {
  providers: ("google" | "github")[];
  demo: boolean;
  emailEnabled?: boolean;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const query = useSearchParams();
  const submitting = useRef(false);
  const activeQuery = useRef(query.toString());
  activeQuery.current = query.toString();
  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (demo) return;
    let checking = false;
    let controller: AbortController | undefined;
    async function checkSession() {
      if (
        checking ||
        submitting.current ||
        document.visibilityState === "hidden"
      )
        return;
      checking = true;
      const flow = activeQuery.current;
      const pending = new AbortController();
      controller = pending;
      try {
        const session = await requestJson<{ user: { id: string } } | null>(
          "/api/auth/get-session",
          { cache: "no-store", signal: pending.signal },
        );
        if (
          !pending.signal.aborted &&
          activeQuery.current === flow &&
          session?.user?.id
        )
          navigateAuth(
            authenticatedSignInDestination(
              new URLSearchParams(flow),
              window.location.origin,
            ),
          );
      } catch {
        // A transient read failure must not disable sign-in or erase typed values.
      } finally {
        checking = false;
      }
    }
    const focus = (event: Event) => {
      if (event.target === event.currentTarget) void checkSession();
    };
    const visible = () => {
      if (document.visibilityState === "visible") void checkSession();
    };
    window.addEventListener("focus", focus);
    window.addEventListener("pageshow", checkSession);
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller?.abort();
      window.removeEventListener("focus", focus);
      window.removeEventListener("pageshow", checkSession);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [demo]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  useEffect(() => {
    if (sentEmail) codeInput.current?.focus();
  }, [sentEmail]);
  async function sendCode() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const recipient = (sentEmail || email).trim().toLowerCase();
    try {
      await authPost("/email-otp/send-verification-otp", {
        email: recipient,
        type: "sign-in",
      });
      setSentEmail(recipient);
      setOtp("");
      setCooldown(60);
      codeInput.current?.focus();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function verifyCode() {
    if (submitting.current || !/^\d{6}$/.test(otp)) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const signedQuery = query.toString();
    try {
      const response = await authPost("/sign-in/email-otp", {
        email: sentEmail,
        otp,
        ...(query.has("sig") ? { oauth_query: signedQuery } : {}),
      });
      if (activeQuery.current === signedQuery)
        navigateAuth(
          response.url ?? signInDestination(query, window.location.origin),
        );
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <AuthLayout title={t.signIn} description={t.signInSubtitle} isSignIn>
      {providers.length ? (
        providers.map((provider) => (
          <button
            type="button"
            key={provider}
            className="auth-provider"
            disabled={busy}
            onClick={async () => {
              if (submitting.current) return;
              submitting.current = true;
              setError("");
              setBusy(true);
              try {
                const safe = signInDestination(query, window.location.origin);
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
            {provider === "google" ? <GoogleMark /> : <GithubMark />}
            {provider === "google" ? t.googleSignIn : t.githubSignIn}
          </button>
        ))
      ) : !emailEnabled ? (
        <p className="callout">{t.authUnavailable}</p>
      ) : null}
      {emailEnabled && (
        <>
          {providers.length > 0 && <p className="auth-divider">{t.orEmail}</p>}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!event.currentTarget.checkValidity()) return;
              if (sentEmail) void verifyCode();
              else void sendCode();
            }}
          >
            {sentEmail ? (
              <>
                <p id="otp-instructions">
                  {t.emailCodeSent.replace("{email}", sentEmail)}
                </p>
                <OneTimeCode
                  inputRef={codeInput}
                  value={otp}
                  onChange={(value) => {
                    setOtp(value);
                    setError("");
                  }}
                  disabled={busy}
                  invalid={Boolean(error)}
                />
                <button
                  type="submit"
                  className="primary auth-submit"
                  disabled={busy}
                >
                  {busy ? t.signingIn : t.verifySignInCode}
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
                <div className="auth-code-actions">
                  <button
                    type="button"
                    disabled={busy || cooldown > 0}
                    onClick={() => void sendCode()}
                  >
                    <RotateCw size={13} aria-hidden="true" />
                    {cooldown
                      ? t.resendCodeIn.replace("{seconds}", String(cooldown))
                      : t.resendCode}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setSentEmail("");
                      setOtp("");
                      setError("");
                    }}
                  >
                    <ArrowLeft size={13} aria-hidden="true" />
                    {t.changeEmail}
                  </button>
                </div>
              </>
            ) : (
              <>
                <label>
                  {t.emailAddress}
                  <span className="auth-email-input">
                    <Mail size={16} aria-hidden="true" />
                    <input
                      type="email"
                      autoComplete="email"
                      placeholder={t.authEmailPlaceholder}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      maxLength={254}
                      disabled={busy}
                    />
                  </span>
                </label>
                <button
                  type="submit"
                  className="primary auth-submit"
                  disabled={busy}
                >
                  {busy ? t.sendingSignInCode : t.sendSignInCode}
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </>
            )}
            <p className="auth-email-note">{t.emailCodeNote}</p>
          </form>
        </>
      )}
      {demo && (
        <a href="/" className="auth-link">
          {t.openDemo}
        </a>
      )}
      <p className="auth-feedback" role={error ? "alert" : "status"}>
        {error}
      </p>
    </AuthLayout>
  );
}
function GithubMark() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.14.68-3.8-1.33-3.8-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.03-.7.08-.69.08-.69 1.14.08 1.74 1.17 1.74 1.17 1.01 1.73 2.65 1.23 3.3.94.1-.73.4-1.23.72-1.51-2.5-.29-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.29-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.15a10.78 10.78 0 0 1 5.65 0c2.15-1.45 3.1-1.15 3.1-1.15.61 1.55.23 2.69.11 2.98.72.79 1.16 1.79 1.16 3.02 0 4.32-2.63 5.27-5.14 5.55.4.35.76 1.04.76 2.1v3.13c0 .3.2.65.78.54A11.25 11.25 0 0 0 12 .75Z"
      />
    </svg>
  );
}
function GoogleMark() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.04H12v3.86h5.38a4.6 4.6 0 0 1-1.99 3.02v2.5h3.23c1.89-1.74 2.98-4.3 2.98-7.34Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.23-2.5c-.9.6-2.05.97-3.39.97-2.6 0-4.81-1.76-5.6-4.12H3.07v2.59A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.4 13.92a6 6 0 0 1 0-3.84V7.49H3.07a10 10 0 0 0 0 9.02l3.33-2.59Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.96c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.33 2.59A5.99 5.99 0 0 1 12 5.96Z"
      />
    </svg>
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
      <AuthLayout title={t.authorize} description={t.authorizeDescription}>
        <p className="callout">{t.authFlowMissing}</p>
        <a className="auth-link" href="/">
          {t.backToWorkspace}
        </a>
      </AuthLayout>
    );
  return (
    <AuthLayout title={t.authorize} description={t.authorizeDescription}>
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
    </AuthLayout>
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
      <AuthLayout title={t.consent} description={t.consentDescription}>
        <p className="callout">{t.authFlowMissing}</p>
        <a className="auth-link" href="/">
          {t.backToWorkspace}
        </a>
      </AuthLayout>
    );
  return (
    <AuthLayout title={t.consent} description={t.consentDescription}>
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
    </AuthLayout>
  );
}
