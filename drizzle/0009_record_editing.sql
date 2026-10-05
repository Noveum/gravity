ALTER TABLE "companies" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "other_emails" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "phone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "linkedin_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "category" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
UPDATE "stages" SET "category" = 'won' WHERE lower("name") = 'won';--> statement-breakpoint
INSERT INTO "stages" ("organization_id", "product_id", "name", "position", "category")
SELECT "organization_id", "product_id", 'Lost', max("position") + 1, 'lost'
FROM "stages"
GROUP BY "organization_id", "product_id"
HAVING bool_and("category" <> 'lost');
