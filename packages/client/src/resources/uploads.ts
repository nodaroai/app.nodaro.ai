import type { NodaroClientCore } from "../core.js"

/**
 * Result of a successful `POST /v1/upload`. Mirrors the route's `data` envelope
 * (`backend/src/routes/upload.ts`), the source of truth — keep in sync if that
 * response changes. The route also returns loosely-typed extracted `metadata`;
 * it is omitted here until a consumer needs a typed shape (add it shaped to
 * that need rather than inventing `Record<string, unknown>` surface now).
 */
export interface UploadResult {
  /** Public R2 URL of the stored asset (always present on success). */
  readonly url: string
  /** Storage row id; `null` when no asset row was written (e.g. unauthenticated). */
  readonly assetId: string | null
  /** Generated thumbnail URL (images/video); `null` for audio or on failure. */
  readonly thumbnailUrl: string | null
  /** Server-classified asset category (e.g. "image" | "video" | "audio"). */
  readonly category: string
  /** Display filename (server override or the original). */
  readonly filename: string
  /** Final MIME type after server normalization. */
  readonly mimeType: string
  /** Stored byte size. */
  readonly sizeBytes: number
  /** R2 object key. */
  readonly r2Key: string
}

export class UploadsResource {
  constructor(private client: NodaroClientCore) {}

  /**
   * Upload one file (`POST /v1/upload`, multipart — the file rides the `file`
   * field). The SDK's `request` detects the `FormData` body and lets the
   * runtime set the multipart boundary. Returns the persisted asset's public
   * URL + storage metadata (unwraps the `{ data }` envelope). Throws
   * `StorageExceededError` (413) over the storage cap and the SDK's other typed
   * errors on the usual statuses.
   */
  async upload(file: File): Promise<UploadResult> {
    const form = new FormData()
    form.append("file", file)
    const res = await this.client.request<{ data: UploadResult }>(
      "POST",
      "/v1/upload",
      { body: form },
    )
    return res.data
  }

  /**
   * Copy a picture from a web address into your storage
   * (`POST /v1/media/import-url`, body `{ url }`). The platform fetches it
   * (http(s) only, never a private address, up to 20 MB), keeps it only if it
   * decodes as an image (JPEG, PNG, WebP, GIF; HEIC/HEIF and AVIF are
   * converted to JPEG or PNG), and stores it as an upload of yours, so its address serves
   * the pixels to the browser (a canvas can read it). Returns the stored
   * picture (unwraps the `{ data }` envelope).
   *
   * Throws `StorageExceededError` on a 413, its `reason` telling the two
   * apart: `storage_limit_exceeded` is a full storage (the quota is in
   * `details` — `usedBytes`, `quotaBytes`, `remainingBytes`, `tier`), and
   * `file_too_large` a picture over 20 MB. Throws a `NodaroError` with `code`
   * `validation_error` (400: not an http(s) address, or not an image) or
   * `fetch_failed` (422: the address could not be reached or answered with an
   * error).
   */
  async importUrl(url: string): Promise<ImportUrlResult> {
    const res = await this.client.request<{ data: ImportUrlResult }>("POST", "/v1/media/import-url", {
      body: { url },
    })
    return res.data
  }

  /**
   * Store a JSON document (`POST /v1/upload-json`, up to 25 MB) and get its
   * public URL — e.g. an image editor's design state, passed to
   * `client.jobs.fromUpload` as `editStateUrl` so the edit can be reopened.
   * The URL is unguessable but public: never store a secret in it. Creates no
   * library item.
   */
  uploadJson(json: Record<string, unknown> | readonly unknown[]): Promise<UploadJsonResult> {
    return this.client.request<UploadJsonResult>("POST", "/v1/upload-json", { body: json })
  }
}

/** Result of {@link UploadsResource.uploadJson}. */
export interface UploadJsonResult {
  /** Public URL of the stored JSON document. */
  readonly url: string
}

/**
 * Result of {@link UploadsResource.importUrl}. Mirrors the route's `data`:
 * the fields of {@link UploadResult} it shares, plus the picture's size.
 */
export interface ImportUrlResult {
  /** Public URL of the stored picture. */
  readonly url: string
  /** Generated thumbnail URL; `null` when it could not be made. */
  readonly thumbnailUrl: string | null
  /** Storage row id; `null` when no asset row was written. */
  readonly assetId: string | null
  /** Final MIME type (a HEIC/HEIF or AVIF source is stored as JPEG or PNG). */
  readonly mimeType: string
  /** Stored byte size. */
  readonly sizeBytes: number
  /** Display filename: the address's last path segment, else `imported-<id>.<ext>`. */
  readonly filename: string
  /** Width in pixels; 0 when it could not be read. */
  readonly width: number
  /** Height in pixels; 0 when it could not be read. */
  readonly height: number
}
