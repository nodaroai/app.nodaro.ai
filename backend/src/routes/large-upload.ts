/**
 * The large-upload lane (decided 2026-11-17): a long video or audio file goes
 * from the browser STRAIGHT to object storage in parts, through presigned
 * UploadPart URLs, so it never passes through this server. What limits it is
 * LENGTH: at most 30 minutes (`MEDIA_IMPORT_MAX_SEC`), probed on the stored
 * object before anything is kept — with the 10 GiB import ceiling
 * (`MEDIA_IMPORT_MAX_BYTES`) and a bitrate sanity check on top.
 *
 * Abuse bounds: each part URL has its exact length signed in, so storage
 * refuses a bigger part; an account has at most 3 open uploads and 20 starts
 * an hour (`lib/large-upload-slots.ts`, fails closed without Redis).
 *
 *   POST /v1/uploads/large/start    { filename, mimeType, sizeBytes } → { token, partSize, partUrls }
 *   POST /v1/uploads/large/complete { token }                         → the same `data` as POST /v1/upload
 *   POST /v1/uploads/large/abort    { token }                         → { data: { aborted } }
 *
 * The browser PUTs part i (bytes [(i-1)·partSize, i·partSize)) to partUrls[i-1]
 * and never needs an ETag: `/complete` collects them from the store's own list.
 *
 * Quota: `/start` only CHECKS it (no reservation — an abandoned upload holds
 * none); `/complete` reserves it atomically once the object is known good, so
 * there is no leak to clean up when a browser goes away mid-upload. Incomplete
 * uploads are aborted by the bucket's lifecycle rule (docs/deployment.md).
 *
 * Upload policy: while any is registered the lane is closed (409
 * `large_upload_unavailable`); a file within 500 MB goes through `POST
 * /v1/upload` there — see `lib/large-upload-storage.ts`.
 *
 * Auth: an ordinary authenticated route, like `POST /v1/upload` (JWT, personal
 * key, connected app — with no scope beyond what `/v1/upload` asks). A personal
 * key limited to some workflows is refused here as on `/v1/upload`: neither
 * route declares a `workflowScope`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { assetSourceColumns } from "../lib/job-source.js"
import { redis } from "../lib/queue.js"
import { r2Url, uploadBufferToR2 } from "../lib/storage.js"
import { deleteKeyRecordingFailure } from "../lib/storage-delete.js"
import { sendInternalError } from "../lib/http-errors.js"
import { formatZodError } from "../lib/zod-error.js"
import { MAX_OPEN_LARGE_UPLOADS, claimLargeUploadSlot, releaseLargeUploadSlot } from "../lib/large-upload-slots.js"
import {
  LargeUploadUnavailableError,
  abortLargeUpload,
  assertLargeUploadLaneOpen,
  completeLargeUpload,
  createLargeUpload,
  largeUploadObjectSize,
  largeUploadPartCount,
  largeUploadPartSize,
  listLargeUploadParts,
  presignLargeUploadParts,
  presignLargeUploadRead,
  LARGE_UPLOAD_PART_URL_TTL_SEC,
} from "../lib/large-upload-storage.js"
import { signLargeUploadToken, verifyLargeUploadToken, type LargeUploadTokenPayload } from "../lib/large-upload-token.js"
import { readStoredMedia, storedVideoPoster, type StoredMediaReading } from "../lib/large-upload-media.js"
import { MEDIA_IMPORT_MAX_BYTES, MEDIA_TOO_LARGE_MESSAGE, MediaImportLengthError, assertImportableMedia } from "../lib/media-import-length.js"
import {
  checkStorageQuota,
  detectCategory,
  getExtensionFromMime,
  reserveStorageIfWithinLimit,
  resolveUploadMime,
} from "../utils/file-validation.js"

/** The token outlives the part URLs by an hour, so a finished upload can still be completed. */
const TOKEN_TTL_MS = (LARGE_UPLOAD_PART_URL_TTL_SEC + 60 * 60) * 1000

/**
 * The biggest file the lane takes: the editor's import ceiling
 * (`MEDIA_IMPORT_MAX_BYTES`, 10 GiB), the same the direct-file link lane holds.
 * At most 640 parts of 16 MiB.
 */
export const LARGE_UPLOAD_MAX_BYTES = MEDIA_IMPORT_MAX_BYTES

const startBody = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
})

const tokenBody = z.object({ token: z.string().min(1).max(4096) })

