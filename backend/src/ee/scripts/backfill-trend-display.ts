// @reads-none reads only temp files: each version's source clip, downloaded to a temp dir and removed after its copy is made
/**
 * Give every trend version that has a source clip and no display copy its
 * display copy and poster (trends "show the original", S7).
 *
 * WHY. Since S7 the admin's upload of a source clip makes a browser-safe copy
 * (`makeDisplayCopy`: H.264 / AAC / faststart MP4 and a PNG poster), kept as
 * `data.source.display`; the trend's page shows the original from it, and a
 * draft without one cannot publish (`source_display_missing`). Versions saved
 * before S7 — published ones, and drafts (a v2 copied from a published v1) —
 * have none.
 *
 * WHAT IT WRITES. For each such version (published AND draft): the version's
 * own `source.videoUrl` is downloaded (SSRF-guarded `downloadFile`, the trend
 * media limit), re-encoded by `makeDisplayCopy` (which uploads the copy and
 * poster under `trends/<id>/`), and attached by `attachDisplayCopy` — the
 * store's one documented exception to "a published version is never
 * written": it adds `data.source.display` only, leaves every other byte of
 * `data`, the `revision` and `published_at` as they were, and refuses a row
 * whose source clip was replaced meanwhile. A version whose download or
 * transcode fails, or whose row moved (source replaced or removed, version
 * gone), is reported and skipped; a database error, or a display address
 * that is not http(s) (storage misconfigured), stops the run.
 * A second run lists nothing.
 *
 * ENVIRONMENT (the API service's): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * INTERNAL_ORCHESTRATOR_SECRET (32+ characters), the R2 storage settings
 * (R2_ACCOUNT_ID or R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_BUCKET_NAME, R2_PUBLIC_URL), and ffmpeg / ffprobe on PATH.
 *
 * Usage (dry run is the DEFAULT: nothing is downloaded, uploaded or written):
 *   cd backend && npm run backfill:trend-display
 *   … -- --limit 1           # the first N versions only
 *   … -- --apply             # make and attach the copies
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { downloadFile, probeVideoSource } from "../../providers/video/ffmpeg-utils.js"
import { isStorageConfigured, r2Url } from "../../lib/storage.js"
import { makeDisplayCopy, TREND_MEDIA_MAX_BYTES, TrendMediaError } from "../lib/trends/media.js"
import { attachDisplayCopy, DisplayAttachConflictError, listVersionsLackingDisplay, type VersionLackingDisplay } from "../lib/trends/store.js"
import type { TrendSourceDisplay } from "../lib/trends/types.js"

export interface DisplayBackfillOptions {
  readonly apply: boolean
  /** Only the first N versions (in trend, version order); null = all. */
  readonly limit: number | null
}

export function parseDisplayArgs(argv: ReadonlyArray<string>): DisplayBackfillOptions {
  const i = argv.indexOf("--limit")
  let limit: number | null = null
  if (i !== -1) {
    const raw = argv[i + 1]
    const n = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : NaN
    if (!Number.isSafeInteger(n) || n < 1) throw new Error("--limit takes a positive whole number of versions (e.g. --limit 5).")
    limit = n
  }
  return { apply: argv.includes("--apply"), limit }
}

export interface DisplayBackfillResult {
  ok: boolean
  candidates: number
  set: number
  already: number
  failed: number
}

/** One version's line prefix: `<slug> (<trend id>) v<version> · published|draft`. */
function label(v: VersionLackingDisplay): string {
  return `${v.slug ?? "(no trend row)"} (${v.trendId}) v${v.version} · ${v.published ? "published" : "draft"}`
}

/** The just-made copy's two files, for a version it was not attached to (they stay in storage). */
const unused = (d: TrendSourceDisplay) => `${d.videoUrl} ${d.posterUrl}`

/** A version's skip reason, or null when the error is not one version's problem (it stops the run). */
function skipReason(stage: "download" | "copy" | "attach", err: unknown): string | null {
  if (err instanceof TrendMediaError) {
    // What ffmpeg / ffprobe said, when it says more than the code (the operator's only clue).
    const cause = err.cause instanceof Error ? err.cause.message : err.cause !== undefined ? String(err.cause) : ""
    return `${err.code}: ${err.message}${cause ? ` (${cause})` : ""}`
  }
  if (err instanceof DisplayAttachConflictError) return `${err.reason}: ${err.message}`
  if (stage === "attach") return null
  return `${stage}: ${err instanceof Error ? err.message : String(err)}`
}

