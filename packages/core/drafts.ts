import { createHash } from "node:crypto";

export function draftHash(input: {
  draft: string;
  personId: string;
  email: string | null;
  channel: string;
  productId: string;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        draft: input.draft,
        personId: input.personId,
        email: input.email,
        channel: input.channel,
        productId: input.productId,
      }),
    )
    .digest("hex");
}
