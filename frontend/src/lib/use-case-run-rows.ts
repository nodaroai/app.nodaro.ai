/**
 * The rows of the run whose take is on show, for a use-case node whose result
 * is a list (Trailer's formats, Clip Pack's clips): every row of that run
 * (the same wrapper job) that names what it delivers, each delivery once (the
 * first row holding it — a run landed twice never shows a delivery twice), in
 * the order the run delivered them. None for a take that names no run, or
 * no delivery (a Preview of a Trailer, an older take). Pure.
 */
import type { GeneratedResult } from "@/types/nodes"

/** One delivery of the run on show: its row in the results, its file and the row itself. */
export interface UseCaseRunRow {
  readonly index: number
  readonly url: string
  /** What the delivery is (a Trailer's format, a Clip Pack's clip). */
  readonly key: string
  readonly row: GeneratedResult
}

/** The rows of the run on show, each delivery named by `keyOf` (a row it names nothing for is left out). */
export function usecaseRunRowsOnShow(
  results: readonly GeneratedResult[],
  onShow: GeneratedResult | undefined,
  keyOf: (row: GeneratedResult) => string | undefined,
): UseCaseRunRow[] {
  const shownKey = onShow ? keyOf(onShow) : undefined
  if (!onShow?.jobId || !shownKey) return []
  const seen = new Set<string>()
  return results.flatMap((row, index) => {
    const key = keyOf(row)
    if (row.jobId !== onShow.jobId || !key || seen.has(key)) return []
    seen.add(key)
    return [{ index, url: row.url, key, row }]
  })
}

const named = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined)

/** A Trailer row is named by its format. */
export const trailerRowKey = (row: GeneratedResult): string | undefined => named(row.format)

/** A Clip Pack row is named by its clip (its key; its file for a clip that names no key). */
export const clipPackRowKey = (row: GeneratedResult): string | undefined => named(row.clipKey) ?? named(row.url)
