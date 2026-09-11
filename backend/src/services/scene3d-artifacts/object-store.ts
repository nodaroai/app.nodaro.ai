import { GetObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { Readable } from "node:stream"
import { Scene3DArtifactError } from "./types.js"

/**
 * The private object store, as a dependency.
 *
 * Reads and deletes only. Uploads are issued as exact-key capabilities
 * elsewhere and verified on receipt, so nothing here needs write credentials.
 *
 * Injected rather than resolved: the route takes it through plugin options and
 * the publish and cleanup helpers take it as an argument, so a test drives a
 * fake and an install with no private bucket simply passes `null`.
 */

/** A half-open-free, fully inclusive byte range, as HTTP spells it. */
export interface Scene3DObjectRange {
  start: number
  endInclusive: number
}

export interface Scene3DObjectRead {
  body: Readable
  /** Bytes in THIS response — the range length when a range was asked for. */
  contentLength: number | null
  /** Normalized (unquoted) entity tag, or null when the store omits one. */
  etag: string | null
}

export interface Scene3DObjectStore {
  readonly bucket: string
  get(objectKey: string, range?: Scene3DObjectRange): Promise<Scene3DObjectRead>
  delete(objectKey: string): Promise<void>
}

export interface Scene3DPrivateStorageConfig {
  bucket: string
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
}

/**
 * Strip the transport's quoting so a tag survives a round trip.
 *
 * S3 returns `"abc"`, some proxies return `W/"abc"`, and a store that omits
 * the header entirely returns nothing. We compare a tag we recorded at receipt
 * with one we read back later, so the only thing that matters is that both
 * sides are normalized the same way.
 */
export function normalizeEtag(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim().replace(/^W\//i, "")
  const unquoted = trimmed.replace(/^"(.*)"$/s, "$1")
  return unquoted.length > 0 ? unquoted : null
}

/**
 * Read the private-storage settings out of an environment.
 *
 * Returns `null` when `SCENE3D_PRIVATE_BUCKET` is unset — the community and
 * self-host default, where the feature is simply off and the binary routes
 * answer 503. THROWS when the configuration exists but is wrong, because a
 * private bucket that silently falls back to the public one is the failure
 * this whole module is built to prevent: those objects are served by URL to
 * anyone who has the URL.
 */
export function resolveScene3DPrivateStorageConfig(
  env: Record<string, string | undefined>,
  publicBucket: string,
): Scene3DPrivateStorageConfig | null {
  const bucket = (env.SCENE3D_PRIVATE_BUCKET ?? "").trim()
  if (!bucket) return null

  if (publicBucket && bucket === publicBucket.trim()) {
    throw new Scene3DArtifactError(
      "SCENE_STORAGE_UNCONFIGURED",
      "SCENE3D_PRIVATE_BUCKET must not be the public media bucket",
      "objects in the public bucket are reachable by URL without authentication",
    )
  }

  const accessKeyId = (env.SCENE3D_PRIVATE_S3_ACCESS_KEY_ID ?? env.R2_ACCESS_KEY_ID ?? "").trim()
  const secretAccessKey = (
    env.SCENE3D_PRIVATE_S3_SECRET_ACCESS_KEY ??
    env.R2_SECRET_ACCESS_KEY ??
    ""
  ).trim()
  const accountId = (env.R2_ACCOUNT_ID ?? "").trim()
  const endpoint = (
    env.SCENE3D_PRIVATE_S3_ENDPOINT ??
    env.R2_ENDPOINT ??
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "")
  ).trim()

  if (!accessKeyId || !secretAccessKey || !endpoint) {
    throw new Scene3DArtifactError(
      "SCENE_STORAGE_UNCONFIGURED",
      "SCENE3D_PRIVATE_BUCKET is set but its credentials or endpoint are not",
      "set SCENE3D_PRIVATE_S3_ACCESS_KEY_ID / _SECRET_ACCESS_KEY / _ENDPOINT, or the global R2_* equivalents",
    )
  }

  const forcePathStyleRaw = env.SCENE3D_PRIVATE_S3_FORCE_PATH_STYLE ?? env.R2_FORCE_PATH_STYLE ?? ""
  return {
    bucket,
    endpoint,
    region: (env.SCENE3D_PRIVATE_S3_REGION ?? env.R2_REGION ?? "auto").trim() || "auto",
    accessKeyId,
    secretAccessKey,
    forcePathStyle: forcePathStyleRaw === "true" || forcePathStyleRaw === "1",
  }
}

/**
 * Sign a time-bounded GET for one object in the private scene bucket.
 *
 * THE ONE PLACE A READ CAPABILITY IS MINTED. `@aws-sdk/s3-request-presigner` is
 * a policed import — a presigned PUT would let bytes go browser→R2 and bypass
 * every ingestion lane the upload policy exists to check — and the totality
 * guard in `lib/__tests__/upload-policy.test.ts` allows exactly two importers:
 * the upload granter (conditional PUTs for trusted build output) and this
 * function, which can only ever produce a GET. Callers that need a read URL ask
 * HERE rather than reaching for the presigner themselves, so "can this codebase
 * mint an upload capability?" stays answerable by reading two files.
 *
 * `no-store` on every one: these objects are private, and a cache between us
 * and the reader is a copy nobody authorized.
 *
 * `ifMatch` is for a reader that can send the header — the trusted engine
 * binding a grant to the exact bytes it was promised. Leave it off for a reader
 * that sends a bare GET (an external provider), where a required `If-Match` it
 * cannot send would 412 every fetch.
 */
export function signScene3DPrivateObjectGet(
  client: S3Client,
  bucket: string,
  input: { objectKey: string; expiresInSeconds: number; ifMatch?: string },
): Promise<string> {
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: input.objectKey,
      ...(input.ifMatch ? { IfMatch: input.ifMatch } : {}),
      ResponseCacheControl: "no-store",
    }),
    {
      expiresIn: input.expiresInSeconds,
      ...(input.ifMatch ? { signableHeaders: new Set(["if-match"]) } : {}),
    },
  )
}

function toReadable(body: unknown): Readable {
  if (body instanceof Readable) return body
  // The SDK hands back a web ReadableStream on some runtimes. Node's adapter
  // covers both without buffering, which is the whole point of streaming here.
  if (body && typeof (body as { getReader?: unknown }).getReader === "function") {
    return Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0])
  }
  throw new Scene3DArtifactError("SCENE_STORAGE_FAILED", "object storage returned no readable body")
}

/**
 * The S3/R2 adapter. Its own client, its own credentials, its own bucket —
 * deliberately NOT the global `lib/storage.ts` client, so a key scoped to the
 * private bucket can be handed to this and nothing else.
 */
export function createS3ObjectStore(cfg: Scene3DPrivateStorageConfig): Scene3DObjectStore {
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  })

  return {
    bucket: cfg.bucket,

    async get(objectKey, range) {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: cfg.bucket,
          Key: objectKey,
          ...(range ? { Range: `bytes=${range.start}-${range.endInclusive}` } : {}),
        }),
      )
      return {
        body: toReadable(response.Body),
        contentLength: typeof response.ContentLength === "number" ? response.ContentLength : null,
        etag: normalizeEtag(response.ETag),
      }
    },

    async delete(objectKey) {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: objectKey }))
    },
  }
}
