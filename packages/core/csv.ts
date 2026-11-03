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

/** Strict RFC 4180 field structure; blank lines are ignored. */
export function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^\uFEFF/, "");
  const lines: string[][] = [];
  let row: string[] = [];
  let field = "";
  let state: "plain" | "quoted" | "closed" = "plain";
  const invalid = () => {
    throw new Error("CSV_STRUCTURE_INVALID");
  };
  const finishField = () => {
    row.push(field.trim());
    field = "";
    state = "plain";
  };
  const finishRow = () => {
    finishField();
    if (row.some(Boolean)) lines.push(row);
    row = [];
  };
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (state === "quoted") {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else state = "closed";
      } else field += char;
    } else if (char === ",") finishField();
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && clean[i + 1] === "\n") i++;
      finishRow();
    } else if (char === '"') {
      if (state !== "plain" || field.length) invalid();
      state = "quoted";
    } else {
      if (state === "closed") invalid();
      field += char;
    }
  }
  if (state === "quoted") invalid();
  if (field.length || row.length || state === "closed") finishRow();
  if (!lines.length) return { headers: [], rows: [] };
  const [headers, ...rows] = lines;
  if (
    headers.some((header) => !header) ||
    new Set(headers).size !== headers.length ||
    rows.some((item) => item.length !== headers.length)
  )
    invalid();
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
