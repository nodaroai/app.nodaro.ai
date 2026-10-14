/**
 * What the UGC node cards show, read from node data that is the node's own
 * last run. Content-free: a clip ticket is read only for `v`, `index` and
 * `durationSec`; UGC Cards' outputs only for their public shapes (Video
 * Overlay's layer list, a caption plan's timed words). Every other key is
 * opaque and never read here.
 */
import { fanOutItemMeta } from "@nodaro/shared/nodes"

/** One clip of a UGC Clips run: its number (from 1) and its length in seconds. */
export interface UgcClipLength { readonly clip: number; readonly durationSec: number }

const parsed = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}
const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)

/** The clips of a UGC Clips run (`__listResults`, one ticket per clip), in list order; an unreadable ticket is skipped. */
export function ugcClipLengths(tickets: unknown): UgcClipLength[] {
  if (!Array.isArray(tickets)) return []
  return tickets.flatMap((raw) => {
    const t = parsed(raw)
    if (!isObject(t) || t.v !== 1) return []
    const { index, durationSec } = t
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return []
    if (typeof durationSec !== "number" || !Number.isFinite(durationSec) || durationSec <= 0) return []
    return [{ clip: index + 1, durationSec }]
  })
}

/** How many warnings a UGC Clip run carries: every clip's when it ran once per clip, else the single run's. */
export function ugcClipWarningCount(data: { readonly __listResultMeta?: unknown; readonly clipWarnings?: unknown }): number {
  const strings = (x: unknown): number => (Array.isArray(x) ? x.filter((w) => typeof w === "string").length : 0)
  const meta = data.__listResultMeta
  if (Array.isArray(meta) && meta.length > 0) return meta.reduce((n: number, row) => n + (isObject(row) ? strings(row.warnings) : 0), 0)
  return strings(data.clipWarnings)
}

/** One clip of UGC Clip's last run: its number (from 1), its length when known, and how many warnings it carries. */
export interface UgcClipRun { readonly clip: number; readonly durationSec?: number; readonly warnings: number }

/**
 * The clips UGC Clip's last run made, numbered the way UGC Cards' notes number
 * them (`clipNotesFrom`): row i of a run once per clip is clip i + 1, and a row
 * the run never wrote is not a clip that ran; a single run (one clip) is clip 1,
 * read from the node's own fields once it has run (the test the notes' input
 * resolver applies).
 */
export function ugcClipRuns(data: {
  readonly __listResultMeta?: unknown
  readonly generatedVideoUrl?: unknown
  readonly clipWarnings?: unknown
  readonly durationSec?: unknown
}): UgcClipRun[] {
  const run = (clip: number, warnings: unknown, durationSec: unknown): UgcClipRun => {
    const m = fanOutItemMeta({ clipWarnings: warnings, durationSec })
    return { clip, ...(m.durationSec !== null ? { durationSec: m.durationSec } : {}), warnings: m.warnings.length }
  }
  const meta = data.__listResultMeta
  if (Array.isArray(meta) && meta.length > 0) {
    const rows: UgcClipRun[] = []
    // forEach skips a hole the run never filled; a null row fails the object check.
    meta.forEach((row, i) => {
      if (isObject(row)) rows.push(run(i + 1, row.warnings, row.durationSec))
    })
    return rows
  }
  const hasRun = data.generatedVideoUrl !== undefined || data.clipWarnings !== undefined || data.durationSec !== undefined
  return hasRun ? [run(1, data.clipWarnings, data.durationSec)] : []
}

/** UGC Cards' last run: how many screenshot cards its layer plan holds and how many words its caption plan times. */
export function ugcCardsCounts(result: { readonly layerPlan?: unknown; readonly captionPlan?: unknown } | undefined): { cards: number; captionWords: number } {
  const layers = parsed(result?.layerPlan)
  const captionPlan = parsed(result?.captionPlan)
  const words = isObject(captionPlan) ? captionPlan.captions : undefined
  return {
    cards: Array.isArray(layers) ? layers.length : 0,
    captionWords: Array.isArray(words) ? words.length : 0,
  }
}

/** A length in seconds as the cards print it: whole seconds as is, else one decimal. */
export function ugcSeconds(sec: number): string {
  return Number.isInteger(sec) ? String(sec) : sec.toFixed(1)
}
