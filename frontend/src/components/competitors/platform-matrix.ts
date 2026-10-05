import {
  COMPETITOR_ABOUT_PLATFORMS,
  COMPETITOR_ACCOUNT_KEYS,
  type CompetitorBrandTally,
  type CompetitorPlatformTally,
  type CompetitorSearchKind,
  type SocialPlatform,
  type TrackedCompetitor,
} from "@nodaro/shared"

/**
 * "Who is where": every tracked brand against every platform, from each
 * brand's latest scan (the server's per-platform tallies) and what its
 * settings read today. Pure, so the page and its tests share it.
 */

/** The platforms the page can show, in the order it shows them. */
export const MATRIX_PLATFORMS: readonly SocialPlatform[] = ["x", "instagram", "tiktok", "youtube", "linkedin", "reddit", "meta_ads"]

/**
 * tracked: the latest scan read it · partial: one of its searches there
 * failed · failed: every search there failed · pending: read from the next
 * scan (added since, or never scanned) · none: not read there · loading: the
 * tallies are on their way.
 */
export type CellState = "tracked" | "partial" | "failed" | "none" | "pending" | "loading"

export interface MatrixCell {
  readonly platform: SocialPlatform
  readonly state: CellState
  readonly own: number
  readonly about: number
  /** What is read there: the brand's account (own posts), its name (posts about it). */
  readonly reads: { readonly own: boolean; readonly about: boolean }
  /** The searches that failed there. */
  readonly failed: readonly CompetitorSearchKind[]
  readonly tally: CompetitorPlatformTally | null
}

export interface MatrixRow {
  readonly competitor: TrackedCompetitor
  readonly cells: readonly MatrixCell[]
  /** Its own posts and posts about it, over every platform. */
  readonly own: number
  readonly about: number
  /** When the scan the counts come from ran; null before the first. */
  readonly scanAt: string | null
}

export interface MatrixColumn {
  readonly platform: SocialPlatform
  /** What its bars measure: own posts, or posts about the brands where no brand's account is read. */
  readonly measure: "own" | "about"
  /** The largest such count in the column, at least 1. */
  readonly max: number
}

export interface Matrix {
  readonly columns: readonly MatrixColumn[]
  readonly rows: readonly MatrixRow[]
}

const ACCOUNT_PLATFORMS: readonly string[] = COMPETITOR_ACCOUNT_KEYS
const ABOUT_PLATFORMS: readonly string[] = COMPETITOR_ABOUT_PLATFORMS

/** What a brand's settings read on a platform today: the server's plan, else its accounts and platforms. */
export function plannedOn(c: TrackedCompetitor, platform: SocialPlatform): CompetitorSearchKind[] {
  if (c.searchPlan) return c.searchPlan.filter((s) => s.platform === platform).map((s) => s.kind)
  const account = ACCOUNT_PLATFORMS.includes(platform) ? (c.accounts as Record<string, string | undefined>)[platform] : undefined
  const own = typeof account === "string" && account.trim() !== ""
  const about = ABOUT_PLATFORMS.includes(platform) && (c.aboutPlatforms as readonly string[]).includes(platform)
  return [...(own ? (["own"] as const) : []), ...(about ? (["about"] as const) : [])]
}

/** One brand on one platform. */
export function cellOf(c: TrackedCompetitor, brand: CompetitorBrandTally | undefined, platform: SocialPlatform, loading: boolean): MatrixCell {
  const tally = brand?.platforms.find((p) => p.platform === platform) ?? null
  if (tally) {
    const failed = tally.failed ?? []
    const searched = tally.searched
    const reads = { own: searched.includes("own") || tally.own > 0, about: searched.includes("about") || tally.about > 0 }
    const allFailed = searched.length > 0 && searched.every((kind) => failed.includes(kind))
    const state: CellState = allFailed ? "failed" : failed.length > 0 ? "partial" : "tracked"
    return { platform, state, own: tally.own, about: tally.about, reads, failed, tally }
  }
  const planned = plannedOn(c, platform)
  const reads = { own: planned.includes("own"), about: planned.includes("about") }
  const state: CellState = planned.length === 0 ? "none" : loading ? "loading" : "pending"
  return { platform, state, own: 0, about: 0, reads, failed: [], tally: null }
}

/**
 * The table: a row per brand (in the given order) and a column per platform
 * any brand reads or has posts on.
 */
export function buildMatrix(
  competitors: readonly TrackedCompetitor[],
  brands: Readonly<Record<string, CompetitorBrandTally>> | undefined,
  loading: boolean,
): Matrix {
  const full = competitors.map((c) => {
    const brand = brands?.[c.id]
    const cells = MATRIX_PLATFORMS.map((p) => cellOf(c, brand, p, loading))
    return {
      competitor: c,
      cells,
      own: cells.reduce((sum, cell) => sum + cell.own, 0),
      about: cells.reduce((sum, cell) => sum + cell.about, 0),
      scanAt: brand?.at ?? null,
    }
  })
  const shown = MATRIX_PLATFORMS.filter((p) => full.some((row) => row.cells.some((cell) => cell.platform === p && cell.state !== "none")))
  const columns = shown.map((platform): MatrixColumn => {
    const cells = full.flatMap((row) => row.cells.filter((cell) => cell.platform === platform))
    const measure = cells.some((cell) => cell.reads.own) ? "own" : "about"
    return { platform, measure, max: Math.max(1, ...cells.map((cell) => cell[measure])) }
  })
  const rows = full.map((row) => ({ ...row, cells: row.cells.filter((cell) => shown.includes(cell.platform)) }))
  return { columns, rows }
}

/** How far a cell's bar reaches in its column, 0 to 1. */
export function barShare(cell: MatrixCell, column: MatrixColumn): number {
  return Math.min(1, Math.max(0, cell[column.measure] / column.max))
}

/**
 * Most activity first: over every platform, or on the chosen one, where a
 * brand whose search there failed comes after every brand it read, and one
 * not read there after those. Ties keep the brands' order.
 */
export function sortRows(rows: readonly MatrixRow[], platform: SocialPlatform | null): MatrixRow[] {
  const score = (row: MatrixRow): number => {
    if (!platform) return row.own + row.about
    const cell = row.cells.find((c) => c.platform === platform)
    if (cell?.state === "tracked" || cell?.state === "partial") return cell.own + cell.about
    if (cell?.state === "failed") return -0.5
    return -1
  }
  return rows
    .map((row, index) => ({ row, index, score: score(row) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.row)
}

/**
 * How a brand's last scan went, as the row tells it once its tallies are
 * here. The server names a problem in `lastScanError` both when some searches
 * of a saved scan failed and when the scan never happened (every search
 * failed, no credits): a saved scan's failures show in its tallies (by name,
 * or as unknown — `failed: null` — for a scan stored before they were kept),
 * so an error beside such tallies is that scan's own (partial); one without
 * is a scan that did not happen (failed), whose counts are those of the scan
 * before. Before the tallies arrive (`scanAt` null) it cannot be told.
 */
export function scanOutcome(row: MatrixRow): "ok" | "partial" | "failed" {
  if (!row.competitor.lastScanError) return "ok"
  return row.cells.some((cell) => cell.failed.length > 0 || (cell.tally !== null && cell.tally.failed === null)) ? "partial" : "failed"
}

/** The newest scan among the rows, for the table's heading; null before any. */
export function latestScanAt(rows: readonly MatrixRow[]): string | null {
  return rows.reduce<string | null>((latest, row) => (row.scanAt && (!latest || row.scanAt > latest) ? row.scanAt : latest), null)
}
