/**
 * Replay a job's own payload against the connected cloud.
 *
 * The capability router covers nodes that route through it. A large second
 * group — Suno's twelve operations, the LLM features, transcription — calls a
 * vendor client straight from the worker and never reaches the registry, so no
 * amount of capability declaration rescues them on a keyless install.
 *
 * The thing that makes a generic path possible: the instance and the cloud run
 * THE SAME CODE, and a worker's `job.data` is the route body that was already
 * validated, plus a couple of instance-local bookkeeping fields. So the worker
 * can re-POST its own payload to the cloud's identical route, wait for that
 * job, and read the finished media back — no per-operation request mapping to
 * write or keep in sync.
 *
 * What this deliberately does NOT do is finalize anything. It hands back the
 * cloud's output_data; the caller downloads what it needs and stores it on the
 * instance through its existing path, so R2 keys, gallery rows, watermarking
 * and cleanup stay identical to a local run.
 */

import {
  createCloudJob,
  waitForCloudJob,
  NodaroCloudError,
  ensureCloudReachableMediaUrl,
} from "./client.js"
import type { ProgressCallback } from "../provider.interface.js"

/**
 * Worker job type -> the cloud route that serves it.
 *
 * Only list a type whose `job.data` really is the route body. A wrong entry
 * fails loudly at the cloud's Zod rather than silently misbehaving, but the
 * check belongs here: add a type only after reading its enqueue site.
 */
const CLOUD_ROUTE_BY_JOB_TYPE: Readonly<Record<string, string>> = {
  "generate-script": "/v1/generate-script",
  "suno-generate": "/v1/suno/generate",
  "suno-cover": "/v1/suno/cover",
  "suno-extend": "/v1/suno/extend",
  "suno-mashup": "/v1/suno/mashup",
  "suno-replace-section": "/v1/suno/replace-section",
  "suno-add-instrumental": "/v1/suno/add-instrumental",
  "suno-add-vocals": "/v1/suno/add-vocals",
  "suno-upload-extend": "/v1/suno/upload-extend",
  // The four bespoke operations (#643). They don't share the multi-track
  // finalizer — lyrics is text, separate is stems, music-video is a video,
  // convert-wav is a wav — so each has its own result adapter in
  // workers/handlers/suno.ts feeding the SAME local persistence a KIE result
  // would. The replay itself stays generic; only the result handling differs.
  "suno-lyrics": "/v1/suno/lyrics",
  "suno-separate": "/v1/suno/separate",
  "suno-music-video": "/v1/suno/music-video",
  "suno-convert-wav": "/v1/suno/convert-wav",
  // The vendor-direct video nodes (HeyGen, Beeble). Their handlers call the
  // vendor client straight from the worker, so the capability router never
  // sees them; without a local key the connection is the only way they run.
  // Enqueue sites read 2026-08-16: each payload is the validated route body
  // plus jobId / usageLogId (/ userId on switchx), which the strip below
  // removes. Media fields re-host through URL_FIELD (`imageUrl`, `audioUrl`,
  // `videoUrl`, `referenceImageUrl`, `maskUrl`) and, for cinematic-avatar's
  // `references[]`, the object-array branch of rehostIfUrlField.
  "ai-avatar": "/v1/ai-avatar",
  "cinematic-avatar": "/v1/cinematic-avatar",
  "switchx": "/v1/switchx",
  // Transcription (#761): the enqueue payload (routes/transcribe.ts) is the
  // validated route body plus jobId/usageLogId, both stripped below. The
  // audioUrl field re-hosts through URL_FIELD — a local-MinIO or extracted
  // social-audio URL becomes cloud-reachable before the POST; wordTimestamps
  // and the whisper/elevenlabs provider choice ride through verbatim (the
  // cloud holds keys for both lanes).
  "transcribe": "/v1/transcribe",
}


/**
 * Per-type payload fixups, for the minority of job types whose enqueued shape
 * differs from the route body.
 *
 * generate-script is the reason this exists: the route takes advancedMode /
 * temperature / maxTokens flat, but the enqueue nests them under `advanced` so
 * the worker can carry them. Replaying verbatim would have dropped exactly the
 * settings a user deliberately changed — silently, since the cloud's Zod
 * ignores an unknown key. Read the enqueue site before adding any type; when
 * it differs, put the difference here rather than pretending it doesn't exist.
 */
const PAYLOAD_ADAPTERS: Readonly<
  Record<string, (payload: Record<string, unknown>) => Record<string, unknown>>
> = {
  "generate-script": ({ advanced, ...rest }) => ({
    ...rest,
    ...(advanced && typeof advanced === "object" ? (advanced as Record<string, unknown>) : {}),
  }),
  // The route's field is `type`; the enqueue renames it `separateType` so the
  // worker payload reads unambiguously. Replayed verbatim, the cloud's Zod
  // would silently drop `separateType` and DEFAULT the operation to
  // separate_vocal — a user's split_stem request would come back as a vocal
  // split with no error anywhere.
  "suno-separate": ({ separateType, ...rest }) => ({
    ...rest,
    ...(typeof separateType === "string" ? { type: separateType } : {}),
  }),
}

