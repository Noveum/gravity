export interface RecordLinks {
  readonly app: string;
  readonly pipeline: (key: string) => string;
  readonly lead: (key: string) => string;
  readonly person: (id: string) => string;
  readonly company: (id: string) => string;
}

export function recordLinks(baseUrl: string): RecordLinks {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    app: `${base}/leads`,
    pipeline: (key) => `${base}/leads/${encodeURIComponent(key)}`,
    lead: (key) => `${base}/l/${encodeURIComponent(key)}`,
    person: (id) => `${base}/people/${encodeURIComponent(id)}`,
    company: (id) => `${base}/companies/${encodeURIComponent(id)}`,
  };
}
