# Security policy

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for a security problem.**
A CRM holds other people's contact details and conversations, so a public report
exposes every installation at once.

Report it privately, one of two ways:

- [Open a private advisory](https://github.com/Noveum/gravity/security/advisories/new)
  on GitHub. This is the preferred route: the discussion, the fix and the
  disclosure stay in one place.
- Or email <shashank@noveum.ai> with `SECURITY` in the subject.

Please include:

- What the problem is and how bad you think it is.
- A minimal reproduction using fictional data, or a proof of concept.
- The commit or deployment you found it on.
- Which boundary it crosses: organization, product, private conversation,
  account owner, OAuth grant or send permission.

You will get an acknowledgement within 72 hours and a confirm-or-reject decision
within seven days, with our plan either way. We aim to fix confirmed issues within
30 days, sooner when one is being exploited. We credit reporters in the advisory
unless you prefer to stay anonymous.

Never include real tokens, customer records, message bodies or transcripts in a
report.

## Supported versions

Gravity is a Preview that ships continuously from `main`. There are no release
branches and no backports.

| Version | Supported |
| --- | --- |
| `main` and the hosted app at gravity.noveum.ai | Yes |
| Anything older | Upgrade to `main` |

## Scope

In scope:

- Tenant isolation: reading or changing another organization's records, or a
  product you are not a member of, over HTTP, MCP, SSE or file download.
- Private histories: reading another account owner's imported mail, calendar,
  LinkedIn or meeting notes without being shared on them.
- Authentication, sessions, email codes and the OAuth authorization server,
  including consent, PKCE, refresh and grant revocation.
- MCP tokens acting outside their granted organization, products or scopes.
- Sending: any path that dispatches a message without `crm:send`, a current
  approval, provider consent and owner authorization, or that retries an
  unknown outcome.
- Webhook signature verification, cron route authorization and stored
  provider credentials.
- Injection, SSRF, stored or reflected XSS, unsafe file handling.

Out of scope:

- Findings that require a malicious administrator of the same organization.
- Missing hardening headers without a demonstrated impact.
- Denial of service through volume, and social engineering.
- The local demo (`CRM_DEMO_MODE=true`), which is fictional by design and
  refuses to run in production.

## Testing rules

Test only your own local installation or a deployment you are authorized to
test. On the hosted app, use workspaces and accounts you created yourself, and
never attempt to access another tenant or a third-party provider account.

## Known gaps

The production gates that are still open, including distributed abuse limits,
key rotation and backup restore qualification, are tracked in the
[roadmap](docs/roadmap.md#production-gates) and [release review](docs/release-review.md).
Automated tests cover selected SQL, HTTP and OAuth boundaries; they are not a
completed security audit.
