import { describe, expect, test } from "vitest";
import t from "../packages/i18n/translations/en.json";
import { mergeParts, mergeText } from "../src/components/outreach/merge-fields";

const noor = {
  name: "Noor Haddad",
  title: "Head of data",
  company: "Lantern AI",
};
const missing = (field: string) =>
  t.mergeFieldMissing.replace("{field}", field);

describe("merge fields", () => {
  test("fills the seed token and the other person fields, ignoring case and spacing", () => {
    expect(mergeText("Hi {first name}, one more idea.", noor)).toBe(
      "Hi Noor, one more idea.",
    );
    expect(
      mergeText(
        "{First Name} {last name} ({ full name }), {title} at {company}",
        noor,
      ),
    ).toBe("Noor Haddad (Noor Haddad), Head of data at Lantern AI");
  });
  test("unknown tokens and empty values get a visible fallback and are marked missing", () => {
    expect(mergeText("Hi {nickname} at {company}", { name: "Owen" })).toBe(
      `Hi ${missing("nickname")} at ${missing("company")}`,
    );
    expect(mergeText("{last name}", { name: "Owen" })).toBe(
      missing("last name"),
    );
    expect(mergeParts("Hi {first name} {role}", noor)).toEqual([
      { text: "Hi " },
      { text: "Noor", field: "first name" },
      { text: " " },
      { text: missing("role"), field: "role", missing: true },
    ]);
  });
  test("text without tokens, and a lone brace, stay as written", () => {
    expect(mergeText("Plain note", noor)).toBe("Plain note");
    expect(mergeText("Half {open", noor)).toBe("Half {open");
  });
});
