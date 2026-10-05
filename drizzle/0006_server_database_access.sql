-- Dedicated server permission group. Login credentials are provisioned separately.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gravity_app') THEN
    CREATE ROLE gravity_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gravity_app' AND
    (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'GRAVITY_APP_ROLE_UNSAFE';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "asset_stages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "change_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connector_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "enrollments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "folders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mcp_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meetings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_selections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "opportunities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "relationships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jwks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_client" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_client_assertion" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_client_resource" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_consent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_resource" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "verification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "actions" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "asset_stages" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "assets" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "change_events" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "companies" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "connections" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "connector_events" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "conversations" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "enrollments" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "evidence" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "folders" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "mcp_grants" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "meetings" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "memberships" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "messages" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "oauth_selections" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "opportunities" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "organizations" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "people" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "product_memberships" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "products" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "relationships" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "sequences" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "stages" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "account" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "jwks" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "oauth_access_token" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "oauth_client" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "oauth_client_assertion" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "oauth_client_resource" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "oauth_consent" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "oauth_refresh_token" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "oauth_resource" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "session" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "user" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "gravity_server_access" ON "verification" AS PERMISSIVE FOR ALL TO "gravity_app" USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO gravity_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."actions", public."asset_stages", public."assets", public."change_events", public."companies", public."connections", public."connector_events", public."conversations", public."enrollments", public."evidence", public."folders", public."mcp_grants", public."meetings", public."memberships", public."messages", public."oauth_selections", public."opportunities", public."organizations", public."people", public."product_memberships", public."products", public."relationships", public."sequences", public."stages", public."account", public."jwks", public."oauth_access_token", public."oauth_client", public."oauth_client_assertion", public."oauth_client_resource", public."oauth_consent", public."oauth_refresh_token", public."oauth_resource", public."session", public."user", public."verification" TO gravity_app;
--> statement-breakpoint
REVOKE ALL ON TABLE public."actions", public."asset_stages", public."assets", public."change_events", public."companies", public."connections", public."connector_events", public."conversations", public."enrollments", public."evidence", public."folders", public."mcp_grants", public."meetings", public."memberships", public."messages", public."oauth_selections", public."opportunities", public."organizations", public."people", public."product_memberships", public."products", public."relationships", public."sequences", public."stages", public."account", public."jwks", public."oauth_access_token", public."oauth_client", public."oauth_client_assertion", public."oauth_client_resource", public."oauth_consent", public."oauth_refresh_token", public."oauth_resource", public."session", public."user", public."verification" FROM PUBLIC;
--> statement-breakpoint
-- Revoke only Gravity tables, leaving unrelated application objects untouched.
DO $$ DECLARE api_role text; BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON TABLE public."actions", public."asset_stages", public."assets", public."change_events", public."companies", public."connections", public."connector_events", public."conversations", public."enrollments", public."evidence", public."folders", public."mcp_grants", public."meetings", public."memberships", public."messages", public."oauth_selections", public."opportunities", public."organizations", public."people", public."product_memberships", public."products", public."relationships", public."sequences", public."stages", public."account", public."jwks", public."oauth_access_token", public."oauth_client", public."oauth_client_assertion", public."oauth_client_resource", public."oauth_consent", public."oauth_refresh_token", public."oauth_resource", public."session", public."user", public."verification" FROM %I', api_role);
  END LOOP;
END $$;
