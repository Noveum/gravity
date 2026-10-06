"use client";
import t from "@crm/i18n/translations/en.json";
import { Check, Copy, Send } from "lucide-react";
import { type FormEvent, useState } from "react";
import { dateLabel, label } from "../client-api";
import { useWorkspaceData } from "../crm/crm-context";
import { EmptyState } from "../ui/states";
import {
  AdminNotice,
  ConfirmButton,
  QueryState,
  SettingsGroup,
  SettingsPanel,
  useSettingsQuery,
} from "./settings-ui";

interface Member {
  userId: string;
  name: string;
  email: string;
  role: "admin" | "member";
  active: boolean;
  allProducts: boolean;
  productIds: string[];
  owned: { relationships: number; actions: number; touches: number };
}
interface Invitation {
  id: string;
  email: string;
  role: "admin" | "member";
  productIds: string[];
  status: "pending" | "expired" | "accepted" | "revoked";
  expiresAt: string;
}
interface Issued {
  acceptUrl: string;
  emailStatus: "sent" | "not_configured" | "failed";
  email: string;
}
type Product = { id: string; name: string };
type Mutate = (
  body: object,
  announce?: string | boolean,
) => Promise<{ ok: boolean; result?: unknown }>;

function ProductChecks({
  products,
  selected,
  onToggle,
}: {
  products: Product[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="settings-checks">
      {products.map((product) => (
        <label key={product.id} className="settings-check">
          <input
            type="checkbox"
            checked={selected.includes(product.id)}
            onChange={() => onToggle(product.id)}
          />
          {product.name}
        </label>
      ))}
    </div>
  );
}
type WorkCounts = Record<keyof typeof t.workCounts, number>;
const pluralRules = new Intl.PluralRules("en");
function workCount(kind: keyof typeof t.workCounts, count: number) {
  const forms = t.workCounts[kind];
  return (
    pluralRules.select(count) === "one" ? forms.one : forms.other
  ).replace("{count}", String(count));
}
function fillWork(template: string, counts: WorkCounts) {
  return template
    .replace(
      "{relationships}",
      workCount("relationships", counts.relationships),
    )
    .replace("{actions}", workCount("actions", counts.actions))
    .replace("{touches}", workCount("touches", counts.touches));
}
export const ownedWorkText = (counts: WorkCounts) =>
  fillWork(t.ownedWork, counts);
export const movedWorkText = (counts: WorkCounts) =>
  fillWork(t.memberMoved, counts);
const toggled = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];

