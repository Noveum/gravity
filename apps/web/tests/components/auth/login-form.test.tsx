import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';

const signInSocial = mock();
const sendVerificationOtp = mock();
const toast = mock();

await restoreModulesAfterThisFile(['@/components/ui/toast.tsx', '@/lib/auth/client.ts']);

mock.module('@/lib/auth/client.ts', () => ({
  authClient: {
    signIn: {
      social: (...args: unknown[]) => signInSocial(...args),
      passkey: mock(),
    },
    emailOtp: {
      sendVerificationOtp: (...args: unknown[]) => sendVerificationOtp(...args),
    },
  },
}));

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast, dismiss: mock() }),
}));

const { LoginForm } = await import('../../../src/components/auth/login-form.tsx');

beforeEach(() => {
  signInSocial.mockReset();
  signInSocial.mockResolvedValue({ error: null });
  sendVerificationOtp.mockReset();
  sendVerificationOtp.mockResolvedValue({ error: null });
  toast.mockReset();
});

describe('LoginForm', () => {
  test('offers the passkey button and the email code path', () => {
    render(<LoginForm providers={[]} />);
    expect(screen.getByRole('button', { name: 'Continue with passkey' })).toBeVisible();
    expect(screen.getByLabelText('Email address')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeVisible();
  });

  test('shows Google and GitHub only when they are configured', () => {
    render(<LoginForm providers={['github']} />);
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
  });

  test('has no provider button when the OIDC slot is empty', () => {
    render(<LoginForm providers={[]} oidcLabel={null} />);
    expect(screen.queryByRole('button', { name: /Continue with (?!passkey)/ })).toBeNull();
  });

  test('labels the OIDC button from the slot and signs in through its provider id', async () => {
    render(<LoginForm providers={[]} oidcLabel="Acme SSO" callbackUrl="/today" />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue with Acme SSO' }));
    await waitFor(() => expect(signInSocial).toHaveBeenCalledTimes(1));
    expect(signInSocial.mock.calls[0]?.[0]).toMatchObject({
      provider: 'gravity-oidc',
      callbackURL: '/today',
    });
  });

  test('asks for the six digit code after sending one', async () => {
    render(<LoginForm providers={[]} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email address'), 'ada@acme.com');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    await waitFor(() => expect(screen.getByLabelText('Sign in code')).toBeVisible());
    expect(sendVerificationOtp.mock.calls[0]?.[0]).toEqual({
      email: 'ada@acme.com',
      type: 'sign-in',
    });
  });
});
