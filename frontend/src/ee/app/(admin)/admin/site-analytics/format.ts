import { formatDate, formatDateTime, formatNumber } from "@/lib/i18n/format"

export const countText = (n: number): string => formatNumber(n)

/** 0.0331 → "3.3%". */
export const percentText = (ratio: number): string => formatNumber(ratio, { style: "percent", maximumFractionDigits: 1 })

/** Average position in Google's results, one decimal; none when the page never showed. */
export const positionText = (position: number): string => (position > 0 ? formatNumber(position, { maximumFractionDigits: 1 }) : "–")

/** 754 → "12m 34s", 42 → "42s", 4000 → "1h 06m". */
export function durationText(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, "0")}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
}

/** A total per active user — 0 when nobody came. */
export const perUser = (total: number, activeUsers: number): number => (activeUsers > 0 ? total / activeUsers : 0)

/**
 * The domain the configured Search Console site covers — "sc-domain:nodaro.ai"
 * or "https://www.nodaro.ai/" both give "nodaro.ai". None without a site.
 */
export function siteDomainOf(searchConsoleSite: string | null): string | null {
  if (!searchConsoleSite) return null
  if (searchConsoleSite.startsWith("sc-domain:")) return searchConsoleSite.slice("sc-domain:".length).toLowerCase() || null
  try {
    return new URL(searchConsoleSite).hostname.toLowerCase().replace(/^www\./, "") || null
  } catch {
    return null
  }
}

/** A plain hostname: letters, digits, dashes and dots — nothing a URL would read as a path, query or fragment. */
const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/

/**
 * The address of a page GA reported by site and path. Anyone can send GA hits
 * under any site name, so only the site's own domain and its subdomains
 * become links, and the host is checked as the browser will read the link —
 * "evil.com#.nodaro.ai" ends in ".nodaro.ai" as text but opens evil.com.
 */
export function pageAddress(row: { host?: string; path?: string }, siteDomain: string | null): string | null {
  const host = row.host?.toLowerCase() ?? ""
  const path = row.path ?? "/"
  if (!siteDomain || !HOSTNAME.test(host) || !path.startsWith("/")) return null
  if (host !== siteDomain && !host.endsWith(`.${siteDomain}`)) return null
  try {
    const link = new URL(`https://${host}${path}`)
    return link.hostname === host ? link.href : null
  } catch {
    return null
  }
}

/** "2026-10-07" (a calendar day) → "Oct 7", read as that day wherever the browser is. */
export const dayText = (day: string): string => formatDate(`${day}T12:00:00`, { month: "short", day: "numeric" })

export const momentText = (iso: string): string => formatDateTime(iso, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
