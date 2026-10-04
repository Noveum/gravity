import {
  finalizeMcpConsent,
  listOrganizationsForUser,
  passkeyVerifiedWithin,
  userHasPasskey,
} from '@gravity/core';
import { toDomainError } from '@gravity/shared/errors';
import { z } from 'zod';
import { readJson } from '@/lib/api/handler.ts';
import { getSession } from '@/lib/auth/session.ts';
import { publicAppUrl } from '@/lib/env.ts';
import { FRESH_SESSION_WINDOW_MS, PASSKEY_STEP_UP_WINDOW_MS, signedInWithin } from '../step-up.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const decisionSchema = z.object({
  decision: z.enum(['allow', 'deny']),
  consentCode: z.string().min(1).max(200),
  organizationId: z.string().min(1).max(64),
  allowApproval: z.boolean().default(false),
});

const RESTART = 'Start the connection again from your AI client.';

async function needsPasskeyStepUp(userId: string, sessionCreatedAt: Date): Promise<boolean> {
  if (signedInWithin(sessionCreatedAt, FRESH_SESSION_WINDOW_MS)) return false;
  if (!(await userHasPasskey(userId))) return false;
  return !(await passkeyVerifiedWithin(userId, PASSKEY_STEP_UP_WINDOW_MS));
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== publicAppUrl()) {
    return Response.json(
      {
        error: 'invalid_origin',
        message: `This request did not come from Gravity's consent page. ${RESTART}`,
      },
      { status: 403 },
    );
  }
  const session = await getSession();
  if (session === null) {
    return Response.json(
      {
        error: 'unauthorized',
        message:
          'Your session has ended. Sign in, then start the connection again from your AI client.',
      },
      { status: 401 },
    );
  }
  try {
    const parsed = decisionSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return Response.json(
        { error: 'invalid_request', message: `The decision was incomplete. ${RESTART}` },
        { status: 400 },
      );
    }
    const { decision, consentCode, organizationId, allowApproval } = parsed.data;
    const userId = session.user.id;
    if (decision === 'deny') {
      const denied = await finalizeMcpConsent({ userId, consentCode, accept: false });
      return Response.json({ redirectUri: denied.redirectUri });
    }
    if (await needsPasskeyStepUp(userId, session.session.createdAt)) {
      return Response.json({ status: 'passkey_required' });
    }
    const organizations = await listOrganizationsForUser(userId);
    if (!organizations.some((entry) => entry.organization.id === organizationId)) {
      return Response.json(
        { error: 'invalid_workspace', message: 'Choose a workspace you belong to.' },
        { status: 400 },
      );
    }
    const approved = await finalizeMcpConsent({
      userId,
      consentCode,
      accept: true,
      organizationId,
      allowApproval,
    });
    return Response.json({ redirectUri: approved.redirectUri });
  } catch (error: unknown) {
    const domain = toDomainError(error);
    if (domain.status >= 500) console.error('The MCP consent decision failed.', error);
    const message =
      domain.status >= 500 ? `Gravity could not save the connection. ${RESTART}` : domain.message;
    return Response.json({ error: domain.code, message }, { status: domain.status });
  }
}
