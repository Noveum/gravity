CREATE TABLE "import_source" (
	"organization_id" text NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"person_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_source_pk" PRIMARY KEY("organization_id","source","source_id")
);
--> statement-breakpoint
ALTER TABLE "import_source" ADD CONSTRAINT "import_source_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_source" ADD CONSTRAINT "import_source_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_source_person_idx" ON "import_source" USING btree ("person_id");