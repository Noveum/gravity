"use client";
import type { ClientSnapshot } from "@crm/core/dto";
import t from "@crm/i18n/translations/en.json";
import {
  Bot,
  Check,
  Copy,
  ExternalLink,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { useRef, useState } from "react";

import { IntegrationCards } from "./integration-cards";
export function Connections({
  data,
  endpoint,
  demo,
  onRevoke,
  organizationId,
  productId,
  initialNotice,
  onChanged,
  timeZone = "UTC",
}: {
  data: ClientSnapshot;
  endpoint: string;
  demo: boolean;
  onRevoke: (id: string) => Promise<boolean>;
  organizationId: string;
  productId: string;
  initialNotice: string;
  onChanged: () => Promise<void>;
  timeZone?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [revoking, setRevoking] = useState("");
  const pending = useRef(false);
  return (
    <div className="page-content integration-grid">
      <IntegrationCards
        key={`${organizationId}:${productId}`}
        data={data}
        organizationId={organizationId}
        productId={productId}
        demo={demo}
        initialNotice={initialNotice}
        onChanged={onChanged}
        timeZone={timeZone}
      />
      <article className="integration-card mcp-card">
        <div className="section-heading">
          <h2>
            <Bot size={18} aria-hidden="true" />
            {t.mcp}
          </h2>
          <span className="badge">
            <ShieldCheck size={12} aria-hidden="true" />
            OAuth 2.1
          </span>
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
              {copied ? (
                <Check size={15} aria-hidden="true" />
              ) : (
                <Copy size={15} aria-hidden="true" />
              )}
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
          href="/docs/connect-an-assistant"
          target="_blank"
          rel="noreferrer"
          className="text-button"
        >
          {t.integrationGuide}
          <ExternalLink size={13} aria-hidden="true" />
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
                <Unplug size={14} aria-hidden="true" />
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