function MemberRow({
  member,
  members,
  products,
  viewer,
  editable,
  send,
  notify,
}: {
  viewer: string;
  member: Member;
  members: Member[];
  products: Product[];
  editable: boolean;
  send: Mutate;
  notify: (message: string) => void;
}) {
  const [access, setAccess] = useState(member.productIds);
  const others = members.filter(
    (item) => item.active && item.userId !== member.userId,
  );
  const [reassign, setReassign] = useState(
    others.find((item) => item.userId === viewer)?.userId ??
      others[0]?.userId ??
      "",
  );
  const owned = ownedWorkText(member.owned);
  const scope = { userId: member.userId };
  const self = member.userId === viewer;
  return (
    <li className="settings-row" aria-label={member.name}>
      <span className="settings-row-main">
        <strong>{member.name}</strong>
        {self && <span className="badge">{t.you}</span>}
        <span className="settings-row-meta">{member.email}</span>
        {!member.active && (
          <span className="badge warning">{t.memberDeactivated}</span>
        )}
      </span>
      <span className="settings-row-meta">{owned}</span>
      {editable && member.active ? (
        <div className="settings-row-actions">
          <select
            aria-label={t.memberRoleFor.replace("{name}", member.name)}
            value={member.role}
            onChange={(event) =>
              void send({
                operation: "member-role",
                ...scope,
                role: event.target.value,
              })
            }
          >
            <option value="member">{t.member}</option>
            <option value="admin">{t.admin}</option>
          </select>
          {member.allProducts ? (
            <span className="badge">{t.allProducts}</span>
          ) : (
            <details className="settings-disclosure">
              <summary>
                {access.length === 1
                  ? t.productCountOne
                  : t.productCount.replace("{count}", String(access.length))}
              </summary>
              <div className="settings-popover">
                <ProductChecks
                  products={products}
                  selected={access}
                  onToggle={(id) => setAccess((ids) => toggled(ids, id))}
                />
                <button
                  type="button"
                  onClick={() =>
                    void send({
                      operation: "member-products",
                      ...scope,
                      productIds: access,
                    })
                  }
                >
                  {t.saveAccess}
                </button>
              </div>
            </details>
          )}
          {!self && (
            <ConfirmButton
              label={t.deactivate}
              confirmLabel={t.deactivateConfirm}
              disabled={!others.length}
              onConfirm={async () => {
                const { ok, result } = await send(
                  {
                    operation: "member-deactivate",
                    ...scope,
                    reassignToUserId: reassign,
                  },
                  false,
                );
                const moved = (result as { reassigned?: Member["owned"] })
                  ?.reassigned;
                if (ok && moved) notify(movedWorkText(moved));
              }}
            >
              <select
                aria-label={t.reassignWorkFrom.replace("{name}", member.name)}
                value={reassign}
                onChange={(event) => setReassign(event.target.value)}
              >
                {others.map((item) => (
                  <option key={item.userId} value={item.userId}>
                    {item.name}
                  </option>
                ))}
              </select>
            </ConfirmButton>
          )}
        </div>
      ) : editable ? (
        <div className="settings-row-actions">
          <button
            type="button"
            className="ghost"
            onClick={() =>
              void send({ operation: "member-reactivate", ...scope })
            }
          >
            {t.reactivate}
          </button>
        </div>
      ) : (
        <span className="badge">{label(member.role)}</span>
      )}
    </li>
  );
}

function IssuedLink({ issued }: { issued: Issued }) {
  const [copied, setCopied] = useState(false);
  const note =
    issued.emailStatus === "sent"
      ? t.invitationEmailed.replace("{email}", issued.email)
      : issued.emailStatus === "failed"
        ? t.invitationEmailFailed
        : t.invitationEmailOff;
  return (
    <div className="settings-issued" role="status">
      <label className="field">
        <span>{t.invitationLink}</span>
        <span className="endpoint-copy">
          <input readOnly value={issued.acceptUrl} />
          <button
            type="button"
            aria-label={t.copyValue.replace("{label}", t.invitationLink)}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(issued.acceptUrl);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? (
              <Check size={14} aria-hidden />
            ) : (
              <Copy size={14} aria-hidden />
            )}
          </button>
        </span>
      </label>
      <p className="settings-note">{note}</p>
    </div>
  );
}

