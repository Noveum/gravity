"use client";
import t from "@crm/i18n/translations/en.json";
import { useRef, useState } from "react";
import { z } from "zod";
import { useWorkspaceData } from "./crm/crm-context";
import { submitOnSaveKey, useModalLifecycle } from "./modal-lifecycle";
import { Select } from "./ui/select";
import { ShortcutHint } from "./ui/shortcut-hint";

export interface MemberAccess {
  id: string;
  name: string;
  role: "admin" | "member";
  productIds: string[];
}
export function AccessFields({
  role,
  setRole,
  productIds,
  setProductIds,
  products,
  disabled,
}: {
  role: "admin" | "member";
  setRole: (role: "admin" | "member") => void;
  productIds: string[];
  setProductIds: (ids: string[]) => void;
  products: { id: string; name: string }[];
  disabled: boolean;
}) {
  return (
    <>
      <div className="field">
        <span>{t.role}</span>
        <Select
          label={t.role}
          value={role}
          disabled={disabled}
          options={[
            { value: "member", label: t.member },
            { value: "admin", label: t.admin },
          ]}
          onChange={(value) => {
            if (value === "admin" || value === "member") setRole(value);
          }}
        />
      </div>
      <p className="muted">
        {role === "admin" ? t.adminAccessDetail : t.memberAccessDetail}
      </p>
      {role === "member" && (
        <fieldset className="product-access" disabled={disabled}>
          <legend>{t.productAccess}</legend>
          {products.map((product) => (
            <label key={product.id}>
              <input
                type="checkbox"
                checked={productIds.includes(product.id)}
                onChange={(event) =>
                  setProductIds(
                    event.target.checked
                      ? [...productIds, product.id]
                      : productIds.filter((id) => id !== product.id),
                  )
                }
              />
              {product.name}
            </label>
          ))}
        </fieldset>
      )}
    </>
  );
}
export function MemberAccessDialog({
  member,
  onClose,
}: {
  member?: MemberAccess;
  onClose: () => void;
}) {
  const crm = useWorkspaceData();
  const modal = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<"admin" | "member">(
    member?.role ?? "member",
  );
  const [productIds, setProductIds] = useState(
    member?.productIds ?? crm.sourceData.products.map((product) => product.id),
  );
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [emailStatus, setEmailStatus] = useState<EmailStatus>("not_configured");
  const [copied, setCopied] = useState(false);
  useModalLifecycle(modal);
  const initialProducts =
    member?.productIds ?? crm.sourceData.products.map((product) => product.id);
  const dirty =
    email !== "" ||
    role !== (member?.role ?? "member") ||
    [...productIds].sort().join(",") !== [...initialProducts].sort().join(",");
  return (
    <dialog
      ref={modal}
      data-dirty={dirty || busy || undefined}
      className="dialog member-dialog"
      aria-labelledby="member-dialog-title"
      aria-describedby="member-dialog-detail"
      onCancel={(event) => {
        if (submitting.current) event.preventDefault();
        else onClose();
      }}
    >
      <span className="eyebrow">{crm.currentOrg?.name}</span>
      <h2 id="member-dialog-title">
        {member ? t.editMemberAccess : t.inviteMember}
      </h2>
      <p className="muted" id="member-dialog-detail">
        {member ? member.name : t.inviteDetail}
      </p>
      {link ? (
        <div className="invite-result">
          <p role="status">{t.inviteReady.replace("{email}", email)}</p>
          <p className="muted">{invitationEmailNote(emailStatus, email)}</p>
          <label className="field">
            {t.invitationLink}
            <input
              value={link}
              readOnly
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <p className="muted">{t.inviteShareDetail}</p>
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              {t.close}
            </button>
            <button
              type="button"
              className="primary"
              onClick={async () => {
                setError("");
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                } catch {
                  setError(t.copyLinkManually);
                }
              }}
            >
              {copied ? t.copied : t.copyLink}
            </button>
          </div>
        </div>
      ) : (
        <form
          onKeyDown={submitOnSaveKey}
          onSubmit={async (event) => {
            event.preventDefault();
            if (submitting.current || !crm.isAdmin) return;
            submitting.current = true;
            setBusy(true);
            setError("");
            try {
              const result = await crm.send(
                {
                  operation: member ? "member-access" : "invitation",
                  organizationId: crm.organizationId,
                  ...(member ? { userId: member.id } : { email }),
                  role,
                  productIds: role === "admin" ? [] : productIds,
                },
                false,
                false,
              );
              if (!result.ok) {
                setError(result.error ?? t.errors.INTERNAL_ERROR);
                return;
              }
              if (member) onClose();
              else {
                const parsed = invitationResult.safeParse(result.result);
                if (!parsed.success) {
                  setError(t.errors.INTERNAL_ERROR);
                  return;
                }
                setEmailStatus(parsed.data.emailStatus);
                setLink(parsed.data.acceptUrl);
              }
            } finally {
              submitting.current = false;
              setBusy(false);
            }
          }}
        >
          {!member && (
            <label>
              {t.emailAddress}
              <input
                name="email"
                type="email"
                required
                maxLength={320}
                value={email}
                disabled={busy}
                onChange={(event) => setEmail(event.target.value)}
                autoFocus
              />
            </label>
          )}
          <AccessFields
            role={role}
            setRole={setRole}
            productIds={productIds}
            setProductIds={setProductIds}
            products={crm.sourceData.products}
            disabled={busy}
          />
          <div className="dialog-actions">
            <button type="button" onClick={onClose} disabled={busy}>
              {t.cancel}
            </button>
            <button
              type="submit"
              className="primary"
              disabled={busy || (role === "member" && productIds.length === 0)}
            >
              {busy ? t.saving : member ? t.saveChanges : t.createInvitation}
              <ShortcutHint id="save" />
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </dialog>
  );
}

const emailStatuses = ["sent", "not_configured", "failed"] as const;
type EmailStatus = (typeof emailStatuses)[number];
export const invitationResult = z.object({
  acceptUrl: z.url(),
  emailStatus: z.enum(emailStatuses),
});
export function invitationEmailNote(status: EmailStatus, email: string) {
  return status === "sent"
    ? t.invitationEmailed.replace("{email}", email)
    : status === "failed"
      ? t.invitationEmailFailed
      : t.invitationEmailOff;
}
