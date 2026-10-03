ALTER TABLE "change_events" ADD COLUMN "source_conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_organization_id_product_id_source_conversation_id_conversations_organization_id_product_id_id_fk" FOREIGN KEY ("organization_id","product_id","source_conversation_id") REFERENCES "public"."conversations"("organization_id","product_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
UPDATE "change_events" AS e SET "source_conversation_id" = a."source_conversation_id" FROM "actions" AS a WHERE e."entity_id" = a."id" AND e."organization_id" = a."organization_id" AND e."product_id" = a."product_id" AND e."type" LIKE 'action.%';
--> statement-breakpoint
UPDATE "change_events" AS e SET "source_conversation_id" = m."conversation_id" FROM "messages" AS m WHERE e."entity_id" = m."id" AND e."organization_id" = m."organization_id" AND e."product_id" = m."product_id" AND e."type" IN ('reply.received', 'message.observed');
