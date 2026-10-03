import { hashToken } from '@gravity/core';
import { and, db, eq, isNull, schema } from '@gravity/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { GravityMark } from '@/components/brand/gravity-mark.tsx';
import { Button } from '@/components/ui/button.tsx';
import { InviteAccept } from '@/features/settings/invite-accept.tsx';
import { getSession } from '@/lib/auth/session.ts';

export const metadata: Metadata = { title: 'Join a workspace' };

async function loadInvite(token: string) {
  const [row] = await db
    .select({
      email: schema.invitation.email,
      role: schema.invitation.role,
      status: schema.invitation.status,
      expiresAt: schema.invitation.expiresAt,
      workspaceName: schema.organization.name,
      inviterName: schema.user.name,
    })
    .from(schema.invitation)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.invitation.organizationId))
    .innerJoin(schema.user, eq(schema.user.id, schema.invitation.inviterId))
    .where(
      and(
        eq(schema.invitation.tokenHash, hashToken(token)),
        isNull(schema.organization.deletionRequestedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

function Shell({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-5 py-12">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-pop">
        <GravityMark size={28} />
        <h1 className="font-medium text-text-strong text-xl">{title}</h1>
        {children}
      </div>
    </main>
  );
}

function Note({ children }: { readonly children: ReactNode }) {
  return <p className="text-muted text-xs">{children}</p>;
}

export default async function InvitePage({
  params,
}: {
  readonly params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await loadInvite(token);

  if (invite === null) {
    return (
      <Shell title="That invite is not valid">
        <Note>The link may have been mistyped. Ask whoever invited you to send a fresh one.</Note>
      </Shell>
    );
  }

  if (invite.status === 'revoked') {
    return (
      <Shell title="This invite was revoked">
        <Note>
          An admin of {invite.workspaceName} cancelled this invite. Ask them to send a new one.
        </Note>
      </Shell>
    );
  }

  if (invite.status === 'accepted') {
    return (
      <Shell title="This invite was already used">
        <Note>You are already part of {invite.workspaceName}. Sign in to keep going.</Note>
        <Button variant="primary" block asChild>
          <Link href="/today">Open Gravity</Link>
        </Button>
      </Shell>
    );
  }

  if (invite.expiresAt.getTime() < Date.now()) {
    return (
      <Shell title="This invite expired">
        <Note>Invites last 14 days. Ask an admin of {invite.workspaceName} to resend it.</Note>
      </Shell>
    );
  }

  const next = encodeURIComponent(`/invite/${token}`);
  const session = await getSession();

  if (session === null) {
    return (
      <Shell title={`Join ${invite.workspaceName}`}>
        <Note>
          {invite.inviterName} invited <span className="text-text">{invite.email}</span> as a{' '}
          {invite.role}. Sign in with that address and you will land back here.
        </Note>
        <Button variant="primary" block asChild>
          <Link href={`/login?next=${next}`}>Sign in to continue</Link>
        </Button>
      </Shell>
    );
  }

  if (session.user.email.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <Shell title="Wrong account">
        <Note>
          This invite was sent to <span className="text-text">{invite.email}</span>, but you are
          signed in as <span className="text-text">{session.user.email}</span>. Sign in again with
          the invited address.
        </Note>
        <Button variant="secondary" block asChild>
          <Link href={`/login?reauth=1&next=${next}`}>Switch account</Link>
        </Button>
      </Shell>
    );
  }

  if (!session.user.emailVerified) {
    return (
      <Shell title="Verify your email to join">
        <Note>
          Sign in with an emailed code for {invite.email} to confirm this address belongs to you,
          then return to accept the invitation.
        </Note>
        <Button variant="primary" block asChild>
          <Link href={`/login?reauth=1&next=${next}`}>Verify email</Link>
        </Button>
      </Shell>
    );
  }

  return (
    <Shell title={`Join ${invite.workspaceName}`}>
      <Note>
        {invite.inviterName} invited you as a {invite.role}. Accepting adds you to the workspace
        right away.
      </Note>
      <InviteAccept token={token} workspaceName={invite.workspaceName} />
    </Shell>
  );
}
