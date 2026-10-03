ALTER TABLE "invitation" ADD COLUMN "token_hash" text;--> statement-breakpoint
UPDATE "invitation" SET "token_hash" = encode(sha256(convert_to("id", 'UTF8')), 'hex'), "id" = gen_random_uuid()::text;--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "token_hash" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_token_hash_unique" ON "invitation" USING btree ("token_hash");
