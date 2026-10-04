export const IMPORT_FORMATS = ['csv', 'json'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

export const IMPORT_TARGETS = ['people', 'companies', 'leads'] as const;
export type ImportTarget = (typeof IMPORT_TARGETS)[number];

export const IMPORT_TARGET_LABELS: Readonly<Record<ImportTarget, string>> = {
  people: 'People',
  companies: 'Companies',
  leads: 'Leads',
};

export const IMPORT_DEFAULT_OWNERS = ['me', 'none'] as const;
export type ImportDefaultOwner = (typeof IMPORT_DEFAULT_OWNERS)[number];

export const MAX_IMPORT_BYTES = 2_000_000;
export const MAX_IMPORT_ROWS = 2_000;
export const MAX_CLI_IMPORT_ROWS = 50_000;
export const MAX_IMPORT_COLUMNS = 100;
export const MAX_IMPORT_CELL_LENGTH = 5_000;
export const MAX_IMPORT_HEADER_LENGTH = 500;
export const IMPORT_CHUNK_ROWS = 100;
export const IMPORT_PREVIEW_CHUNK_ROWS = 500;

export interface ImportLimits {
  readonly maxBytes: number;
  readonly maxRows: number;
}

export const HTTP_IMPORT_LIMITS: ImportLimits = {
  maxBytes: MAX_IMPORT_BYTES,
  maxRows: MAX_IMPORT_ROWS,
};

export const CLI_IMPORT_LIMITS: ImportLimits = {
  maxBytes: 50_000_000,
  maxRows: MAX_CLI_IMPORT_ROWS,
};
