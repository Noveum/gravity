import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createUser, createWorkspace, resetDatabase } from '@gravity/core/test-support';
import { db } from '@gravity/db';
import * as emailService from '@gravity/services/email';
import { restoreModulesAfterThisFile, signedInAs } from '../../../../tests-support.ts';

await restoreModulesAfterThisFile(['@gravity/services/email']);

const sendEmail = mock((_database: unknown, _input: Record<string, string>) => Promise.resolve({}));
const inviteEmail = mock((props: { workspaceName: string; inviterName: string; url: string }) =>
  Promise.resolve({
    subject: `Join ${props.workspaceName}`,
    html: `<p>${props.url}</p>`,
    text: props.url,
  }),
);
mock.module('@gravity/services/email', () => ({ ...emailService, sendEmail, inviteEmail }));

const { POST: invite } = await import('@/app/api/invites/route.ts');
const { PATCH: resend } = await import('@/app/api/invites/[id]/route.ts');
const { serverEnv } = await import('@/lib/env.ts');

const saved = {
  key: process.env['RESEND_API_KEY'],
  from: process.env['EMAIL_FROM'],
  dev: process.env['GRAVITY_DEV_LOGIN'],
};

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(async () => {
  await resetDatabase();
  sendEmail.mockClear();
  inviteEmail.mockClear();
  process.env['RESEND_API_KEY'] = 're_test_key';
  process.env['EMAIL_FROM'] = 'Gravity <auth@gravity.test>';
  process.env['GRAVITY_DEV_LOGIN'] = 'true';
});

afterEach(() => {
  restore('RESEND_API_KEY', saved.key);
  restore('EMAIL_FROM', saved.from);
  restore('GRAVITY_DEV_LOGIN', saved.dev);
});

function post(body: unknown): Request {
  return new Request('http://localhost:3300/api/invites', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

interface Created {
  readonly token: string;
  readonly invitation: { id: string; expiresAt: string };
}

function sentInput(call: number): Record<string, string> {
  const input = sendEmail.mock.calls[call]?.[1];
  if (input === undefined) throw new Error(`sendEmail call ${call} missing`);
  return input;
}

describe('invite email delivery', () => {
  test('a single invite sends the accept url and an idempotency key tied to the expiry', async () => {
    const workspace = await createWorkspace();
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const created = (await (
      await invite(post({ email: 'one@gravity.test', role: 'member' }))
    ).json()) as Created;

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]?.[0]).toBe(db);
    const input = sentInput(0);
    expect(input['to']).toBe('one@gravity.test');
    expect(input['template']).toBe('invite');
    expect(input['text']).toContain(`${serverEnv().NEXT_PUBLIC_APP_URL}/invite/${created.token}`);
    expect(input['text']).not.toContain(created.invitation.id);
    expect(inviteEmail).toHaveBeenCalledWith({
      workspaceName: 'Acme',
      inviterName: workspace.adminUser.name,
      url: `${serverEnv().NEXT_PUBLIC_APP_URL}/invite/${created.token}`,
    });
    expect(input['idempotencyKey']).toBe(
      `invite:${created.invitation.id}:${new Date(created.invitation.expiresAt).toISOString()}`,
    );
  });

  test('a bulk invite sends one email per address with its own token and key', async () => {
    const workspace = await createWorkspace();
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const response = await invite(
      post({ invites: [{ email: 'a@gravity.test' }, { email: 'b@gravity.test' }] }),
    );
    const { invites } = (await response.json()) as { invites: Created[] };

    expect(sendEmail).toHaveBeenCalledTimes(2);
    const first = sentInput(0);
    const second = sentInput(1);
    expect([first['to'], second['to']]).toEqual(['a@gravity.test', 'b@gravity.test']);
    invites.forEach((entry, index) => {
      const input = sentInput(index);
      expect(input['text']).toContain(`${serverEnv().NEXT_PUBLIC_APP_URL}/invite/${entry.token}`);
      expect(input['idempotencyKey']).toBe(
        `invite:${entry.invitation.id}:${new Date(entry.invitation.expiresAt).toISOString()}`,
      );
    });
    expect(first['idempotencyKey']).not.toBe(second['idempotencyKey']);
  });

  test('a resend sends a fresh token and a new idempotency key for the extended expiry', async () => {
    const workspace = await createWorkspace();
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const created = (await (await invite(post({ email: 'again@gravity.test' }))).json()) as Created;
    sendEmail.mockClear();

    const response = await resend(new Request('http://localhost:3300/x', { method: 'PATCH' }), {
      params: Promise.resolve({ id: created.invitation.id }),
    });
    const resent = (await response.json()) as Created;

    expect(response.status).toBe(200);
    expect(resent.token).not.toBe(created.token);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const input = sentInput(0);
    expect(input['to']).toBe('again@gravity.test');
    expect(input['text']).toContain(`${serverEnv().NEXT_PUBLIC_APP_URL}/invite/${resent.token}`);
    expect(input['text']).not.toContain(created.token);
    expect(input['idempotencyKey']).toBe(
      `invite:${created.invitation.id}:${new Date(resent.invitation.expiresAt).toISOString()}`,
    );
  });

  test('sends nothing in dev mode when email is not configured', async () => {
    process.env['RESEND_API_KEY'] = '';
    const workspace = await createWorkspace();
    await signedInAs(workspace.adminUser.id, workspace.organizationId);
    const invitee = await createUser('Aditi');
    const response = await invite(post({ email: invitee.email }));
    expect(response.status).toBe(200);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
