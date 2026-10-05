import { emailSignInEnabled, enabledProviders } from "@crm/auth/config";
import { appUrl } from "@crm/auth/options";
import { currentPrincipal } from "@crm/auth/server";
import { DomainError } from "@crm/core/policy";
import { isDemoMode } from "@crm/database/client";
import t from "@crm/i18n/translations/en.json";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignIn } from "@/components/auth-forms";
import { authenticatedSignInDestination } from "@/components/sign-in-destination";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isDemoMode()) {
    let authenticated = false;
    try {
      await currentPrincipal(await headers());
      authenticated = true;
    } catch (error) {
      if (
        !(error instanceof DomainError) ||
        !["UNAUTHORIZED", "AUTH_UNAVAILABLE"].includes(error.code)
      )
        throw error;
    }
    if (authenticated) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(await searchParams)) {
        if (Array.isArray(value))
          for (const item of value) query.append(key, item);
        else if (typeof value === "string") query.append(key, value);
      }
      redirect(authenticatedSignInDestination(query, appUrl()));
    }
  }
  return (
    <Suspense fallback={<p>{t.loading}</p>}>
      <SignIn
        providers={isDemoMode() ? [] : enabledProviders()}
        demo={isDemoMode()}
        emailEnabled={!isDemoMode() && emailSignInEnabled()}
      />
    </Suspense>
  );
}
