/**
 * Display formatting for the inventory screens.
 *
 * Timestamps arrive in Postgres' text form — "2026-01-15 09:30:00.123+00" —
 * which Chrome's `Date.parse` accepts and Safari's rejects. `parseTimestamp`
 * rewrites it to strict ISO-8601 first, so iPhones show the same dates.
 */
export function parseTimestamp(value: string): Date {
  const iso = value
    .trim()
    .replace(" ", "T")
    .replace(/([+-]\d{2})$/, "$1:00");
  return new Date(iso);
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatDateTime(timestamp: string): string {
  const date = parseTimestamp(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : dateTimeFormat.format(date);
}

/** A calendar date (`YYYY-MM-DD`), shown without any timezone shift. */
export function formatCalendarDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  return dateFormat.format(new Date(year, month - 1, day));
}

/**
 * "BDT 1,250.50". The amount is a decimal string from the API; grouping is
 * added to the whole part only, so no float rounding ever touches it.
 */
export function formatMoney(amount: string, currencySymbol: string): string {
  const [whole, fraction = "00"] = amount.split(".");
  const negative = whole.startsWith("-");
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${currencySymbol} ${grouped}.${fraction.padEnd(2, "0")}`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
