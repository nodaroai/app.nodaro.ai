import type { NodaroClient } from "../client.js"

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
  constructor(private client: NodaroClient) {}

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
}
