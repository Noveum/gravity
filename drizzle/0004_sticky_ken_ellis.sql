-- Bind organization selection to each OAuth flow; prior foundation selections are transient.
TRUNCATE TABLE "oauth_selections";--> statement-breakpoint
ALTER TABLE "oauth_selections" DROP CONSTRAINT "oauth_selections_pkey";--> statement-breakpoint
ALTER TABLE "oauth_selections" ADD COLUMN "flow_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_selections" ADD CONSTRAINT "oauth_selections_session_id_flow_key_pk" PRIMARY KEY("session_id","flow_key");
