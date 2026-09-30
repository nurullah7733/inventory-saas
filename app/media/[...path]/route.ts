import { readLocalImage } from "@/lib/storage/images.ts";

/**
 * Serves images stored by the LOCAL storage driver (`lib/storage/images.ts`).
 * With Vercel Blob configured, image URLs point at the Blob CDN and this route
 * is never hit.
 *
 * Public on purpose, like a Blob URL: an `<img>` tag cannot send a bearer
 * token, and the key is a random UUID under the tenant's prefix, so it cannot
 * be guessed or enumerated. The files live outside `public/` because Next.js
 * only serves files that existed there at build time.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  const image = await readLocalImage(path.join("/"));
  if (!image) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "content-type": image.contentType,
      // Keys are never reused, so the bytes behind a URL never change.
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