/**
 * Fields the instance adds when enqueuing. They identify rows in THIS
 * database and mean nothing to the cloud, so they never travel.
 *
 * NOTE this is a denylist, which is the weaker shape: a job type whose payload
 * carries some OTHER internal field would leak it. That is tolerable only
 * because the map above is deliberate and small — the rule for adding a type
 * is to read its enqueue site first and confirm the payload is route-shaped.
 * If this map ever grows past a handful of hand-checked entries, replace this
 * with a per-type allowlist derived from the route schema.
 */
export const INSTANCE_ONLY_FIELDS = new Set([
  "jobId",
  "usageLogId",
  "userId",
  "workflowExecutionId",
  // Billing/tier decisions are the CLOUD's to make for its own account —
  // forwarding ours would either be ignored or, worse, respected.
  "shouldWatermark",
  "should_watermark",
  "tier",
  "creditsReserved",
])


/** Field names whose values are media URLs. Matching on the NAME keeps this
 *  from mangling a prompt that happens to contain a URL. */
const URL_FIELD = /url$|urls$|urllist$/i

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** Re-host the URL-named fields of one object (one level — a reference list
 *  item, not a whole nested document). */
async function rehostObjectUrlFields(obj: Record<string, unknown>): Promise<Record<string, unknown>> {
  return Object.fromEntries(
    await Promise.all(Object.entries(obj).map(async ([k, v]) => [k, await rehostIfUrlField(k, v)])),
  )
}

export async function rehostIfUrlField(key: string, value: unknown): Promise<unknown> {
  // A list of objects (cinematic-avatar's `references: [{ type, url }]`)
  // carries its media one level down; the list's own name says nothing
  // about URLs, so look inside regardless of the key.
  if (Array.isArray(value) && value.length > 0 && value.every(isPlainObject)) {
    return Promise.all(value.map((v) => rehostObjectUrlFields(v)))
  }
  if (!URL_FIELD.test(key)) return value
  if (typeof value === "string") return ensureCloudReachableMediaUrl(value)
  if (Array.isArray(value)) {
    return Promise.all(
      value.map((v) => (typeof v === "string" ? ensureCloudReachableMediaUrl(v) : v)),
    )
  }
  return value
}

export function cloudRouteForJobType(jobType: string): string | undefined {
  return CLOUD_ROUTE_BY_JOB_TYPE[jobType]
}

/** True when this job type can be replayed against the cloud. */
export function canRunOnCloud(jobType: string): boolean {
  return jobType in CLOUD_ROUTE_BY_JOB_TYPE
}

/**
 * The one rule for "should this run on the connection instead of the vendor":
 * the install has no key of its own for that vendor AND a live nodaro.ai
 * connection. A keyed install never reaches the cloud path and behaves
 * exactly as before; an unconnected keyless install fails the honest way
 * (the vendor client's own "add <KEY>" message). Reads the connection each
 * call — a connect-after-boot must count, and the read is a cached credential.
 */
export async function shouldRunOnCloud(localKey: string | null | undefined): Promise<boolean> {
  const { isNodaroConnected, getNodaroProviderPrefs } = await import("../../lib/nodaro-connect.js")
  const prefs = await getNodaroProviderPrefs()
  // scope "exclusives": the credential serves ONLY the exclusive nodes —
  // this vendor-direct fallthrough behaves as if it did not exist, even on
  // a keyless install (the vendor client's own missing-key error is the
  // honest outcome the user chose).
  if (prefs.scope === "exclusives") return false
  const hasLocalKey = typeof localKey === "string" && localKey.trim().length > 0
  // precedence "nodaro" ("ignore my other providers"): the connection wins
  // even when a local vendor key exists.
  if (hasLocalKey && prefs.precedence !== "nodaro") return false
  return isNodaroConnected().catch(() => false)
}

/**
 * Run `payload` on the cloud as `jobType` and return the finished job's
 * `output_data` verbatim. Throws NodaroCloudError on anything the cloud
 * refuses, so the caller's existing error path reports it.
 */
export async function runJobOnCloud(
  jobType: string,
  payload: Record<string, unknown>,
  onProgress?: ProgressCallback,
): Promise<Record<string, unknown>> {
  const route = cloudRouteForJobType(jobType)
  if (!route) {
    throw new NodaroCloudError(`nodaro.ai: ${jobType} cannot run on the connection`)
  }
  const adapted = PAYLOAD_ADAPTERS[jobType]?.(payload) ?? payload
  const kept = Object.entries(adapted).filter(
    ([key, value]) => !INSTANCE_ONLY_FIELDS.has(key) && value !== undefined,
  )
  // Media in a payload usually lives on THIS instance (a user upload, or a
  // social URL we already downloaded), and the cloud cannot reach a private
  // host — the same wall image-to-video hit. Re-host URL-shaped fields before
  // sending; public URLs pass through untouched.
  const body = Object.fromEntries(
    await Promise.all(kept.map(async ([key, value]) => [key, await rehostIfUrlField(key, value)])),
  )
  const jobId = await createCloudJob(route, body)
  const job = await waitForCloudJob(jobId, onProgress)
  const output = job.output_data
  if (!output || typeof output !== "object") {
    throw new NodaroCloudError(`nodaro.ai: ${jobType} job ${jobId} finished with no output`)
  }
  return output as Record<string, unknown>
}
