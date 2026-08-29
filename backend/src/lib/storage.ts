import type { CopyObjectCommandInput, ObjectCannedACL, PutObjectCommandInput } from "@aws-sdk/client-s3"
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, CopyObjectCommand, HeadObjectCommand, ListObjectsV2Command, CreateBucketCommand, PutBucketPolicyCommand } from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import { randomUUID } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { pipeline } from "node:stream/promises"
import { stat } from "node:fs/promises"
import { Readable, Transform } from "node:stream"
import { config } from "./config.js"
import { safeFetch } from "./safe-fetch.js"
import {
  updateStorageUsage,
  reserveStorageIfWithinLimit,
  refundStorage,
  getSizeLimit,
  type FileCategory,
} from "../utils/file-validation.js"

/**
 * Resolve the S3 endpoint: an explicit R2_ENDPOINT (MinIO / any S3-compatible
 * server — the community-compose default) wins; otherwise the Cloudflare R2
 * endpoint is derived from R2_ACCOUNT_ID exactly as before. Exported for the
 * unit test — the S3Client below is constructed at module load, so the
 * selection logic must be testable on its own.
 */
export function resolveStorageEndpoint(cfg: {
  R2_ENDPOINT: string
  R2_ACCOUNT_ID: string
}): string {
  return cfg.R2_ENDPOINT || `https://${cfg.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
}

/**
 * Storage is configured when credentials exist AND we know where to send
 * them — either a custom endpoint or an R2 account id. Single source of
 * truth shared with the /v1/setup/status probe.
 */
export function isStorageConfigured(): boolean {
  return Boolean(
    config.R2_ACCESS_KEY_ID &&
    config.R2_SECRET_ACCESS_KEY &&
    (config.R2_ENDPOINT || config.R2_ACCOUNT_ID),
  )
}

export const s3 = new S3Client({
  // "auto" is R2's value and MinIO ignores it; Supabase-local ("local") and
  // DO Spaces / AWS ("nyc3", "us-east-1", …) reject it. See R2_REGION.
  region: config.R2_REGION,
  endpoint: resolveStorageEndpoint(config),
  // MinIO and most self-hosted S3 servers require path-style addressing.
  forcePathStyle: config.R2_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: config.R2_ACCESS_KEY_ID,
    secretAccessKey: config.R2_SECRET_ACCESS_KEY,
  },
})

/**
 * THE object-ACL seam. Every object write in this repo — Put, Copy and
 * multipart Upload, in lib/ and in routes/ — passes its params through here.
 *
 * Default is empty, so nothing is added and the request is byte-identical to
 * before this existed: Cloud keeps sending no ACL to R2, and self-host keeps
 * relying on the boot-time bucket policy below. It is one function rather
 * than a literal at each site because the literal WAS at each site — seven of
 * them — and the eighth call site somebody adds is the one that silently
 * writes an unreadable object. See STORAGE_OBJECT_ACL.
 */
export function withObjectAcl<T extends PutObjectCommandInput | CopyObjectCommandInput>(
  params: T,
): T {
  const acl = config.STORAGE_OBJECT_ACL
  return acl ? { ...params, ACL: acl as ObjectCannedACL } : params
}

/**
 * Anonymous-read bucket policy for self-host storage: the app hands the
 * browser plain public URLs (`R2_PUBLIC_URL/<key>`), so objects must be
 * readable without auth — same posture as the public R2 bucket on cloud.
 * Writes still require the access keys. Exported for the unit test.
 */
export function buildPublicReadPolicy(bucket: string): string {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { AWS: ["*"] },
        Action: ["s3:GetObject"],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  })
}

/**
 * Self-host boot helper: create the bucket and open anonymous reads on a
 * CUSTOM S3 endpoint (MinIO etc.). Deliberately a no-op on Cloudflare R2
 * (no R2_ENDPOINT): R2 API tokens are object-scoped and cannot create
 * buckets, and the cloud bucket already exists. Every failure is logged
 * and swallowed — a storage hiccup at boot must not take the API down;
 * the /v1/setup/status probe surfaces the broken state instead.
 */
export async function ensureStorageBucket(): Promise<void> {
  if (!config.R2_ENDPOINT || !isStorageConfigured()) return
  const bucket = config.R2_BUCKET_NAME
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }))
    console.log(`[storage] created bucket "${bucket}" on ${config.R2_ENDPOINT}`)
  } catch (err) {
    const name = err instanceof Error ? err.name : ""
    if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") {
      console.error(`[storage] failed to create bucket "${bucket}":`, err)
      return
    }
  }
  try {
    await s3.send(
      new PutBucketPolicyCommand({ Bucket: bucket, Policy: buildPublicReadPolicy(bucket) }),
    )
  } catch (err) {
    console.error(`[storage] failed to set public-read policy on "${bucket}":`, err)
  }
}

type MediaType = "image" | "video" | "audio"

const MEDIA_EXT: Record<MediaType, string> = { video: "mp4", audio: "wav", image: "png" }
const MEDIA_MIME: Record<MediaType, string> = { video: "video/mp4", audio: "audio/wav", image: "image/png" }

/**
 * Video containers a writer may KEEP instead of the default mp4 stamp.
 *
 * `mov` exists for Seedance 2.5's `output_format: "mov"` (H.264 yuv444p +
 * PCM): re-fed as the reference on the next extension it roughly halves the
 * colour drift at the join, which only works if the bytes survive un-
 * transcoded AND are served with an honest content type. Opt-in per call —
 * `mp4`/`video/mp4` stays the default for every existing caller, and the
 * browser-safe deliverable paths (`uploadVideoMaybeWatermark`,
 * `watermarkLocalVideoAndUpload`) never pass it.
 */
const VIDEO_EXT_MIME = { mp4: "video/mp4", mov: "video/quicktime" } as const
export type VideoContainerExt = keyof typeof VIDEO_EXT_MIME

/**
 * Resolve `{ key, contentType }` for one produced-media upload. Without
 * `ext` — or for a non-video type, which has its own single container — this
 * is exactly `r2Key(jobId, type)` + `MEDIA_MIME[type]`.
 */
function mediaTarget(
  jobId: string,
  type: MediaType,
  ext?: VideoContainerExt,
): { key: string; contentType: string } {
  if (type === "video" && ext && ext !== "mp4") {
    return { key: mediaObjectKey(jobId, type, ext), contentType: VIDEO_EXT_MIME[ext] }
  }
  return { key: r2Key(jobId, type), contentType: MEDIA_MIME[type] }
}

// Immutable assets keyed by job ID — cache for 1 year
const R2_CACHE_CONTROL = "public, max-age=31536000, immutable"

/**
 * THE key builder for produced media: `<type>s/<id>.<ext>` — `images/`,
 * `videos/`, `audios/`. Every writer in this repo goes through it, including
 * the ones that hand `uploadBufferToR2` a raw key: nine call sites spelled
 * `audio/…` by hand and split the audio store across two prefixes (#754); a
 * structural test (`__tests__/media-key-prefixes.test.ts`) keeps it that way.
 * Private cloud plugins reach it as `tk.storage.mediaObjectKey` — until each
 * adopts it, plugin-minted keys can still carry the singular prefix. Objects
 * already under `audio/` stay where they are — every one is referenced from
 * the DB (assets / jobs.output_data), which is what deletion and cleanup key
 * off — so nothing needs moving; new writes land here.
 */
export function mediaObjectKey(id: string, type: MediaType, ext: string = MEDIA_EXT[type]): string {
  return `${type}s/${id}.${ext}`
}

/**
 * Key for a provider-INPUT scratch object — a re-encoded or trimmed copy of
 * the user's media that only exists so a vendor can fetch it (lip-sync audio
 * trims, motion-transfer video trims). Not a deliverable, not DB-referenced,
 * so it must not share the deliverable prefixes above; its own prefix makes
 * it identifiable for a future age-based sweep (there is none today — these
 * have always been left behind).
 */
export const PROVIDER_INPUT_TMP_PREFIX = "tmp/provider-input/"
export function tmpObjectKey(name: string, ext: string): string {
  return `${PROVIDER_INPUT_TMP_PREFIX}${name}.${ext}`
}

/**
 * Build the R2 object key for a given job and media type.
 */
function r2Key(jobId: string, type: MediaType): string {
  return mediaObjectKey(jobId, type)
}

/**
 * Build the public URL for an R2 key. Exported so callers that persist a bare
 * R2 KEY (e.g. the video-analysis window checkpoint) can reconstruct the public
 * URL on re-entry without re-deriving the CDN base.
 */
export function r2Url(key: string): string {
  return `${config.R2_PUBLIC_URL}/${key}`
}

/** Audio-inclusive MIME map for recast fork copies. The generic
 *  `copyR2ObjectToPrefix` has no audio entries and mints uuid keys, so a
 *  forked `.wav`/`.mp3` would land as application/octet-stream under a lost
 *  suffix — hence this dedicated recast copier. */
const RECAST_COPY_EXT_TO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  // Seedance 2.5 raw-extension objects (`output_format: "mov"`), which a fork
  // must carry across intact — the mov IS the next extension's reference.
  mov: "video/quicktime",
  webm: "video/webm",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
}

/**
 * Physically copy ONE recast-owned R2 object into a fork-owned key, R2-to-R2
 * (`CopyObjectCommand` — no egress, storage only). The caller encodes the
 * whole fork key (type prefix + fork-scoped id + suffix + ext) in `destKey`;
 * this preserves it and sets `ContentType` from the audio-inclusive map above
 * (MetadataDirective REPLACE, so a source with a drifted type is corrected).
 *
 * Returns the fork public URL and the SOURCE object's byte size (HEAD the
 * source, which is known to exist, rather than the post-copy dest whose HEAD
 * can race) so the caller can reserve quota. Throws on a foreign source URL
 * (a recast object is always ours — a foreign URL is a fork bug that would
 * leave the fork pointing at someone else's bytes) or an unknown extension.
 */
export async function copyRecastObject(
  sourceUrl: string,
  destKey: string,
): Promise<{ url: string; bytes: number }> {
  const sourceKey = r2KeyFromOurUrl(sourceUrl)
  if (!sourceKey) throw new Error(`copyRecastObject: not one of our R2 objects: ${sourceUrl}`)
  const ext = destKey.slice(destKey.lastIndexOf(".") + 1).toLowerCase()
  const contentType = RECAST_COPY_EXT_TO_MIME[ext]
  if (!contentType) throw new Error(`copyRecastObject: unknown extension for dest key ${destKey}`)
  const bytes = await getR2ObjectSize(sourceKey)
  await s3.send(
    new CopyObjectCommand(withObjectAcl({
      Bucket: config.R2_BUCKET_NAME,
      Key: destKey,
      CopySource: `/${config.R2_BUCKET_NAME}/${sourceKey}`,
      ContentType: contentType,
      CacheControl: R2_CACHE_CONTROL,
      MetadataDirective: "REPLACE",
    })),
  )
  return { url: r2Url(destKey), bytes }
}

/**
 * Stream a body to R2 via multipart upload.
 */
async function streamToR2(key: string, body: Readable | Buffer, contentType: string): Promise<void> {
  const upload = new Upload({
    client: s3,
    params: withObjectAcl({
      Bucket: config.R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: R2_CACHE_CONTROL,
    }),
    partSize: 5 * 1024 * 1024,
    queueSize: 4,
  })
  await upload.done()
}

/**
 * Track storage usage for a user after upload.
 * Fire-and-forget: errors are logged but never thrown.
 */
function trackStorage(trackUserId: string | undefined, sizeBytes: number): void {
  if (!trackUserId || sizeBytes <= 0) return
  updateStorageUsage(trackUserId, sizeBytes).catch((err) => {
    console.error("[storage] Failed to track usage:", err)
  })
}

/**
 * Transform that counts bytes flowing through it and errors once the cap is
 * crossed. Used by uploadToR2 to bound streaming downloads of user-supplied
 * URLs: Content-Length is advisory (attacker-controlled servers may lie or
 * omit it), so authoritative enforcement happens here, mid-stream.
 */
class SizeLimitedStream extends Transform {
  private counted = 0
  constructor(private readonly maxBytes: number) {
    super()
  }
  _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    cb: (err?: Error | null, data?: Buffer) => void,
  ): void {
    this.counted += chunk.length
    if (this.counted > this.maxBytes) {
      cb(
        new Error(
          `upload-size-exceeded: ${this.counted} bytes read, cap is ${this.maxBytes}`,
        ),
      )
      return
    }
    cb(null, chunk)
  }
  get bytesRead(): number {
    return this.counted
  }
}

/**
 * Stream a remote URL directly to R2, bounded by
 * `min(getSizeLimit(type), opts.remainingQuotaBytes ?? ∞)` via
 * SizeLimitedStream. Content-Length is an advisory early-reject only.
 *
 * Pass `opts.reserveQuota: true` (together with `trackUserId`) to do an
 * atomic pre-upload reservation of `effectiveCap` bytes through the
 * reserve_storage_if_within_limit RPC. The unused portion is refunded on
 * success; the full reservation is refunded on failure. This is what
 * protects against the concurrent-upload quota oversubscription: the RPC
 * serialises against a FOR UPDATE lock on the profile row, so N parallel
 * callers cannot each pass the same pre-upload snapshot check.
 */
export async function uploadToR2(
  sourceUrl: string,
  jobId: string,
  type: MediaType = "image",
  trackUserId?: string,
  opts: { remainingQuotaBytes?: number; reserveQuota?: boolean; ext?: VideoContainerExt } = {},
): Promise<string> {
  // safeFetch: validate DNS resolution against private/reserved IP ranges at
  // connection time. Without this, a user-supplied sourceUrl resolving to an
  // internal IP (cloud metadata, admin service, 127.0.0.1) would stream that
  // response into R2 and return the public URL — a read-oracle for internal
  // HTTP. See backend/src/lib/safe-fetch.ts.
  const response = await safeFetch(sourceUrl, { timeoutMs: 120_000 })
  if (!response.ok) {
    throw new Error(`Failed to download ${type}: ${response.status}`)
  }

  const typeCap = getSizeLimit(type as FileCategory)
  const quotaCap = opts.remainingQuotaBytes ?? Number.POSITIVE_INFINITY
  const effectiveCap = Math.min(typeCap, quotaCap)

  const advertised = parseInt(response.headers.get("content-length") ?? "", 10)
  if (Number.isFinite(advertised) && advertised > effectiveCap) {
    try { await response.body?.cancel() } catch { /* best effort */ }
    throw new Error(
      `upload-size-exceeded: Content-Length ${advertised} > cap ${effectiveCap}`,
    )
  }

  let reserved = false
  if (opts.reserveQuota && trackUserId) {
    reserved = await reserveStorageIfWithinLimit(trackUserId, effectiveCap)
    if (!reserved) {
      try { await response.body?.cancel() } catch { /* best effort */ }
      throw new Error(
        `storage-limit-exceeded: atomic reservation of ${effectiveCap} bytes refused`,
      )
    }
  }

  const { key, contentType } = mediaTarget(jobId, type, opts.ext)
  const source = Readable.fromWeb(response.body as import("stream/web").ReadableStream)
  const counter = new SizeLimitedStream(effectiveCap)

  // Propagate teardown: a counter error (or source error) must destroy both
  // sides so the upstream fetch socket is closed and the Upload aborts.
  counter.once("error", (err) => {
    if (!source.destroyed) source.destroy(err)
  })
  source.once("error", (err) => {
    if (!counter.destroyed) counter.destroy(err)
  })
  source.pipe(counter)

  try {
    await streamToR2(key, counter, contentType)
  } catch (err) {
    // Release the quota reservation before surfacing the error, otherwise a
    // failed upload permanently holds the user's quota.
    //
    // Deliberately NO deleteFromR2(key) here. Keys are deterministic
    // (`images/<jobId>.png`) and two finalizers can race on the same job (the
    // worker and the reconcile cron) — a failure-path delete destroys the
    // OTHER writer's successfully-uploaded object while the job row stays
    // `completed`, leaving a charged job with a permanent 404 (incident
    // 2026-06-10, job 7955772a). A failed multipart upload never materializes
    // an object (lib-storage aborts it), so the only things a delete could
    // remove are a phantom committed PutObject (rare, a harmless quota
    // orphan) or another finalizer's good upload (permanent data loss).
    if (reserved) {
      try {
        await refundStorage(trackUserId!, effectiveCap)
      } catch (refundErr) {
        console.error("[uploadToR2] reservation refund failed:", refundErr)
      }
    }
    throw err
  }

  if (reserved) {
    const unused = effectiveCap - counter.bytesRead
    if (unused > 0) {
      await refundStorage(trackUserId!, unused).catch((refundErr) => {
        console.error("[uploadToR2] unused-bytes refund failed:", refundErr)
      })
    }
  } else {
    trackStorage(trackUserId, counter.bytesRead)
  }

  return r2Url(key)
}

export async function uploadBufferToR2(
  buffer: Buffer,
  key: string,
  contentType: string,
  trackUserId?: string,
): Promise<string> {
  await s3.send(
    new PutObjectCommand(withObjectAcl({
      Bucket: config.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: R2_CACHE_CONTROL,
    })),
  )

  trackStorage(trackUserId, buffer.length)

  return r2Url(key)
}

/**
 * Stream a local file directly to R2 without buffering the entire file in memory.
 */
export async function uploadFileToR2(
  filePath: string,
  jobId: string,
  type: MediaType = "video",
  trackUserId?: string,
  opts: { ext?: VideoContainerExt } = {},
): Promise<string> {
  const fileStat = await stat(filePath)
  const { key, contentType } = mediaTarget(jobId, type, opts.ext)

  await streamToR2(key, createReadStream(filePath), contentType)

  trackStorage(trackUserId, fileStat.size)

  return r2Url(key)
}

/**
 * Stream a local file to R2 with a custom key (no jobId-based naming).
 */
export async function uploadFileWithKeyToR2(
  filePath: string,
  key: string,
  contentType: string,
  trackUserId?: string,
): Promise<string> {
  const fileStat = await stat(filePath)
  await streamToR2(key, createReadStream(filePath), contentType)
  trackStorage(trackUserId, fileStat.size)
  return r2Url(key)
}

// ---------------------------------------------------------------------------
// Template preview copy
// ---------------------------------------------------------------------------

const PREVIEW_EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
}

/**
 * Origin-anchored R2 key extractor. Uses startsWith with a trailing slash to
 * avoid the substring-prefix pitfall (R2_PUBLIC_URL=https://assets.nodaro.ai
 * would otherwise prefix-match https://assets.nodaro.ai.attacker.com/...).
 */
/**
 * Stream an object from the R2 ORIGIN (S3 API) to a local file — bypasses
 * the public CDN entirely. The fallback for Cloudflare's per-edge negative
 * cache: a freshly finalized object can 404 on cdn.nodaro.ai for 40-55min
 * on some edges while the origin has it (incidents 2026-06-10/12). Throws
 * if the object truly doesn't exist, so callers keep a honest failure path.
 */
export async function downloadR2ObjectToFile(key: string, dest: string): Promise<void> {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: config.R2_BUCKET_NAME, Key: key }),
  )
  if (!res.Body) throw new Error(`R2 origin returned no body for ${key}`)
  await pipeline(res.Body as Readable, createWriteStream(dest))
}

/**
 * Read an object from the R2 ORIGIN (S3 API) fully into a Buffer — bypasses
 * the public CDN entirely. Returns null when the object is absent (NoSuchKey)
 * or on ANY other error, so callers treat a missing/unreadable object as
 * "not present" instead of a thrown failure. Mirrors downloadR2ObjectToFile
 * but buffers small internal artifacts (e.g. the video-analysis checkpoint)
 * that must never be read through the immutable-cached CDN.
 */
export async function readR2ObjectBuffer(key: string): Promise<Buffer | null> {
  return (await readR2Object(key))?.body ?? null
}

/**
 * Read one of OUR objects through the storage client — with its content type
 * and, when the store reports it, its size (checked before buffering so a
 * caller with a cap can refuse without reading the whole thing).
 *
 * This is how code that runs INSIDE the app container reads the install's own
 * media: through `R2_ENDPOINT` (e.g. `http://minio:9000`), which always
 * resolves in there. The public URL (`PUBLIC_URL`/`R2_PUBLIC_URL`, e.g.
 * `http://localhost:3002/storage/…`) is what BROWSERS use and often does not
 * resolve from inside the container — a remapped port, a domain behind a
 * proxy, split-horizon DNS. Fetching our own object by its public URL was how
 * the cloud re-host died with ECONNREFUSED on a perfectly healthy install.
 */
export async function readR2Object(
  key: string,
  opts: { maxBytes?: number } = {},
): Promise<{ body: Buffer; contentType: string | null; size: number | null } | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: config.R2_BUCKET_NAME, Key: key }),
    )
    if (!res.Body) return null
    const size = typeof res.ContentLength === "number" ? res.ContentLength : null
    if (opts.maxBytes !== undefined && size !== null && size > opts.maxBytes) {
      // Don't read a multi-GB object into memory just to refuse it.
      ;(res.Body as Readable).destroy?.()
      return { body: Buffer.alloc(0), contentType: res.ContentType ?? null, size }
    }
    const chunks: Buffer[] = []
    for await (const chunk of res.Body as Readable) {
      chunks.push(chunk as Buffer)
    }
    const body = Buffer.concat(chunks)
    return { body, contentType: res.ContentType ?? null, size: size ?? body.length }
  } catch {
    return null
  }
}

