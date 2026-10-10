import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import { recordContactSubmission } from "./contact-attribution";
import { authorize, DomainError, type Principal } from "./policy";
import { assertProductActive } from "./products";
import { companyDomain, linkedinUrl } from "./records";
import { lockOrganization } from "./visibility";

export * from "./csv";

import { detectColumnMapping, parseCsv } from "./csv";

export const csvImportPreviewSchema = z.object({
  organizationId: z.uuid(),
  productId: z.uuid(),
  csvText: z.string().min(1).max(5000000),
  columnMapping: z.record(z.string(), z.string()).optional(),
  purpose: z.enum(["buyer", "partner"]).default("buyer"),
});

export const csvImportSchema = z.object({
  organizationId: z.uuid(),
  productId: z.uuid(),
  csvText: z.string().min(1).max(5000000),
  columnMapping: z.record(z.string(), z.string()).optional(),
  purpose: z.enum(["buyer", "partner"]).default("buyer"),
  skipDuplicates: z.boolean().default(false),
  rowIndices: z.array(z.number().int().positive()).optional(),
  label: z.string().trim().min(1).max(150).default("CSV Import"),
});

export interface ValidatedPerson {
  name: string;
  email?: string;
  title: string;
  phone: string;
  linkedinUrl: string;
  summary: string;
}

export interface ValidatedCompany {
  name?: string;
  domain?: string;
  description: string;
}

export interface ValidatedRow {
  rowIndex: number;
  person: ValidatedPerson;
  company?: ValidatedCompany;
}

export interface DuplicateReason {
  kind: "person_email" | "company_domain" | "csv_duplicate";
  message: string;
  existingId?: string;
  existingName?: string;
}

export interface DuplicateRow {
  rowIndex: number;
  person: ValidatedPerson;
  company?: ValidatedCompany;
  reasons: DuplicateReason[];
}

export interface InvalidRow {
  rowIndex: number;
  row: Record<string, string>;
  errors: string[];
}

export interface PreviewResult {
  summary: {
    totalRows: number;
    validCount: number;
    duplicateCount: number;
    invalidCount: number;
    headers: string[];
    detectedMapping: Record<string, string>;
  };
  validRows: ValidatedRow[];
  duplicateRows: DuplicateRow[];
  invalidRows: InvalidRow[];
}

export interface ImportResult {
  totalRows: number;
  importedCount: number;
  peopleCreated: number;
  companiesCreated: number;
  relationshipsCreated: number;
  duplicateCount: number;
  invalidCount: number;
  imported: Array<{
    rowIndex: number;
    personId: string;
    companyId?: string;
    relationshipId: string;
  }>;
  duplicates: DuplicateRow[];
  invalid: InvalidRow[];
}

const phonePattern = /^[+\d\s().-]*$/;

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Transaction;

export class CsvImportService {
  constructor(private db: Database) {}

  private prepareRows(
    headers: string[],
    rawRows: string[][],
    columnMapping?: Record<string, string>,
  ) {
    const mapping: Record<string, string> = {
      ...detectColumnMapping(headers),
      ...(columnMapping ?? {}),
    };

    const parsedRows: Array<{
      rowIndex: number;
      raw: Record<string, string>;
      values: Record<string, string>;
    }> = [];

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const raw: Record<string, string> = {};
      const values: Record<string, string> = {};

      for (let c = 0; c < headers.length; c++) {
        const header = headers[c];
        const val = row[c] ?? "";
        raw[header] = val;
        const target = mapping[header];
        if (target && target !== "ignore") {
          values[target] = val.trim();
        }
      }
      parsedRows.push({ rowIndex: i + 1, raw, values });
    }

