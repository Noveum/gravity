import t from "@crm/i18n/translations/en.json";
import { Suspense } from "react";
import { Consent } from "@/components/auth-forms";
export default function Page() {
  return (
    <Suspense fallback={<p>{t.loading}</p>}>
      <Consent />
    </Suspense>
  );
}
