import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/client";
import * as s from "../database/schema";
import t from "../i18n/translations/en.json";
import {
  attributionHash,
  recordContactSubmission,
} from "./contact-attribution";
import { authorize, DomainError, type Principal } from "./policy";
import { assertProductActive } from "./products";
import { companyDomain, linkedinUrl } from "./records";
import { linkedinKey, lockOrganization } from "./visibility";

export * from "./csv";

import { allowedFields, detectColumnMapping, parseCsv } from "./csv";

export const csvImportPreviewSchema = z.object({
  organizationId: z.uuid(),
  productId: z.uuid(),
  csvText: z.string().min(1).max(5000000),
  columnMapping: z.record(z.string(), z.enum(allowedFields)).optional(),
  mode: z
    .enum(["contacts", "companies"])
    .default("contacts")
    .describe(
      "contacts creates people with product relationships and optional companies; companies creates organization companies without people or relationships",
    ),
  purpose: z.enum(["buyer", "partner"]).default("buyer"),
});

export const csvImportSchema = csvImportPreviewSchema.extend({
  skipDuplicates: z.boolean().default(false),
  rowIndices: z.array(z.number().int().positive()).optional(),
  label: z.string().trim().min(1).max(150).default(t.importCsv),
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
  kind: "person_email" | "person_linkedin" | "company_domain" | "csv_duplicate";
  code:
    | "PERSON_EMAIL_EXISTS"
    | "PERSON_LINKEDIN_EXISTS"
    | "COMPANY_DOMAIN_EXISTS"
    | "CSV_DUPLICATE";
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
  companyIds?: string[];
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

    const targets = new Set<string>();
    for (const [header, target] of Object.entries(mapping)) {
      if (
        !headers.includes(header) ||
        !allowedFields.includes(target as (typeof allowedFields)[number])
      )
        throw new DomainError("CSV_MAPPING_INVALID", 400);
      if (target !== "ignore") {
        if (targets.has(target))
          throw new DomainError("CSV_MAPPING_INVALID", 400);
        targets.add(target);
      }
    }

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
    await authorize(executor, principal, input.organizationId, input.productId);
    await assertProductActive(executor, input.organizationId, input.productId);
    let parsed: ReturnType<typeof parseCsv>;
    try {
      parsed = parseCsv(input.csvText);
    } catch {
      throw new DomainError("CSV_STRUCTURE_INVALID", 400);
    }
    const { headers, rows: rawRows } = parsed;
    const { mapping, parsedRows } = this.prepareRows(
      headers,
      rawRows,
      input.columnMapping,
    );
    if (
      input.mode === "companies" &&
      Object.values(mapping).some(
        (field) => field !== "ignore" && !field.startsWith("company"),
      )
    )
      throw new DomainError("CSV_MAPPING_INVALID", 400);

    // The directory is organization-wide, including archived records and aliases.
    // Collision responses deliberately contain no stored record identifiers or names.
    const [existingPeople, existingCompanies] = await Promise.all([
      executor
        .select({
          email: s.people.email,
          otherEmails: s.people.otherEmails,
          linkedin: linkedinKey(s.people.linkedinUrl),
        })
        .from(s.people)
        .where(eq(s.people.organizationId, input.organizationId)),
      executor
        .select({ domain: s.companies.domain })
        .from(s.companies)
        .where(eq(s.companies.organizationId, input.organizationId)),
    ]);
    const emails = new Set(
      existingPeople
        .flatMap((person) => [person.email ?? "", ...person.otherEmails])
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    );
    const linkedins = new Set(
      existingPeople.map((person) => String(person.linkedin)).filter(Boolean),
    );
    const domains = new Set(
      existingCompanies
        .map((company) => company.domain?.toLowerCase())
        .filter(Boolean),
    );
    // Use the same database normalization expression as contact identity matching.
    const profiles = [
      ...new Set(
        parsedRows.map((row) => row.values.linkedinUrl).filter(Boolean),
      ),
    ];
    const profileKeys = new Map<string, string>();
    if (profiles.length) {
      const normalized = await executor
        .select({
          profile: sql<string>`profile`,
          key: linkedinKey(sql`profile`).mapWith(String),
        })
        .from(
          sql`jsonb_array_elements_text(${JSON.stringify(profiles)}::jsonb) AS profile`,
        );
      for (const row of normalized) profileKeys.set(row.profile, row.key);
    }
    const counts = new Map<string, number>();
    for (const { values } of parsedRows) {
      const keys =
        input.mode === "companies"
          ? [
              values.companyDomain
                ? `domain:${companyDomain.safeParse(values.companyDomain).data}`
                : `company:${values.companyName?.toLowerCase()}`,
            ]
          : [
              values.email ? `email:${values.email.toLowerCase()}` : "",
              values.linkedinUrl
                ? `linkedin:${profileKeys.get(values.linkedinUrl)}`
                : "",
            ];
      for (const key of keys.filter(Boolean))
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const validRows: ValidatedRow[] = [];
    const duplicateRows: DuplicateRow[] = [];
    const invalidRows: InvalidRow[] = [];
    for (const { rowIndex, raw, values } of parsedRows) {
      const errors: string[] = [];
      const rawName = values.name ?? "";
      if (input.mode === "contacts" && !rawName)
        errors.push("PERSON_NAME_REQUIRED");
      if (
        input.mode === "companies" &&
        !values.companyName &&
        !values.companyDomain
      )
        errors.push("COMPANY_IDENTITY_REQUIRED");
      for (const [field, max, code] of [
        ["name", 100, "PERSON_NAME_TOO_LONG"],
        ["title", 150, "TITLE_TOO_LONG"],
        ["companyName", 100, "COMPANY_NAME_TOO_LONG"],
        ["companyDescription", 2000, "COMPANY_DESCRIPTION_TOO_LONG"],
        ["summary", 10000, "SUMMARY_TOO_LONG"],
      ] as const) {
        if ((values[field]?.length ?? 0) > max) errors.push(code);
      }
      let email: string | undefined;
      if (values.email) {
        const result = z
          .string()
          .trim()
          .toLowerCase()
          .pipe(z.email().max(254))
          .safeParse(values.email);
        if (!result.success) errors.push("EMAIL_INVALID");
        else email = result.data;
      }
      let compDomain: string | undefined;
      if (values.companyDomain) {
        const result = companyDomain.safeParse(values.companyDomain);
        if (!result.success || !result.data)
          errors.push("COMPANY_DOMAIN_INVALID");
        else compDomain = result.data;
      }
      let linkedIn = "";
      if (values.linkedinUrl) {
        const result = linkedinUrl.safeParse(values.linkedinUrl);
        if (!result.success) errors.push("LINKEDIN_INVALID");
        else linkedIn = result.data;
      }
      const phone = values.phone ?? "";
      if (phone && (!phonePattern.test(phone) || phone.length > 40))
        errors.push("PHONE_INVALID");
      if (errors.length) {
        invalidRows.push({ rowIndex, row: raw, errors });
        continue;
      }
      const person: ValidatedPerson = {
        name: rawName,
        email,
        title: values.title ?? "",
        phone,
        linkedinUrl: linkedIn,
        summary: values.summary ?? "",
      };
      const company =
        values.companyName || compDomain || values.companyDescription
          ? {
              name: values.companyName || undefined,
              domain: compDomain,
              description: values.companyDescription ?? "",
            }
          : undefined;
      const reasons: DuplicateReason[] = [];
      const profile = profileKeys.get(linkedIn);
      if (email && emails.has(email))
        reasons.push({ kind: "person_email", code: "PERSON_EMAIL_EXISTS" });
      if (profile && linkedins.has(profile))
        reasons.push({
          kind: "person_linkedin",
          code: "PERSON_LINKEDIN_EXISTS",
        });
      if (compDomain && domains.has(compDomain))
        reasons.push({ kind: "company_domain", code: "COMPANY_DOMAIN_EXISTS" });
      const duplicateInCsv =
        input.mode === "companies"
          ? (counts.get(
              compDomain
                ? `domain:${compDomain}`
                : `company:${company?.name?.toLowerCase()}`,
            ) ?? 0) > 1
          : (email && (counts.get(`email:${email}`) ?? 0) > 1) ||
            (profile && (counts.get(`linkedin:${profile}`) ?? 0) > 1);
      if (duplicateInCsv)
        reasons.push({ kind: "csv_duplicate", code: "CSV_DUPLICATE" });
      if (reasons.length)
        duplicateRows.push({ rowIndex, person, company, reasons });
      else validRows.push({ rowIndex, person, company });
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
    return this.db.transaction(async (tx) => {
      await lockOrganization(tx, input.organizationId);
      await authorize(
        tx,
        principal,
        input.organizationId,
        input.productId,
        true,
      );
      await assertProductActive(tx, input.organizationId, input.productId);

      const preview = await this.preview(
        principal,
        {
          organizationId: input.organizationId,
          productId: input.productId,
          csvText: input.csvText,
          columnMapping: input.columnMapping,
          purpose: input.purpose,
          mode: input.mode,
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
        if (
          input.mode === "companies" ||
          firstReason?.kind === "company_domain"
        ) {
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

      const [batch] = await tx
        .insert(s.contactImportBatches)
        .values({
          organizationId: input.organizationId,
          productId: input.productId,
          submittedBy: principal.userId,
          sourceKind: "file",
          label: input.label,
          submissionKey: `csv-import-${randomUUID()}`,
          transport: principal.source,
          clientId: principal.source === "mcp" ? principal.clientId : null,
          grantId: principal.source === "mcp" ? principal.grantId : null,
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
                : t.company);

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

      if (input.mode === "companies")
        return {
          totalRows: preview.summary.totalRows,
          importedCount: candidateValid.length,
          peopleCreated: 0,
          companiesCreated: companiesCreatedCount,
          relationshipsCreated: 0,
          duplicateCount: candidateDuplicates.length,
          invalidCount: candidateInvalid.length,
          imported: [],
          companyIds: [...createdCompaniesByKey.values()],
          duplicates: candidateDuplicates,
          invalid: candidateInvalid,
        };

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
          submission: { batch },
          requestHash: attributionHash({
            mode: input.mode,
            purpose: input.purpose,
            row,
          }),
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
