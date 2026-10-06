"use client";
import t from "@crm/i18n/translations/en.json";
import { Building2, Plus, Settings2, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { dateLabel, errorText, label, requestJson } from "../client-api";
import { useCreate, useWorkspaceData } from "../crm/crm-context";
import { type MemberAccess, MemberAccessDialog } from "../member-access-dialog";
import { Preferences } from "../preferences";
import { ProductDialog } from "../product-dialog";
import { SettingsForm } from "../settings-form";
import { initials } from "../shell/workspace-menu";

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

export function SettingsView() {
  const crm = useWorkspaceData();
  const [dialog, setDialog] = useState<
    "invite" | "product" | MemberAccess | null
  >(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [revoking, setRevoking] = useState("");
  const revokingRef = useRef(false);
  const data = crm.sourceData;
  const openInvite = () => {
    if (!crm.isAdmin) return false;
    setDialog("invite");
    return true;
  };
  useCreate(openInvite);
  useEffect(() => {
    if (!crm.isAdmin) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    requestJson<unknown>(
      `/api/crm?operation=invitations&organizationId=${crm.organizationId}&revision=${revision}&asOf=${encodeURIComponent(data.asOf)}`,
    )
      .then((value) => {
        const parsed = invitationList.parse(value);
        if (active) setInvitations(parsed);
      })
      .catch((error: unknown) => {
        if (active) setError(errorText(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [crm.organizationId, crm.isAdmin, revision, data.asOf]);
  const closeDialog = () => {
    setDialog(null);
    setRevision((value) => value + 1);
  };
  const productNames = (ids: string[]) =>
    ids
      .map((id) => data.products.find((product) => product.id === id)?.name)
      .filter(Boolean)
      .join(", ");
  return (
    <div className="page-content organization-settings">
      <header className="settings-heading">
        <div>
          <span className="eyebrow">{t.settings}</span>
          <h2>{crm.currentOrg?.name ?? t.workspace}</h2>
          <p className="muted">{t.organizationSettingsDetail}</p>
        </div>
        {crm.isAdmin && (
          <button type="button" className="primary" onClick={openInvite}>
            <Users size={15} aria-hidden />
            {t.inviteMember}
          </button>
        )}
      </header>
      <nav className="settings-jump-links" aria-label={t.settingsSections}>
        <a href="#settings-members">
          <Users size={14} aria-hidden />
          {t.members}
        </a>
        <a href="#settings-organization">
          <Building2 size={14} aria-hidden />
          {t.organizationDetails}
        </a>
        <a href="#settings-products">{t.products}</a>
        <a href="#settings-preferences">
          <Settings2 size={14} aria-hidden />
          {t.preferences}
        </a>
      </nav>
      <section
        className="settings-card"
        id="settings-members"
        aria-labelledby="settings-members-title"
      >
        <header className="settings-card-heading">
          <div>
            <h3 id="settings-members-title">
              {t.members} <span className="badge">{data.members.length}</span>
            </h3>
            <p className="muted">{t.membersDetail}</p>
          </div>
        </header>
        {!crm.isAdmin && <p className="callout">{t.membersAdminOnly}</p>}
        <ul className="settings-list">
          {data.members.map((member) => (
            <li className="settings-member-row" key={member.id}>
              <span className="avatar" aria-hidden>
                {initials(member.name)}
              </span>
              <div className="settings-member-identity">
                <strong>
                  {member.name}
                  {member.id === crm.userId && (
                    <span className="muted"> {t.you}</span>
                  )}
                </strong>
                <span className="muted">{member.email}</span>
              </div>
              <div className="settings-member-access">
                <span className="badge">{label(member.role)}</span>
                <small className="muted">
                  {member.role === "admin"
                    ? t.allProducts
                    : productNames(member.productIds) || t.noProductAccess}
                </small>
              </div>
              {crm.isAdmin && (
                <button
                  type="button"
                  className="ghost"
                  aria-label={`${t.editMemberAccess}: ${member.name}`}
                  onClick={() => setDialog(member)}
                >
                  {t.editAccess}
                </button>
              )}
            </li>
          ))}
        </ul>
        {crm.isAdmin && (
          <div className="settings-pending">
            <h4>{t.pendingInvitations}</h4>
            {error ? (
              <div role="alert" className="settings-error">
                <p>{error}</p>
                <button
                  type="button"
                  onClick={() => setRevision((value) => value + 1)}
                >
                  {t.retry}
                </button>
              </div>
            ) : loading ? (
              <p role="status" className="muted">
                {t.loading}
              </p>
            ) : invitations.length === 0 ? (
              <p className="muted">{t.noPendingInvitations}</p>
            ) : (
              <ul className="settings-list">
                {invitations.map((invitation) => (
                  <li className="settings-member-row" key={invitation.id}>
                    <div className="settings-member-identity">
                      <strong>{invitation.email}</strong>
                      <small className="muted">
                        {t.invitationExpires.replace(
                          "{date}",
                          dateLabel(invitation.expiresAt, crm.timeZone),
                        )}
                      </small>
                    </div>
                    <div className="settings-member-access">
                      <span className="badge">{label(invitation.role)}</span>
                      <small className="muted">
                        {invitation.role === "admin"
                          ? t.allProducts
                          : productNames(invitation.productIds)}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="ghost"
                      disabled={!!revoking}
                      aria-label={`${t.revokeInvitation}: ${invitation.email}`}
                      onClick={async () => {
                        if (revokingRef.current) return;
                        revokingRef.current = true;
                        setRevoking(invitation.id);
                        try {
                          if (
                            await crm.mutate({
                              operation: "invitation-revoke",
                              organizationId: crm.organizationId,
                              invitationId: invitation.id,
                            })
                          )
                            setRevision((value) => value + 1);
                        } finally {
                          revokingRef.current = false;
                          setRevoking("");
                        }
                      }}
                    >
                      {t.revokeInvitation}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
      <section
        className="settings-card"
        id="settings-organization"
        aria-labelledby="settings-organization-title"
      >
        <header className="settings-card-heading">
          <div>
            <h3 id="settings-organization-title">{t.organizationDetails}</h3>
            <p className="muted">{t.organizationIsolation}</p>
          </div>
        </header>
        {crm.currentOrg && (
          <SettingsForm
            key={`${crm.organizationId}:${crm.currentOrg.name}:${crm.currentOrg.timezone}`}
            organization={crm.currentOrg}
            disabled={!crm.isAdmin}
            mutate={crm.mutate}
            onOrganizations={crm.reloadOrganizations}
          />
        )}
      </section>
      <section
        className="settings-card"
        id="settings-products"
        aria-labelledby="settings-products-title"
      >
        <header className="settings-card-heading">
          <div>
            <h3 id="settings-products-title">
              {t.products} <span className="badge">{data.products.length}</span>
            </h3>
            <p className="muted">{t.settingsProductsDetail}</p>
          </div>
          {crm.isAdmin && (
            <button
              type="button"
              className="secondary"
              onClick={() => setDialog("product")}
            >
              <Plus size={14} aria-hidden />
              {t.newProduct}
            </button>
          )}
        </header>
        <ul className="settings-list">
          {data.products.map((product) => {
            const count = data.members.filter(
              (member) =>
                member.role === "admin" ||
                member.productIds.includes(product.id),
            ).length;
            return (
              <li className="setting-row" key={product.id}>
                <span
                  className="product-dot"
                  style={{ background: product.color }}
                  aria-hidden
                />
                <strong>{product.name}</strong>
                <span className="muted settings-product-count">
                  {(count === 1
                    ? t.productMemberCountOne
                    : t.productMemberCount
                  ).replace("{count}", String(count))}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <section
        className="settings-card"
        id="settings-preferences"
        aria-labelledby="settings-preferences-title"
      >
        <header className="settings-card-heading">
          <div>
            <h3 id="settings-preferences-title">{t.preferences}</h3>
            <p className="muted">{t.preferencesDetail}</p>
          </div>
        </header>
        <Preferences labelled />
        <p className="muted density-detail">{t.densityDetail}</p>
      </section>
      {dialog === "product" && (
        <ProductDialog
          organizationId={crm.organizationId}
          organizationName={crm.currentOrg?.name ?? t.workspace}
          mutate={crm.mutate}
          onClose={closeDialog}
        />
      )}
      {dialog !== null && dialog !== "product" && (
        <MemberAccessDialog
          key={crm.organizationId}
          {...(dialog === "invite" ? {} : { member: dialog })}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}