function Invitations({
  products,
  send,
  revision,
  organizationId,
  timeZone,
}: {
  products: Product[];
  send: Mutate;
  revision: unknown;
  organizationId: string;
  timeZone: string;
}) {
  const query = useSettingsQuery<{ invitations: Invitation[] }>(
    `/api/crm?operation=invitations&organizationId=${organizationId}`,
    revision,
  );
  const [role, setRole] = useState<"member" | "admin">("member");
  const [chosen, setChosen] = useState<string[]>([]);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = (query.data?.invitations ?? []).filter(
    (invitation) => invitation.status !== "accepted",
  );
  async function issue(body: object, email: string) {
    const { ok, result } = await send(body, false);
    const value = result as Omit<Issued, "email"> | undefined;
    if (ok && value?.acceptUrl) setIssued({ ...value, email });
    await query.reload();
    return ok;
  }
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email") ?? "").trim();
    if (!email || busy) return;
    setBusy(true);
    try {
      if (
        await issue(
          {
            operation: "invitation",
            email,
            role,
            productIds: role === "admin" ? [] : chosen,
          },
          email,
        )
      ) {
        form.reset();
        setChosen([]);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsGroup title={t.invitations} detail={t.invitationsDetail}>
      <form className="settings-invite" onSubmit={invite}>
        <div className="settings-inline-form">
          <input
            name="email"
            type="email"
            aria-label={t.inviteEmail}
            placeholder={t.inviteEmail}
            required
            maxLength={254}
            disabled={busy}
          />
          <select
            aria-label={t.inviteRole}
            value={role}
            onChange={(event) =>
              setRole(event.target.value === "admin" ? "admin" : "member")
            }
          >
            <option value="member">{t.member}</option>
            <option value="admin">{t.admin}</option>
          </select>
          <button type="submit" className="primary" disabled={busy}>
            <Send size={14} aria-hidden />
            {t.invite}
          </button>
        </div>
        {role === "member" && (
          <ProductChecks
            products={products}
            selected={chosen}
            onToggle={(id) => setChosen((ids) => toggled(ids, id))}
          />
        )}
      </form>
      {issued && <IssuedLink issued={issued} />}
      <QueryState
        error={query.error}
        loading={query.loading}
        onRetry={() => void query.reload()}
        rows={2}
      />
      {query.data && !shown.length && (
        <EmptyState title={t.noInvitations} compact />
      )}
      <ul className="settings-list">
        {shown.map((invitation) => {
          const open =
            invitation.status === "pending" || invitation.status === "expired";
          return (
            <li
              key={invitation.id}
              className="settings-row"
              aria-label={invitation.email}
            >
              <span className="settings-row-main">
                <span>{invitation.email}</span>
                <span className="badge">{label(invitation.role)}</span>
                <span
                  className={`badge${invitation.status === "pending" ? "" : " warning"}`}
                >
                  {t.invitationStatus[invitation.status]}
                </span>
              </span>
              {invitation.status === "pending" && (
                <span className="settings-row-meta">
                  {t.invitationExpires.replace(
                    "{date}",
                    dateLabel(invitation.expiresAt, timeZone),
                  )}
                </span>
              )}
              {open && (
                <div className="settings-row-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() =>
                      void issue(
                        {
                          operation: "invitation-resend",
                          invitationId: invitation.id,
                        },
                        invitation.email,
                      )
                    }
                  >
                    {t.resendInvitation}
                  </button>
                  <ConfirmButton
                    label={t.revokeInvitation}
                    confirmLabel={t.revokeInvitationConfirm}
                    onConfirm={async () => {
                      await send({
                        operation: "invitation-revoke",
                        invitationId: invitation.id,
                      });
                      await query.reload();
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </SettingsGroup>
  );
}

export function MemberSettings() {
  const crm = useWorkspaceData();
  const revision = crm.sourceData.asOf;
  const query = useSettingsQuery<{ members: Member[] }>(
    `/api/crm?operation=members&organizationId=${crm.organizationId}`,
    revision,
  );
  const editable = crm.isAdmin;
  const products = crm.sourceData.products;
  const send: Mutate = (body, announce = true) =>
    crm.send({ organizationId: crm.organizationId, ...body }, announce);
  const members = query.data?.members ?? [];
  return (
    <SettingsPanel section="members">
      <SettingsGroup title={t.members}>
        <QueryState
          error={query.error}
          loading={query.loading}
          onRetry={() => void query.reload()}
        />
        <ul className="settings-list">
          {members.map((member) => (
            <MemberRow
              key={`${member.userId}:${member.role}:${member.active}:${member.productIds.join(",")}`}
              member={member}
              members={members}
              products={products}
              viewer={crm.userId}
              editable={editable}
              send={send}
              notify={(message) => crm.notify(message, "success")}
            />
          ))}
        </ul>
        {!editable && <AdminNotice />}
      </SettingsGroup>
      {editable && (
        <Invitations
          products={products}
          send={send}
          revision={revision}
          organizationId={crm.organizationId}
          timeZone={crm.timeZone}
        />
      )}
    </SettingsPanel>
  );
}
