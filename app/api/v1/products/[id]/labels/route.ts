import { z } from "zod";
import { withTenantAuth } from "@/lib/api/guard.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import { listArticleLabels } from "@/lib/inventory/article-labels.ts";
import { MAX_ARTICLE_NUMBER } from "@/lib/inventory/article-numbers.ts";

type Context = { params: Promise<{ id: string }> };
const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(100),
  variantId: z.uuid().optional(),
  articleNumber: z.coerce.number().int().min(1).max(MAX_ARTICLE_NUMBER).optional(),
  includeHistory: z.enum(["true", "false"]).default("false"),
});

/** Item numbers are allocated with stock receipts; printing is read-only. */
export const GET = withTenantAuth<Context>(async (request, auth, context) => {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return apiError("NOT_FOUND", "Product not found.", 404);
  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) return validationError(parsed.error);
  return apiSuccess(await listArticleLabels(auth.scope, id, { ...parsed.data, stockOnly: parsed.data.includeHistory !== "true" }));
});
