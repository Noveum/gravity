import t from "@crm/i18n/translations/en.json";
import { Suspense } from "react";
import { Authorization } from "@/components/auth-forms";
export default function Page() {
  return (
    <Suspense fallback={<p>{t.loading}</p>}>
      <Authorization />
    </Suspense>
  );
}
