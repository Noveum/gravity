import { redirect } from "next/navigation";
import { settingsPath } from "@/components/routes";

export default function Page() {
  redirect(settingsPath("workspace"));
}
