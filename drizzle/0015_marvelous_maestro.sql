CREATE INDEX "companies_browse" ON "companies" USING btree ("organization_id","name","id");--> statement-breakpoint
CREATE INDEX "people_company_browse" ON "people" USING btree ("organization_id","company_id","archived_at");--> statement-breakpoint
CREATE INDEX "people_name_browse" ON "people" USING btree ("organization_id","name","id");--> statement-breakpoint
CREATE INDEX "relationships_person_browse" ON "relationships" USING btree ("organization_id","person_id","product_id");--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "company_amount_nonnegative" CHECK ("companies"."amount_minor" IS NULL OR "companies"."amount_minor" >= 0);--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "company_currency_valid" CHECK ("companies"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "person_amount_nonnegative" CHECK ("people"."amount_minor" IS NULL OR "people"."amount_minor" >= 0);--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "person_currency_valid" CHECK ("people"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationship_amount_nonnegative" CHECK ("relationships"."amount_minor" IS NULL OR "relationships"."amount_minor" >= 0);--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationship_currency_valid" CHECK ("relationships"."currency" ~ '^[A-Z]{3}$');