    return { mapping, parsedRows };
  }

  /**
   * Preview a CSV import without writing changes.
   * Identifies valid rows, invalid rows, and rows that collide with existing people/companies
   * or duplicate other rows in the file for duplicate review.
   */
  async preview(
    principal: Principal,
    rawInput: z.input<typeof csvImportPreviewSchema>,
    executor: Reader = this.db,
  ): Promise<PreviewResult> {
    const input = csvImportPreviewSchema.parse(rawInput);
    await authorize(executor, principal, input.organizationId);
    await assertProductActive(executor, input.organizationId, input.productId);
    if (
      principal.productIds &&
      !principal.productIds.includes(input.productId)
    ) {
      throw new DomainError("FORBIDDEN", 403);
    }

    const { headers, rows: rawRows } = parseCsv(input.csvText);
    const { mapping, parsedRows } = this.prepareRows(
      headers,
      rawRows,
      input.columnMapping,
    );

    const [existingPeople, existingCompanies] = await Promise.all([
      executor
        .select({ id: s.people.id, name: s.people.name, email: s.people.email })
        .from(s.people)
        .where(
          and(
            eq(s.people.organizationId, input.organizationId),
            isNull(s.people.archivedAt),
          ),
        ),
      executor
        .select({
          id: s.companies.id,
          name: s.companies.name,
          domain: s.companies.domain,
        })
        .from(s.companies)
        .where(
          and(
            eq(s.companies.organizationId, input.organizationId),
            isNull(s.companies.archivedAt),
          ),
        ),
    ]);

    const peopleByEmail = new Map<string, { id: string; name: string }>();
    for (const p of existingPeople) {
      if (p.email) peopleByEmail.set(p.email.toLowerCase(), p);
    }

    const companiesByDomain = new Map<string, { id: string; name: string }>();
    for (const c of existingCompanies) {
      if (c.domain) companiesByDomain.set(c.domain.toLowerCase(), c);
    }

    const validRows: ValidatedRow[] = [];
    const duplicateRows: DuplicateRow[] = [];
    const invalidRows: InvalidRow[] = [];
    const seenEmailsInCsv = new Set<string>();

    const emailCounts = new Map<string, number>();
    for (const { values } of parsedRows) {
      if (values.email) {
        const parsedEmail = z
          .string()
          .trim()
          .toLowerCase()
          .pipe(z.email().max(254))
          .safeParse(values.email);
        if (parsedEmail.success) {
          const e = parsedEmail.data;
          emailCounts.set(e, (emailCounts.get(e) ?? 0) + 1);
        }
      }
    }

    for (const { rowIndex, raw, values } of parsedRows) {
      const errors: string[] = [];

      const rawName = values.name ?? "";
      if (!rawName) {
        errors.push("Person name is required");
      } else if (rawName.length > 100) {
        errors.push("Person name must be 100 characters or fewer");
      }

      let email: string | undefined;
      if (values.email) {
        const parsedEmail = z
          .string()
          .trim()
          .toLowerCase()
          .pipe(z.email().max(254))
          .safeParse(values.email);
        if (!parsedEmail.success) {
          errors.push(`Invalid email address: ${values.email}`);
        } else {
          email = parsedEmail.data;
        }
      }

      let compDomain: string | undefined;
      if (values.companyDomain) {
        const parsedDomain = companyDomain.safeParse(values.companyDomain);
        if (!parsedDomain.success || !parsedDomain.data) {
          errors.push(`Invalid company domain: ${values.companyDomain}`);
        } else {
          compDomain = parsedDomain.data;
        }
      }

      let linkedIn: string = "";
      if (values.linkedinUrl) {
        const parsedLinkedin = linkedinUrl.safeParse(values.linkedinUrl);
        if (!parsedLinkedin.success) {
          errors.push(`Invalid LinkedIn URL: ${values.linkedinUrl}`);
        } else {
          linkedIn = parsedLinkedin.data;
        }
      }

      const phone = values.phone ?? "";
      if (phone && (!phonePattern.test(phone) || phone.length > 40)) {
        errors.push(`Invalid phone number: ${phone}`);
      }

      const compName = values.companyName
        ? values.companyName.slice(0, 100)
        : undefined;
      const compDesc = values.companyDescription
        ? values.companyDescription.slice(0, 2000)
        : "";
      const title = values.title ? values.title.slice(0, 150) : "";
      const summary = values.summary ? values.summary.slice(0, 10000) : "";

      if (errors.length > 0) {
        invalidRows.push({ rowIndex, row: raw, errors });
        continue;
      }

      const person: ValidatedPerson = {
        name: rawName,
        email,
        title,
        phone,
        linkedinUrl: linkedIn,
        summary,
      };

      const company: ValidatedCompany | undefined =
        compName || compDomain || compDesc
          ? {
              name: compName,
              domain: compDomain,
              description: compDesc,
            }
          : undefined;

      const reasons: DuplicateReason[] = [];

      if (email) {
        const existingPerson = peopleByEmail.get(email);
        if (existingPerson) {
          reasons.push({
            kind: "person_email",
            message: `Email "${email}" already belongs to ${existingPerson.name} in this organization.`,
            existingId: existingPerson.id,
            existingName: existingPerson.name,
          });
        } else if ((emailCounts.get(email) ?? 0) > 1) {
          reasons.push({
            kind: "csv_duplicate",
            message: `Email "${email}" appears multiple times in this CSV.`,
          });
        }
      }

      if (compDomain) {
        const existingComp = companiesByDomain.get(compDomain);
        if (existingComp) {
          reasons.push({
            kind: "company_domain",
            message: `Company domain "${compDomain}" already belongs to ${existingComp.name} in this organization.`,
            existingId: existingComp.id,
            existingName: existingComp.name,
          });
        }
      }

      if (reasons.length > 0) {
        duplicateRows.push({ rowIndex, person, company, reasons });
        if (email) seenEmailsInCsv.add(email);
      } else {
        validRows.push({ rowIndex, person, company });
        if (email) seenEmailsInCsv.add(email);
      }
    }

    return {
      summary: {
        totalRows: parsedRows.length,
        validCount: validRows.length,
        duplicateCount: duplicateRows.length,
        invalidCount: invalidRows.length,
        headers,
        detectedMapping: mapping,
      },
      validRows,
      duplicateRows,
      invalidRows,
    };
  }

  /**
   * Execute CSV import.
   * If skipDuplicates is false and duplicates exist, rejects with PERSON_EXISTS / COMPANY_EXISTS
   * so records are never silently merged.
   * If skipDuplicates is true, imports valid non-duplicate rows while recording provenance.
   */
  async importCsv(
    principal: Principal,
    rawInput: z.input<typeof csvImportSchema>,
  ): Promise<ImportResult> {
    const input = csvImportSchema.parse(rawInput);
    await authorize(this.db, principal, input.organizationId);
    await assertProductActive(this.db, input.organizationId, input.productId);
    if (
      principal.productIds &&
      !principal.productIds.includes(input.productId)
    ) {
      throw new DomainError("FORBIDDEN", 403);
    }

    return this.db.transaction(async (tx) => {
      await lockOrganization(tx, input.organizationId);

      const preview = await this.preview(
        principal,
        {
          organizationId: input.organizationId,
          productId: input.productId,
          csvText: input.csvText,
          columnMapping: input.columnMapping,
          purpose: input.purpose,
        },
        tx,
      );

      const allowedIndices = input.rowIndices
        ? new Set(input.rowIndices)
        : null;

      const candidateValid = allowedIndices
        ? preview.validRows.filter((r) => allowedIndices.has(r.rowIndex))
        : preview.validRows;
      const candidateDuplicates = allowedIndices
        ? preview.duplicateRows.filter((r) => allowedIndices.has(r.rowIndex))
        : preview.duplicateRows;
      const candidateInvalid = allowedIndices
        ? preview.invalidRows.filter((r) => allowedIndices.has(r.rowIndex))
        : preview.invalidRows;

      if (!input.skipDuplicates && candidateDuplicates.length > 0) {
        const firstReason = candidateDuplicates[0].reasons[0];
        if (firstReason?.kind === "company_domain") {
          throw new DomainError("COMPANY_EXISTS", 409);
        }
        throw new DomainError("PERSON_EXISTS", 409);
      }

      if (candidateValid.length === 0) {
        return {
          totalRows: preview.summary.totalRows,
          importedCount: 0,
          peopleCreated: 0,
          companiesCreated: 0,
          relationshipsCreated: 0,
          duplicateCount: candidateDuplicates.length,
          invalidCount: candidateInvalid.length,
          imported: [],
          duplicates: candidateDuplicates,
          invalid: candidateInvalid,
        };
      }

      const [firstStage] = await tx
        .select({ id: s.stages.id })
        .from(s.stages)
        .where(
          and(
            eq(s.stages.organizationId, input.organizationId),
            eq(s.stages.productId, input.productId),
            eq(s.stages.pipeline, "outreach"),
            eq(s.stages.category, "open"),
            isNull(s.stages.archivedAt),
          ),
        )
        .orderBy(asc(s.stages.position))
        .limit(1);

      await tx
        .insert(s.contactImportBatches)
        .values({
          organizationId: input.organizationId,
          productId: input.productId,
          submittedBy: principal.userId,
          sourceKind: "file",
          label: input.label || "CSV Import",
          submissionKey: `csv-import-${randomUUID()}`,
          transport: principal.source === "mcp" ? "mcp" : "session",
        })
        .returning();

      const createdCompaniesByKey = new Map<string, string>();
      let companiesCreatedCount = 0;

      for (const row of candidateValid) {
        if (row.company && (row.company.domain || row.company.name)) {
          const key = row.company.domain
            ? `domain:${row.company.domain.toLowerCase()}`
            : `name:${row.company.name?.toLowerCase()}`;

          if (!createdCompaniesByKey.has(key)) {
            const companyName =
              row.company.name ||
              (row.company.domain
                ? row.company.domain.split(".")[0].toUpperCase()
                : "Company");

            const [createdComp] = await tx
              .insert(s.companies)
              .values({
                organizationId: input.organizationId,
                name: companyName,
                domain: row.company.domain || null,
                description: row.company.description || "",
              })
              .returning();

            createdCompaniesByKey.set(key, createdComp.id);
            companiesCreatedCount++;

            await tx.insert(s.changeEvents).values({
              organizationId: input.organizationId,
              actorId: principal.userId,
              type: "company.created",
              entityId: createdComp.id,
            });
          }
        }
      }

      const importedList: Array<{
        rowIndex: number;
        personId: string;
        companyId?: string;
        relationshipId: string;
      }> = [];

      for (const row of candidateValid) {
        let companyId: string | null = null;
        if (row.company && (row.company.domain || row.company.name)) {
          const key = row.company.domain
            ? `domain:${row.company.domain.toLowerCase()}`
            : `name:${row.company.name?.toLowerCase()}`;
          companyId = createdCompaniesByKey.get(key) ?? null;
        }

        const [person] = await tx
          .insert(s.people)
          .values({
            organizationId: input.organizationId,
            name: row.person.name,
            title: row.person.title || "",
            email: row.person.email || null,
            phone: row.person.phone || "",
            linkedinUrl: row.person.linkedinUrl || "",
            summary: row.person.summary || "",
            companyId,
          })
          .returning();

        const [rel] = await tx
          .insert(s.relationships)
          .values({
            organizationId: input.organizationId,
            productId: input.productId,
            personId: person.id,
            ownerId: principal.userId,
            purpose: input.purpose,
            context: row.person.summary || "",
            stageId: firstStage?.id ?? null,
          })
          .returning();

        await recordContactSubmission(tx, principal, {
          organizationId: input.organizationId,
          personId: person.id,
          productId: input.productId,
          kind: "created",
          sourceRecordId: String(row.rowIndex),
        });

        await tx.insert(s.changeEvents).values([
          {
            organizationId: input.organizationId,
            actorId: principal.userId,
            type: "person.created",
            entityId: person.id,
          },
          {
            organizationId: input.organizationId,
            actorId: principal.userId,
            type: "relationship.created",
            entityId: rel.id,
          },
        ]);

        importedList.push({
          rowIndex: row.rowIndex,
          personId: person.id,
          companyId: companyId ?? undefined,
          relationshipId: rel.id,
        });
      }

      return {
        totalRows: preview.summary.totalRows,
        importedCount: importedList.length,
        peopleCreated: importedList.length,
        companiesCreated: companiesCreatedCount,
        relationshipsCreated: importedList.length,
        duplicateCount: candidateDuplicates.length,
        invalidCount: candidateInvalid.length,
        imported: importedList,
        duplicates: candidateDuplicates,
        invalid: candidateInvalid,
      };
    });
  }
}
