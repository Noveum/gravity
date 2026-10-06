import { getDatabase } from "@crm/database/client";
import { apiOperation } from "@crm/operations/catalog";
import { notFound } from "next/navigation";
import { publicDetailSchema } from "@/components/files/file-api";
import { PublicFile } from "@/components/files/public-file";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function PublicFilePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let result: import("zod").z.infer<typeof publicDetailSchema>;
  try {
    result = publicDetailSchema.parse(
      await apiOperation("files", "GET", "public").execute(
        {
          db: await getDatabase(),
          principal: { userId: "", source: "session" },
        },
        { token },
      ),
    );
  } catch {
    notFound();
  }
  return <PublicFile token={token} initial={result} />;
}
