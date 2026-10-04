import { emailSignInEnabled } from "@crm/auth/email";
import { enabledProviders } from "@crm/auth/server";
import { isDemoMode } from "@crm/database/client";
import t from "@crm/i18n/translations/en.json";
import { Suspense } from "react";
import { SignIn } from "@/components/auth-forms";
export const dynamic = "force-dynamic";
export default function Page() {
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
