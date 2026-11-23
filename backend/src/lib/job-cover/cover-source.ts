import sharp from "sharp"
import { judgeUrlForRecording } from "../key-ownership.js"
import { headR2Object, isStorageConfigured, readR2Object, r2Url } from "../storage.js"
import { supabase } from "../supabase.js"
import { onlyAssetFiles } from "../asset-file-column.js"
import { restrictedKeys } from "../content-restriction-set.js"
import { RESTRICTED_ASSET_COLUMN } from "../content-restrictions-column.js"
import { isRestrictedCoverAddress } from "./cover-restriction.js"
import type { JobCoverRequest } from "./cover-request.js"

export type { JobCoverRequest } from "./cover-request.js"

/**
 * The picture a caller names as a job's cover (`PATCH /v1/jobs/:id { cover }`,
 * decided 2026-11-23): one of their own images on this platform, by its
 * library asset id or by its address on our CDN, never anything else.
 *
 *   - Another host is refused (a cover is loaded by every client that lists
 *     the job: no tracking pixel, no hotlink, never an outside address for the
 *     in-app assistant).
 *   - Whose file: the WRITER's allow proof (`judgeUrlForRecording`,
 *     lib/key-ownership.ts; review round, decided 2026-11-23) — the platform
 *     recorded the CALLER as the file's maker: their job's output, their
 *     upload, a file in their own folder (their earlier covers included).
 *     "Nobody proves it is someone else's" is not enough: a file in another
 *     user's preset, clone, export or a template's kept folder proves nobody,
 *     and must not become this caller's. An asset id is judged the same way
 *     (a library row may only RECORD an address someone named). The refusal
 *     comes BEFORE the storage is asked, the same whether or not the object
 *     exists, so it never says what exists in another account.
 *   - The file itself is read and judged: a picture sharp decodes, in one of
 *     `JOB_COVER_FORMATS`, at most `JOB_COVER_MAX_BYTES`, each side from
 *     `JOB_COVER_MIN_SIDE` to `JOB_COVER_MAX_SIDE` pixels.
 *
 * The job then keeps its own copy (lib/job-cover/cover-store.ts).
 */
export const JOB_COVER_MAX_BYTES = 10 * 1024 * 1024
export const JOB_COVER_MIN_SIDE = 64
export const JOB_COVER_MAX_SIDE = 8192
/** sharp's format names, with the file extension the copy is stored under. */
export const JOB_COVER_FORMATS: Readonly<Record<string, string>> = { jpeg: "jpg", png: "png", webp: "webp", gif: "gif" }
/** The side of the thumbnail the bytes are decoded into, to prove they decode. */
const DECODE_PROBE_SIDE = 64

export type JobCoverProblem =
  | "not_platform_image"
  | "not_yours"
  | "missing"
  | "too_large"
  | "not_an_image"
  | "wrong_format"
  | "wrong_size"

export const JOB_COVER_PROBLEM_MESSAGE: Readonly<Record<JobCoverProblem, string>> = {
  not_platform_image: "cover must be an image stored on this platform: one of your uploads or results, by its asset id or its address",
  not_yours: "cover must be one of your own images",
  missing: "cover points at a file that does not exist",
  too_large: `cover must be at most ${JOB_COVER_MAX_BYTES / (1024 * 1024)} MB`,
  not_an_image: "cover is not a picture that can be read",
  wrong_format: `cover must be ${Object.keys(JOB_COVER_FORMATS).join(", ")}`,
  wrong_size: `cover must be ${JOB_COVER_MIN_SIDE} to ${JOB_COVER_MAX_SIDE} pixels on each side`,
}

export type JobCoverSource = { readonly ok: true; readonly sourceKey: string; readonly ext: string } | { readonly ok: false; readonly problem: JobCoverProblem }

const fail = (problem: JobCoverProblem): JobCoverSource => ({ ok: false, problem })

/** A library asset's address, when the row is the caller's. Throws when the lookup cannot be asked. */
async function ownAssetUrl(userId: string, assetId: string): Promise<string | null> {
  // A file the library no longer holds, or one under a content restriction, is never a cover.
  const { data, error } = await onlyAssetFiles(
    supabase
      .from("assets")
      .select("r2_url")
      .eq("id", assetId)
      .eq("user_id", userId)
      .is(RESTRICTED_ASSET_COLUMN, null),
  ).maybeSingle()
  if (error) throw new Error(`cover asset lookup failed: ${error.message}`)
  const url = (data as { r2_url?: string | null } | null)?.r2_url
  return typeof url === "string" && url !== "" ? url : null
}

