import { sql } from "drizzle-orm";
import { pgPolicy } from "drizzle-orm/pg-core";

// This role is exclusive to the trusted server. Tenant and product authorization
// remains in the shared domain services used by HTTP and MCP.
export function serverAccessPolicy() {
  return pgPolicy("gravity_server_access", {
    for: "all",
    to: "gravity_app",
    using: sql`true`,
    withCheck: sql`true`,
  });
}
