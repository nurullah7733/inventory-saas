import { withTenantAuth, type TenantRequestContext } from "@/lib/api/guard.ts";
import { recordAudit } from "@/lib/audit/log.ts";
import { apiError, apiSuccess } from "@/lib/api/response.ts";
import { MASTER_DATA_WRITE_ROLES } from "@/lib/inventory/master-data.ts";
import {
  IMAGE_PURPOSES,
  MAX_IMAGE_BYTES,
  sniffImageType,
  StorageUnavailableError,
  storeImage,
  type ImagePurpose,
} from "@/lib/storage/images.ts";

/**
 * Upload one product, category or business logo image.
 *
 *   POST /api/v1/uploads/images
 *   Content-Type: multipart/form-data
 *     file     the image (JPEG, PNG or WebP, at most 5 MB)
 *     purpose  "product" | "category" | "logo" | "profile"
 *
 * Returns `{ image: { url, contentType, size } }`. The client then saves that
 * `url` as the product's / category's `imageUrl` in a normal JSON request, so
 * web, Android and iOS all follow the same two steps.
 */
export const POST = withTenantAuth(
  async (request: Request, auth: TenantRequestContext) => {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_IMAGE_BYTES + 64 * 1024) return tooLarge();

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return apiError(
        "VALIDATION_ERROR",
        "Send the image as multipart/form-data with a `file` field.",
        400,
      );
    }

    const purposeRaw = form.get("purpose") ?? "product";
    if (
      typeof purposeRaw !== "string" ||
      !(IMAGE_PURPOSES as readonly string[]).includes(purposeRaw)
    ) {
      return apiError("VALIDATION_ERROR", "purpose must be product, category, logo or profile.", 422, {
        purpose: ["Use product, category, logo or profile."],
      });
    }

    if (purposeRaw !== "profile" && !MASTER_DATA_WRITE_ROLES.some((role) => role === auth.user.role)) {
      return apiError("FORBIDDEN", "You do not have permission to upload this image.", 403);
    }
    if (Array.from(form.keys()).some((key) => key !== "purpose" && key !== "file")) {
      return apiError("VALIDATION_ERROR", "Send only file and purpose fields.", 422);
    }

    if (purposeRaw === "logo" && auth.user.role !== "shop_owner") {
      return apiError("FORBIDDEN", "Only the shop owner can upload a business logo.", 403);
    }

    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return apiError("VALIDATION_ERROR", "Choose an image to upload.", 422, {
        file: ["Choose an image to upload."],
      });
    }
    if (file.size > MAX_IMAGE_BYTES) return tooLarge();

    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffImageType(bytes);
    if (!type) {
      return apiError(
        "VALIDATION_ERROR",
        "Only JPEG, PNG and WebP images can be uploaded.",
        422,
        { file: ["Only JPEG, PNG and WebP images can be uploaded."] },
      );
    }

    try {
      const stored = await storeImage({
        tenantId: auth.tenantId,
        userId: auth.user.id,
        purpose: purposeRaw as ImagePurpose,
        bytes,
        type,
        origin: new URL(request.url).origin,
      });
      await recordAudit({ tenantId: auth.tenantId, userId: auth.user.id,
        action: "image.create", entityType: "image",
        metadata: { purpose: purposeRaw, key: stored.key, contentType: stored.contentType, size: stored.size } });
      return apiSuccess(
        { image: { url: stored.url, contentType: stored.contentType, size: stored.size } },
        201,
      );
    } catch (error) {
      if (error instanceof StorageUnavailableError) {
        return apiError("STORAGE_UNAVAILABLE", error.message, 503);
      }
      throw error;
    }
  },
  { verifySession: true },
);

function tooLarge() {
  return apiError("VALIDATION_ERROR", "The image must be 5 MB or smaller.", 413, {
    file: ["The image must be 5 MB or smaller."],
  });
}
