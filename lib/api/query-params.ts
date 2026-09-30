import type { NextResponse } from "next/server";
import { isCalendarDate } from "../dates.ts";
import { apiError, type ApiFailure } from "./response.ts";

/**
 * Query-string parsing shared by the list endpoints. Each parser answers
 * either the value or the 422 to send, so a route reads as a straight line.
 */

type Parsed<T> = { ok: true; value: T } | { ok: false; response: NextResponse<ApiFailure> };

function invalid(param: string, message: string): Parsed<never> {
  return {
    ok: false,
    response: apiError("VALIDATION_ERROR", message, 422, { [param]: [message] }),
  };
}

export interface Pagination {
  page: number;
  pageSize: number;
  offset: number;
}

/** `?page=1&pageSize=20` — 1-based pages, at most 100 rows per page. */
export function parsePagination(
  params: URLSearchParams,
  defaultPageSize = 20,
): Parsed<Pagination> {
  const page = parseIntParam(params, "page", { min: 1, max: 100_000 });
  if (!page.ok) return page;
  const pageSize = parseIntParam(params, "pageSize", { min: 1, max: 100 });
  if (!pageSize.ok) return pageSize;

  const resolvedPage = page.value ?? 1;
  const resolvedSize = pageSize.value ?? defaultPageSize;
  return {
    ok: true,
    value: {
      page: resolvedPage,
      pageSize: resolvedSize,
      offset: (resolvedPage - 1) * resolvedSize,
    },
  };
}

export function parseIntParam(
  params: URLSearchParams,
  name: string,
  range: { min: number; max: number },
): Parsed<number | null> {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return { ok: true, value: null };
  if (!/^-?\d+$/.test(raw.trim())) {
    return invalid(name, `${name} must be a whole number.`);
  }
  const value = Number(raw);
  if (value < range.min || value > range.max) {
    return invalid(name, `${name} must be between ${range.min} and ${range.max}.`);
  }
  return { ok: true, value };
}

export function parseEnumParam<T extends string>(
  params: URLSearchParams,
  name: string,
  allowed: readonly T[],
  fallback: T,
): Parsed<T> {
  const raw = params.get(name);
  if (raw === null || raw === "") return { ok: true, value: fallback };
  if (!(allowed as readonly string[]).includes(raw)) {
    return invalid(name, `${name} must be one of: ${allowed.join(", ")}.`);
  }
  return { ok: true, value: raw as T };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseUuidParam(
  params: URLSearchParams,
  name: string,
): Parsed<string | null> {
  const raw = params.get(name);
  if (raw === null || raw === "") return { ok: true, value: null };
  if (!UUID.test(raw)) return invalid(name, `${name} must be a valid id.`);
  return { ok: true, value: raw };
}

/** A calendar date, `YYYY-MM-DD`. */
export function parseDateParam(
  params: URLSearchParams,
  name: string,
): Parsed<string | null> {
  const raw = params.get(name);
  if (raw === null || raw === "") return { ok: true, value: null };
  if (!isCalendarDate(raw)) return invalid(name, `${name} must be a date (YYYY-MM-DD).`);
  return { ok: true, value: raw };
}

/**
 * An instant, as an ISO-8601 timestamp with an offset. Range filters on
 * `created_at` take instants rather than dates because only the client knows
 * where the shop's day starts and ends.
 */
export function parseInstantParam(
  params: URLSearchParams,
  name: string,
): Parsed<string | null> {
  const raw = params.get(name);
  if (raw === null || raw === "") return { ok: true, value: null };
  const time = Date.parse(raw);
  if (!/T.*(Z|[+-]\d{2}:?\d{2})$/i.test(raw) || Number.isNaN(time)) {
    return invalid(name, `${name} must be an ISO timestamp with a timezone, e.g. 2026-01-31T18:00:00Z.`);
  }
  return { ok: true, value: new Date(time).toISOString() };
}