/**
 * HEAD an R2 object and return its byte size (0 on any error). Used to backfill
 * `assets.size_bytes` for generated media — `trackStorage` already adds the real
 * bytes to the user's quota at upload, so the asset row MUST record the real
 * size too, or the cleanup reaper (which decrements quota by `size_bytes`)
 * subtracts 0 and the free-user `storage_used_bytes` ratchets permanently up.
 */
export async function getR2ObjectSize(key: string): Promise<number> {
  try {
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: config.R2_BUCKET_NAME, Key: key }),
    )
    return Number(head.ContentLength ?? 0)
  } catch {
    return 0
  }
}

export function r2KeyFromOurUrl(url: string): string | null {
  if (!config.R2_PUBLIC_URL) return null
  try {
    const base = new URL(config.R2_PUBLIC_URL)
    const candidate = new URL(url)
    if (candidate.origin !== base.origin) return null
    const prefix = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`
    if (!candidate.pathname.startsWith(prefix)) return null
    const key = candidate.pathname.slice(prefix.length)
    return key || null
  } catch {
    return null
  }
}

function extractExtensionFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname
    const dot = path.lastIndexOf(".")
    if (dot < 0 || dot === path.length - 1) return null
    const ext = path.slice(dot + 1).toLowerCase()
    return /^[a-z0-9]{1,5}$/.test(ext) ? ext : null
  } catch {
    return null
  }
}

/**
 * Copy a media URL into a durable template-preview slot.
 *
 * Why this exists: workflow_templates.preview_media_url used to store a direct
 * reference to an in-flow asset URL — if the source node was later deleted and
 * the template re-published, derivePreviewMedia returned null and the preview
 * silently disappeared from marketplace/tutorial cards. This helper decouples
 * the template's preview from any node by writing an independent copy at a
 * stable key.
 *
 * R2-to-R2 path uses CopyObjectCommand — no egress, no re-upload. Foreign URLs
 * fall back to a bounded safeFetch + streamToR2. Storage is tracked against
 * the creator (matches who owns the template).
 *
 * Idempotent: re-publishing overwrites the same `templates/<id>/preview.<ext>`
 * key. CDN URL stays stable; edge caches refresh on their own TTL.
 *
 * TODO(thumbnails): cap video preview size or convert video previews to a
 * single-frame poster — currently copies videos at full size. Tracked as a
 * separate follow-up.
 */
export async function copyToTemplatePreview(
  sourceUrl: string,
  templateId: string,
  mediaType: "image" | "video",
  creatorUserId: string,
): Promise<string> {
  const ext = extractExtensionFromUrl(sourceUrl) ?? MEDIA_EXT[mediaType]
  const destKey = `templates/${templateId}/preview.${ext}`
  const contentType = PREVIEW_EXT_TO_MIME[ext] ?? MEDIA_MIME[mediaType]

  const sourceKey = r2KeyFromOurUrl(sourceUrl)
  if (sourceKey) {
    await s3.send(
      new CopyObjectCommand(withObjectAcl({
        Bucket: config.R2_BUCKET_NAME,
        Key: destKey,
        CopySource: `/${config.R2_BUCKET_NAME}/${sourceKey}`,
        ContentType: contentType,
        CacheControl: R2_CACHE_CONTROL,
        MetadataDirective: "REPLACE",
      })),
    )
    // Best-effort size tracking. A HEAD failure shouldn't fail the publish —
    // the copy already succeeded; quota accounting drifting by one preview is
    // acceptable.
    try {
      const head = await s3.send(
        new HeadObjectCommand({ Bucket: config.R2_BUCKET_NAME, Key: destKey }),
      )
      if (head.ContentLength) trackStorage(creatorUserId, head.ContentLength)
    } catch (err) {
      console.error("[copyToTemplatePreview] HEAD failed (storage not tracked):", err)
    }
    return r2Url(destKey)
  }

  // Foreign URL — download and upload, bounded by the standard size cap.
  const response = await safeFetch(sourceUrl, { timeoutMs: 120_000 })
  if (!response.ok) {
    throw new Error(`copyToTemplatePreview: source fetch failed (${response.status})`)
  }
  const cap = getSizeLimit(mediaType as FileCategory)
  const source = Readable.fromWeb(response.body as import("stream/web").ReadableStream)
  const counter = new SizeLimitedStream(cap)
  counter.once("error", (err) => {
    if (!source.destroyed) source.destroy(err)
  })
  source.once("error", (err) => {
    if (!counter.destroyed) counter.destroy(err)
  })
  source.pipe(counter)

  await streamToR2(destKey, counter, contentType)
  trackStorage(creatorUserId, counter.bytesRead)
  return r2Url(destKey)
}

// ---------------------------------------------------------------------------
// Community sharing — prefix listing + arbitrary-prefix copy
// ---------------------------------------------------------------------------

/**
 * Map a file extension to the size-limit category used for the foreign-URL
 * fallback in copyR2ObjectToPrefix. Unknown extensions default to "video" —
 * the most permissive cap — so a legitimate clone of an unexpected asset type
 * is never spuriously rejected (the copy is of already-trusted content).
 */
function categoryFromExt(ext: string): FileCategory {
  if (["png", "jpg", "jpeg", "webp", "gif", "avif", "heic", "heif"].includes(ext)) return "image"
  if (["mp3", "wav", "m4a", "aac", "ogg", "weba"].includes(ext)) return "audio"
  return "video"
}

/** A listed R2 object plus the S3 metadata ListObjectsV2 returns for it. */
export interface R2ListedObject {
  key: string
  /** S3 `LastModified`. Absent only if S3 omits it (defensive — normally set). */
  lastModified?: Date
  /** S3 `Size` in bytes. */
  size?: number
}

/**
 * List every R2 object under `prefix` WITH its S3 metadata (LastModified, Size),
 * following NextContinuationToken until the result set is exhausted.
 * ListObjectsV2 returns at most 1000 entries per page, so the continuation loop
 * is mandatory — a single call silently truncates large prefixes.
 *
 * This is the single pagination site; `listObjectsByPrefix` is the keys-only
 * projection of it, so the two can never drift. `LastModified` powers the
 * aged-reaper sweeps (e.g. `sweepVideoAnalysisTmp`) that delete by object age.
 */
export async function listObjectsByPrefixWithMeta(prefix: string): Promise<R2ListedObject[]> {
  const objects: R2ListedObject[] = []
  let ContinuationToken: string | undefined
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: config.R2_BUCKET_NAME,
        Prefix: prefix,
        ContinuationToken,
      }),
    )
    for (const o of res.Contents ?? []) {
      if (o.Key) objects.push({ key: o.Key, lastModified: o.LastModified, size: o.Size })
    }
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (ContinuationToken)
  return objects
}

/**
 * List every R2 object key under `prefix` (keys only). Thin projection over
 * `listObjectsByPrefixWithMeta` — the community reaper/clone walk whole entity
 * folders and only need the keys.
 */
export async function listObjectsByPrefix(prefix: string): Promise<string[]> {
  return (await listObjectsByPrefixWithMeta(prefix)).map((o) => o.key)
}

/**
 * Copy `sourceUrl` into a fresh object under `destPrefix`, named
 * `<destPrefix><uuid>.<ext>` (extension carried from the source so the CDN
 * serves the right Content-Type by URL). Returns the public URL and the byte
 * size of the written object.
 *
 * Mirrors copyToTemplatePreview: our own R2 URLs go through CopyObjectCommand
 * (no egress, no re-upload); foreign URLs fall back to a bounded safeFetch +
 * SizeLimitedStream + streamToR2. The dest is then HEAD-ed for an
 * authoritative ContentLength — unlike copyToTemplatePreview the HEAD is NOT
 * best-effort here, because the caller (clone) needs the byte count to charge
 * the cloner's storage quota.
 */
export async function copyR2ObjectToPrefix(
  sourceUrl: string,
  destPrefix: string,
): Promise<{ url: string; bytes: number }> {
  const ext = extractExtensionFromUrl(sourceUrl) ?? "bin"
  const destKey = `${destPrefix}${randomUUID()}.${ext}`
  const contentType = PREVIEW_EXT_TO_MIME[ext] ?? "application/octet-stream"

  const sourceKey = r2KeyFromOurUrl(sourceUrl)
  if (sourceKey) {
    await s3.send(
      new CopyObjectCommand(withObjectAcl({
        Bucket: config.R2_BUCKET_NAME,
        Key: destKey,
        CopySource: `/${config.R2_BUCKET_NAME}/${sourceKey}`,
        ContentType: contentType,
        CacheControl: R2_CACHE_CONTROL,
        MetadataDirective: "REPLACE",
      })),
    )
  } else {
    // Foreign URL — download and upload, bounded by the size cap. Same
    // teardown propagation as copyToTemplatePreview so an over-cap stream
    // closes the upstream socket and aborts the upload.
    const response = await safeFetch(sourceUrl, { timeoutMs: 120_000 })
    if (!response.ok) {
      throw new Error(`copyR2ObjectToPrefix: source fetch failed (${response.status})`)
    }
    const cap = getSizeLimit(categoryFromExt(ext))
    const source = Readable.fromWeb(response.body as import("stream/web").ReadableStream)
    const counter = new SizeLimitedStream(cap)
    counter.once("error", (err) => {
      if (!source.destroyed) source.destroy(err)
    })
    source.once("error", (err) => {
      if (!counter.destroyed) counter.destroy(err)
    })
    source.pipe(counter)
    await streamToR2(destKey, counter, contentType)
  }

  const head = await s3.send(
    new HeadObjectCommand({ Bucket: config.R2_BUCKET_NAME, Key: destKey }),
  )
  return { url: r2Url(destKey), bytes: Number(head.ContentLength ?? 0) }
}

export async function deleteFromR2(key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: config.R2_BUCKET_NAME,
      Key: key,
    }),
  )
}

/**
 * Batch delete up to 1000 keys per call from R2.
 * Automatically chunks if more than 1000 keys are provided.
 */
export async function batchDeleteFromR2(keys: string[]): Promise<{ deleted: number; errors: number }> {
  if (keys.length === 0) return { deleted: 0, errors: 0 }

  const BATCH_SIZE = 1000
  let deleted = 0
  let errors = 0

  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE)
    try {
      const result = await s3.send(new DeleteObjectsCommand({
        Bucket: config.R2_BUCKET_NAME,
        Delete: { Objects: batch.map(Key => ({ Key })) },
      }))
      deleted += result.Deleted?.length ?? 0
      errors += result.Errors?.length ?? 0
    } catch (err) {
      console.error(`[storage] Batch delete failed for ${batch.length} keys:`, err)
      errors += batch.length
    }
  }
  return { deleted, errors }
}
