/**
 * Nodaro Cloud provider HTTP client (community cloud-connect, Phase 4a).
 *
 * Thin layer the NodaroCloud* providers share: create a generation job on the
 * connected cloud via its public /v1 routes, then poll GET /v1/jobs/:id until
 * the job reaches a terminal status. Auth rides `nodaroCloudFetch` (the stored
 * `ndr_app_` instance token — see lib/nodaro-connect.ts); the token resolves
 * to the connected cloud account, whose wallet is billed for the generation.
 *
 * Error mapping: cloud errors (402 insufficient_credits, 403 revoked/scope,
 * 5xx) are rethrown as NodaroCloudError carrying the cloud's own error
 * message, so the instance user sees the real reason a run failed.
 */

import { Agent } from "undici"
import { nodaroCloudFetch, getNodaroCredential, nodaroCloudBase } from "../../lib/nodaro-connect.js"
import { config } from "../../lib/config.js"
import { r2KeyFromOurUrl, readR2Object } from "../../lib/storage.js"
import { isUnroutableMediaUrl } from "../../lib/media-portability.js"
import type { ProgressCallback } from "../provider.interface.js"

/** Poll every 2s for the first few attempts, then 4s (spec: 2-4s interval). */
const POLL_FAST_MS = 2_000
const POLL_SLOW_MS = 4_000
const POLL_FAST_ATTEMPTS = 5
/** Wall-clock budget (~15 min) before giving up on a cloud job. */
const POLL_BUDGET_MS = 15 * 60 * 1_000
/** Consecutive transient poll failures (network / 5xx / 429) tolerated. */
const MAX_TRANSIENT_POLL_FAILURES = 5

/** Error body every cloud route returns: `{ error: { code, message } }`. */
interface CloudErrorBody {
  error?: { code?: string; message?: string }
}

/** Public (sanitized) job shape from the cloud's GET /v1/jobs/:id. */
export interface CloudJob {
  id: string
  status: string
  progress?: number
  output_data?: Record<string, unknown> | null
  error_message?: string | null
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "cancelled",
])

export class NodaroCloudError extends Error {
  readonly statusCode?: number
  readonly code?: string

  constructor(message: string, statusCode?: number, code?: string) {
    super(message)
    this.name = "NodaroCloudError"
    this.statusCode = statusCode
    this.code = code
  }
}

async function readCloudErrorBody(res: Response): Promise<CloudErrorBody["error"]> {
  const body = (await res.json().catch(() => null)) as CloudErrorBody | null
  return body?.error ?? undefined
}

/**
 * Build a NodaroCloudError for a non-OK cloud response, preferring the
 * cloud's own error message (the real reason) over a generic fallback.
 */
function cloudError(
  status: number,
  err: CloudErrorBody["error"],
  operation: string,
): NodaroCloudError {
  const fallback =
    status === 402
      ? "Insufficient nodaro.ai credits — top up or upgrade your connected account."
      : status === 401 || status === 403
        ? "The nodaro.ai connection was rejected — it may have been revoked. Reconnect from Integrations."
        : `${operation} failed (${status})`
  const message = err?.message?.trim() ? err.message : fallback
  return new NodaroCloudError(`nodaro.ai: ${message}`, status, err?.code)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * A synchronous cloud route answers only when the work is done — for a
 * web-scrape site crawl that can be ~10 minutes with no headers on the wire.
 * undici's default headersTimeout (300 s) would drop the socket at five
 * minutes while the cloud finishes and bills the connected account, so long
 * calls go through a dispatcher whose deadlines cover the route's own budget
 * (the cloud's web-scrape route allows 600 s).
 */
const LONG_CALL_TIMEOUT_MS = 620_000
let longCallAgent: Agent | null = null
function longCallDispatcher(): Agent {
  if (!longCallAgent) {
    longCallAgent = new Agent({ headersTimeout: LONG_CALL_TIMEOUT_MS, bodyTimeout: LONG_CALL_TIMEOUT_MS })
  }
  return longCallAgent
}

/**
 * A synchronous cloud route — one that answers with the result in the
 * response body rather than a job to poll (web-scrape). Returns the parsed
 * JSON; throws NodaroCloudError with the cloud's own message on refusal.
 */
export async function callCloudRoute(
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await nodaroCloudFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
    // Node's global fetch is undici's — `dispatcher` is honoured though the DOM
    // RequestInit type does not name it.
    ...({ dispatcher: longCallDispatcher() } as unknown as RequestInit),
  })
  if (!res.ok) {
    throw cloudError(res.status, await readCloudErrorBody(res), `POST ${path}`)
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!json || typeof json !== "object") {
    throw new NodaroCloudError(`nodaro.ai: POST ${path} succeeded but returned no body`, res.status)
  }
  return json
}

