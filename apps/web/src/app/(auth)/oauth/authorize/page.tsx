import { listOrganizationsForUser, pendingMcpConsent, userHasPasskey } from '@gravity/core';
import { isDomainError } from '@gravity/shared/errors';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { GravityMark } from '@/components/brand/gravity-mark.tsx';
import { getSession } from '@/lib/auth/session.ts';
import { ConsentForm } from './consent-form.tsx';

export const metadata: Metadata = { title: 'Connect to Gravity' };
export const dynamic = 'force-dynamic';

function first(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  return Array.isArray(value) ? value[0] : undefined;
}

function ConsentShell({ children }: { readonly children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-pop sm:p-7">
        <div className="mb-5 flex flex-col items-center gap-1.5 text-center">
          <GravityMark size={36} />
          <h1 className="font-medium text-text text-xl">Connect to Gravity</h1>
        </div>
        {children}
      </div>
    </main>
  );
}

function Notice({ children }: { readonly children: ReactNode }) {
  return (
    <ConsentShell>
      <p role="alert" className="text-center text-muted text-sm">
        {children}
      </p>
    </ConsentShell>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const consentCode = first(params['consent_code']);
  if (consentCode === undefined || consentCode.length === 0) {
    return (
      <Notice>
        This authorization link is invalid. Start the connection again from your AI client.
      </Notice>
    );
  }
  const session = await getSession();
  if (session === null) {
    const next = `/oauth/authorize?${new URLSearchParams({ consent_code: consentCode }).toString()}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  let pending: Awaited<ReturnType<typeof pendingMcpConsent>>;
  try {
    pending = await pendingMcpConsent(session.user.id, consentCode);
  } catch (error: unknown) {
    if (isDomainError(error) && error.status < 500) {
      return <Notice>{error.message} Start the connection again from your AI client.</Notice>;
    }
    throw error;
  }
  const [organizations, requirePasskey] = await Promise.all([
    listOrganizationsForUser(session.user.id),
    userHasPasskey(session.user.id),
  ]);
  if (organizations.length === 0) {
    return (
      <Notice>
        You are not a member of any workspace yet, so there is nothing to connect. Create or join a
        workspace first.
      </Notice>
    );
  }
  return (
    <ConsentShell>
      <ConsentForm
        consentCode={consentCode}
        clientName={pending.clientName}
        clientLogo={pending.clientLogo}
        scopes={pending.scopes}
        organizations={organizations.map((entry) => ({
          id: entry.organization.id,
          name: entry.organization.name,
        }))}
        requirePasskey={requirePasskey}
        userEmail={session.user.email}
      />
    </ConsentShell>
  );
}
