"use client";
import t from "@crm/i18n/translations/en.json";
import { Check, Copy, Users } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { dateLabel, label } from "../client-api";
import { useCreate, useWorkspaceData } from "../crm/crm-context";
import {
  invitationEmailNote,
  invitationResult,
  type MemberAccess,
  MemberAccessDialog,
} from "../member-access-dialog";
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
  ownedProductIds: string[];
}
const invitationList = z.array(
  z.object({
    id: z.uuid(),
    email: z.email(),
    role: z.enum(["admin", "member"]),
    productIds: z.array(z.uuid()),
    expiresAt: z.string(),
  }),
);
type Invitation = z.infer<typeof invitationList>[number];
interface Issued extends z.infer<typeof invitationResult> {
  email: string;
}
type Product = { id: string; name: string };
type Mutate = (
  body: object,
  announce?: string | boolean,
) => Promise<{ ok: boolean; result?: unknown }>;

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
const productNames = (products: Product[], ids: string[]) =>
  ids
    .map((id) => products.find((product) => product.id === id)?.name)
    .filter(Boolean)
    .join(", ");

function MemberRow({
  member,
  members,
  products,
  viewer,
  editable,
  send,
  notify,
  onEdit,
}: {
  viewer: string;
  member: Member;
  members: Member[];
  products: Product[];
  editable: boolean;
  send: Mutate;
  notify: (message: string) => void;
  onEdit: (member: MemberAccess) => void;
}) {
  const others = members.filter(
    (item) => item.active && item.userId !== member.userId,
  );
  const missing = (target: Member) =>
    target.allProducts
      ? []
      : member.ownedProductIds.filter((id) => !target.productIds.includes(id));
  const eligible = others.filter((item) => !missing(item).length);
  const [reassign, setReassign] = useState(
    eligible.find((item) => item.userId === viewer)?.userId ??
      eligible[0]?.userId ??
      "",
  );
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
      <span className="settings-row-meta">{ownedWorkText(member.owned)}</span>
      <span className="settings-row-meta">
        <span className="badge">{label(member.role)}</span>{" "}
        {member.allProducts
          ? t.allProducts
          : productNames(products, member.productIds) || t.noProductAccess}
      </span>
      {editable && member.active ? (
        <div className="settings-row-actions">
          <button
            type="button"
            className="ghost"
            aria-label={`${t.editMemberAccess}: ${member.name}`}
            onClick={() =>
              onEdit({
                id: member.userId,
                name: member.name,
                role: member.role,
                productIds: member.productIds,
              })
            }
          >
            {t.editAccess}
          </button>
          {!self && (
            <ConfirmButton
              label={t.deactivate}
              ariaLabel={`${t.deactivate}: ${member.name}`}
              confirmLabel={t.deactivateConfirm}
              disabled={!eligible.length}
              onConfirm={async () => {
                const { ok, result } = await send(
                  {
                    operation: "member-remove",
                    userId: member.userId,
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
                {others.map((item) => {
                  const blocked = missing(item);
                  return (
                    <option
                      key={item.userId}
                      value={item.userId}
                      disabled={blocked.length > 0}
                    >
                      {blocked.length
                        ? t.reassignNeedsAccess
                            .replace("{name}", item.name)
                            .replace(
                              "{products}",
                              productNames(products, blocked),
                            )
                        : item.name}
                    </option>
                  );
                })}
              </select>
            </ConfirmButton>
          )}
        </div>
      ) : editable ? (
        <div className="settings-row-actions">
          <button
            type="button"
            className="ghost"
            aria-label={`${t.reactivate}: ${member.name}`}
            onClick={() =>
              void send({
                operation: "member-reactivate",
                userId: member.userId,
              })
            }
          >
            {t.reactivate}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function IssuedLink({ issued }: { issued: Issued }) {
  const [copied, setCopied] = useState(false);
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
      <p className="settings-note">
        {invitationEmailNote(issued.emailStatus, issued.email)}
      </p>
    </div>
  );
}

function Invitations({
  products,
  send,
  notify,
  revision,
  organizationId,
  timeZone,
}: {
  products: Product[];
  send: Mutate;
  notify: (message: string) => void;
  revision: unknown;
  organizationId: string;
  timeZone: string;
}) {
  const query = useSettingsQuery<unknown>(
    `/api/crm?operation=invitations&organizationId=${organizationId}`,
    revision,
  );
  const [issued, setIssued] = useState<Issued | null>(null);
  const parsed = invitationList.safeParse(query.data ?? []);
  const invitations = parsed.success ? parsed.data : [];
  async function resend(invitation: Invitation) {
    const productIds = invitation.productIds.filter((id) =>
      products.some((product) => product.id === id),
    );
    if (invitation.role === "member" && !productIds.length)
      return notify(t.resendInvitationArchived);
    const { ok, result } = await send(
      {
        operation: "invitation",
        email: invitation.email,
        role: invitation.role,
        productIds,
      },
      false,
    );
    const value = invitationResult.safeParse(result);
    if (ok && value.success)
      setIssued({ ...value.data, email: invitation.email });
    await query.reload();
  }
  return (
    <SettingsGroup title={t.pendingInvitations} detail={t.invitationsDetail}>
      {issued && <IssuedLink issued={issued} />}
      <QueryState
        error={query.error}
        loading={query.loading}
        onRetry={() => void query.reload()}
        rows={2}
      />
      {query.data !== null && !invitations.length && (
        <EmptyState title={t.noPendingInvitations} compact />
      )}
      <ul className="settings-list">
        {invitations.map((invitation) => (
          <li
            key={invitation.id}
            className="settings-row"
            aria-label={invitation.email}
          >
            <span className="settings-row-main">
              <span>{invitation.email}</span>
              <span className="badge">{label(invitation.role)}</span>
            </span>
            <span className="settings-row-meta">
              {invitation.role === "admin"
                ? t.allProducts
                : productNames(products, invitation.productIds)}
            </span>
            <span className="settings-row-meta">
              {t.invitationExpires.replace(
                "{date}",
                dateLabel(invitation.expiresAt, timeZone),
              )}
            </span>
            <div className="settings-row-actions">
              <button
                type="button"
                className="ghost"
                aria-label={`${t.resendInvitation}: ${invitation.email}`}
                onClick={() => void resend(invitation)}
              >
                {t.resendInvitation}
              </button>
              <ConfirmButton
                label={t.revokeInvitation}
                ariaLabel={`${t.revokeInvitation}: ${invitation.email}`}
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
          </li>
        ))}
      </ul>
    </SettingsGroup>
  );
}

export function MemberSettings() {
  const crm = useWorkspaceData();
  const [dialog, setDialog] = useState<"invite" | MemberAccess | null>(null);
  const [revision, setRevision] = useState(0);
  const queryRevision = `${crm.sourceData.asOf}:${revision}`;
  const query = useSettingsQuery<{ members: Member[] }>(
    `/api/crm?operation=members&organizationId=${crm.organizationId}`,
    queryRevision,
  );
  const editable = crm.isAdmin;
  const products = crm.sourceData.products;
  const send: Mutate = (body, announce = true) =>
    crm.send({ organizationId: crm.organizationId, ...body }, announce);
  const members = query.data?.members ?? [];
  const openInvite = () => {
    if (!editable) return false;
    setDialog("invite");
    return true;
  };
  useCreate(openInvite);
  return (
    <SettingsPanel
      section="members"
      actions={
        editable ? (
          <button
            type="button"
            className="primary"
            aria-keyshortcuts="C"
            onClick={openInvite}
          >
            <Users size={14} aria-hidden />
            {t.inviteMember}
          </button>
        ) : undefined
      }
    >
      <SettingsGroup title={t.members} detail={t.membersDetail}>
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
              onEdit={setDialog}
            />
          ))}
        </ul>
        {!editable && <AdminNotice />}
      </SettingsGroup>
      {editable && (
        <Invitations
          products={products}
          send={send}
          notify={(message) => crm.notify(message, "danger")}
          revision={queryRevision}
          organizationId={crm.organizationId}
          timeZone={crm.timeZone}
        />
      )}
      {dialog !== null && (
        <MemberAccessDialog
          key={crm.organizationId}
          {...(dialog === "invite" ? {} : { member: dialog })}
          onClose={() => {
            setDialog(null);
            setRevision((value) => value + 1);
          }}
        />
      )}
    </SettingsPanel>
  );
}
