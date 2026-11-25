import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, type PutObjectCommandInput } from "@aws-sdk/client-s3"
import { PassThrough, type Readable } from "node:stream"
import { config } from "../../../lib/config.js"
import { storageDeletesSkipped } from "../../../lib/storage-deletes-setting.js"
import { STORAGE_DOWNLOAD_LIMITS, boundedStorageClientConfig, guardStorageReadBody, storageTransferOptions } from "../../../lib/storage-timeouts.js"
import { refuse } from "./errors.js"

/**
 * The private bucket video-editor projects live in (`EDITOR_PROJECTS_BUCKET`),
 * never the media bucket. Read and written only by this backend, through its
 * own client and credentials; no URL to an object is ever made.
 *
 * Mirrors the scene-3D private store (services/scene3d-artifacts/object-store.ts
 * `resolveScene3DPrivateStorageConfig`, lib/private-plugins/scene3d-upload-grants.ts
 * `withPrivateSceneObjectParams`): the same companion variables, named in the
 * same style, falling back to the media store's endpoint and credentials, and
 * the same refusal to share the media bucket. A sibling rather than a shared
 * helper because that resolver throws the scene feature's own error type.
 *
 *   unset                      → `editorProjectsStore(log)` is null: every
 *                                editor-project route answers 503 `not_available`.
 *   set, but equal to the media
 *   bucket or without credentials → `resolveEditorProjectsStorageConfig`
 *                                throws; `editorProjectsStore(log)` logs it once
 *                                and treats the bucket as unset (503). A
 *                                private bucket that silently fell back to
 *                                the public one is the failure this module
 *                                exists to prevent.
 */

export interface EditorProjectsStorageConfig {
  bucket: string
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
}

export function resolveEditorProjectsStorageConfig(
  env: Record<string, string | undefined>,
  publicBucket: string,
): EditorProjectsStorageConfig | null {
  const bucket = (env.EDITOR_PROJECTS_BUCKET ?? "").trim()
  if (!bucket) return null
  if (publicBucket && bucket === publicBucket.trim()) {
    throw new Error("EDITOR_PROJECTS_BUCKET must not be the public media bucket: its objects are readable by key")
  }
  const accessKeyId = (env.EDITOR_PROJECTS_S3_ACCESS_KEY_ID ?? env.R2_ACCESS_KEY_ID ?? "").trim()
  const secretAccessKey = (env.EDITOR_PROJECTS_S3_SECRET_ACCESS_KEY ?? env.R2_SECRET_ACCESS_KEY ?? "").trim()
  const accountId = (env.R2_ACCOUNT_ID ?? "").trim()
  const endpointVariable = env.EDITOR_PROJECTS_S3_ENDPOINT !== undefined ? "EDITOR_PROJECTS_S3_ENDPOINT" : env.R2_ENDPOINT !== undefined ? "R2_ENDPOINT" : "R2_ACCOUNT_ID"
  const endpoint = (
    env.EDITOR_PROJECTS_S3_ENDPOINT ??
    env.R2_ENDPOINT ??
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "")
  ).trim()
  if (!accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error(
      "EDITOR_PROJECTS_BUCKET is set but its credentials or endpoint are not: set EDITOR_PROJECTS_S3_ACCESS_KEY_ID / _SECRET_ACCESS_KEY / _ENDPOINT, or the global R2_* equivalents",
    )
  }
  if (!isHttpUrl(endpoint)) {
    throw new Error(`EDITOR_PROJECTS_BUCKET is set but its endpoint (${endpointVariable}) is not an http(s) URL`)
  }
  const forcePathStyleRaw = env.EDITOR_PROJECTS_S3_FORCE_PATH_STYLE ?? env.R2_FORCE_PATH_STYLE ?? ""
  return {
    bucket,
    endpoint,
    region: (env.EDITOR_PROJECTS_S3_REGION ?? env.R2_REGION ?? "auto").trim() || "auto",
    accessKeyId,
    secretAccessKey,
    forcePathStyle: forcePathStyleRaw === "true" || forcePathStyleRaw === "1",
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

/**
 * A write's parameters, bound to the private bucket. No ACL, whatever
 * `STORAGE_OBJECT_ACL` says (that stamp makes media public on ACL-based
 * stores); a caller cannot set the bucket or an ACL.
 */
export function withPrivateEditorProjectParams(
  privateBucket: string,
  publicBucket: string,
  input: Omit<PutObjectCommandInput, "Bucket" | "ACL">,
): PutObjectCommandInput {
  if (!privateBucket || privateBucket === publicBucket) throw new Error("Editor projects require a separate private bucket")
  if ("Bucket" in input || "ACL" in input) throw new Error("An editor project write cannot set its bucket or ACL")
  return { ...input, Bucket: privateBucket }
}

/** What the routes need from the private bucket. */
export interface EditorProjectsStore {
  /** Writes `body` (gzip) under `key`. Throws a `StorageOperationError` when storage refuses. */
  put(key: string, body: Buffer): Promise<void>
  /** Whether an object is at `key`. */
  exists(key: string): Promise<boolean>
  /** The object's bytes; null when there is none; 413 `too_large` over `maxBytes` (stopped there). */
  read(key: string, maxBytes: number): Promise<Buffer | null>
  /** The object as a stream; null when there is none. */
  stream(key: string): Promise<{ body: Readable; contentLength: number | null } | null>
  /**
   * Deletes `key` — unless this deployment deletes nothing
   * (`STORAGE_DELETES=skip`), when the object stays and this answers
   * "skipped". Throws when storage refuses.
   */
  delete(key: string): Promise<"deleted" | "skipped">
}

export type StorageOperation = "put" | "head" | "read" | "stream" | "delete"

/**
 * A storage failure, as it leaves this module: the operation, the SDK
 * error's name and its HTTP status, and nothing else. An SDK exception
 * carries every field of the store's error body (`Key`, `BucketName`,
 * `Resource`), and a key names the user and the project, so the raw
 * exception never reaches a log.
 */
export class StorageOperationError extends Error {
  constructor(
    readonly operation: StorageOperation,
    readonly errorName: string,
    readonly httpStatusCode: number | undefined,
  ) {
    super(`editor projects storage ${operation} failed: ${errorName}${httpStatusCode ? ` (${httpStatusCode})` : ""}`)
    this.name = "StorageOperationError"
  }
}

function sanitized(operation: StorageOperation, err: unknown): StorageOperationError | Error {
  // Our own refusals (413 too_large) pass as they are; they carry no storage detail.
  if ((err as { name?: unknown })?.name === "EditorProjectRefusal") return err as Error
  const e = err as { name?: unknown; $metadata?: { httpStatusCode?: unknown } } | null
  const name = typeof e?.name === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(e.name) ? e.name : "Error"
  const status = typeof e?.$metadata?.httpStatusCode === "number" ? e.$metadata.httpStatusCode : undefined
  return new StorageOperationError(operation, name, status)
}

/**
 * `source` piped through a stream whose only error is the sanitized one: an
 * error raised mid-stream, while the reply is being sent, reaches the
 * server's logs as an operation, a name and a status — never the SDK
 * exception with its error-body fields.
 */
function nameOnlyErrors(source: Readable): Readable {
  const out = new PassThrough()
  source.on("error", (err) => out.destroy(sanitized("stream", err)))
  out.on("close", () => {
    if (!source.destroyed) source.destroy()
  })
  source.pipe(out)
  return out
}

const isNotFound = (err: unknown) => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404
}

