// @reads-none reads nothing itself: each web copy (web-copy.ts) downloads its video to a temp dir it removes
/**
 * Give every published trend's shown videos their web copies (types.ts
 * `TrendWebCopy`): the original's (unless the trend hides it) and every
 * example's.
 *
 * WHY. Since web copies, a publish makes them in the background
 * (`startWebCopies`, web-copy.ts), and the public trend answers carry each
 * one as `webUrl` / `webSizeBytes`, which clients play as it is (H.264
 * ~2.5 Mbit/s with AAC 160 kbit/s sound, in place of the full display copy or
 * the CDN's light copy, whose sound is AAC 64 kbit/s). Versions published
 * before have none, and a publish whose background work was cut short (a
 * deploy, a restart) may have left some out.
 *
 * WHAT IT WRITES. For each trend that is published now, its published
 * version (what the catalog serves; drafts and unpublished trends get theirs
 * at their next publish): every shown video without a current web copy is
 * downloaded (SSRF-guarded, the trend video limit) — the original from its
 * uploaded source clip, an example from its own video — encoded
 * (`webCopyArgs`) and uploaded under `trends/<id>/`, one at a time, then
 * attached by `attachWebCopies` — the store's third documented exception to
 * "a published version is never written": it adds the `web` keys only,
 * leaves every other byte of `data`, the `revision` and `published_at` as
 * they were, and skips a copy whose video was replaced meanwhile. A video
 * whose download or encode fails is reported and skipped; a database error,
 * or a copy address that is not http(s) (storage misconfigured), stops the
 * run. A second run lists nothing.
 *
 * ENVIRONMENT (the API service's): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * INTERNAL_ORCHESTRATOR_SECRET (32+ characters), the R2 storage settings
 * (R2_ACCOUNT_ID or R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_BUCKET_NAME, R2_PUBLIC_URL), and ffmpeg / ffprobe on PATH.
 *
 * Usage (dry run is the DEFAULT: nothing is downloaded, uploaded or written):
 *   cd backend && npm run backfill:trend-web-copies
 *   … -- --limit 1           # the first N trends (by slug) that lack a copy
 *   … -- --apply             # make and attach the copies
 */
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { isStorageConfigured, r2Url } from "../../lib/storage.js"
import { TrendMediaError } from "../lib/trends/media.js"
import { listPublishedTrendVersions, WebCopyAttachConflictError, type PublishedTrendVersion } from "../lib/trends/store.js"
import { makeWebCopies, makeWebCopy, type WebCopyOutcome } from "../lib/trends/web-copy.js"
import { webCopyTargets } from "../lib/trends/web-copy-plan.js"

export interface WebCopyBackfillOptions {
  readonly apply: boolean
  /** Only the first N trends lacking a copy (in slug order); null = all. */
  readonly limit: number | null
}

export function parseWebCopyArgs(argv: ReadonlyArray<string>): WebCopyBackfillOptions {
  const i = argv.indexOf("--limit")
  let limit: number | null = null
  if (i !== -1) {
    const raw = argv[i + 1]
    const n = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : NaN
    if (!Number.isSafeInteger(n) || n < 1) throw new Error("--limit takes a positive whole number of trends (e.g. --limit 5).")
    limit = n
  }
  return { apply: argv.includes("--apply"), limit }
}

export interface WebCopyBackfillResult {
  ok: boolean
  /** Trends whose published version lacks a web copy (after `--limit`). */
  trends: number
  /** Videos lacking one, across those trends. */
  videos: number
  set: number
  already: number
  stale: number
  failed: number
}

/** One trend's line prefix: `<slug> (<trend id>) v<version>`. */
const label = (v: PublishedTrendVersion) => `${v.slug} (${v.trendId}) v${v.version}`

const MiB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

/** Why a video's copy failed, for the operator: the code and, when it says more, what ffmpeg / ffprobe said. */
function reasonOf(err: unknown): string {
  if (err instanceof TrendMediaError) {
    const cause = err.cause instanceof Error ? err.cause.message : err.cause !== undefined ? String(err.cause) : ""
    return `${err.code}: ${err.message}${cause ? ` (${cause})` : ""}`
  }
  return err instanceof Error ? err.message : String(err)
}

export async function runWebCopyBackfill(
  opts: WebCopyBackfillOptions,
  deps: { make?: typeof makeWebCopy } = {},
): Promise<WebCopyBackfillResult> {
  console.log(`[trend-web-copies] mode=${opts.apply ? "APPLY" : "dry run"}${opts.limit !== null ? ` limit=${opts.limit}` : ""}`)
  const empty: WebCopyBackfillResult = { ok: true, trends: 0, videos: 0, set: 0, already: 0, stale: 0, failed: 0 }
  // Without credentials every upload fails; without R2_PUBLIC_URL an upload answers "/trends/…", no address to play.
  if (opts.apply && !(isStorageConfigured() && /^https?:\/\//i.test(r2Url("x")))) {
    console.error("Refusing: storage is not configured (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID or R2_ENDPOINT, and an http(s) R2_PUBLIC_URL).")
    return { ...empty, ok: false }
  }
  const published = await listPublishedTrendVersions()
  const lacking = published.filter((v) => webCopyTargets(v.data).length > 0)
  const versions = opts.limit !== null ? lacking.slice(0, opts.limit) : lacking
  console.log(
    `[trend-web-copies] ${published.length} published trend(s), ${lacking.length} lacking a web copy${versions.length < lacking.length ? `, taking the first ${versions.length}` : ""}`,
  )
  const result: WebCopyBackfillResult = { ...empty, trends: versions.length }

  for (const v of versions) {
    const targets = webCopyTargets(v.data)
    result.videos += targets.length
    if (!opts.apply) {
      for (const t of targets) console.log(`${label(v)} · ${t.label} · would make a web copy`)
      continue
    }
    const onEach = (o: WebCopyOutcome) => {
      if (o.copy) console.log(`${label(v)} · ${o.target.label} · web copy made (${MiB(o.copy.sizeBytes)})`)
      else {
        result.failed += 1
        console.warn(`${label(v)} · ${o.target.label} · FAILED (${reasonOf(o.error)})`)
      }
    }
    try {
      const { attached } = await makeWebCopies(v.trendId, v.version, v.data, { onEach, ...(deps.make ? { make: deps.make } : {}) })
      if (attached) {
        result.set += attached.set
        result.already += attached.already
        result.stale += attached.stale
        console.log(`${label(v)} · ${attached.set} attached, ${attached.already} already had one, ${attached.stale} stale (the video was replaced meanwhile)`)
      }
    } catch (err) {
      if (!(err instanceof WebCopyAttachConflictError)) throw err
      result.failed += 1
      console.warn(`${label(v)} · FAILED (${err.reason}: ${err.message}; the copies just made are left unused)`)
    }
  }

  result.ok = result.failed === 0
  console.log(
    opts.apply
      ? `[trend-web-copies] ${versions.length} trend(s), ${result.videos} video(s): ${result.set} set, ${result.already} already had one, ${result.stale} stale, ${result.failed} failed`
      : `[trend-web-copies] ${versions.length} trend(s), ${result.videos} video(s) (dry run — nothing written)`,
  )
  return result
}

const invokedDirectly = typeof process.argv[1] === "string" && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  Promise.resolve()
    .then(() => runWebCopyBackfill(parseWebCopyArgs(process.argv.slice(2))))
    .then((r) => {
      if (!r.ok) process.exitCode = 1
    })
    .catch((err) => {
      console.error(err)
      process.exitCode = 1
    })
}
