import type { FieldValues, Resolver } from "react-hook-form";
import type { ZodType } from "zod";

/**
 * React Hook Form resolver for a Zod 4 schema.
 *
 * Normally this is `@hookform/resolvers/zod`, but that package declares an
 * optional peer on `effect`, and this tree already resolves `effect` to a
 * version npm refuses to reconcile with it (`npm install` fails with
 * ERESOLVE). Forcing the install would leave a dependency graph npm itself
 * calls incorrect, for a package whose entire job is the twenty lines below —
 * so the twenty lines are here instead, and the schema stays the one authored
 * in `lib/tenant/settings.ts`.
 *
 * Swap this for the official resolver whenever the peer conflict clears.
 */
export function zodResolver<TFieldValues extends FieldValues>(
  // Typed loosely on purpose: a schema with `.transform(...)` has an output
  // type that differs from the form's value type, and threading both through
  // RHF's generics costs more in casts at every call site than it buys. The
  // caller names the form type; the schema is the runtime authority.
  schema: ZodType,
): Resolver<TFieldValues> {
  return async (values) => {
    const result = await schema.safeParseAsync(values);

    if (result.success) {
      return { values, errors: {} };
    }

    const errors: Record<string, { type: string; message: string }> = {};
    for (const issue of result.error.issues) {
      // First message per field wins — RHF shows one error per input, and the
      // first is the one closest to what the user just typed.
      const path = issue.path.join(".") || "root";
      errors[path] ??= { type: issue.code ?? "validation", message: issue.message };
    }

    return {
      values: {} as TFieldValues,
      errors: errors as never,
    };
  };
}
