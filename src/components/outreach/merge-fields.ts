import t from "@crm/i18n/translations/en.json";

export interface MergePerson {
  name: string;
  title?: string | null;
  company?: string | null;
}
export interface MergePart {
  text: string;
  field?: string;
  missing?: boolean;
}

const token = /\{([^{}]+)\}/g;

function value(field: string, person: MergePerson) {
  const words = person.name.trim().split(/\s+/).filter(Boolean);
  const fields: Record<string, string | null | undefined> = {
    "first name": words[0],
    "last name": words.length > 1 ? words.slice(1).join(" ") : "",
    "full name": person.name.trim(),
    name: person.name.trim(),
    title: person.title,
    company: person.company,
  };
  return fields[field]?.trim() ?? "";
}

export function hasMergeFields(template: string) {
  return /\{[^{}]+\}/.test(template);
}

export function mergeParts(template: string, person: MergePerson) {
  const parts: MergePart[] = [];
  let last = 0;
  for (const match of template.matchAll(token)) {
    const start = match.index;
    if (start > last) parts.push({ text: template.slice(last, start) });
    const field = (match[1] ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const filled = value(field, person);
    parts.push(
      filled
        ? { text: filled, field }
        : {
            text: t.mergeFieldMissing.replace("{field}", field),
            field,
            missing: true,
          },
    );
    last = start + match[0].length;
  }
  if (last < template.length) parts.push({ text: template.slice(last) });
  return parts;
}

export function mergeText(template: string, person: MergePerson) {
  return mergeParts(template, person)
    .map((part) => part.text)
    .join("");
}
