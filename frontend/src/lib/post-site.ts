/**
 * Where a post's link opens, named the way a reader names it: "Instagram" for
 * instagram.com, "X" for x.com and twitter.com, the bare host for any other
 * site. Every card that links back to an original post says "Open in <site>"
 * through this — the shared post feed card, the Collections page. Brand names
 * stay Latin in every language.
 *
 * Display only. This is never an allowlist: what the server may download is
 * `SOCIAL_VIDEO_HOSTS` in `@nodaro/shared`.
 */
const SITES: ReadonlyArray<readonly [name: string, hosts: readonly string[]]> = [
  ["Instagram", ["instagram.com"]],
  ["X", ["x.com", "twitter.com"]],
  ["TikTok", ["tiktok.com"]],
  ["YouTube", ["youtube.com", "youtu.be"]],
  ["Reddit", ["reddit.com", "redd.it"]],
  ["LinkedIn", ["linkedin.com", "lnkd.in"]],
  ["Facebook", ["facebook.com", "fb.com", "fb.watch"]],
  ["Telegram", ["t.me", "telegram.me"]],
  ["Threads", ["threads.net", "threads.com"]],
]

/** The link, only when it is an http(s) address: post data is untrusted input. */
export function httpLink(url: unknown): string | null {
  if (typeof url !== "string") return null
  const trimmed = url.trim()
  if (!trimmed) return null
  try {
    const { protocol } = new URL(trimmed)
    return protocol === "http:" || protocol === "https:" ? trimmed : null
  } catch {
    return null
  }
}

/** A known platform's name for a host (a subdomain counts: m.facebook.com is Facebook), else null. */
function knownSite(host: string): string | null {
  for (const [name, hosts] of SITES) {
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return name
  }
  return null
}

/** The site a link opens on: a known platform's name, else its host without "www.". Null when there is no http(s) link. */
export function linkSiteName(url: unknown): string | null {
  const link = httpLink(url)
  if (!link) return null
  const host = new URL(link).hostname.toLowerCase().replace(/^www\./, "")
  return knownSite(host) ?? host
}
