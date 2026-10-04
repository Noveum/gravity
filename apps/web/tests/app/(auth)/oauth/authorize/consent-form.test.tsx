import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { serveJson } from '../../../../support/fetch.ts';
import { renderWithClient } from '../../../../support/render.tsx';

interface PasskeyResult {
  readonly data: unknown;
  readonly error: { readonly message?: string } | null;
}

const passkey = mock((): Promise<PasskeyResult> => Promise.resolve({ data: {}, error: null }));
const realClient = await import('@/lib/auth/client.ts');
mock.module('@/lib/auth/client.ts', () => ({
  ...realClient,
  authClient: { signIn: { passkey } },
}));
const { ConsentForm } = await import('@/app/(auth)/oauth/authorize/consent-form.tsx');

const assign = mock();

beforeEach(() => {
  passkey.mockClear();
  assign.mockClear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign },
  });
});

afterEach(() => {
  mock.module('@/lib/auth/client.ts', () => realClient);
});

function renderForm(
  scopes: readonly string[] = ['openid', 'gravity.read', 'gravity.approve'],
  clientLogo: string | null = null,
) {
  return renderWithClient(
    <ConsentForm
      consentCode="code-1"
      clientName="Desk agent"
      clientLogo={clientLogo}
      scopes={scopes}
      organizations={[
        { id: 'o1', name: 'Acme' },
        { id: 'o2', name: 'Bravo' },
      ]}
      requirePasskey={false}
      userEmail="ada@acme.test"
    />,
    { bootstrap: null },
  );
}

describe('ConsentForm', () => {
  test('focuses the workspace picker and lists what the client may do', () => {
    renderForm();
    expect(screen.getByLabelText('Workspace')).toHaveFocus();
    expect(screen.getByText(/Read people, companies, leads/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Approve outbound messages/ })).not.toBeChecked();
  });

  test('Cmd+Enter approves the chosen workspace without approval rights', async () => {
    const sent = serveJson(() => ({ body: { redirectUri: 'http://127.0.0.1:9000/cb?code=x' } }));
    renderForm();
    fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'o2' } });
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://127.0.0.1:9000/cb?code=x'));
    expect(sent[0]?.body).toEqual({
      decision: 'allow',
      consentCode: 'code-1',
      organizationId: 'o2',
      allowApproval: false,
    });
  });

  test('ticking approval sends it and a passkey step-up retries after verifying', async () => {
    let calls = 0;
    const sent = serveJson(() => {
      calls += 1;
      return calls === 1
        ? { body: { status: 'passkey_required' } }
        : { body: { redirectUri: 'http://127.0.0.1:9000/cb?code=y' } };
    });
    renderForm();
    await userEvent.click(screen.getByRole('checkbox', { name: /Approve outbound messages/ }));
    await userEvent.click(screen.getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://127.0.0.1:9000/cb?code=y'));
    expect(passkey).toHaveBeenCalledTimes(1);
    expect(sent.map((entry) => (entry.body as { allowApproval: boolean }).allowApproval)).toEqual([
      true,
      true,
    ]);
  });

  test('a passkey that does not verify stays on the page and says so', async () => {
    passkey.mockImplementationOnce(() =>
      Promise.resolve({ data: {}, error: { message: 'The passkey prompt was dismissed.' } }),
    );
    serveJson(() => ({ body: { status: 'passkey_required' } }));
    renderForm(['openid', 'gravity.read']);
    await userEvent.click(screen.getByRole('button', { name: /Approve/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The passkey prompt was dismissed.');
    expect(assign).not.toHaveBeenCalled();
  });

  test('Deny returns to the client with its refusal', async () => {
    const sent = serveJson(() => ({
      body: { redirectUri: 'http://127.0.0.1:9000/cb?error=access_denied' },
    }));
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('http://127.0.0.1:9000/cb?error=access_denied'),
    );
    expect(sent[0]?.body).toMatchObject({ decision: 'deny' });
  });

  test('names the failure inline when the server refuses', async () => {
    serveJson(() => ({
      status: 401,
      body: {
        error: 'unauthorized',
        message: 'This authorization request is invalid or has expired.',
      },
    }));
    renderForm(['openid', 'gravity.read']);
    await userEvent.click(screen.getByRole('button', { name: /Approve/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This authorization request is invalid or has expired.',
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  test('never navigates to a script redirect and stays on the page', async () => {
    serveJson(() => ({ body: { redirectUri: 'javascript:alert(document.cookie)' } }));
    renderForm(['openid', 'gravity.read']);
    await userEvent.click(screen.getByRole('button', { name: /Approve/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/unsafe address/);
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Workspace')).toBeInTheDocument();
  });

  test('shows the client logo without a referrer and falls back to its initial', () => {
    renderForm(['openid', 'gravity.read'], 'https://agent.example.com/logo.png');
    const logo = screen.getByTestId('client-logo');
    expect(logo).toHaveAttribute('src', 'https://agent.example.com/logo.png');
    expect(logo).toHaveAttribute('referrerpolicy', 'no-referrer');
    fireEvent.error(logo);
    expect(screen.queryByTestId('client-logo')).toBeNull();
    expect(screen.getByText('D')).toBeInTheDocument();
  });
});
