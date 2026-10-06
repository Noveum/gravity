# MCP client qualification

Gravity exposes CRM read/write/send Streamable HTTP at `<APP_URL>/mcp`. OAuth is the supported authentication path; no CRM API-key flow is implemented. Webhook HMAC is separate from user/assistant authorization.

## Evidence

| Path | Result in this change | Remaining qualification |
|---|---|---|
| Official MCP TypeScript client 2.3.0 | Real local HTTP discovery, unauthenticated dynamic registration, S256 PKCE, signed organization/product selection, consent, token exchange, protocol initialization, tool discovery/calls, selected-product isolation and immediate revocation pass. GET is rejected like the application POST-only endpoint. | Repeat on the supplied HTTPS staging origin. |
| OAuth provider HTTP tests | Parallel flow binding, token resource, refresh retaining the immutable grant, disabled client/session rejection, grant revocation and unauthenticated discovery pass with actual SQL. | Live social login and hosted callback behavior. |
| Codex | The current desktop task has an authenticated hosted Gravity connection. Identity, permissions, capability discovery, product/workspace/context/sequence/integration reads and enrollment dry run work through its MCP tools. | Hosted writes and actual dispatch were not exercised on real contacts. Repeat discovery after publishing the reviewed release; qualify interactive consent, refresh and revocation independently. |
| Claude Code | Installed `2.1.283` supports HTTP MCP registration/login; official commands documented. | Actual user authorization on configured staging, including reconnect/refresh/revoke. |
| Other agents | Standard OAuth discovery, dynamic registration and CRM read/write tools provide a protocol path. | Qualify each actual client's OAuth and HTTP implementation; SDK success is not blanket client certification. |

The automated fixture uses a fictional email/password test identity and in-memory credentials; it does not send email, configure a personal assistant or access a live inbox. Production login remains Google/GitHub configuration. Client Metadata Document support is configured through the official Better Auth CIMD plugin but is **not yet exercised against Codex's live metadata document**. Do not describe the DCR SDK test as CIMD qualification.

## Connect after staging is configured

Use a current Codex CLI:

```sh
codex mcp add gravity --url https://YOUR_GRAVITY_ORIGIN/mcp
codex mcp login gravity
```

In Codex desktop, add the same remote HTTP URL under MCP server settings and authenticate. In Claude Code:

```sh
claude mcp add --transport http --scope user gravity https://YOUR_GRAVITY_ORIGIN/mcp
claude mcp login gravity
```

If prompted in a Claude session, `/mcp` also opens connection management. The uppercase hostname is a placeholder, not a functioning server. The old Twenty Cloud Run bridge is a separate installation.

Sign in, select one organization and allowed products, and accept CRM read/write/send consent. Run `get_me`, `get_capabilities`, and `list_products`. Confirm the granted organization/product IDs; request an ungranted product and verify denial. Revoke the grant in Connections and verify that an existing token no longer reads records. All-products grants include future permitted products; specific-product grants stay fixed. Reconnect existing read-only clients to authorize `crm:write crm:send`. Ask the assistant to list capabilities before expecting Gmail synchronization or sending.

## Authentication direction

Use OAuth first for interactive Codex/Claude users. A future service-account API key needs hashed storage, visible owner, organization/product scopes, expiration, last-use tracking and independent rotation/revocation with the same domain permission checks. An arbitrary bearer token is not a supported shortcut. Token cryptography and discovery remain in the official libraries.

Official references reviewed: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Claude Code MCP](https://code.claude.com/docs/en/mcp), [MCP TypeScript client](https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/client/), [MCP authorization specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/draft/basic/authorization/index.mdx).
