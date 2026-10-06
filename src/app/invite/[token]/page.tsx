import { currentPrincipal } from "@crm/auth/server";
import { InvitationService } from "@crm/core/invitations";
import { DomainError, type Principal } from "@crm/core/policy";
import { getDatabase } from "@crm/database/client";
import t from "@crm/i18n/translations/en.json";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { AuthLayout } from "@/components/auth-forms";
import {
  InviteAcceptance,
  workspaceEntryPath,
} from "@/components/invite-acceptance";
import { invitePath, requestPathHeader, signInPath } from "@/components/routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = {
  title: `${t.invitePageTitle} · ${t.brand}`,
  robots: { index: false, follow: false },
};
const signedOutCodes = ["UNAUTHORIZED", "AUTH_UNAVAILABLE"];
function errorMessage(code: string) {
  return t.errors[code as keyof typeof t.errors] ?? t.errors.NOT_FOUND;
}
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const request = await headers();
  let principal: Principal;
  try {
    principal = await currentPrincipal(request);
  } catch (error) {
    if (error instanceof DomainError && signedOutCodes.includes(error.code))
      return (
        <AuthLayout
          title={t.inviteSignInTitle}
          description={t.inviteSignInDescription}
        >
          <a
            className="auth-link auth-submit"
            href={signInPath(
              request.get(requestPathHeader) ?? invitePath(token),
            )}
          >
            {t.inviteSignIn}
          </a>
        </AuthLayout>
      );
    throw error;
  }
  try {
    const invitation = await new InvitationService(await getDatabase()).preview(
      principal,
      token,
    );
    const workspace = invitation.organizationName;
    return (
      <AuthLayout
        title={t.inviteTitle.replace("{workspace}", workspace)}
        description={t.inviteDescription
          .replace("{workspace}", workspace)
          .replace(
            "{role}",
            invitation.role === "admin"
              ? t.inviteRoleAdmin
              : t.inviteRoleMember,
          )}
      >
        <InviteAcceptance token={token} organizationName={workspace} />
      </AuthLayout>
    );
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    const joinedId = error.details?.organizationId;
    const joinedName = error.details?.organizationName;
    if (
      error.code === "ALREADY_MEMBER" &&
      typeof joinedId === "string" &&
      typeof joinedName === "string"
    )
      return (
        <AuthLayout
          title={t.inviteAlreadyMemberTitle.replace("{workspace}", joinedName)}
          description={t.inviteAlreadyMemberDescription}
        >
          <a
            className="auth-link auth-submit"
            href={workspaceEntryPath(joinedId)}
          >
            {t.inviteOpenWorkspace.replace("{workspace}", joinedName)}
          </a>
        </AuthLayout>
      );
    return (
      <AuthLayout
        title={t.inviteUnavailableTitle}
        description={errorMessage(error.code)}
      >
        <a className="auth-link auth-provider" href="/">
          {t.brand}
        </a>
      </AuthLayout>
    );
  }
}
