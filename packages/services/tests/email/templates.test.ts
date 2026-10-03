import { describe, expect, test } from 'bun:test';
import { inviteEmail, resetPasswordEmail, signInCodeEmail } from '../../src/email/index.ts';

describe('email templates', () => {
  test('the sign-in code email shows the code and names Gravity', async () => {
    const content = await signInCodeEmail({ code: '482913', email: 'ada@acme.com' });
    expect(content.text).toContain('482913');
    expect(content.html).toContain('482913');
    expect(content.subject).toContain('Gravity');
  });

  test('the invite email carries the accept url and the workspace', async () => {
    const content = await inviteEmail({
      workspaceName: 'Acme',
      inviterName: 'Ada',
      url: 'http://localhost:3300/invite/abc',
    });
    expect(content.html).toContain('http://localhost:3300/invite/abc');
    expect(content.text).toContain('http://localhost:3300/invite/abc');
    expect(content.subject).toBe('Ada invited you to Acme on Gravity');
  });

  test('the reset password email carries the url', async () => {
    const content = await resetPasswordEmail({
      url: 'http://localhost:3300/reset-password/tok',
      email: 'ada@acme.com',
    });
    expect(content.html).toContain('http://localhost:3300/reset-password/tok');
    expect(content.subject).toContain('Gravity');
  });
});
