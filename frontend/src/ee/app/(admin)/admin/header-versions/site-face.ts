import type { HeaderVersionsReport, ProductView, SiteEnvironment, SiteResult, Standing } from "./types"

/**
 * What a site's block says: the pill, the line under it and their colour.
 * Pure, so the page's words for every kind of answer are decided in one place.
 */

export type Tone = "newest" | "behind" | "ahead" | "off" | "quiet" | "bad"

export interface SiteFace {
  readonly label: string
  readonly note: string | null
  readonly tone: Tone
}

export const ENVIRONMENTS: readonly SiteEnvironment[] = ["production", "staging"]

/** The "What changed" section's anchor: a card's "behind" note links to it. */
export const WHATS_NEW_ID = "whats-new"

/** The server counts the releases a site lacks on the header's own tags, patch releases included. */
function behindNote(releasesBehind: number | null): string {
  if (releasesBehind === null) return "Behind"
  return `${releasesBehind} ${releasesBehind === 1 ? "version" : "versions"} behind`
}

const STANDING_FACE: Record<Exclude<Standing, "behind">, { note: string; tone: Tone }> = {
  newest: { note: "Newest", tone: "newest" },
  ahead: { note: "Ahead of the release", tone: "ahead" },
}

type Reading = Extract<SiteResult, { status: "ok" }>

/**
 * A pin says what the commit would install, not what the site installed or
 * whether it shows it; a range is what was asked for, not what was installed:
 * neither is ranked. A site that hides the header says so first.
 */
function readingFace(result: Reading): SiteFace {
  const { version } = result
  if (version === null) return { label: "No header", note: null, tone: "quiet" }
  if (result.source === "pin") return { label: "Unknown yet", note: `The commit pins ${version}; the site does not say yet`, tone: "quiet" }
  if (result.header === false) return { label: "Header off", note: `${version} installed`, tone: "off" }
  if (result.source === "package-json") return { label: version, note: "Declared range, not installed", tone: "quiet" }
  if (result.standing === "behind") return { label: version, note: behindNote(result.releasesBehind), tone: "behind" }
  if (result.standing) return { label: version, ...STANDING_FACE[result.standing] }
  return { label: version, note: null, tone: "quiet" }
}

export function siteFace(result: SiteResult): SiteFace {
  switch (result.status) {
    case "ok":
      return readingFace(result)
    case "error":
      return { label: "Unreadable", note: result.message, tone: "bad" }
    case "no_deploy":
      return { label: "No deploy", note: "No successful deploy found", tone: "quiet" }
    case "not_configured":
      return { label: "Unknown", note: "Needs the GitHub token", tone: "quiet" }
  }
}

/** A site on the newest release (or past it) that shows the header. */
export function isUpToDate(result: SiteResult): boolean {
  return result.status === "ok" && result.header !== false && (result.standing === "newest" || result.standing === "ahead")
}

export function isProductUpToDate(product: ProductView): boolean {
  return ENVIRONMENTS.every((environment) => isUpToDate(product.sites[environment].result))
}

export function upToDateCount(report: HeaderVersionsReport): { readonly upToDate: number; readonly total: number } {
  const results = report.products.flatMap((product) => ENVIRONMENTS.map((environment) => product.sites[environment].result))
  return { upToDate: results.filter(isUpToDate).length, total: results.length }
}

/** The newest release's version, when there is one to rank against. */
export function newestVersion(report: HeaderVersionsReport): string | null {
  return report.latest.status === "ok" ? report.latest.version : null
}
