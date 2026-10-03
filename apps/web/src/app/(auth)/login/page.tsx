import { emailConfigured } from '@gravity/shared/utils';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthErrorNotice } from '@/components/auth/auth-error-notice.tsx';
import { DevSignIn } from '@/components/auth/dev-sign-in.tsx';
import { LoginForm } from '@/components/auth/login-form.tsx';
import { devLoginEnabled } from '@/lib/api/dev-login.ts';
import { listDevUsers } from '@/lib/api/dev-users.ts';
import { authErrorCode } from '@/lib/auth/oauth-error.ts';
import { enabledSocialProviders, oidcProvider, passwordAuthEnabled } from '@/lib/auth/server.ts';
import { getSession } from '@/lib/auth/session.ts';
import { signUpIsOpen } from '@/lib/env.ts';
import { safeCallback } from './continue-url.ts';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const callbackUrl = safeCallback(params['next']);
  const errorCode = authErrorCode(params['error']);
  const session = await getSession();
  if (session !== null && params['reauth'] !== '1') redirect(callbackUrl ?? '/today');

  const devUsers = devLoginEnabled() ? await listDevUsers() : [];

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-5 py-12">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-pop sm:p-7">
        <LoginForm
          providers={enabledSocialProviders}
          oidcLabel={oidcProvider === null ? null : oidcProvider.label}
          passwordEnabled={passwordAuthEnabled}
          emailEnabled={emailConfigured(process.env)}
          openSignUp={signUpIsOpen()}
          {...(callbackUrl === undefined ? {} : { callbackUrl })}
        />
        {devUsers.length > 0 ? (
          <DevSignIn users={devUsers} callbackUrl={callbackUrl ?? '/today'} />
        ) : null}
      </div>
      {errorCode === undefined ? null : <AuthErrorNotice code={errorCode} />}
    </main>
  );
}
