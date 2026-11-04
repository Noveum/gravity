import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { ContactAttributionService } from "../packages/core/contact-attribution";
import { CsvImportService, parseCsv } from "../packages/core/csv-import";
import { createLocalDatabase } from "../packages/database/client";
import * as s from "../packages/database/schema";
import { demoId, demoUser, seedDemo } from "../packages/database/seed";
import {
  apiOperation,
  executeMcpOperation,
} from "../packages/operations/catalog";

let local: Awaited<ReturnType<typeof createLocalDatabase>>;
const organizationId = demoId(1),
  productId = demoId(10);
const admin = { userId: demoUser, source: "session" as const };
beforeAll(async () => {
  local = await createLocalDatabase();
  await seedDemo(local.db);
});
afterAll(async () => {
  await local.client.close();
});
test("HTTP import and preview enforce current product membership without a product grant", async () => {
  for (const name of ["csv-import", "csv-import-preview"]) {
    await expect(
      apiOperation("crm", "POST", name).execute(
        {
          db: local.db,
          principal: { userId: "demo-restricted", source: "session" },
        },
        {
          organizationId,
          productId,
          csvText:
            "Name,Email\nUnauthorized CSV Person,unauthorized-csv@example.test",
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
});
test("MCP imports reject stale grants and read-only principals", async () => {
  const op = apiOperation("crm", "POST", "csv-import");
  await expect(
    executeMcpOperation(
      op,
      {
        db: local.db,
        principal: {
          userId: "demo-restricted",
          source: "mcp",
          organizationId,
          productIds: [productId],
          readOnly: false,
        },
      },
      organizationId,
      { productId, csvText: "Name\nStale grant" },
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    new CsvImportService(local.db).importCsv(
      { ...admin, source: "mcp", organizationId },
      { organizationId, productId, csvText: "Name\nRead only" },
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
test("hidden contact and company collisions are detected without identifiers or stored names", async () => {
  const [company] = await local.db
    .insert(s.companies)
    .values({
      organizationId,
      name: "Secret Company",
      domain: "hidden-csv.example.test",
    })
    .returning();
  const [person] = await local.db
    .insert(s.people)
    .values({
      organizationId,
      name: "Hidden Fictional Person",
      email: "hidden-csv@example.test",
      companyId: company.id,
    })
    .returning();
  await local.db.insert(s.relationships).values({
    organizationId,
    productId,
    personId: person.id,
    ownerId: demoUser,
  });
  const result = await new CsvImportService(local.db).preview(
    { userId: "demo-restricted", source: "session" },
    {
      organizationId,
      productId: demoId(11),
      csvText:
        "Name,Email,Domain\nProbe,hidden-csv@example.test,hidden-csv.example.test",
    },
  );
  expect(result.summary.duplicateCount).toBe(1);
  for (const reason of result.duplicateRows[0].reasons) {
    expect(reason.existingId).toBeUndefined();
    expect(reason.existingName).toBeUndefined();
  }
  expect(JSON.stringify(result)).not.toContain("Hidden Fictional Person");
  expect(JSON.stringify(result)).not.toContain("Secret Company");
});
test("CSV provenance joins to its batch and retains authenticated MCP attribution", async () => {
  const principal = {
    ...admin,
    source: "mcp" as const,
    organizationId,
    readOnly: false,
    clientId: "fictional-client",
    grantId: demoId(809),
  };
  const result = await new CsvImportService(local.db).importCsv(principal, {
    organizationId,
    productId,
    csvText: "Name,Email\nProvenance Probe,provenance-csv@example.test",
    label: "Fictional import source",
  });
  const [contribution] = await local.db
    .select()
    .from(s.contactContributions)
    .where(eq(s.contactContributions.personId, result.imported[0].personId));
  expect(contribution.batchId).not.toBeNull();
  expect(contribution.requestHash).toMatch(/^[a-f0-9]{64}$/);
  expect(contribution.sourceRecordId).toBe("1");
  expect(contribution).toMatchObject({
    clientId: "fictional-client",
    grantId: demoId(809),
  });
  const [batch] = await local.db
    .select()
    .from(s.contactImportBatches)
    .where(eq(s.contactImportBatches.id, contribution.batchId ?? ""));
  expect(batch).toMatchObject({
    label: "Fictional import source",
    clientId: "fictional-client",
    grantId: demoId(809),
  });
  const history = await new ContactAttributionService(local.db).list(
    principal,
    { organizationId, productId, personId: result.imported[0].personId },
  );
  expect(history.creator?.batchLabel).toBe("Fictional import source");
});
test("alternate email, archived identity and normalized LinkedIn collisions are all reviewed", async () => {
  await local.db.insert(s.people).values({
    organizationId,
    name: "Alias Owner",
    otherEmails: ["alternate-csv@example.test"],
    archivedAt: new Date(),
    linkedinUrl: "https://www.linkedin.com/in/csv-alias/",
  });
  const result = await new CsvImportService(local.db).preview(admin, {
    organizationId,
    productId,
    csvText:
      "Name,Email,LinkedIn\nAlias duplicate,alternate-csv@example.test,\nLinkedIn duplicate,,https://linkedin.com/in/CSV-ALIAS?trk=csv",
  });
  expect(result.summary.duplicateCount).toBe(2);
  expect(result.summary.validCount).toBe(0);
});
test("company-only mode supports HTTP preview and MCP import without creating contacts", async () => {
  const input = {
    organizationId,
    productId,
    mode: "companies",
    csvText: "Company,Domain\nFictional Only Company,only-company.example.test",
  };
  const preview = (await apiOperation(
    "crm",
    "POST",
    "csv-import-preview",
  ).execute({ db: local.db, principal: admin }, input)) as {
    summary: { validCount: number };
  };
  expect(preview.summary.validCount).toBe(1);
  const result = (await executeMcpOperation(
    apiOperation("crm", "POST", "csv-import"),
    {
      db: local.db,
      principal: { ...admin, source: "mcp", organizationId, readOnly: false },
    },
    organizationId,
    input,
  )) as {
    importedCount: number;
    peopleCreated: number;
    companiesCreated: number;
    relationshipsCreated: number;
  };
  expect(result).toMatchObject({
    importedCount: 1,
    peopleCreated: 0,
    companiesCreated: 1,
    relationshipsCreated: 0,
  });
  expect(
    await local.db
      .select()
      .from(s.companies)
      .where(
        and(
          eq(s.companies.organizationId, organizationId),
          eq(s.companies.domain, "only-company.example.test"),
        ),
      ),
  ).toHaveLength(1);
  const duplicate = await new CsvImportService(local.db).preview(
    admin,
    input as Parameters<CsvImportService["preview"]>[1],
  );
  expect(duplicate.summary.duplicateCount).toBe(1);
});
test("overlong field values are invalid instead of silently truncated", async () => {
  const result = await new CsvImportService(local.db).preview(admin, {
    organizationId,
    productId,
    csvText: `Name,Title,Company,Description,Summary\nProbe,${"T".repeat(151)},${"C".repeat(101)},${"D".repeat(2001)},${"S".repeat(10001)}`,
  });
  expect(result.summary.invalidCount).toBe(1);
  expect(result.invalidRows[0].errors).toHaveLength(4);
});
test.each([
  'Name\n"unclosed',
  'Name\nun"quoted',
  'Name\n"closed"junk',
  "Name,Name\nA,B",
  "Name,Email\nA",
  "Name\nA,extra",
])("rejects malformed CSV structure %s", (csv) => {
  expect(() => parseCsv(csv)).toThrow("CSV_STRUCTURE_INVALID");
});
test("duplicate field mappings fail before values can overwrite one another", async () => {
  await expect(
    new CsvImportService(local.db).preview(admin, {
      organizationId,
      productId,
      csvText: "Name,Full Name\nA,B",
    }),
  ).rejects.toMatchObject({ code: "CSV_MAPPING_INVALID" });
});

test("company-only files review duplicate domains within the file and reject without skipping", async () => {
  const input = {
    organizationId,
    productId,
    mode: "companies" as const,
    csvText:
      "Company,Domain\nOne,repeat-csv.example.test\nTwo,https://www.repeat-csv.example.test/",
  };
  const preview = await new CsvImportService(local.db).preview(admin, input);
  expect(preview.summary).toMatchObject({ duplicateCount: 2, validCount: 0 });
  await expect(
    new CsvImportService(local.db).importCsv(admin, input),
  ).rejects.toMatchObject({ code: "COMPANY_EXISTS" });
});

test("read-only MCP principals can preview POST CSV operations but cannot import", async () => {
  const principal = {
    ...admin,
    source: "mcp" as const,
    organizationId,
    readOnly: true,
  };
  const input = { productId, csvText: "Name\nRead-only preview fixture" };
  const result = (await executeMcpOperation(
    apiOperation("crm", "POST", "csv-import-preview"),
    { db: local.db, principal },
    organizationId,
    input,
  )) as { summary: { validCount: number } };
  expect(result.summary.validCount).toBe(1);
  await expect(
    executeMcpOperation(
      apiOperation("crm", "POST", "csv-import"),
      { db: local.db, principal },
      organizationId,
      input,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

test("CSV work limit accepts 1,000 data rows and rejects 1,001 before a transaction", async () => {
  const csvText = `Name\n${Array.from({ length: 1000 }, (_, index) => `Fictional ${index}`).join("\n")}`;
  expect(parseCsv(csvText).rows).toHaveLength(1000);
  expect(() => parseCsv(`${csvText}\nOver the limit`)).toThrow("CSV_ROW_LIMIT");
  const transaction = vi.spyOn(local.db, "transaction");
  try {
    await expect(
      new CsvImportService(local.db).importCsv(admin, {
        organizationId,
        productId,
        csvText: `${csvText}\nOver the limit`,
      }),
    ).rejects.toMatchObject({ code: "CSV_ROW_LIMIT" });
    expect(transaction).not.toHaveBeenCalled();
    const preview = await new CsvImportService(local.db).preview(admin, {
      organizationId,
      productId,
      csvText,
    });
    expect(preview.summary.validCount).toBe(1000);
  } finally {
    transaction.mockRestore();
  }
});

test("a failure after an imported row rolls back people, companies, relationships and provenance", async () => {
  const before = await Promise.all(
    [
      s.people,
      s.companies,
      s.relationships,
      s.contactContributions,
      s.contactImportBatches,
      s.changeEvents,
    ].map((table) => local.db.select().from(table)),
  );
  await local.client.exec(
    `CREATE FUNCTION reject_csv_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name = 'Forced CSV failure' THEN RAISE EXCEPTION 'Forced fixture failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_csv_fixture BEFORE INSERT ON people FOR EACH ROW EXECUTE FUNCTION reject_csv_fixture();`,
  );
  try {
    await expect(
      new CsvImportService(local.db).importCsv(admin, {
        organizationId,
        productId,
        label: "Rollback fixture",
        csvText:
          "Name,Email,Company,Domain\nFirst rollback fixture,rollback-first@example.test,Rollback Company,rollback-csv.example.test\nForced CSV failure,rollback-fail@example.test,Rollback Company,rollback-csv.example.test",
      }),
    ).rejects.toThrow();
    const after = await Promise.all(
      [
        s.people,
        s.companies,
        s.relationships,
        s.contactContributions,
        s.contactImportBatches,
        s.changeEvents,
      ].map((table) => local.db.select().from(table)),
    );
    expect(after).toEqual(before);
  } finally {
    await local.client.exec(
      "DROP TRIGGER reject_csv_fixture ON people; DROP FUNCTION reject_csv_fixture();",
    );
  }
});
