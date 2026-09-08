import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export type ApiSuccess<T> = { ok: true; data: T };

export type ApiFailure = {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;

    details?: Record<string, string[]>;
  };
};

export type ApiResponseBody<T> = ApiSuccess<T> | ApiFailure;

/** Closed set so clients can exhaustively switch on it. */
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_CREDENTIALS"
  | "EMAIL_TAKEN"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "ACCOUNT_DISABLED"
  | "TENANT_SUSPENDED"
  | "PIN_NOT_SET"
  | "PIN_LOCKED"
  | "SUBSCRIPTION_INACTIVE"
  | "INTERNAL_ERROR";

export function apiSuccess<T>(
  data: T,
  status = 200,
): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true, data } satisfies ApiSuccess<T>, {
    status,
  });
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: Record<string, string[]>,
): NextResponse<ApiFailure> {
  return NextResponse.json(
    {
      ok: false,
      error: details ? { code, message, details } : { code, message },
    } satisfies ApiFailure,
    { status },
  );
}

export function validationError(error: ZodError): NextResponse<ApiFailure> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join(".") : "_";
    (details[path] ??= []).push(issue.message);
  }
  return apiError(
    "VALIDATION_ERROR",
    "The submitted data is invalid.",
    422,
    details,
  );
}

export async function readJsonBody(
  request: Request,
): Promise<
  | { ok: true; value: unknown }
  | { ok: false; response: NextResponse<ApiFailure> }
> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return {
      ok: false,
      response: apiError(
        "VALIDATION_ERROR",
        "Request body must be valid JSON.",
        400,
      ),
    };
  }
}
