export const allowedFields = [
  "name",
  "email",
  "title",
  "phone",
  "linkedinUrl",
  "summary",
  "companyName",
  "companyDomain",
  "companyDescription",
  "ignore",
] as const;

export type ImportField = (typeof allowedFields)[number];

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/** RFC 4180 compliant CSV parser with multiline & quote escaping support. */
export function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^\uFEFF/, "");
  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  let i = 0;

  while (i < clean.length) {
    const char = clean[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < clean.length && clean[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      currentField += char;
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ",") {
      currentRow.push(currentField.trim());
      currentField = "";
      i++;
      continue;
    }
    if (char === "\r" || char === "\n") {
      if (char === "\r" && i + 1 < clean.length && clean[i + 1] === "\n") {
        i++;
      }
      currentRow.push(currentField.trim());
      currentField = "";
      if (currentRow.some((field) => field.length > 0)) {
        lines.push(currentRow);
      }
      currentRow = [];
      i++;
      continue;
    }
    currentField += char;
    i++;
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((field) => field.length > 0)) {
      lines.push(currentRow);
    }
  }

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = lines[0].map((h) => h.trim());
  const rows = lines.slice(1);
  return { headers, rows };
}

/** Auto-detect column mapping by matching common English header variants. */
export function detectColumnMapping(
  headers: string[],
): Record<string, ImportField> {
  const mapping: Record<string, ImportField> = {};
  for (const header of headers) {
    const norm = header.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (
      ["name", "fullname", "contactname", "personname", "contact"].includes(
        norm,
      )
    ) {
      mapping[header] = "name";
    } else if (
      ["email", "emailaddress", "workemail", "contactemail", "mail"].includes(
        norm,
      )
    ) {
      mapping[header] = "email";
    } else if (
      ["title", "jobtitle", "role", "position", "job"].includes(norm)
    ) {
      mapping[header] = "title";
    } else if (
      ["phone", "phonenumber", "telephone", "mobile", "cell"].includes(norm)
    ) {
      mapping[header] = "phone";
    } else if (
      ["linkedin", "linkedinurl", "profile", "linkedinprofile"].includes(norm)
    ) {
      mapping[header] = "linkedinUrl";
    } else if (
      [
        "company",
        "companyname",
        "organization",
        "organisation",
        "account",
        "business",
      ].includes(norm)
    ) {
      mapping[header] = "companyName";
    } else if (
      [
        "domain",
        "companydomain",
        "website",
        "companywebsite",
        "url",
        "web",
      ].includes(norm)
    ) {
      mapping[header] = "companyDomain";
    } else if (
      ["description", "companydescription", "about", "aboutcompany"].includes(
        norm,
      )
    ) {
      mapping[header] = "companyDescription";
    } else if (
      ["summary", "notes", "context", "background", "comments"].includes(norm)
    ) {
      mapping[header] = "summary";
    } else {
      mapping[header] = "ignore";
    }
  }
  return mapping;
}
