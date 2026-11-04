import { expect, test } from "vitest";
import { localOAuthPostgresUrl } from "./support/oauth-database";

test.each([
  "postgres://127.0.0.1:5432/postgres",
  "postgresql://localhost/postgres",
  "postgres://[::1]/postgres",
])("OAuth PostgreSQL fixture accepts loopback URLs (%s)", (url) => {
  expect(localOAuthPostgresUrl(url).toString()).toBe(url);
});

test.each([
  "not-a-url",
  "https://localhost/postgres",
  "postgres://external.example.test/postgres",
  "postgres://localhost/postgres?host=external.example.test",
  "postgres://localhost/postgres#external",
])(
  "OAuth PostgreSQL fixture refuses nonlocal or overridden URLs (%s)",
  (url) => {
    expect(() => localOAuthPostgresUrl(url)).toThrow(
      "OAUTH_TEST_DATABASE_MUST_BE_LOCAL",
    );
  },
);
