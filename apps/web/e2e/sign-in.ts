import type { BrowserContext, Page } from '@playwright/test';
import { BASE } from './base-url.ts';

export async function signIn(context: BrowserContext, email: string): Promise<Page> {
  await signInSession(context, email);
  return await context.newPage();
}

export async function signInSession(context: BrowserContext, email: string): Promise<void> {
  const response = await context.request.post(`${BASE}/api/dev/sign-in`, { data: { email } });
  if (!response.ok()) {
    throw new Error(
      `Dev sign-in for ${email} failed with ${response.status()}: ${await response.text()}. ` +
        'Check that the web server on BASE is running in development and that ' +
        'ALLOWED_EMAIL_DOMAINS in its environment admits this address.',
    );
  }
}
