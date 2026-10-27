// @reads-none reads nothing itself: the cut (preview-clip-media.ts) downloads each version's source clip and face mask to a temp dir it removes
/**
 * Give every trend version that offers a 4 s preview and has no preview
 * INPUT CLIP its clip (`data.previewClip`, types.ts).
 *
 * WHY. Since the prepared preview, the admin's draft save and publish cut the
 * preview's input clip once (`ensurePreviewClip`, preview-clip-media.ts) and
 * a preview run of that version sends exactly that file to an engine that
 * declares `castSwap.preparedPreview`; an engine without it still cuts the
 * window itself from the whole source. Versions saved before — published
 * ones, which users run, and drafts — have none, so their preview runs keep
 * cutting per run until the next publish. This cuts them ahead of time.
 *
 * WHAT IT WRITES. For each such version (published AND draft): the clip is
 * cut from the version's OWN source at its OWN `previewStart`, with the
 * version's current stored face mask (`storedFaceMaskFor`) cut alongside
 * when it has one (`makePreviewClip`, which uploads under `trends/<id>/`),
 * and attached by `attachPreviewClip` — the store's second documented
 * exception to "a published version is never written": it adds
 * `data.previewClip` only, leaves every other byte of `data`, the `revision`
 * and `published_at` as they were, and refuses a row whose source or start
 * moved meanwhile. A version whose download or cut fails, or whose row moved,
 * is reported and skipped; a database error, or a clip address that is not
 * http(s) (storage misconfigured), stops the run. A second run lists nothing.
 *
 * ENVIRONMENT (the API service's): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * INTERNAL_ORCHESTRATOR_SECRET (32+ characters), the R2 storage settings
 * (R2_ACCOUNT_ID or R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_BUCKET_NAME, R2_PUBLIC_URL), and ffmpeg / ffprobe on PATH.
 *
 * Usage (dry run is the DEFAULT: nothing is downloaded, uploaded or written):
 *   cd backend && npm run backfill:trend-preview-clip
 *   … -- --limit 1           # the first N versions only
 *   … -- --published         # published versions only (what users run)
 *   … -- --apply             # cut and attach the clips
 */
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { isStorageConfigured, r2Url } from "../../lib/storage.js"
import { TrendMediaError } from "../lib/trends/media.js"
import { makePreviewClip } from "../lib/trends/preview-clip-media.js"
import { previewClipDurationSec } from "../lib/trends/preview-clip.js"
import { storedFaceMaskFor } from "../lib/trends/face-mask.js"
import { attachPreviewClip, PreviewClipAttachConflictError, listVersionsLackingPreviewClip, type VersionLackingPreviewClip } from "../lib/trends/store.js"
import type { TrendPreviewClip } from "../lib/trends/types.js"

export interface PreviewClipBackfillOptions {
  readonly apply: boolean
  /** Only the first N versions (in trend, version order); null = all. */
  readonly limit: number | null
  /** Published versions only. */
  readonly publishedOnly: boolean
}

export function parsePreviewClipArgs(argv: ReadonlyArray<string>): PreviewClipBackfillOptions {
  const i = argv.indexOf("--limit")
  let limit: number | null = null
  if (i !== -1) {
    const raw = argv[i + 1]
    const n = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : NaN
    if (!Number.isSafeInteger(n) || n < 1) throw new Error("--limit takes a positive whole number of versions (e.g. --limit 5).")
    limit = n
  }
  return { apply: argv.includes("--apply"), limit, publishedOnly: argv.includes("--published") }
}

export interface PreviewClipBackfillResult {
  ok: boolean
  candidates: number
  set: number
  already: number
  failed: number
}

/** One version's line prefix: `<slug> (<trend id>) v<version> · published|draft`. */
function label(v: VersionLackingPreviewClip): string {
  return `${v.slug ?? "(no trend row)"} (${v.trendId}) v${v.version} · ${v.published ? "published" : "draft"}`
}

/** The just-made clip's file(s), for a version it was not attached to (they stay in storage). */
const unused = (c: TrendPreviewClip) => [c.videoUrl, ...(c.faceMask ? [c.faceMask.url] : [])].join(" ")

