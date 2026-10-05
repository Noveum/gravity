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
  let status = 0;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `gravity-login-${createHash("sha256").update(`${email}:${otp}`).digest("hex")}`,
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: t.emailOtpSubject,
        text: t.emailOtpBody.replace("{code}", otp),
      }),
      signal: AbortSignal.timeout(10000),
    });
    status = response.status;
    if (!response.ok) throw new Error("EMAIL_REJECTED");
  } catch {
    // Provider bodies and exceptions can contain recipients or credentials.
    console.error(
      JSON.stringify({
        event: "gravity.auth_email",
        status: "failed",
        providerStatus: status,
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
