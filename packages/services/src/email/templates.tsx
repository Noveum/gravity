import { Button, Text } from '@react-email/components';
import { render } from '@react-email/render';
import { buttonStyle, cardStyle, Layout, LinkLine, paragraphStyle } from './layout.tsx';

export interface EmailContent {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface SignInCodeProps {
  readonly code: string;
  readonly email: string;
}

export interface ResetPasswordProps {
  readonly url: string;
  readonly email: string;
}

export interface InviteProps {
  readonly workspaceName: string;
  readonly inviterName: string;
  readonly url: string;
}

export async function signInCodeEmail(props: SignInCodeProps): Promise<EmailContent> {
  const subject = 'Your Gravity sign in code';
  const html = await render(
    <Layout
      preview={`${props.code} is your Gravity sign in code`}
      heading="Sign in to Gravity"
      footer={`This code was requested for ${props.email}. It expires in five minutes and can be used once.`}
    >
      <Text style={paragraphStyle}>Enter this code to sign in. No password needed.</Text>
      <Text
        style={{
          ...cardStyle,
          fontSize: '28px',
          fontWeight: 700,
          letterSpacing: '0.2em',
          textAlign: 'center',
        }}
      >
        {props.code}
      </Text>
    </Layout>,
  );
  return {
    subject,
    html,
    text: [
      'Sign in to Gravity',
      '',
      `Use this code to sign in as ${props.email}:`,
      props.code,
      '',
      'The code expires in five minutes and can be used once.',
    ].join('\n'),
  };
}

export async function resetPasswordEmail(props: ResetPasswordProps): Promise<EmailContent> {
  const subject = 'Reset your Gravity password';
  const html = await render(
    <Layout
      preview="Reset your Gravity password"
      heading="Reset your password"
      footer={`This reset was requested for ${props.email}. It expires shortly and can be used once. If you did not ask for it, ignore this email.`}
    >
      <Text style={paragraphStyle}>Click the button below to choose a new password.</Text>
      <Button href={props.url} style={buttonStyle}>
        Reset password
      </Button>
      <LinkLine url={props.url} />
    </Layout>,
  );
  return {
    subject,
    html,
    text: [
      'Reset your Gravity password',
      '',
      `Use this link to reset the password for ${props.email}:`,
      props.url,
      '',
      'The link expires shortly and can be used once. If you did not ask for it, ignore this email.',
    ].join('\n'),
  };
}

export async function inviteEmail(props: InviteProps): Promise<EmailContent> {
  const subject = `${props.inviterName} invited you to ${props.workspaceName} on Gravity`;
  const html = await render(
    <Layout
      preview={subject}
      heading={`Join ${props.workspaceName}`}
      footer="You are receiving this because someone invited you to a Gravity workspace."
    >
      <Text style={paragraphStyle}>
        {props.inviterName} invited you to join {props.workspaceName} on Gravity.
      </Text>
      <Button href={props.url} style={buttonStyle}>
        Accept invitation
      </Button>
      <LinkLine url={props.url} />
    </Layout>,
  );
  return {
    subject,
    html,
    text: [
      `${props.inviterName} invited you to join ${props.workspaceName} on Gravity.`,
      '',
      'Accept the invitation:',
      props.url,
    ].join('\n'),
  };
}