/** The `data` `/complete` answers — the same shape as `POST /v1/upload`. */
interface UploadData {
  readonly url: string
  readonly thumbnailUrl: string | null
  readonly assetId: string | null
  readonly category: "video" | "audio"
  readonly filename: string
  readonly mimeType: string
  readonly sizeBytes: number
  readonly metadata: StoredMediaReading["metadata"] | null
  readonly r2Key: string
}

/** A refusal `/complete` answers after deleting the object. */
class CompleteRefusal extends Error {
  readonly code: string
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    const error = body.error as { message?: string; code?: string } | undefined
    super(String(error?.message ?? "refused"))
    this.code = String(error?.code ?? "")
  }
}

const refusal = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  new CompleteRefusal(status, { error: { code, message, ...extra } })

const unavailableBody = (err: LargeUploadUnavailableError) => ({ error: { code: err.code, message: err.message } })

function requireUser(req: FastifyRequest, reply: FastifyReply): string | null {
  if (req.userId) return req.userId
  void reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required for uploads" } })
  return null
}

/** The caller's own token, or the reply it was refused with. */
function readToken(req: FastifyRequest, reply: FastifyReply, userId: string): LargeUploadTokenPayload | null {
  const parsed = tokenBody.safeParse(req.body)
  if (!parsed.success) {
    void reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    return null
  }
  const payload = verifyLargeUploadToken(parsed.data.token)
  if (!payload) {
    void reply.status(400).send({ error: { code: "invalid_token", message: "This upload link is invalid or has expired. Start the upload again." } })
    return null
  }
  if (payload.userId !== userId) {
    void reply.status(403).send({ error: { code: "forbidden", message: "This upload belongs to another account." } })
    return null
  }
  return payload
}

/** The storage-quota refusal, in `POST /v1/upload`'s exact shape. */
async function quotaRefusalBody(userId: string, sizeBytes: number) {
  const quota = await checkStorageQuota(userId, sizeBytes)
  return {
    error: {
      code: "storage_limit_exceeded",
      message: quota.error,
      usedBytes: quota.usedBytes,
      quotaBytes: quota.quotaBytes,
      remainingBytes: quota.remainingBytes,
      tier: quota.tier,
    },
  }
}

// ── /complete's claim on its upload: one call does the work, a repeat reads its answer ──

const claimKey = (uploadId: string) => `upload:large:complete:${uploadId}`
const PENDING = "pending"

type Claim = { readonly kind: "claimed" } | { readonly kind: "done"; readonly data: UploadData } | { readonly kind: "busy" }

async function claimCompletion(payload: LargeUploadTokenPayload): Promise<Claim> {
  const ttlSec = Math.max(60, Math.ceil((payload.exp - Date.now()) / 1000) + 24 * 60 * 60)
  const set = await redis.set(claimKey(payload.uploadId), PENDING, "EX", ttlSec, "NX")
  if (set === "OK") return { kind: "claimed" }
  const held = await redis.get(claimKey(payload.uploadId))
  if (held && held !== PENDING) return { kind: "done", data: JSON.parse(held) as UploadData }
  return { kind: "busy" }
}

async function recordCompletion(payload: LargeUploadTokenPayload, data: UploadData): Promise<void> {
  const ttlSec = Math.max(60, Math.ceil((payload.exp - Date.now()) / 1000) + 24 * 60 * 60)
  await redis.set(claimKey(payload.uploadId), JSON.stringify(data), "EX", ttlSec).catch((err: unknown) => {
    console.error("[large-upload] could not record the completed upload:", err)
  })
}

async function releaseClaim(uploadId: string): Promise<void> {
  await redis.del(claimKey(uploadId)).catch(() => undefined)
}

/** Remove the finished object a refusal leaves behind (best-effort; a failure is recorded for the retry pass). */
async function dropObject(key: string): Promise<void> {
  await deleteKeyRecordingFailure(key, "media").catch((err: unknown) => {
    console.error(`[large-upload] could not delete refused object ${key}:`, err)
  })
}

/**
 * Finish the upload: join the parts, check the size and the length, reserve
 * the quota, then record the asset. Every refusal after the join deletes the
 * object before it is thrown.
 */
