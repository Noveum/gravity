import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { serveJson } from '../../../../support/fetch.ts';
import { renderWithClient } from '../../../../support/render.tsx';

interface PasskeyResult {
  readonly data: unknown;
  readonly error: { readonly message?: string } | null;
}

const passkey = mock(
  (): Promise<PasskeyResult> =>
    Promise.resolve({ data: { user: { email: 'Ada@acme.test' } }, error: null }),
);
const realClient = await import('@/lib/auth/client.ts');
mock.module('@/lib/auth/client.ts', () => ({
  ...realClient,
  authClient: { signIn: { passkey } },
}));
const { ConsentForm, DenyConnection } = await import(
  '@/app/(auth)/oauth/authorize/consent-form.tsx'
);

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
      redirectHost="127.0.0.1:9000"
      scopes={scopes}
      organizations={[
        { id: 'o1', name: 'Acme', role: 'admin' },
        { id: 'o2', name: 'Bravo', role: 'guest' },
      ]}
      requirePasskey={false}
      userEmail="ada@acme.test"
    />,
    { bootstrap: null },
  );
}

describe('ConsentForm scopes by role', () => {
  test('a workspace where the role can only read never offers write, and says why', () => {
    renderForm(['openid', 'gravity.read', 'gravity.write']);
    expect(screen.getByText(/Create and update records/)).toBeInTheDocument();
    expect(screen.queryByText(/can only read in Acme/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'o2' } });
    expect(screen.queryByText(/Create and update records/)).not.toBeInTheDocument();
    expect(screen.getByText(/Read people, companies, leads/)).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your role can only read in Bravo, so this client will not be able to create or update records there.',
      ),
    ).toBeInTheDocument();
  });
});

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

  test('names where the client sends you back and that its name and logo are unverified', () => {
    renderForm();
    expect(screen.getByText('127.0.0.1:9000')).toBeInTheDocument();
    expect(screen.getByText(/Gravity will send you back to/)).toBeInTheDocument();
    expect(screen.getByText(/provided by the app and not verified by Gravity/)).toBeInTheDocument();
  });

  test('a passkey of another account stops the approval without retrying', async () => {
    passkey.mockImplementationOnce(() =>
      Promise.resolve({ data: { user: { email: 'bob@acme.test' } }, error: null }),
    );
    const sent = serveJson(() => ({ body: { status: 'passkey_required' } }));
    renderForm(['openid', 'gravity.read']);
    await userEvent.click(screen.getByRole('button', { name: /Approve/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That passkey belongs to another account. Sign in as ada@acme.test to continue.',
    );
    expect(sent).toHaveLength(1);
    expect(assign).not.toHaveBeenCalled();
  });

  test('Deny reports that it is busy while the denial is in flight', async () => {
    let answer = (_response: Response): void => undefined;
    globalThis.fetch = mock(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    ) as unknown as typeof fetch;
    renderForm();
    const deny = screen.getByRole('button', { name: 'Deny' });
    expect(deny).toHaveAttribute('aria-busy', 'false');
    await userEvent.click(deny);
    expect(deny).toHaveAttribute('aria-busy', 'true');
    expect(deny).not.toBeDisabled();
    answer(Response.json({ redirectUri: 'http://127.0.0.1:9000/cb?error=access_denied' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('http://127.0.0.1:9000/cb?error=access_denied'),
    );
  });
});

describe('DenyConnection', () => {
  test('sends a denial without a workspace and returns to the client', async () => {
    const sent = serveJson(() => ({
      body: { redirectUri: 'http://127.0.0.1:9000/cb?error=access_denied' },
    }));
    renderWithClient(<DenyConnection consentCode="code-1" />, { bootstrap: null });
    await userEvent.click(screen.getByRole('button', { name: /Deny/ }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('http://127.0.0.1:9000/cb?error=access_denied'),
    );
    expect(sent[0]?.body).toEqual({ decision: 'deny', consentCode: 'code-1' });
  });

  test('never follows an unsafe redirect', async () => {
    serveJson(() => ({ body: { redirectUri: 'javascript:alert(1)' } }));
    renderWithClient(<DenyConnection consentCode="code-1" />, { bootstrap: null });
    await userEvent.click(screen.getByRole('button', { name: /Deny/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/unsafe address/);
    expect(assign).not.toHaveBeenCalled();
  });
});
