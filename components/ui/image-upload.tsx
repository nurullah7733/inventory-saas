"use client";

import { useId, useRef, useState } from "react";
import { apiRequest } from "@/lib/client/api.ts";
import { errorMessage } from "@/lib/client/format.ts";
import { prepareImageForUpload } from "@/lib/client/image.ts";
import { Button } from "./field.tsx";

/**
 * Pick a photo (the camera on a phone), shrink it, upload it to
 * `POST /uploads/images`, and hand back the URL — which the form then saves
 * like any other field. A hosted URL can still be pasted instead.
 *
 * Controlled: `value` is the current image URL or `""`.
 */
export function ImageUploadField({
  label,
  value,
  onChange,
  purpose,
  error,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  purpose: "product" | "category";
  error?: string;
  disabled?: boolean;
}) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showUrl, setShowUrl] = useState(false);
  const [broken, setBroken] = useState(false);

  async function upload(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const blob = await prepareImageForUpload(file);
      const form = new FormData();
      form.set("purpose", purpose);
      form.set("file", blob, file.name);
      const result = await apiRequest<{ image: { url: string } }>("/uploads/images", {
        method: "POST",
        body: form,
      });
      setBroken(false);
      onChange(result.image.url);
    } catch (caught) {
      setUploadError(errorMessage(caught, "Upload failed. Try again."));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const message = uploadError ?? error;
  const showPreview = value !== "" && /^https?:\/\//i.test(value) && !broken;

  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>

      <div className="flex items-center gap-3">
        {showPreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt=""
            className="h-20 w-20 shrink-0 rounded-lg border border-zinc-200 bg-white object-cover dark:border-zinc-700"
            onError={() => setBroken(true)}
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-xs text-zinc-400 dark:border-zinc-700"
          >
            No image
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            className="sr-only"
            disabled={disabled || uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            disabled={disabled || uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? "Uploading…" : value ? "Change photo" : "Upload photo"}
          </Button>
          {value ? (
            <Button
              type="button"
              variant="ghost"
              disabled={disabled || uploading}
              onClick={() => onChange("")}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      {showUrl ? (
        <input
          type="url"
          inputMode="url"
          aria-label={`${label} URL`}
          placeholder="https://cdn.example.com/photo.jpg"
          value={value}
          disabled={disabled}
          onChange={(event) => {
            setBroken(false);
            onChange(event.target.value);
          }}
          className="min-h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
      ) : (
        <button
          type="button"
          className="self-start text-sm text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          onClick={() => setShowUrl(true)}
        >
          Or paste an image URL
        </button>
      )}

      {message ? (
        <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
          {message}
        </p>
      ) : (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          JPEG, PNG or WebP. Large photos are resized before upload.
        </p>
      )}
    </div>
  );
}
