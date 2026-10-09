import { parseTimestamp } from "./format.ts";
export function formatCount(value: string | number) {
  return typeof value === "number" ? value.toLocaleString("en-US") : BigInt(value).toLocaleString("en-US");
}
export function formatDashboardDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dhaka" }).format(parseTimestamp(value));
}
