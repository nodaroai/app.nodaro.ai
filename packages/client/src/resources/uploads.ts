import type { NodaroClientCore } from "../core.js"
import { LargeUploadUnavailableError, NodaroError } from "../errors.js"

/**
 * The most `POST /v1/upload` ({@link UploadsResource.upload}) takes: 500 MB.
 * {@link UploadsResource.uploadLarge} sends a file of this size or less through
 * that same route, and only a bigger one through the large-upload lane.
 */
export const UPLOAD_MAX_BYTES = 500 * 1024 * 1024
/** Tries per part: the first, and two retries. */
const PART_ATTEMPTS = 3
/** `/complete` reads the stored file's length and makes its poster before it answers. */
const COMPLETE_TIMEOUT_MS = 5 * 60 * 1000

/** Options of {@link UploadsResource.uploadLarge}. */
export interface UploadLargeOptions {
  /** The name to store the file under; defaults to the file's own name, else `upload`. */
  readonly filename?: string
  /** Called as parts finish, with the bytes sent so far and the file's size. */
  readonly onProgress?: (sentBytes: number, totalBytes: number) => void
  /** Cancels the upload; the server's copy of the parts is aborted. */
  readonly signal?: AbortSignal
  /** Parts sent at once (default 3). */
  readonly concurrency?: number
}

/** `POST /v1/uploads/large/start`'s answer. */
interface LargeUploadStart {
  readonly token: string
  readonly partSize: number
  readonly partUrls: readonly string[]
}

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
    return this.uploadMultipart(file)
  }

  private async uploadMultipart(file: Blob, filename?: string, signal?: AbortSignal): Promise<UploadResult> {
    const form = new FormData()
    if (filename !== undefined) form.append("file", file, filename)
    else form.append("file", file)
    const res = await this.client.request<{ data: UploadResult }>(
      "POST",
      "/v1/upload",
      { body: form, ...(signal ? { signal } : {}) },
    )
    return res.data
  }

  /**
   * Upload a file of any size, choosing the lane by size:
   *
   * - **{@link UPLOAD_MAX_BYTES} (500 MB) or less:** exactly {@link upload}
   *   (`POST /v1/upload`) — the path every file of that size takes today, with
   *   everything it does on the server (faststart, HEIC conversion, upload
   *   policies, thumbnails). The large-upload lane is never touched.
   * - **Bigger (video or audio only):** the bytes go straight from here to the
   *   platform's object storage in parts (`POST /v1/uploads/large/start` → one
   *   `PUT` per part → `POST /v1/uploads/large/complete`), never through the
   *   API server. What limits such a file is length: one longer than 30
   *   minutes is refused once it has arrived, with `MediaTooLongError` (the
   *   stored copy is removed and nothing counts against storage).
   *
   * Returns the same result as {@link upload}. Parts are sent `concurrency` at
   * a time (default 3); a part that fails is tried twice more before the
   * upload fails. `onProgress(sentBytes, totalBytes)` is called as parts
   * finish (once at the end on the small path). Aborting `signal`, or any
   * failure, aborts the upload on the server (best-effort).
   *
   * A file over 500 MB on a deployment without the lane — one that checks every
   * upload's bytes (409 `large_upload_unavailable`), or an older server (404) —
   * throws `LargeUploadUnavailableError`: `POST /v1/upload` would refuse it
   * anyway. Throws `StorageExceededError` (413) when the file does not fit in
   * the account's storage, and the SDK's other typed errors on the usual
   * statuses.
   *
   * In a browser, storage must allow cross-origin `PUT` from the page's origin
   * for the large lane (the platform's own deployments do).
   */
  async uploadLarge(file: Blob & { readonly name?: string }, options: UploadLargeOptions = {}): Promise<UploadResult> {
    const filename = options.filename ?? (file.name && file.name.length > 0 ? file.name : "upload")
    const signal = options.signal
    if (file.size <= UPLOAD_MAX_BYTES) {
      const result = await this.uploadMultipart(file, filename, signal)
      options.onProgress?.(file.size, file.size)
      return result
    }
    let started: LargeUploadStart
    try {
      started = await this.client.request<LargeUploadStart>("POST", "/v1/uploads/large/start", {
        body: { filename, mimeType: file.type || "application/octet-stream", sizeBytes: file.size },
        ...(signal ? { signal } : {}),
      })
    } catch (err) {
      if (err instanceof NodaroError && err.status === 404) throw new LargeUploadUnavailableError(undefined, 404)
      throw err
    }

    const { token, partSize, partUrls } = started
    try {
      await this.sendParts(file, partSize, partUrls, options)
      const res = await this.client.request<{ data: UploadResult }>("POST", "/v1/uploads/large/complete", {
        body: { token },
        timeoutMs: COMPLETE_TIMEOUT_MS,
        ...(signal ? { signal } : {}),
      })
      return res.data
    } catch (err) {
      // Best-effort, and never under the caller's (possibly aborted) signal.
      await this.client.request("POST", "/v1/uploads/large/abort", { body: { token } }).catch(() => undefined)
      throw err
    }
  }

  /**
   * PUT every part, `concurrency` at a time, each tried up to
   * {@link PART_ATTEMPTS} times. Each part is EXACTLY `partSize` bytes (the
   * last one the remainder): its URL has that length signed in, so storage
   * refuses any other. The runtime sets Content-Length from the slice itself.
   */
  private async sendParts(file: Blob, partSize: number, partUrls: readonly string[], options: UploadLargeOptions): Promise<void> {
    const total = file.size
    const concurrency = Math.max(1, Math.floor(options.concurrency ?? 3))
    let next = 0
    let sent = 0
    let failed: unknown
    const worker = async (): Promise<void> => {
      while (failed === undefined && next < partUrls.length) {
        const index = next++
        const start = index * partSize
        const part = file.slice(start, Math.min(start + partSize, total))
        try {
          await this.putPart(partUrls[index]!, part, index + 1, options.signal)
        } catch (err) {
          failed ??= err
          return
        }
        sent += part.size
        options.onProgress?.(sent, total)
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, partUrls.length) }, () => worker()))
    if (failed !== undefined) throw failed
  }

  private async putPart(url: string, part: Blob, partNumber: number, signal: AbortSignal | undefined): Promise<void> {
    let lastStatus = 0
    for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt++) {
      signal?.throwIfAborted()
      try {
        const res = await this.client.fetch(url, { method: "PUT", body: part, ...(signal ? { signal } : {}) })
        if (res.ok) return
        lastStatus = res.status
        // A refusal (expired link, wrong signature) will not change on a retry.
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) break
      } catch (err) {
        if (signal?.aborted) throw err
        lastStatus = 0
      }
    }
    throw new NodaroError(`Uploading part ${partNumber} failed${lastStatus ? ` (HTTP ${lastStatus})` : ""}`, "upload_part_failed", lastStatus)
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
   *
   * An import of a link runs the platform's content rights check: pass the
   * `confirmationId` from `contentRights.confirm({ url })` when the deployment
   * requires one (`403 rights_confirmation_required` otherwise). A site an
   * administrator disabled answers `403 import_source_disabled`, and a
   * deployment that turned link imports off answers `403 link_imports_disabled`
   * for a link to another site (a file of the deployment's own storage is still
   * imported as before).
   */
  async importUrl(url: string, options: { confirmationId?: string } = {}): Promise<ImportUrlResult> {
    const res = await this.client.request<{ data: ImportUrlResult }>("POST", "/v1/media/import-url", {
      body: { url, ...(options.confirmationId ? { confirmationId: options.confirmationId } : {}) },
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
