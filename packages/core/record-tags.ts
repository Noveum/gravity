import { z } from "zod";

export const tagsSchema = z
  .array(z.string().trim().min(1).max(50))
  .max(30)
  .transform((tags) => [
    ...new Map(tags.map((tag) => [tag.toLowerCase(), tag])).values(),
  ]);