/**
 * POST a generation request to a cloud route (e.g. /v1/generate-image) and
 * return the created cloud job id. The instance sends the same body the
 * route's Zod schema accepts — identical vocabulary to a direct API caller.
 */
export async function createCloudJob(
  path: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await nodaroCloudFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw cloudError(res.status, await readCloudErrorBody(res), `POST ${path}`)
  }
  const json = (await res.json().catch(() => null)) as { jobId?: unknown } | null
  const jobId = typeof json?.jobId === "string" ? json.jobId : undefined
  if (!jobId) {
    throw new NodaroCloudError(
      `nodaro.ai: POST ${path} succeeded but returned no jobId`,
      res.status,
    )
  }
  return jobId
}

/**
 * Poll the cloud's GET /v1/jobs/:id until the job is terminal.
 *
 * - `completed` → resolves with the job (caller reads output_data URLs).
 * - `failed` / `cancelled` → throws with the cloud's error_message.
 * - Transient poll errors (network, 5xx, 429) are tolerated up to
 *   MAX_TRANSIENT_POLL_FAILURES consecutive occurrences; auth-ish statuses
 *   (401/403/404) fail fast — the token was revoked or the job vanished.
 * - Gives up after POLL_BUDGET_MS (~15 min).
 */
export async function waitForCloudJob(
  jobId: string,
  onProgress?: ProgressCallback,
  opts: { budgetMs?: number } = {},
): Promise<CloudJob> {
  const startedAt = Date.now()
  // Default stays POLL_BUDGET_MS (~15 min). The exclusive-node relay passes
  // a bigger budget for gvp/evp-class runs (they legitimately take an hour+),
  // kept under the orchestrator's 90-min NODE_TIMEOUT_MS.
  const budgetMs = opts.budgetMs ?? POLL_BUDGET_MS
  let attempt = 0
  let transientFailures = 0

  while (Date.now() - startedAt < budgetMs) {
    if (attempt > 0) {
      await sleep(attempt <= POLL_FAST_ATTEMPTS ? POLL_FAST_MS : POLL_SLOW_MS)
    }
    attempt += 1

    let job: CloudJob | undefined
    try {
      const res = await nodaroCloudFetch(`/v1/jobs/${jobId}`)
      if (!res.ok) {
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          throw cloudError(res.status, await readCloudErrorBody(res), `GET /v1/jobs/${jobId}`)
        }
        // 5xx / 429: transient — retry within the failure allowance.
        transientFailures += 1
        if (transientFailures > MAX_TRANSIENT_POLL_FAILURES) {
          throw cloudError(res.status, await readCloudErrorBody(res), `GET /v1/jobs/${jobId}`)
        }
        continue
      }
      const json = (await res.json().catch(() => null)) as { data?: CloudJob } | null
      job = json?.data
    } catch (err) {
      if (err instanceof NodaroCloudError) throw err
      // Network-level failure — transient.
      transientFailures += 1
      if (transientFailures > MAX_TRANSIENT_POLL_FAILURES) {
        const message = err instanceof Error ? err.message : String(err)
        throw new NodaroCloudError(
          `nodaro.ai: polling job ${jobId} failed repeatedly (${message})`,
        )
      }
      continue
    }

    if (!job) {
      transientFailures += 1
      if (transientFailures > MAX_TRANSIENT_POLL_FAILURES) {
        throw new NodaroCloudError(
          `nodaro.ai: job ${jobId} poll returned no data repeatedly`,
        )
      }
      continue
    }
    transientFailures = 0

    if (typeof job.progress === "number" && onProgress) {
      try {
        await onProgress(job.progress)
      } catch {
        // Progress reporting is best-effort — never fail the poll for it.
      }
    }

    if (!TERMINAL_STATUSES.has(job.status)) continue

    if (job.status === "completed") return job
    if (job.status === "cancelled") {
      throw new NodaroCloudError(
        `nodaro.ai: generation was cancelled on the cloud (job ${jobId})`,
      )
    }
    throw new NodaroCloudError(
      `nodaro.ai: ${job.error_message?.trim() ? job.error_message : `generation failed (job ${jobId})`}`,
    )
  }

  throw new NodaroCloudError(
    `nodaro.ai: job ${jobId} did not finish within ${Math.round(POLL_BUDGET_MS / 60_000)} minutes`,
  )
}


