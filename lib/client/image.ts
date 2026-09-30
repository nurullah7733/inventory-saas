/**
 * Shrink a photo in the browser before it is uploaded.
 *
 * A phone camera image is 3–8 MB at 4000 px wide; a product thumbnail needs
 * perhaps 1200 px. Resizing here makes the upload fast on shop Wi-Fi or mobile
 * data and keeps storage (and the Neon/Vercel free tiers) small. The server
 * still validates whatever arrives — this is a courtesy, not a control.
 */

const MAX_EDGE = 1200;
const QUALITY = 0.85;
/** Already small and already a web format — send as-is. */
const SKIP_BELOW_BYTES = 300 * 1024;
const WEB_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function prepareImageForUpload(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file (JPEG, PNG or WebP).");
  }
  if (file.size <= SKIP_BELOW_BYTES && WEB_TYPES.has(file.type)) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // e.g. HEIC on a browser that cannot decode it. Let the server decide.
    if (WEB_TYPES.has(file.type)) return file;
    throw new Error("This image format is not supported. Use a JPEG, PNG or WebP photo.");
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // WebP where the browser can encode it; older Safari silently hands back a
  // PNG for an unsupported type, so fall through to JPEG in that case.
  const webp = await toBlob(canvas, "image/webp");
  if (webp?.type === "image/webp") return webp;
  const jpeg = await toBlob(canvas, "image/jpeg");
  return jpeg ?? file;
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}
