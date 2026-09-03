/**
 * "Which platform / product made this job" — a display label derived from a
 * job's `source` + `source_detail`, for the admin Jobs Gallery grouping + chips.
 *
 * The Nodaro web apps (studio / voice / recast / person / app / …) are browser
 * SPAs, so a job from one is stamped `source='web'` with the origin HOST in
 * `source_detail` (studio.nodaro.ai, recast.nodaro.ai, …). The subdomain is
 * therefore the product name, and it self-adapts: a new person.nodaro.ai groups
 * as "person" the day it launches, with nothing added here — mirroring the
 * backend job-source design (see backend/src/lib/job-source.ts). Non-web callers
 * group by their coarse source kind (api / mcp / cli / sdk / extension / …), and
 * developer-app jobs by the resolved app name.
 *
 * Pure: no imports, no I/O — trivially unit-testable.
 */

export interface JobPlatform {
  /** Stable grouping key, unique per platform. */
  readonly key: string
  /** Human label for chips + section headers. */
  readonly label: string
}

export interface JobPlatformInput {
  readonly source?: string | null
  readonly source_detail?: string | null
  /** Resolved developer-app name when source==='app' (source_detail is the id). */
  readonly source_app_name?: string | null
}

/**
 * Bare host → product label. `studio.nodaro.ai` → `studio`; `app.nodaro.ai` →
 * `app`; `next.studio.nodaro.ai` → `studio` (env-prefixed subdomain collapses to
 * the product). A non-nodaro host (self-host, or `localhost:3000` in dev) is kept
 * WHOLE — never split on the port — so a dev host stays one readable group.
 */
function productFromHost(host: string): string {
  const h = host.trim().toLowerCase()
  if (!h) return "web"
  if (h.endsWith(".nodaro.ai")) {
    const sub = h.slice(0, -".nodaro.ai".length)
    // Last label of the subdomain is the product: `studio`, or `studio` from
    // `next.studio`. Empty subdomain (bare nodaro.ai) → generic "web".
    const product = sub.split(".").filter(Boolean).pop()
    return product || "web"
  }
  return h
}

export function jobPlatform(job: JobPlatformInput): JobPlatform {
  const source = (job.source ?? "").toLowerCase()

  // Developer apps: the resolved app name is the product.
  if (source === "app") {
    const name = job.source_app_name?.trim()
    return name ? { key: `app:${name}`, label: name } : { key: "app", label: "app" }
  }

  // Web SPAs: product = origin subdomain.
  if (source === "web" && job.source_detail) {
    const product = productFromHost(job.source_detail)
    return { key: `web:${product}`, label: product }
  }

  // Every other coarse kind groups as itself (api / mcp / cli / sdk / extension
  // / internal / web-without-detail).
  if (source) return { key: source, label: source }

  // Pre-provenance rows (before migration 282): no source recorded.
  return { key: "unknown", label: "—" }
}