async function finishUpload(req: FastifyRequest, payload: LargeUploadTokenPayload, userId: string): Promise<UploadData> {
  const { key, uploadId, sizeBytes, partSize, mimeType, filename, category } = payload

  const parts = await listLargeUploadParts(key, uploadId)
  const expected = largeUploadPartCount(sizeBytes, partSize)
  const complete = parts.length === expected && parts.every((p, i) => p.partNumber === i + 1)
  if (!complete) {
    throw refusal(400, "upload_incomplete", `The upload is missing parts (${parts.length} of ${expected} arrived). Send every part, then complete again.`)
  }
  await completeLargeUpload(key, uploadId, parts)

  const storedBytes = await largeUploadObjectSize(key)
  if (storedBytes !== sizeBytes) {
    await dropObject(key)
    throw refusal(400, "size_mismatch", "The uploaded file's size does not match the size declared when the upload started.")
  }

  const readUrl = await presignLargeUploadRead(key)
  let reading: StoredMediaReading | undefined
  try {
    reading = await readStoredMedia(key, readUrl, category)
  } catch (err) {
    req.log.warn({ err, key }, "[large-upload] could not read the stored file's length")
  }
  try {
    // Length, size, and the bitrate the two imply (a short duration forged
    // into a big file's header is refused for its bitrate).
    assertImportableMedia({ durationSec: reading?.durationSec, sizeBytes, kind: category })
  } catch (err) {
    await dropObject(key)
    if (err instanceof MediaImportLengthError) throw refusal(422, err.code, err.message)
    throw err
  }

  if (!(await reserveStorageIfWithinLimit(userId, sizeBytes))) {
    const body = await quotaRefusalBody(userId, sizeBytes)
    await dropObject(key)
    throw new CompleteRefusal(413, body)
  }

  // Best-effort, like /v1/upload: a poster failure logs and the upload proceeds.
  let thumbnailUrl: string | null = null
  if (category === "video") {
    try {
      const poster = await storedVideoPoster(readUrl)
      // `uploads/videos/<id>_thumb.png`, beside the video, as /v1/upload names its poster.
      const thumbKey = `${key.replace(/\.[^./]+$/, "")}_thumb.png`
      thumbnailUrl = await uploadBufferToR2(poster, thumbKey, "image/png")
    } catch (err) {
      console.error("[large-upload] Thumbnail extraction failed:", err)
    }
  }

  const publicUrl = r2Url(key)
  const metadata = reading?.metadata ?? null
  let assetId: string | null = null
  const { data: asset, error: insertError } = await supabase
    .from("assets")
    .insert({
      user_id: userId,
      type: category,
      filename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      r2_key: key,
      r2_url: publicUrl,
      upload_source: "manual_upload",
      ...assetSourceColumns(req),
      metadata: {
        ...(metadata ?? {}),
        thumbnail_url: thumbnailUrl,
        original_filename: filename,
      },
    })
    .select("id")
    .single()
  if (insertError) {
    console.error("[large-upload] Failed to create asset record:", insertError)
  } else {
    assetId = (asset as { id: string }).id
  }

  return { url: publicUrl, thumbnailUrl, assetId, category, filename, mimeType, sizeBytes, metadata, r2Key: key }
}