/**
 * The storage key of the caller's own file at `url`, or why it is not one.
 * Asks only the database: the storage is never asked about a file the caller
 * cannot be shown to have made. Throws when ownership cannot be asked.
 */
async function callersOwnKey(userId: string, url: string): Promise<{ key: string; url: string } | { problem: JobCoverProblem }> {
  if (!isStorageConfigured()) return { problem: "not_platform_image" }
  const target = await judgeUrlForRecording(userId, url)
  if (target.kind === "external") return { problem: "not_platform_image" }
  if (target.kind === "refused") return { problem: "not_yours" }
  return { key: target.key, url: target.url }
}

/**
 * The bytes' verdict: a picture of an accepted format and size that really
 * DECODES — the header is read for the format and the sides, then the
 * pixels are decoded into a small thumbnail (at most `limitInputPixels`), so
 * a file with a valid header and broken or truncated data is refused.
 */
export async function judgeCoverBytes(bytes: Buffer): Promise<{ ok: true; ext: string } | { ok: false; problem: JobCoverProblem }> {
  if (bytes.length > JOB_COVER_MAX_BYTES) return { ok: false, problem: "too_large" }
  const options = { animated: false, limitInputPixels: JOB_COVER_MAX_SIDE * JOB_COVER_MAX_SIDE } as const
  let meta: sharp.Metadata
  try {
    meta = await sharp(bytes, options).metadata()
  } catch {
    return { ok: false, problem: "not_an_image" }
  }
  const ext = meta.format ? JOB_COVER_FORMATS[meta.format] : undefined
  if (!ext) return { ok: false, problem: "wrong_format" }
  const sides = [meta.width ?? 0, meta.height ?? 0]
  if (sides.some((s) => s < JOB_COVER_MIN_SIDE || s > JOB_COVER_MAX_SIDE)) return { ok: false, problem: "wrong_size" }
  try {
    await sharp(bytes, options).resize(DECODE_PROBE_SIDE, DECODE_PROBE_SIDE, { fit: "inside" }).raw().toBuffer()
  } catch {
    return { ok: false, problem: "not_an_image" }
  }
  return { ok: true, ext }
}

/** The caller's stored object at `key`, judged on its bytes. Throws when the storage cannot be asked. */
async function judgeStoredCover(key: string): Promise<JobCoverSource> {
  const head = await headR2Object(key)
  if (!head.exists) return fail("missing")
  if ((head.sizeBytes ?? 0) > JOB_COVER_MAX_BYTES) return fail("too_large")
  const object = await readR2Object(key, { maxBytes: JOB_COVER_MAX_BYTES })
  if (!object) return fail("missing")
  // An object over the cap is not read: an empty body with its size.
  if ((object.size ?? object.body.length) > JOB_COVER_MAX_BYTES) return fail("too_large")
  const verdict = await judgeCoverBytes(object.body)
  if (!verdict.ok) return fail(verdict.problem)
  return { ok: true, sourceKey: key, ext: verdict.ext }
}

/**
 * Resolve and judge the picture a caller names. Answers the source key and
 * the extension to store the copy under, or the problem. Throws only when the
 * database or the storage cannot be asked (the route answers 500).
 */
export async function resolveJobCoverSource(userId: string, request: JobCoverRequest): Promise<JobCoverSource> {
  const named = "assetId" in request ? await ownAssetUrl(userId, request.assetId) : request.url
  // An asset that is not the caller's answers as one that is not theirs, never whether it exists.
  if (named === null) return fail("not_yours")
  const own = await callersOwnKey(userId, named)
  if ("problem" in own) return fail(own.problem)
  // Bytes under a content restriction, held as evidence, or a cover copied
  // from restricted bytes, are never shown as a cover.
  if (isRestrictedCoverAddress(own.url, await restrictedKeys())) return fail("not_yours")
  return judgeStoredCover(own.key)
}

/** The public address of a stored cover key (re-exported for the store and tests). */
export const jobCoverUrlOf = (key: string): string => r2Url(key)
