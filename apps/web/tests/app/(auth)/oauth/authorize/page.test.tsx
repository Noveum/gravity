import { beforeEach, describe, expect, test } from 'bun:test';
import {
  addMember,
  createUser,
  createWorkspace,
  insertMcpClient,
  insertMcpConsentRequest,
  resetDatabase,
  type TestWorkspace,
} from '@gravity/core/test-support';
import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import AuthorizePage from '@/app/(auth)/oauth/authorize/page.tsx';
import { signedInAs, signedOut } from '../../../../../tests-support.ts';
import { renderWithClient } from '../../../../support/render.tsx';

const CALLBACK = 'https://agent.example.com:8443/oauth/callback';

let workspace: TestWorkspace;
let clientId: string;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Consent');
  clientId = await insertMcpClient(workspace.adminUser.id, {
    name: 'Desk agent',
    redirectUrl: CALLBACK,
  });
});

function consentCodeFor(userId: string): Promise<string> {
  return insertMcpConsentRequest({
    clientId,
    userId,
    scope: ['openid', 'gravity.read'],
    redirectUri: CALLBACK,
  });
}

function open(params: Record<string, string>): Promise<ReactElement> {
  return AuthorizePage({ searchParams: Promise.resolve(params) });
}

async function redirectOf(attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt;
  } catch (error: unknown) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) {
      return digest.split(';')[2] ?? '';
    }
    throw error;
  }
  throw new Error('Expected the page to redirect.');
}

describe('/oauth/authorize', () => {
  test('a missing or empty consent code is named as an invalid link', async () => {
    signedOut();
    for (const params of [{}, { consent_code: '' }]) {
      const { unmount } = renderWithClient(await open(params), { bootstrap: null });
      expect(screen.getByRole('alert')).toHaveTextContent('This authorization link is invalid.');
      unmount();
    }
  });

  test('a signed out visitor is sent to sign in and back to this request', async () => {
    signedOut();
    const location = await redirectOf(open({ consent_code: 'abc123' }));
    const url = new URL(location, 'http://localhost:3300');
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('next')).toBe('/oauth/authorize?consent_code=abc123');
  });

  test('a request opened by another account is shown as a notice, not a form', async () => {
    const other = await addMember(workspace, 'Olga Other', 'member');
    const code = await consentCodeFor(other.userId);
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    renderWithClient(await open({ consent_code: code }), { bootstrap: null });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This authorization request belongs to another account.',
    );
    expect(screen.queryByLabelText('Workspace')).toBeNull();
  });

  test('shows the redirect host the client cannot disguise', async () => {
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const code = await consentCodeFor(workspace.adminUser.id);
    renderWithClient(await open({ consent_code: code }), { bootstrap: null });
    expect(screen.getByText('agent.example.com:8443')).toBeInTheDocument();
    expect(screen.getByLabelText('Workspace')).toBeInTheDocument();
  });

  test('a guest is offered read only, with the reason', async () => {
    const guest = await addMember(workspace, 'Gus Guest', 'guest');
    await signedInAs(guest.userId, workspace.organizationId);
    const code = await insertMcpConsentRequest({
      clientId,
      userId: guest.userId,
      scope: ['openid', 'gravity.read', 'gravity.write'],
      redirectUri: CALLBACK,
    });
    renderWithClient(await open({ consent_code: code }), { bootstrap: null });
    expect(screen.getByText(/Read people, companies, leads/)).toBeInTheDocument();
    expect(screen.queryByText(/Create and update records/)).toBeNull();
    expect(screen.getByText(/Your role can only read in Consent/)).toBeInTheDocument();
  });

  test('a user with no workspace is told so and may still deny', async () => {
    const loner = await createUser('Lone Ranger');
    await signedInAs(loner.id);
    const code = await consentCodeFor(loner.id);
    renderWithClient(await open({ consent_code: code }), { bootstrap: null });
    expect(screen.getByRole('alert')).toHaveTextContent('You are not a member of any workspace');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'so Desk agent stops waiting. That name is provided by the app and not verified by Gravity.',
    );
    expect(screen.getByRole('button', { name: /Deny/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Workspace')).toBeNull();
  });
});
