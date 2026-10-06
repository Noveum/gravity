export function normalizeEmailDomains(domains: readonly string[]) {
  return [
    ...new Set(
      domains
        .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean),
    ),
  ];
}
export function deploymentEmailDomains() {
  return normalizeEmailDomains(
    (process.env.ALLOWED_EMAIL_DOMAINS ?? "").split(","),
  );
}
export function emailDomainAllowed(
  email: string,
  workspaceDomains: readonly string[],
) {
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  return [deploymentEmailDomains(), normalizeEmailDomains(workspaceDomains)]
    .filter((list) => list.length > 0)
    .every((list) => list.includes(domain));
}
