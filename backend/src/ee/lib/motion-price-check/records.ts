/**
 * A Nodaro Motion run's price records, read for the admin's Motion price
 * check. The engine writes three, all server-only (top-level `__` keys, which
 * every job read drops: lib/public-job-data.ts):
 *
 * - the quote the run was admitted on (`input_data.__castSwapQuote`): its
 *   hold (`totalCredits`), the settlement it expected, the estimate's lines
 *   under their own names, and the quote's two extras beside the hold;
 * - what it reused (`output_data.__castSwapReuse`): the steps it took from a
 *   cache or an earlier try instead of paying for them;
 * - which of the quoted extras ran (`output_data.__castSwapExtras`).
 *
 * They arrive from the database functions as plain JSON and are read
 * tolerantly: a record of another version is none, a malformed figure or
 * field is dropped, and a line or step this reader does not know is KEPT —
 * a price check must never hide a line the engine has started to quote.
 */

type Rec = Record<string, unknown>

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v)

/** A finite number of credits, 0 or more; else null (a string is not one). */
const creditsOf = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null)

/** A quote line's name: a plain identifier, as the estimate names its lines. */
const LINE_NAME = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/
/** The most lines a quote is read with (the engine quotes under ten). */
export const MAX_QUOTE_LINES = 20

export interface QuoteRecord {
  totalCredits: number
  expectedCredits: number | null
  breakdown: Record<string, number>
  privacyCredits: number | null
  referencesRetryCredits: number | null
}

/**
 * A run's recorded quote: null unless it is version 1 with a total of 0 or
 * more. Its lines are the breakdown's well-named finite figures of 0 or more,
 * the first 20, unknown names included; the expected settlement and each
 * extra are read the same way (null when absent or malformed).
 */
export function readQuoteRecord(value: unknown): QuoteRecord | null {
  if (!isRec(value) || value.v !== 1) return null
  const totalCredits = creditsOf(value.totalCredits)
  if (totalCredits === null) return null
  const lines = isRec(value.breakdown)
    ? Object.entries(value.breakdown)
      .flatMap(([name, figure]): Array<[string, number]> => {
        const n = creditsOf(figure)
        return LINE_NAME.test(name) && n !== null ? [[name, n]] : []
      })
      .slice(0, MAX_QUOTE_LINES)
    : []
  return {
    totalCredits,
    expectedCredits: creditsOf(value.expectedCredits),
    breakdown: Object.fromEntries(lines),
    privacyCredits: creditsOf(value.privacyCredits),
    referencesRetryCredits: creditsOf(value.referencesRetryCredits),
  }
}

/** One reused step as recorded: every field it carries well-formed, null for the rest. */
export interface ReuseEntryView {
  step: string
  role: number | null
  attempt: "first" | "retry" | null
  jobId: string | null
  ref: string | null
}

/** A reused step's name, as the engine names its steps (`reference-sheet`, `face-mask`, …). */
const STEP_NAME = /^[a-z][a-z-]{0,39}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A kept clip's reference: 12 lowercase hex, never the cache key itself. */
const REF = /^[0-9a-f]{12}$/

const roleOf = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null)

/**
 * A run's reuse record: its entries, each with a step name (an unknown one
 * kept), or null when the record is not version 1 with a list of entries. A
 * malformed field is dropped, never the entry; an entry is kept as listed
 * (the reader counts, so nothing is merged here).
 */
export function readReuseRecord(value: unknown): ReuseEntryView[] | null {
  if (!isRec(value) || value.v !== 1 || !Array.isArray(value.entries)) return null
  return value.entries.flatMap((e): ReuseEntryView[] => {
    if (!isRec(e) || typeof e.step !== "string" || !STEP_NAME.test(e.step)) return []
    return [{
      step: e.step,
      role: roleOf(e.role),
      attempt: e.attempt === "first" || e.attempt === "retry" ? e.attempt : null,
      jobId: typeof e.jobId === "string" && UUID.test(e.jobId) ? e.jobId : null,
      ref: typeof e.ref === "string" && REF.test(e.ref) ? e.ref : null,
    }]
  })
}

/** The quote's two extras, beside its hold: the masking retry and the sheet retry, by the quote's own keys. */
export const QUOTED_EXTRAS = ["privacyCredits", "referencesRetryCredits"] as const
export type QuotedExtra = (typeof QUOTED_EXTRAS)[number]

const isQuotedExtra = (v: unknown): v is QuotedExtra => (QUOTED_EXTRAS as readonly unknown[]).includes(v)

/** Which quoted extras ran: the two names only, each once, in the order they ran; null unless version 1 with a list. */
export function readExtrasRecord(value: unknown): QuotedExtra[] | null {
  if (!isRec(value) || value.v !== 1 || !Array.isArray(value.ran)) return null
  return value.ran.filter((name, i, all): name is QuotedExtra => isQuotedExtra(name) && all.indexOf(name) === i)
}
