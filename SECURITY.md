# Security policy

This foundation preview is not approved for live sales data. Only the latest development branch is maintained; there is no stable production release or security-response SLA yet.

Use the repository's **Security → Report a vulnerability** private reporting feature when enabled. If unavailable, contact the Noveum repository owner privately through your existing channel. Do not post tokens, customer records, message bodies or exploitable private-service details in a public issue.

Describe the affected commit, minimum fictional reproduction, violated tenant/product/private-source boundary and expected impact. Testing must target your own local installation or an explicitly authorized environment. Do not test another tenant or provider account without authorization.

Production gates include encrypted provider credentials, distributed abuse limits, least-privileged database/storage roles, key rotation, backups and restore qualification. Current automated coverage establishes selected SQL/HTTP/OAuth boundaries; it does not establish a completed production security audit. See [the release review](docs/release-review.md) and [roadmap](docs/roadmap.md).
