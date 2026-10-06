/** One fan-out item's notes: its warnings and its real length (UGC Clip). */
export interface FanOutItemMeta { readonly warnings: readonly string[]; readonly durationSec: number | null }
/** One row of UGC Cards' `notes` input. */
export interface ClipNote { readonly clip: number; readonly warnings: readonly string[]; readonly durationSec?: number }

export function fanOutItemMeta(output: { clipWarnings?: unknown; durationSec?: unknown } | null | undefined): FanOutItemMeta {
  const w = output?.clipWarnings
  const d = output?.durationSec
  return {
    warnings: Array.isArray(w) ? w.filter((x): x is string => typeof x === "string") : [],
    durationSec: typeof d === "number" && Number.isFinite(d) && d > 0 ? d : null,
  }
}

/** Row-aligned meta (or one single output) → the notes UGC Cards reads, clip numbers from 1. */
export function clipNotesFrom(meta: ReadonlyArray<FanOutItemMeta | null | undefined> | undefined, single?: FanOutItemMeta): ClipNote[] {
  const rows = meta && meta.length > 0 ? meta : single ? [single] : []
  return rows.map((m, i) => ({
    clip: i + 1,
    warnings: m?.warnings ?? [],
    ...(typeof m?.durationSec === "number" ? { durationSec: m.durationSec } : {}),
  }))
}