// ─── Instance→cloud media handoff ─────────────────────────────────
//
// Local artifacts live in the instance's own storage (MinIO / self-host R2),
// often on localhost or a private network the cloud cannot and will not fetch
// (its safe-fetch guard rejects private hosts — the exact error the founder
// hit live: "imageUrl: URL must use http(s) and must not point to localhost
// or private networks"). Any media INPUT the instance sends to a cloud job is
// therefore re-hosted first: read the bytes locally, push them through the
// cloud's public upload route with the instance token, pass the returned
// public URL.

/**
 * Origins whose media this instance is willing to read and re-upload.
 *
 * SECURITY: re-hosting reads the URL with a PLAIN fetch — the safe-fetch guard
 * is deliberately bypassed because our own storage often sits on a private
 * host. That bypass must therefore be narrow. Re-hosting anything that merely
 * "looks private" would turn any node's URL field into a way to read internal
 * addresses (169.254.169.254, an intranet host) and publish the bytes to a
 * public cloud URL. So: our storage origins only, everything else refused.
 */
function instanceMediaOrigins(): string[] {
  const origins: string[] = []
  for (const candidate of [config.R2_PUBLIC_URL, config.PUBLIC_URL]) {
    if (!candidate) continue
    try {
      origins.push(new URL(candidate).origin)
    } catch {
      /* malformed config value — ignore rather than crash a generation */
    }
  }
  return origins
}

function isOurMediaUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== "http:" && u.protocol !== "https:") return false
    if (config.R2_PUBLIC_FALLBACK_DOMAIN && u.hostname === config.R2_PUBLIC_FALLBACK_DOMAIN) {
      return true
    }
    return instanceMediaOrigins().includes(u.origin)
  } catch {
    return false
  }
}

// The host classification lives in lib/media-portability.ts (one list for
// "can the cloud fetch this?" and the workflow export/import checks, #866).
const isCloudUnreachableUrl = isUnroutableMediaUrl

/** Ceiling for re-hosted media, matched to the cloud upload route's own cap. */
const MAX_REHOST_BYTES = 500 * 1_000_000

const MIME_TO_UPLOAD_NAME: Record<string, string> = {
  "image/png": "frame.png",
  "image/jpeg": "frame.jpg",
  "image/webp": "frame.webp",
  "image/avif": "frame.avif",
  "video/mp4": "clip.mp4",
  "video/quicktime": "clip.mov",
  "video/webm": "clip.webm",
  "audio/mpeg": "audio.mp3",
  "audio/mp3": "audio.mp3",
  "audio/wav": "audio.wav",
  "audio/x-wav": "audio.wav",
  "audio/mp4": "audio.m4a",
  "audio/x-m4a": "audio.m4a",
  "audio/aac": "audio.aac",
}

function uploadNameFor(mime: string): string {
  const known = MIME_TO_UPLOAD_NAME[mime]
  if (known) return known
  const [kind] = mime.split("/")
  return kind === "video" ? "clip.mp4" : kind === "audio" ? "audio.mp3" : "frame.png"
}

const tooLarge = (bytes: number): NodaroCloudError =>
  new NodaroCloudError(
    `nodaro.ai: media is too large to send to the cloud (${Math.round(bytes / 1_000_000)} MB; limit ${MAX_REHOST_BYTES / 1_000_000} MB)`,
  )

/**
 * The bytes of one of OUR media urls, for the re-host upload.
 *
 * Through the storage client first: this code runs INSIDE the app container,
 * where the install's public origin often does not resolve (a remapped host
 * port, a domain behind a proxy, split-horizon DNS) — `fetch("http://
 * localhost:3002/storage/…")` from within died with ECONNREFUSED on a
 * healthy install (2026-08-16), while `R2_ENDPOINT` (`http://minio:9000`)
 * always answers in there. The plain fetch of the public url stays as the
 * fallback for media served under PUBLIC_URL by something other than the
 * bucket (deliberately not safe-fetch: our storage is on a private host by
 * design). Bounded either way — a multi-GB clip would otherwise be read fully
 * into memory and take the process down before the cloud ever refused it.
 */
