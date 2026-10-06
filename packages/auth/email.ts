import { createHash } from "node:crypto";
import { APIError } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { z } from "zod";
import t from "../i18n/translations/en.json";
import { emailSender } from "./config";
export async function sendSignInCode({
  email,
  otp,
}: {
  email: string;
  otp: string;
}) {
  const from = emailSender();
  const key = process.env.RESEND_API_KEY;
  if (
    !from ||
    !key ||
    !/^\d{6}$/.test(otp) ||
    !z.email().safeParse(email).success
  )
    throw new APIError("SERVICE_UNAVAILABLE", {
      code: "EMAIL_DELIVERY_UNAVAILABLE",
      message: t.errors.EMAIL_DELIVERY_UNAVAILABLE,
    });
  try {
    await postEmail(
      key,
      `gravity-login-${createHash("sha256").update(`${email}:${otp}`).digest("hex")}`,
      {
        from,
        to: [email],
        subject: t.emailOtpSubject,
        text: t.emailOtpBody.replace("{code}", otp),
      },
    );
  } catch (error) {
    // Provider bodies and exceptions can contain recipients or credentials.
    console.error(
      JSON.stringify({
        event: "gravity.auth_email",
        status: "failed",
        providerStatus: error instanceof EmailRejected ? error.status : 0,
      }),
    );
    throw new APIError("SERVICE_UNAVAILABLE", {
      code: "EMAIL_DELIVERY_UNAVAILABLE",
      message: t.errors.EMAIL_DELIVERY_UNAVAILABLE,
    });
  }
  console.info(
    JSON.stringify({ event: "gravity.auth_email", status: "accepted" }),
  );
}
class EmailRejected extends Error {
  constructor(public status: number) {
    super("EMAIL_REJECTED");
  }
}
async function postEmail(
  key: string,
  idempotencyKey: string,
  message: { from: string; to: string[]; subject: string; text: string },
) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new EmailRejected(response.status);
}
export type InvitationEmailStatus = "sent" | "not_configured" | "failed";
export async function sendInvitationEmail(invitation: {
  id: string;
  email: string;
  workspace: string;
  link: string;
  expiresAt: Date;
}): Promise<InvitationEmailStatus> {
  const from = emailSender();
  const key = process.env.RESEND_API_KEY?.trim();
  if (!from || !key) return "not_configured";
  try {
    await postEmail(
      key,
      `gravity-invitation-${createHash("sha256").update(`${invitation.id}:${invitation.link}`).digest("hex")}`,
      {
        from,
        to: [invitation.email],
        subject: t.inviteEmailSubject.replace(
          "{workspace}",
          invitation.workspace,
        ),
        text: t.inviteEmailBody
          .replaceAll("{workspace}", invitation.workspace)
          .replace("{link}", invitation.link)
          .replace("{expires}", invitation.expiresAt.toUTCString()),
      },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "gravity.invitation_email",
        status: "failed",
        providerStatus: error instanceof EmailRejected ? error.status : 0,
      }),
    );
    return "failed";
  }
  console.info(
    JSON.stringify({ event: "gravity.invitation_email", status: "accepted" }),
  );
  return "sent";
}
export function emailSignInPlugin() {
  return emailOTP({
    otpLength: 6,
    expiresIn: 300,
    allowedAttempts: 3,
    storeOTP: "hashed",
    rateLimit: { window: 60, max: 5 },
    async sendVerificationOTP({ email, otp, type }) {
      if (type !== "sign-in")
        throw new APIError("BAD_REQUEST", {
          code: "INVALID_INPUT",
          message: t.errors.INVALID_INPUT,
        });
      // Await delivery acceptance so serverless execution cannot drop the send.
      await sendSignInCode({ email, otp });
    },
  });
}
