"use client";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useRef, useState } from "react";

const providers = ["gmail", "calendar", "linkedin", "fireflies"] as const;
export function Connections({
  data,
  endpoint,
  demo,
  onRevoke,
}: {
  data: ClientSnapshot;
  endpoint: string;
  demo: boolean;
  onRevoke: (id: string) => Promise<boolean>;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [revoking, setRevoking] = useState("");
  const pending = useRef(false);
  return (
    <div className="page-content integration-grid">
      {providers.map((provider) => (
        <article key={provider} className="integration-card">
          <div className="section-heading">
            <h2>{t[provider]}</h2>
            <span className="badge">{t.notConnected}</span>
          </div>
          <p>{t[`${provider}Description`]}</p>
          <details className="connection-guide">
            <summary>{t.connectionSetup}</summary>
            <p>{t.providerConnectionPending}</p>
            <ol>
              {t.connectionSteps[provider].map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </details>
          {provider === "gmail" && (
            <p className="connection-note">{t.mailboxSeparateLogin}</p>
          )}
        </article>
      ))}
      <article className="integration-card mcp-card">
        <div className="section-heading">
          <h2>{t.mcp}</h2>
          <span className="badge">OAuth 2.1</span>
        </div>
        <p>{t.mcpDescription}</p>
        <div className="endpoint-field">
          <label htmlFor="mcp-endpoint">{t.mcpEndpoint}</label>
          <div className="endpoint-copy">
            <input id="mcp-endpoint" readOnly value={endpoint} />
            <button
              type="button"
              aria-label={t.copyMcpEndpoint}
              disabled={!endpoint}
              onClick={async () => {
                setCopyError("");
                try {
                  await navigator.clipboard.writeText(endpoint);
                  setCopied(true);
                } catch {
                  setCopyError(t.copyFailed);
                }
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              <span>{copied ? t.copied : t.copy}</span>
            </button>
          </div>
        </div>
        {copyError && <p role="alert">{copyError}</p>}
        {copied && (
          <span role="status" className="sr-only">
            {t.copied}
          </span>
        )}
        <p className="callout">{demo ? t.mcpOffline : t.mcpQualification}</p>
        <ol className="mcp-steps">
          {t.mcpSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="muted">{t.noKey}</p>
        <a
          href="https://github.com/Noveum/gravity/blob/main/docs/setup-and-mcp.md"
          target="_blank"
          rel="noreferrer"
          className="text-button"
        >
          {t.integrationGuide}
          <ExternalLink size={13} />
        </a>
        <h3 className="spaced">{t.assistantGrants}</h3>
        {data.grants.length ? (
          data.grants.map((grant) => (
            <div className="grant-row" key={grant.id}>
              <span>
                {grant.productIds
                  .map(
                    (id) =>
                      data.products.find((product) => product.id === id)?.name,
                  )
                  .filter(Boolean)
                  .join(", ")}
              </span>
              <button
                type="button"
                disabled={!!revoking}
                onClick={async () => {
                  if (pending.current) return;
                  pending.current = true;
                  setRevoking(grant.id);
                  try {
                    await onRevoke(grant.id);
                  } finally {
                    pending.current = false;
                    setRevoking("");
                  }
                }}
              >
                {revoking === grant.id ? t.saving : t.revoke}
              </button>
            </div>
          ))
        ) : (
          <small>{t.noGrants}</small>
        )}
      </article>
    </div>
  );
}