async function readOwnMedia(url: string): Promise<{ buffer: Buffer; mime: string }> {
  const key = r2KeyFromOurUrl(url)
  if (key) {
    const obj = await readR2Object(key, { maxBytes: MAX_REHOST_BYTES })
    if (obj) {
      if (obj.size !== null && obj.size > MAX_REHOST_BYTES) throw tooLarge(obj.size)
      return { buffer: obj.body, mime: obj.contentType?.split(";")[0] ?? "application/octet-stream" }
    }
  }

  const local = await fetch(url)
  if (!local.ok) {
    throw new NodaroCloudError(
      `nodaro.ai: failed to read local media for cloud upload (${local.status})`,
    )
  }
  const declared = Number(local.headers.get("content-length") ?? "0")
  if (declared > MAX_REHOST_BYTES) throw tooLarge(declared)
  const buffer = Buffer.from(await local.arrayBuffer())
  if (buffer.length > MAX_REHOST_BYTES) throw tooLarge(buffer.length)
  return { buffer, mime: local.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream" }
}

/**
 * Pass public URLs through untouched; re-host instance-local ones.
 *
 * Works for images, video and audio alike — the generic `POST /v1/upload`
 * accepts every media kind and reports back one shape. Video and audio matter
 * as much as images here: lip-sync, motion-transfer, video-upscale and
 * video-to-video all send clips the cloud cannot reach on a private host.
 */
export async function ensureCloudReachableMediaUrl(url: string): Promise<string>
export async function ensureCloudReachableMediaUrl(url: string | undefined): Promise<string | undefined>
export async function ensureCloudReachableMediaUrl(url: string | undefined): Promise<string | undefined> {
  if (!url || !isCloudUnreachableUrl(url)) return url

  // Only our own storage is read and re-hosted (see instanceMediaOrigins).
  if (!isOurMediaUrl(url)) {
    throw new NodaroCloudError(
      "nodaro.ai: that media lives on a host the cloud can't reach and this " +
        "install doesn't own. Upload it here first, or use a public URL.",
    )
  }

  const { buffer, mime } = await readOwnMedia(url)

  // getNodaroCredential, NOT getNodaroConnection: the connection object is
  // the OAuth registration only, so a NODARO_API_KEY-lane install (env or
  // pasted) could create cloud jobs but died right here on the very first
  // media re-host with a misleading "not connected" (4b plan, PR 1). The
  // credential covers every lane and is what nodaroCloudFetch itself uses.
  const credential = await getNodaroCredential()
  if (!credential) {
    throw new NodaroCloudError("nodaro.ai is not connected")
  }
  const form = new FormData()
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mime }), uploadNameFor(mime))
  const res = await fetch(`${nodaroCloudBase()}/v1/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${credential.token}` },
    body: form,
  })
  if (!res.ok) {
    throw new NodaroCloudError(`nodaro.ai: media upload failed (${res.status})`, res.status)
  }
  // The generic route answers { data: { url } }; the legacy image route answers
  // { url }. Accept both so this keeps working if a call site changes routes.
  const json = (await res.json().catch(() => null)) as
    | { url?: string; data?: { url?: string } }
    | null
  const uploaded = json?.data?.url ?? json?.url
  if (!uploaded) {
    throw new NodaroCloudError("nodaro.ai: media upload returned no url")
  }
  return uploaded
}

/** Back-compat alias — images were the first (and for a while only) kind. */
export const ensureCloudReachableImageUrl = ensureCloudReachableMediaUrl

/** Array form (order preserved). */
export async function ensureCloudReachableMediaUrls(
  urls: string[] | undefined,
): Promise<string[] | undefined> {
  if (!urls?.length) return urls
  return Promise.all(urls.map((u) => ensureCloudReachableMediaUrl(u)))
}

/** Back-compat alias. */
export const ensureCloudReachableImageUrls = ensureCloudReachableMediaUrls
