import { redirect } from "next/navigation";
import { outreachPath } from "@/components/routes";

export default function Page() {
  redirect(outreachPath("today"));
}
