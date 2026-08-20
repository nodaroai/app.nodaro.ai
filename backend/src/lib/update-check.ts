import { isCloud } from "./config.js"
import { getAppVersion } from "./app-version.js"

/**
 * "Is a newer release out?" — the backend half of the sidebar's red dot
 * (versioning spec, 2026-08-19).
 *
 * Reads the PUBLIC mirror's releases and picks the newest `vX.Y.Z` tag.
 * NEVER `releases/latest`: the repo also hosts the npm package releases
 * (@nodaro/sdk@…, @nodaro/prompts@… — they were "latest" the day this was
 * written), so the latest RELEASE is usually not an app release at all.
 *
 * Privacy: one anonymous HTTPS request to api.github.com, at most once per
 * CACHE_TTL_MS per process. Nothing about the install rides along. Opt out
 * with NODARO_UPDATE_CHECK=off. On cloud `latest` still flows (it feeds the
 * "what's new" dialog) but updateAvailable is always false — we ARE the
 * newest version there by definition.
 */

const RELEASES_URL = "https://api.github.com/repos/nodaroai/app.nodaro.ai/releases?per_page=20"
const TAGS_URL = "https://api.github.com/repos/nodaroai/app.nodaro.ai/tags?per_page=50"
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const HIGHLIGHT_MAX_CHARS = 1200
const APP_TAG = /^v(\d+)\.(\d+)\.(\d+)$/

export interface LatestRelease {
  readonly version: string
  readonly url: string
  readonly publishedAt: string
  readonly highlights: string
}

export interface UpdateStatus {
  readonly current: string
  readonly latest: LatestRelease | null
  readonly updateAvailable: boolean
}

let cached: { at: number; latest: LatestRelease | null } | null = null
let inflight: Promise<LatestRelease | null> | null = null

/**
 * Cloud runs whatever commit Railway deployed, and Railway injects that SHA
 * (RAILWAY_GIT_COMMIT_SHA) but no version — so the label showed the stale
 * package.json fallback ("v1.23.0" beside "What's new in v1.27.0", founder
 * report 2026-08-19). Every production commit on main carries its release
 * tag, so one daily tags-API read maps the running SHA to its exact
 * version. No match (staging runs untagged dev commits) -> null, callers
 * keep the fallback.
 */
let shaVersionCached: { at: number; version: string | null } | null = null
let shaInflight: Promise<string | null> | null = null

async function resolveVersionFromDeployedSha(): Promise<string | null> {
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA?.trim()
  if (!sha) return null
  const now = Date.now()
  if (shaVersionCached && now - shaVersionCached.at < CACHE_TTL_MS) return shaVersionCached.version
  if (!shaInflight) {
    shaInflight = (async () => {
      try {
        const res = await fetch(TAGS_URL, {
          headers: { Accept: "application/vnd.github+json" },
          signal: AbortSignal.timeout(8_000),
        })
        if (!res.ok) return null
        const tags = (await res.json()) as Array<{ name?: string; commit?: { sha?: string } }>
        if (!Array.isArray(tags)) return null
        const hit = tags.find((t) => t.commit?.sha === sha && t.name && APP_TAG.test(t.name))
        return hit?.name ?? null
      } catch {
        return null
      }
    })().then((version) => {
      shaVersionCached = { at: Date.now(), version }
      shaInflight = null
      return version
    })
  }
  return shaInflight
}

export function updateCheckEnabled(): boolean {
  return (process.env.NODARO_UPDATE_CHECK ?? "").trim().toLowerCase() !== "off"
}

function parseSemver(v: string): [number, number, number] | null {
  const m = APP_TAG.exec(v.startsWith("v") ? v : `v${v}`)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** True when b is strictly newer than a. Unparseable sides compare as not-newer
 *  (a `1.23.0-dev.abc` local build never nags about itself). */
export function isNewer(a: string, b: string): boolean {
  const pa = parseSemver(a.split("-")[0])
  const pb = parseSemver(b.split("-")[0])
  if (!pa || !pb) return false
  for (let i = 0; i < 3; i++) {
    if (pb[i] !== pa[i]) return pb[i] > pa[i]
  }
  return false
}

function trimHighlights(body: string | null | undefined): string {
  const text = (body ?? "").trim()
  if (text.length <= HIGHLIGHT_MAX_CHARS) return text
  const cut = text.slice(0, HIGHLIGHT_MAX_CHARS)
  const lastLine = cut.lastIndexOf("\n")
  return (lastLine > 0 ? cut.slice(0, lastLine) : cut) + "\n…"
}

async function fetchLatestAppRelease(): Promise<LatestRelease | null> {
  const res = await fetch(RELEASES_URL, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) return null
  const releases = (await res.json()) as Array<{
    tag_name?: string
    html_url?: string
    published_at?: string
    body?: string | null
    draft?: boolean
    prerelease?: boolean
  }>
  if (!Array.isArray(releases)) return null
  let best: LatestRelease | null = null
  for (const r of releases) {
    if (r.draft || r.prerelease) continue
    if (!r.tag_name || !APP_TAG.test(r.tag_name)) continue
    if (best === null || isNewer(best.version, r.tag_name)) {
      best = {
        version: r.tag_name,
        url: r.html_url ?? "https://github.com/nodaroai/app.nodaro.ai/releases",
        publishedAt: r.published_at ?? "",
        highlights: trimHighlights(r.body),
      }
    }
  }
  return best
}

/**
 * The full status for `GET /v1/version`. Errors degrade to "no update known"
 * — a GitHub hiccup must never surface as anything at all.
 */
export async function getUpdateStatus(): Promise<UpdateStatus> {
  let current = getAppVersion()
  if (!updateCheckEnabled()) {
    return { current, latest: null, updateAvailable: false }
  }
  // Image-baked env wins; otherwise try the deployed-SHA -> tag match
  // before settling for the package.json fallback.
  if (!process.env.APP_VERSION?.trim()) {
    const fromSha = await resolveVersionFromDeployedSha()
    if (fromSha) current = fromSha.replace(/^v/, "")
  }
  const now = Date.now()
  if (!cached || now - cached.at >= CACHE_TTL_MS) {
    if (!inflight) {
      inflight = fetchLatestAppRelease()
        .catch(() => null)
        .then((latest) => {
          cached = { at: Date.now(), latest }
          inflight = null
          return latest
        })
    }
    await inflight
  }
  const latest = cached?.latest ?? null
  return {
    current,
    latest,
    // Cloud always RUNS the newest deploy, so there is never an update to
    // offer — but `latest` still flows: the founder-requested "what's new"
    // dialog shows cloud users the changelog of what just shipped
    // (2026-08-19). Self-host keeps the red-dot semantics.
    updateAvailable: !isCloud() && latest !== null && isNewer(current, latest.version),
  }
}

export function _resetUpdateCheckForTests(): void {
  cached = null
  inflight = null
  shaVersionCached = null
  shaInflight = null
}
