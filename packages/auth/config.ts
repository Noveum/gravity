import { z } from "zod";

export function enabledProviders() {
  return [
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? "google"
      : null,
    process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? "github"
      : null,
  ].filter((value): value is "google" | "github" => value !== null);
}
export function emailSender() {
  const from = process.env.EMAIL_FROM?.trim();
  if (!from || /[\r\n]/.test(from)) return null;
  const address = from.match(/<([^<>]+)>$/)?.[1] ?? from;
  return z.email().safeParse(address).success ? from : null;
}
export function emailSignInEnabled() {
  return Boolean(process.env.RESEND_API_KEY?.trim() && emailSender());
}
export function loginConfigured() {
  return enabledProviders().length > 0 || emailSignInEnabled();
}
