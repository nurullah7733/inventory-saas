import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Where uploaded product / category images live.
 *
 *   vercel-blob  when BLOB_READ_WRITE_TOKEN is set — the production path on
 *                the brief's hosting target (Vercel). Public, CDN-served URLs.
 *   local        otherwise, outside Vercel — files under `.uploads/`, served
 *                back by `app/media/[...path]/route.ts`. For development and
 *                self-hosting on a machine with a persistent disk.
 *
 * On Vercel without a token there is no writable disk to fall back to, so
 * uploads are refused with a clear message rather than failing mysteriously.
 *
 * Either way the object key starts with the tenant id, so one shop's files are
 * never written under another's prefix, and the file name is a random UUID —
 * a URL cannot be guessed from a product name.
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const IMAGE_PURPOSES = ["product", "category", "logo", "profile"] as const;
export type ImagePurpose = (typeof IMAGE_PURPOSES)[number];

interface ImageType {
  mime: string;
  ext: string;
}

/**
 * Identify the image from its first bytes rather than trusting the client's
 * Content-Type or file name. SVG is deliberately absent: it is a document that
 * can carry script, and it would be served from our own origin.
 */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return { mime: "image/png", ext: "png" };
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

export type StorageDriver = "vercel-blob" | "local" | "unavailable";

export function activeStorageDriver(): StorageDriver {
  if (process.env.BLOB_READ_WRITE_TOKEN) return "vercel-blob";
  if (process.env.VERCEL) return "unavailable";
  return "local";
}

/** Root for the local driver. Kept out of `public/` — see the media route. */
export function localUploadRoot(): string {
  return path.resolve(process.env.LOCAL_UPLOAD_DIR ?? ".uploads");
}

export interface StoredImage {
  url: string;
  key: string;
  contentType: string;
  size: number;
}

export async function storeImage(input: {
  tenantId: string;
  purpose: ImagePurpose;
  userId?: string;
  bytes: Uint8Array;
  type: ImageType;
  /** Origin of the incoming request, for building the local driver's URL. */
  origin: string;
}): Promise<StoredImage> {
  if (input.purpose === "profile" && !input.userId) throw new Error("Profile images require an authenticated user.");
  const prefix = input.purpose === "profile" ? `profile/${input.userId}` : input.purpose;
  const key = `tenants/${input.tenantId}/${prefix}/${randomUUID()}.${input.type.ext}`;

  switch (activeStorageDriver()) {
    case "vercel-blob": {
      const { put } = await import("@vercel/blob");
      const blob = await put(key, Buffer.from(input.bytes), {
        access: "public",
        contentType: input.type.mime,
        addRandomSuffix: false,
        // Keys are unique already; a year of CDN caching is safe because a
        // replaced image always gets a new key.
        cacheControlMaxAge: 60 * 60 * 24 * 365,
      });
      return { url: blob.url, key, contentType: input.type.mime, size: input.bytes.length };
    }

    case "local": {
      const file = path.join(localUploadRoot(), ...key.split("/"));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, input.bytes);
      return {
        url: `${input.origin}/media/${key}`,
        key,
        contentType: input.type.mime,
        size: input.bytes.length,
      };
    }

    case "unavailable":
      throw new StorageUnavailableError();
  }
}

export class StorageUnavailableError extends Error {
  constructor() {
    super(
      "Image storage is not configured. Set BLOB_READ_WRITE_TOKEN (Vercel Blob) to enable uploads.",
    );
    this.name = "StorageUnavailableError";
  }
}

const LOCAL_KEY =
  /^tenants\/[0-9a-f-]{36}\/(?:product|category|logo|profile\/[0-9a-f-]{36})\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * Read a locally stored image by key. The key must match the exact shape
 * `storeImage` writes, which rules out `..`, absolute paths and any file that
 * was not put there by an upload.
 */
export async function readLocalImage(
  key: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const match = LOCAL_KEY.exec(key);
  if (!match) return null;
  try {
    const bytes = await readFile(path.join(localUploadRoot(), ...key.split("/")));
    return { bytes, contentType: MIME_BY_EXT[match[1]] };
  } catch {
    return null;
  }
}