export async function largeUploadRoutes(app: FastifyInstance) {
  app.post("/v1/uploads/large/start", async (req, reply) => {
    const userId = requireUser(req, reply)
    if (!userId) return reply

    const parsed = startBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    const { filename, sizeBytes } = parsed.data
    if (sizeBytes > LARGE_UPLOAD_MAX_BYTES) {
      return reply.status(422).send({ error: { code: "media_too_large", message: MEDIA_TOO_LARGE_MESSAGE } })
    }

    try {
      assertLargeUploadLaneOpen()
    } catch (err) {
      if (err instanceof LargeUploadUnavailableError) return reply.status(409).send(unavailableBody(err))
      throw err
    }

    const mimeType = resolveUploadMime(parsed.data.mimeType, filename)
    const category = detectCategory(mimeType)
    if (category !== "video" && category !== "audio") {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Large uploads take video and audio files only. Upload other files with POST /v1/upload." },
      })
    }

    // Checked, never reserved: an abandoned upload must not hold quota. /complete reserves.
    const quota = await checkStorageQuota(userId, sizeBytes)
    if (!quota.allowed) {
      return reply.status(413).send({
        error: {
          code: "storage_limit_exceeded",
          message: quota.error,
          usedBytes: quota.usedBytes,
          quotaBytes: quota.quotaBytes,
          remainingBytes: quota.remainingBytes,
          tier: quota.tier,
        },
      })
    }

    const key = `uploads/${category}s/${randomUUID()}.${getExtensionFromMime(mimeType)}`
    const partSize = largeUploadPartSize(sizeBytes)
    const exp = Date.now() + TOKEN_TTL_MS

    // At most 3 open uploads and 20 starts an hour per account. Fails CLOSED:
    // without Redis the lane would be unbounded.
    let slot: Awaited<ReturnType<typeof claimLargeUploadSlot>>
    try {
      slot = await claimLargeUploadSlot(userId, key, exp)
    } catch (err) {
      req.log.error({ err }, "[large-upload] open-upload count unavailable")
      return reply.status(503).send({
        error: { code: "large_upload_busy", message: "Large uploads are unavailable right now. Try again in a moment." },
      })
    }
    if (slot === "too_many_open") {
      return reply.status(429).send({
        error: {
          code: "too_many_open_uploads",
          message: `Up to ${MAX_OPEN_LARGE_UPLOADS} large uploads can be in progress at once. Finish or cancel one, then try again.`,
        },
      })
    }
    if (slot === "rate_limited") {
      return reply.status(429).send({
        error: { code: "rate_limited", message: "Too many large uploads started in the last hour. Try again later." },
      })
    }

    try {
      const uploadId = await createLargeUpload(key, mimeType)
      const partUrls = await presignLargeUploadParts(key, uploadId, sizeBytes, partSize)
      const token = signLargeUploadToken({
        v: 1,
        userId,
        key,
        uploadId,
        sizeBytes,
        partSize,
        mimeType,
        filename,
        category,
        exp,
      })
      return reply.send({ token, partSize, partUrls })
    } catch (err) {
      await releaseLargeUploadSlot(userId, key)
      if (err instanceof LargeUploadUnavailableError) return reply.status(409).send(unavailableBody(err))
      return sendInternalError(reply, req, err, "Failed to start the upload")
    }
  })

  app.post("/v1/uploads/large/complete", async (req, reply) => {
    const userId = requireUser(req, reply)
    if (!userId) return reply
    const payload = readToken(req, reply, userId)
    if (!payload) return reply

    let claim: Claim
    try {
      claim = await claimCompletion(payload)
    } catch (err) {
      // Without the claim a repeat could reserve and record twice: refuse rather than guess.
      return sendInternalError(reply, req, err, "Failed to complete the upload")
    }
    if (claim.kind === "done") return reply.send({ data: claim.data })
    if (claim.kind === "busy") {
      return reply.status(409).send({ error: { code: "upload_completing", message: "This upload is already being completed. Try again in a moment." } })
    }

    try {
      const data = await finishUpload(req, payload, userId)
      await recordCompletion(payload, data)
      await releaseLargeUploadSlot(userId, payload.key)
      return reply.send({ data })
    } catch (err) {
      await releaseClaim(payload.uploadId)
      if (err instanceof LargeUploadUnavailableError) {
        await abortLargeUpload(payload.key, payload.uploadId).catch(() => undefined)
        await releaseLargeUploadSlot(userId, payload.key)
        return reply.status(409).send(unavailableBody(err))
      }
      if (err instanceof CompleteRefusal) {
        // Missing parts can still be sent: that upload stays open. Every other
        // refusal removed the object, so the upload is over.
        if (err.code !== "upload_incomplete") await releaseLargeUploadSlot(userId, payload.key)
        return reply.status(err.status).send(err.body)
      }
      if ((err as { name?: string }).name === "NoSuchUpload") {
        await releaseLargeUploadSlot(userId, payload.key)
        return reply.status(400).send({ error: { code: "upload_not_found", message: "This upload no longer exists. Start the upload again." } })
      }
      return sendInternalError(reply, req, err, "Failed to complete the upload")
    }
  })

  app.post("/v1/uploads/large/abort", async (req, reply) => {
    const userId = requireUser(req, reply)
    if (!userId) return reply
    const payload = readToken(req, reply, userId)
    if (!payload) return reply
    try {
      await abortLargeUpload(payload.key, payload.uploadId)
      return reply.send({ data: { aborted: true } })
    } catch (err) {
      // Best-effort: an upload already completed or aborted has nothing left to abort.
      req.log.warn({ err, key: payload.key }, "[large-upload] abort failed")
      return reply.send({ data: { aborted: false } })
    } finally {
      await releaseLargeUploadSlot(userId, payload.key)
    }
  })
}
