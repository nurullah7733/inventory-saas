import { recordAudit } from "@/lib/audit/log.ts";
import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import {
  parseEnumParam,
  parsePagination,
  parseUuidParam,
} from "@/lib/api/query-params.ts";
import { apiError, apiSuccess, validationError } from "@/lib/api/response.ts";
import {
  isUniqueViolation,
  MASTER_DATA_WRITE_ROLES,
} from "@/lib/inventory/master-data.ts";
import {
  findProduct,
  findSkuClash,
  generateSku,
  listProducts,
  planProductUsage,
  validateProductRefs,
} from "@/lib/inventory/product-queries.ts";
import { planLimitReached, skuTaken } from "@/lib/inventory/product-errors.ts";
import { PRODUCT_STATUSES, productSchema } from "@/lib/inventory/products.ts";
import { numeric } from "@/lib/numeric.ts";
import { readTenantSafeJsonBody } from "@/lib/tenant/request.ts";

/**
 * Products list — newest first, paged.
 *
 *   ?search=     name or SKU, case-insensitive
 *   ?categoryId= one category
 *   ?status=     active (default) | deleted | all
 *   ?page=&pageSize=
 */
export const GET = withTenantAuth(
  async (request: Request, auth: TenantRequestContext) => {
    const params = new URL(request.url).searchParams;

    const status = parseEnumParam(params, "status", PRODUCT_STATUSES, "active");
    if (!status.ok) return status.response;
    const categoryId = parseUuidParam(params, "categoryId");
    if (!categoryId.ok) return categoryId.response;
    const page = parsePagination(params);
    if (!page.ok) return page.response;

    const search = (params.get("search") ?? "").trim().slice(0, 100);

    const result = await listProducts(
      auth.scope,
      { status: status.value, search, categoryId: categoryId.value },
      page.value,
    );

    return apiSuccess({
      products: result.products,
      page: page.value.page,
      pageSize: page.value.pageSize,
      total: result.total,
    });
  },
);

export const POST = withTenantAuth(
  async (request: Request, auth: TenantRequestContext) => {
    const body = await readTenantSafeJsonBody(request);
    if (!body.ok) return body.response;

    const parsed = productSchema.safeParse(body.value);
    if (!parsed.success) return validationError(parsed.error);
    const data = parsed.data;

    const refErrors = await validateProductRefs(auth.scope, data);
    if (refErrors) {
      return apiError(
        "VALIDATION_ERROR",
        "The submitted data is invalid.",
        422,
        refErrors,
      );
    }

    const usage = await planProductUsage(auth.scope, auth.db);
    if (usage.used >= usage.max) return planLimitReached(usage.max);

    let sku = data.sku;
    if (sku === "") {
      sku = await generateSku(auth.scope);
    } else {
      const clash = await findSkuClash(auth.scope, sku);
      if (clash) return skuTaken(sku, clash);
    }

    let created;
    try {
      created = await auth.scope.Product.select("id").create(
        auth.scope.own({
          ...data,
          sku,
          costPrice: numeric<10, 2>(data.costPrice),
          sellPrice: numeric<10, 2>(data.sellPrice),
        }),
      );
    } catch (error) {
      // Lost a race with another request creating the same SKU.
      if (isUniqueViolation(error)) {
        return apiError("CONFLICT", `SKU ${sku} is already in use.`, 409, {
          sku: ["This SKU is already in use."],
        });
      }
      throw error;
    }

    const product = await findProduct(auth.scope, created.id);
    if (!product) throw new Error("Created product could not be read back.");

    await recordAudit({
      tenantId: auth.tenantId,
      userId: auth.user.id,
      action: "product.create",
      entityType: "product",
      entityId: product.id,
      metadata: {
        name: product.name,
        sku: product.sku,
        costPrice: product.costPrice,
        sellPrice: product.sellPrice,
      },
    });

    return apiSuccess({ product }, 201);
  },
  { roles: MASTER_DATA_WRITE_ROLES },
);
