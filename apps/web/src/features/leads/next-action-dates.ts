export interface DateChoice {
  readonly label: string;
  readonly at: string | null;
}

function atNineLocal(base: Date, days: number): string {
  const day = new Date(base);
  day.setDate(day.getDate() + days);
  day.setHours(9, 0, 0, 0);
  return day.toISOString();
}

export function nextActionChoices(now: Date): DateChoice[] {
  const toMonday = (8 - now.getDay()) % 7 || 7;
  return [
    { label: 'Tomorrow', at: atNineLocal(now, 1) },
    { label: 'In 3 days', at: atNineLocal(now, 3) },
    { label: 'Next week', at: atNineLocal(now, toMonday) },
  ];
}

export function holdChoices(now: Date): DateChoice[] {
  return [
    { label: 'No end date', at: null },
    { label: 'One week', at: atNineLocal(now, 7) },
    { label: 'One month', at: atNineLocal(now, 30) },
    { label: 'Three months', at: atNineLocal(now, 90) },
  ];
}
