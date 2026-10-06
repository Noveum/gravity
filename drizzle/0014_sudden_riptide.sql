ALTER TABLE "companies" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "amount_minor" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "amount_minor" integer;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "amount_minor" integer;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;