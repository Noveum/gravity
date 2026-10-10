import * as fs from "node:fs";
import * as path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  CsvImportService,
  detectColumnMapping,
  parseCsv,
} from "../packages/core/csv-import";
import type { Principal } from "../packages/core/policy";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import {
  apiOperation,
  executeMcpOperation,
} from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
let service: CsvImportService;

const org1 = demoId(1);
const org2 = demoId(2);
const product10 = demoId(10);
const product11 = demoId(11);
const product13 = demoId(13); // Org 2 product

const adminUser: Principal = {
  userId: demoUser,
  source: "session",
  organizationId: org1,
};

const restrictedUser: Principal = {
  userId: "demo-restricted",
  source: "session",
  organizationId: org1,
  productIds: [product11],
};

const org2Admin: Principal = {
  userId: demoUser,
  source: "session",
  organizationId: org2,
};

const fixtureCsvPath = path.resolve(
  __dirname,
  "fixtures/fictional-contacts.csv",
);
const fixtureCsvText = fs.readFileSync(fixtureCsvPath, "utf8");

beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
  service = new CsvImportService(local.db);
});

afterAll(async () => {
  await local.client.close();
});

describe("CSV parsing and mapping", () => {
  test("RFC 4180 parsing handles quotes, commas, newlines and spaces", () => {
    const raw = `Name,Email,Company,Notes
"Smith, John",john@test.invalid,"Acme, Inc.","Multiline
note here"
"Jane ""CEO"" Doe",jane@test.invalid,Acme,Simple note
`;
    const parsed = parseCsv(raw);
    expect(parsed.headers).toEqual(["Name", "Email", "Company", "Notes"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toEqual([
      "Smith, John",
      "john@test.invalid",
      "Acme, Inc.",
      "Multiline\nnote here",
    ]);
    expect(parsed.rows[1]).toEqual([
      'Jane "CEO" Doe',
      "jane@test.invalid",
      "Acme",
      "Simple note",
    ]);
  });

  test("auto-detects column mapping for typical contact and company headers", () => {
    const headers = [
      "Contact Name",
      "Work Email",
      "Job Title",
      "Phone Number",
      "LinkedIn Profile",
      "Company Name",
      "Company Website",
      "About Company",
      "Comments",
      "Extra Unmapped",
    ];
    const mapping = detectColumnMapping(headers);
    expect(mapping["Contact Name"]).toBe("name");
    expect(mapping["Work Email"]).toBe("email");
    expect(mapping["Job Title"]).toBe("title");
    expect(mapping["Phone Number"]).toBe("phone");
    expect(mapping["LinkedIn Profile"]).toBe("linkedinUrl");
    expect(mapping["Company Name"]).toBe("companyName");
    expect(mapping["Company Website"]).toBe("companyDomain");
    expect(mapping["About Company"]).toBe("companyDescription");
    expect(mapping.Comments).toBe("summary");
    expect(mapping["Extra Unmapped"]).toBe("ignore");
  });
});

describe("CSV import preview and duplicate review with fixture", () => {
  test("previews several hundred rows from fixture CSV with counts and duplicate classification", async () => {
    const preview = await service.preview(adminUser, {
      organizationId: org1,
      productId: product10,
      csvText: fixtureCsvText,
    });

    expect(preview.summary.totalRows).toBe(271);
    expect(preview.summary.headers).toEqual([
      "Name",
      "Email",
      "Title",
      "Phone",
      "LinkedIn",
      "Company",
      "Domain",
      "Notes",
    ]);
    expect(preview.summary.detectedMapping.Name).toBe("name");
    expect(preview.summary.detectedMapping.Email).toBe("email");
    expect(preview.summary.detectedMapping.Company).toBe("companyName");
    expect(preview.summary.detectedMapping.Domain).toBe("companyDomain");

    // Identifies invalid rows
    expect(preview.summary.invalidCount).toBe(3);
    expect(preview.invalidRows).toHaveLength(3);
    const missingName = preview.invalidRows.find((r) => r.rowIndex === 5);
    expect(missingName?.errors).toContain("Person name is required");
    const badEmail = preview.invalidRows.find((r) => r.rowIndex === 6);
    expect(badEmail?.errors[0]).toContain("Invalid email address");
    const badDomain = preview.invalidRows.find((r) => r.rowIndex === 7);
    expect(badDomain?.errors[0]).toContain("Invalid company domain");

    // Identifies duplicates for review (existing email, existing company domain, duplicate in CSV)
    expect(preview.summary.duplicateCount).toBe(4);
    expect(preview.duplicateRows).toHaveLength(4);

    // Row 1: Existing person email & existing company domain in org 1
    const duplicateRow1 = preview.duplicateRows.find((r) => r.rowIndex === 1);
    expect(duplicateRow1?.reasons.some((x) => x.kind === "person_email")).toBe(
      true,
    );
    expect(
      duplicateRow1?.reasons.some((x) => x.kind === "company_domain"),
    ).toBe(true);

    // Row 2: Existing company domain in org 1 (harbor-analytics.example.test)
    const duplicateRow2 = preview.duplicateRows.find((r) => r.rowIndex === 2);
    expect(
      duplicateRow2?.reasons.some((x) => x.kind === "company_domain"),
    ).toBe(true);

    // Row 4: Duplicate email in the same CSV
    const duplicateRow4 = preview.duplicateRows.find((r) => r.rowIndex === 4);
    expect(duplicateRow4?.reasons.some((x) => x.kind === "csv_duplicate")).toBe(
      true,
    );

    // Valid rows ready to import
    expect(preview.summary.validCount).toBe(264);
    expect(preview.validRows).toHaveLength(264);
    expect(
      preview.validRows.every((r) => r.person.name && r.person.email),
    ).toBe(true);
  });

  test("rejects import with PERSON_EXISTS or COMPANY_EXISTS when skipDuplicates is false", async () => {
    await expect(
      service.importCsv(adminUser, {
        organizationId: org1,
        productId: product10,
        csvText: fixtureCsvText,
        skipDuplicates: false,
      }),
    ).rejects.toMatchObject({
      code: "PERSON_EXISTS",
      status: 409,
    });
  });

  test("rejects import with COMPANY_EXISTS when only company domain collides and skipDuplicates is false", async () => {
    const csvWithCompanyDuplicate = `Name,Email,Company,Domain
Test Person,unique.new.email@test.invalid,Harbor Analytics,harbor-analytics.example.test
`;
    await expect(
      service.importCsv(adminUser, {
        organizationId: org1,
        productId: product10,
        csvText: csvWithCompanyDuplicate,
        skipDuplicates: false,
      }),
    ).rejects.toMatchObject({
      code: "COMPANY_EXISTS",
      status: 409,
    });
  });

  test("imports several hundred rows when skipDuplicates is true, recording provenance and returning final summary", async () => {
    const countPeopleBefore = (
      await local.db
        .select({ id: s.people.id })
        .from(s.people)
        .where(eq(s.people.organizationId, org1))
    ).length;

    const result = await service.importCsv(adminUser, {
      organizationId: org1,
      productId: product10,
      csvText: fixtureCsvText,
      skipDuplicates: true,
      label: "Fictional Prospect List",
    });

    expect(result.totalRows).toBe(271);
    expect(result.importedCount).toBe(264);
    expect(result.peopleCreated).toBe(264);
    expect(result.relationshipsCreated).toBe(264);
    expect(result.duplicateCount).toBe(4);
    expect(result.invalidCount).toBe(3);
    expect(result.duplicates).toHaveLength(4);
    expect(result.invalid).toHaveLength(3);
    expect(result.companiesCreated).toBeGreaterThan(0);

    const countPeopleAfter = (
      await local.db
        .select({ id: s.people.id })
        .from(s.people)
        .where(eq(s.people.organizationId, org1))
    ).length;
    expect(countPeopleAfter - countPeopleBefore).toBe(264);

    // Verifies batch attribution was recorded
    const [batch] = await local.db
      .select()
      .from(s.contactImportBatches)
      .where(
        and(
          eq(s.contactImportBatches.organizationId, org1),
          eq(s.contactImportBatches.label, "Fictional Prospect List"),
        ),
      );
    expect(batch).toBeDefined();
    expect(batch.submittedBy).toBe(demoUser);

    // Contributions recorded
    const firstImported = result.imported[0];
    const [contrib] = await local.db
      .select()
      .from(s.contactContributions)
      .where(
        and(
          eq(s.contactContributions.personId, firstImported.personId),
          eq(s.contactContributions.organizationId, org1),
        ),
      );
    expect(contrib).toBeDefined();
    expect(contrib.kind).toBe("created");
  });
});

describe("Permissions and cross-organization isolation", () => {
  test("enforces product permission: user without access to product cannot import", async () => {
    // restrictedUser only has product 11; importing into product 10 must fail
    await expect(
      service.preview(restrictedUser, {
        organizationId: org1,
        productId: product10,
        csvText: "Name,Email\nJohn,john@example.test",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });

    await expect(
      service.importCsv(restrictedUser, {
        organizationId: org1,
        productId: product10,
        csvText: "Name,Email\nJohn,john@example.test",
        skipDuplicates: true,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  test("enforces product permission: user with product access can import into permitted product", async () => {
    const csv =
      "Name,Email\nRestricted Allowed,restricted.allowed@example.test";
    const preview = await service.preview(restrictedUser, {
      organizationId: org1,
      productId: product11,
      csvText: csv,
    });
    expect(preview.summary.validCount).toBe(1);

    const imported = await service.importCsv(restrictedUser, {
      organizationId: org1,
      productId: product11,
      csvText: csv,
      skipDuplicates: true,
    });
    expect(imported.importedCount).toBe(1);
  });

  test("cross-organization isolation: organization 2 import does not collide with organization 1 records", async () => {
    // Org 1 already has person0@example.test and northstar-labs.example.test
    // Org 2 user importing person0@example.test with northstar-labs.example.test into Org 2 (product13) succeeds!
    const csvForOrg2 = `Name,Email,Company,Domain
Mira Chen Org2,person0@example.test,Northstar Org2,northstar-labs.example.test
`;
    const preview = await service.preview(org2Admin, {
      organizationId: org2,
      productId: product13,
      csvText: csvForOrg2,
    });

    // In Org 2, these are NOT duplicates
    expect(preview.summary.duplicateCount).toBe(0);
    expect(preview.summary.validCount).toBe(1);

    const res = await service.importCsv(org2Admin, {
      organizationId: org2,
      productId: product13,
      csvText: csvForOrg2,
      skipDuplicates: false,
    });
    expect(res.importedCount).toBe(1);

    // Verify record in Org 2 has Org 2 organizationId
    const [person] = await local.db
      .select()
      .from(s.people)
      .where(eq(s.people.id, res.imported[0].personId));
    expect(person.organizationId).toBe(org2);
  });

  test("cannot access or import into another organization", async () => {
    const unauthed: Principal = {
      userId: "unauthed-user",
      source: "session",
    };
    await expect(
      service.preview(unauthed, {
        organizationId: org1,
        productId: product10,
        csvText: "Name,Email\nTest,test@test.test",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });
});

describe("Operations catalog and MCP transport", () => {
  test("executes preview via API operation registry", async () => {
    const op = apiOperation("crm", "POST", "csv-import-preview");
    expect(op.name).toBe("preview_csv_import");

    const result = (await op.execute(
      { db: local.db, principal: adminUser },
      {
        organizationId: org1,
        productId: product11,
        csvText: "Name,Email\nApi User,api.user@test.invalid",
      },
    )) as Awaited<ReturnType<CsvImportService["preview"]>>;

    expect(result.summary.validCount).toBe(1);
    expect(result.validRows[0].person.name).toBe("Api User");
  });

  test("executes import via executeMcpOperation for assistants", async () => {
    const op = apiOperation("crm", "POST", "csv-import");
    expect(op.name).toBe("import_contacts_csv");

    const assistantPrincipal: Principal = {
      userId: demoUser,
      source: "mcp",
      organizationId: org1,
      readOnly: false,
      clientId: "codex-test-client",
      grantId: demoId(809),
    };

    const res = (await executeMcpOperation(
      op,
      { db: local.db, principal: assistantPrincipal },
      org1,
      {
        productId: product11,
        csvText: "Name,Email\nMCP Contact,mcp.contact@test.invalid",
        skipDuplicates: true,
      },
    )) as Awaited<ReturnType<CsvImportService["importCsv"]>>;

    expect(res.importedCount).toBe(1);
    expect(res.peopleCreated).toBe(1);

    // Verify batch transport was recorded as mcp
    const [batch] = await local.db
      .select()
      .from(s.contactImportBatches)
      .where(
        and(
          eq(s.contactImportBatches.organizationId, org1),
          eq(s.contactImportBatches.submittedBy, demoUser),
        ),
      )
      .orderBy(s.contactImportBatches.createdAt);

    expect(batch).toBeDefined();
  });
});