/** A version's skip reason, or null when the error is not one version's problem (it stops the run). */
function skipReason(stage: "cut" | "attach", err: unknown): string | null {
  if (err instanceof TrendMediaError) {
    // What ffmpeg / ffprobe said, when it says more than the code (the operator's only clue).
    const cause = err.cause instanceof Error ? err.cause.message : err.cause !== undefined ? String(err.cause) : ""
    return `${err.code}: ${err.message}${cause ? ` (${cause})` : ""}`
  }
  if (err instanceof PreviewClipAttachConflictError) return `${err.reason}: ${err.message}`
  if (stage === "attach") return null
  return `${stage}: ${err instanceof Error ? err.message : String(err)}`
}

/** Cut the version's own preview clip (and its stored face mask's cut) from its own source and start. */
function previewClipOf(v: VersionLackingPreviewClip): Promise<TrendPreviewClip> {
  const { data } = v
  const source = data.source!
  const startSec = data.previewStart!
  const mask = storedFaceMaskFor(data)
  return makePreviewClip(v.trendId, {
    sourceUrl: source.videoUrl,
    startSec,
    durationSec: previewClipDurationSec(source.durationSec, startSec),
    ...(mask ? { faceMask: { url: mask.url } } : {}),
  })
}

export async function runPreviewClipBackfill(opts: PreviewClipBackfillOptions): Promise<PreviewClipBackfillResult> {
  console.log(`[trend-preview-clip] mode=${opts.apply ? "APPLY" : "dry run"}${opts.limit !== null ? ` limit=${opts.limit}` : ""}${opts.publishedOnly ? " published only" : ""}`)
  // Without credentials every upload fails; without R2_PUBLIC_URL an upload answers "/trends/…", no address a run can fetch.
  if (opts.apply && !(isStorageConfigured() && /^https?:\/\//i.test(r2Url("x")))) {
    console.error("Refusing: storage is not configured (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID or R2_ENDPOINT, and an http(s) R2_PUBLIC_URL).")
    return { ok: false, candidates: 0, set: 0, already: 0, failed: 0 }
  }
  const listed = await listVersionsLackingPreviewClip()
  const all = opts.publishedOnly ? listed.filter((v) => v.published) : listed
  const versions = opts.limit !== null ? all.slice(0, opts.limit) : all
  console.log(`[trend-preview-clip] ${all.length} version(s) lacking a preview clip${versions.length < all.length ? `, taking the first ${versions.length}` : ""}`)
  const result: PreviewClipBackfillResult = { ok: true, candidates: versions.length, set: 0, already: 0, failed: 0 }

  for (const v of versions) {
    const mask = storedFaceMaskFor(v.data)
    const what = `${previewClipDurationSec(v.data.source!.durationSec, v.data.previewStart!).toFixed(2)} s from ${v.data.previewStart!.toFixed(2)} s${mask ? ", with its face mask" : ""}`
    if (!opts.apply) {
      console.log(`${label(v)} · would cut the preview clip (${what})`)
      continue
    }
    let clip: TrendPreviewClip
    try {
      clip = await previewClipOf(v)
    } catch (err) {
      result.failed += 1
      console.warn(`${label(v)} · FAILED (${skipReason("cut", err)})`)
      continue
    }
    try {
      const outcome = await attachPreviewClip(v.trendId, v.version, clip)
      if (outcome === "set") {
        result.set += 1
        console.log(`${label(v)} · preview clip set (${what}: ${clip.frames} frames, ${clip.width}×${clip.height}, ${clip.durationSec.toFixed(2)} s, sha256 ${clip.sha256.slice(0, 12)})`)
      } else {
        result.already += 1
        console.log(`${label(v)} · already had a preview clip (the one just made is left unused: ${unused(clip)})`)
      }
    } catch (err) {
      const reason = skipReason("attach", err)
      if (reason === null) throw err
      result.failed += 1
      console.warn(`${label(v)} · FAILED (${reason}; the clip just made is left unused: ${unused(clip)})`)
    }
  }

  result.ok = result.failed === 0
  console.log(
    opts.apply
      ? `[trend-preview-clip] ${versions.length} version(s): ${result.set} set, ${result.already} already had one, ${result.failed} failed`
      : `[trend-preview-clip] ${versions.length} version(s) (dry run — nothing written)`,
  )
  return result
}

const invokedDirectly = typeof process.argv[1] === "string" && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  Promise.resolve()
    .then(() => runPreviewClipBackfill(parsePreviewClipArgs(process.argv.slice(2))))
    .then((r) => {
      if (!r.ok) process.exitCode = 1
    })
    .catch((err) => {
      console.error(err)
      process.exitCode = 1
    })
}