export function createEditorProjectsStore(cfg: EditorProjectsStorageConfig, publicBucket: string, client?: S3Client): EditorProjectsStore {
  const s3 = client ?? new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    ...boundedStorageClientConfig(),
  })
  const get = async (operation: StorageOperation, key: string, signal?: AbortSignal) => {
    try {
      return await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), signal ? { abortSignal: signal } : undefined)
    } catch (err) {
      if (isNotFound(err)) return null
      throw sanitized(operation, err)
    }
  }
  return {
    async put(key, body) {
      try {
        await s3.send(
          new PutObjectCommand(withPrivateEditorProjectParams(cfg.bucket, publicBucket, {
            Key: key,
            Body: body,
            ContentType: "application/gzip",
            CacheControl: "private, no-store",
          })),
          storageTransferOptions(body.length),
        )
      } catch (err) {
        throw sanitized("put", err)
      }
    },
    async exists(key) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }))
        return true
      } catch (err) {
        if (isNotFound(err)) return false
        throw sanitized("head", err)
      }
    },
    async read(key, maxBytes) {
      const controller = new AbortController()
      const res = await get("read", key, controller.signal)
      if (!res?.Body) return null
      const size = typeof res.ContentLength === "number" ? res.ContentLength : null
      if (size !== null && size > maxBytes) {
        controller.abort()
        throw refuse(413, "too_large")
      }
      try {
        const body = guardStorageReadBody(res.Body as Readable, {
          sizeBytes: size, startedAt: Date.now(), label: "editor project file", controller, limits: STORAGE_DOWNLOAD_LIMITS,
        })
        const chunks: Buffer[] = []
        let length = 0
        for await (const chunk of body) {
          length += (chunk as Buffer).length
          if (length > maxBytes) {
            body.destroy()
            throw refuse(413, "too_large")
          }
          chunks.push(chunk as Buffer)
        }
        return Buffer.concat(chunks)
      } catch (err) {
        throw sanitized("read", err)
      }
    },
    async stream(key) {
      const res = await get("stream", key)
      if (!res?.Body) return null
      return { body: nameOnlyErrors(res.Body as Readable), contentLength: typeof res.ContentLength === "number" ? res.ContentLength : null }
    },
    async delete(key) {
      if (storageDeletesSkipped()) return "skipped"
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }))
      } catch (err) {
        throw sanitized("delete", err)
      }
      return "deleted"
    },
  }
}

let cached: EditorProjectsStore | null | undefined

/**
 * Resolves the private bucket once: at boot (app.ts calls this where the
 * routes are registered) and on first use. A misconfiguration — the media
 * bucket itself, or no usable credentials or endpoint — is logged once,
 * naming the variable and never its value, and from then on the bucket is
 * treated as unset: the routes answer 503 `not_available`. Never a crash,
 * never a per-request 500.
 */
export function editorProjectsStore(log: { error: (obj: object, msg: string) => void }): EditorProjectsStore | null {
  if (cached !== undefined) return cached
  try {
    const cfg = resolveEditorProjectsStorageConfig(process.env, config.R2_BUCKET_NAME)
    cached = cfg ? createEditorProjectsStore(cfg, config.R2_BUCKET_NAME) : null
  } catch (err) {
    // The messages name variables, never their values.
    const message = err instanceof Error ? err.message : "EDITOR_PROJECTS_BUCKET is misconfigured"
    log.error({ variable: "EDITOR_PROJECTS_BUCKET" }, `[editor-projects] ${message}; video-editor projects are off`)
    cached = null
  }
  return cached
}

/** Test seam: forget the resolved bucket. */
export function resetEditorProjectsStoreForTest(): void {
  cached = undefined
}