/** Download the version's own source clip to a temp dir, make its display copy there; the dir is always removed. */
async function displayCopyOf(v: VersionLackingDisplay): Promise<TrendSourceDisplay> {
  const dir = await mkdtemp(join(tmpdir(), "trend-display-backfill-"))
  const file = join(dir, "source")
  try {
    try {
      await downloadFile(v.sourceVideoUrl, file, { maxBytes: TREND_MEDIA_MAX_BYTES.video })
    } catch (err) {
      throw Object.assign(new Error(err instanceof Error ? err.message : String(err)), { stage: "download" as const })
    }
    // The re-encode is admitted at the clip's size, as at upload; unreadable here, at the default.
    const canvas = await probeVideoSource(file).then((p) => ({ width: p.width, height: p.height }), () => undefined)
    return await makeDisplayCopy(v.trendId, file, canvas ? { canvas } : {})
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function runDisplayBackfill(opts: DisplayBackfillOptions): Promise<DisplayBackfillResult> {
  console.log(`[trend-display] mode=${opts.apply ? "APPLY" : "dry run"}${opts.limit !== null ? ` limit=${opts.limit}` : ""}`)
  // Without credentials every upload fails; without R2_PUBLIC_URL an upload answers "/trends/…", no address to show.
  if (opts.apply && !(isStorageConfigured() && /^https?:\/\//i.test(r2Url("x")))) {
    console.error("Refusing: storage is not configured (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID or R2_ENDPOINT, and an http(s) R2_PUBLIC_URL).")
    return { ok: false, candidates: 0, set: 0, already: 0, failed: 0 }
  }
  const all = await listVersionsLackingDisplay()
  const versions = opts.limit !== null ? all.slice(0, opts.limit) : all
  console.log(`[trend-display] ${all.length} version(s) lacking a display copy${versions.length < all.length ? `, taking the first ${versions.length}` : ""}`)
  const result: DisplayBackfillResult = { ok: true, candidates: versions.length, set: 0, already: 0, failed: 0 }

  for (const v of versions) {
    if (!opts.apply) {
      console.log(`${label(v)} · would make a display copy`)
      continue
    }
    let display: TrendSourceDisplay
    try {
      display = await displayCopyOf(v)
    } catch (err) {
      const stage = (err as { stage?: "download" }).stage ?? "copy"
      result.failed += 1
      console.warn(`${label(v)} · FAILED (${skipReason(stage, err)})`)
      continue
    }
    try {
      const outcome = await attachDisplayCopy(v.trendId, v.version, display, { sourceVideoUrl: v.sourceVideoUrl })
      if (outcome === "set") {
        result.set += 1
        console.log(`${label(v)} · display copy set (${display.width}×${display.height}, ${display.durationSec.toFixed(1)} s)`)
      } else {
        result.already += 1
        console.log(`${label(v)} · already had a display copy (the one just made is left unused: ${unused(display)})`)
      }
    } catch (err) {
      const reason = skipReason("attach", err)
      if (reason === null) throw err
      result.failed += 1
      console.warn(`${label(v)} · FAILED (${reason}; the copy just made is left unused: ${unused(display)})`)
    }
  }

  result.ok = result.failed === 0
  console.log(
    opts.apply
      ? `[trend-display] ${versions.length} version(s): ${result.set} set, ${result.already} already had one, ${result.failed} failed`
      : `[trend-display] ${versions.length} version(s) (dry run — nothing written)`,
  )
  return result
}

const invokedDirectly = typeof process.argv[1] === "string" && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  Promise.resolve()
    .then(() => runDisplayBackfill(parseDisplayArgs(process.argv.slice(2))))
    .then((r) => {
      if (!r.ok) process.exitCode = 1
    })
    .catch((err) => {
      console.error(err)
      process.exitCode = 1
    })
}
