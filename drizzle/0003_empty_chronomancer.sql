ALTER TABLE "actions" ADD COLUMN "source_conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "self_email" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "inbox_folder_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "sent_folder_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_organization_id_product_id_source_conversation_id_conversations_organization_id_product_id_id_fk" FOREIGN KEY ("organization_id","product_id","source_conversation_id") REFERENCES "public"."conversations"("organization_id","product_id","id") ON DELETE no action ON UPDATE no action;