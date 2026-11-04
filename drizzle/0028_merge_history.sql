ALTER TABLE "touches" DROP CONSTRAINT "touches_organization_id_product_id_relationship_id_enrollment_id_enrollments_organization_id_product_id_relationship_id_id_fk";
--> statement-breakpoint
DROP INDEX "contact_contributions_original_creator";--> statement-breakpoint
ALTER TABLE "contact_contributions" ADD COLUMN "merged_from_person_id" uuid;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "merge_history" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_organization_id_product_id_relationship_id_enrollment_id_enrollments_organization_id_product_id_relationship_id_id_fk" FOREIGN KEY ("organization_id","product_id","relationship_id","enrollment_id") REFERENCES "public"."enrollments"("organization_id","product_id","relationship_id","id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_contributions_original_creator" ON "contact_contributions" USING btree ("person_id") WHERE "contact_contributions"."kind" = 'created' AND "contact_contributions"."merged_from_person_id" IS NULL;