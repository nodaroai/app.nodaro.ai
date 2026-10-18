/**
 * What a run of UGC Clip renders when the clips are already fixed: its UGC
 * Clips does not run, so the clips are the ones UGC Clips saved
 * (`__listResults`, its tickets), and each is either rendered or handed back.
 *
 * UGC Clip hands a clip back at no cost only to the user who made it, when a
 * clip of the same ticket, at the same Re-render count, under the same run,
 * already finished. The route decides that by the clip's content; the editor
 * can only expect it from what the node records of its last batch: the ticket
 * each row ran on (`__listInputs`) beside the take it made (`__listResults`,
 * "" for a row that failed or never ran), and on the take itself (its entry in
 * `generatedResults`) the job that made it and the Re-render count it was made
 * at (`ugcClipNonce`, written by the editor's run). A clip is CLAIMED as handed
 * back only when:
 * - a row of that batch ran on exactly this ticket and made a take,
 * - the take names its job and the Re-render count it was made at, and that
 *   count is the one this run sends (the clip's `rerender` count now), and
 * - the clip carries no Re-render mark (`rerenderPending`).
 * A claim is only that: the quote checks every one against the caller's own
 * jobs (`POST /v1/ugc/quote`, `reusedClips`), and prices a clip at nothing only
 * when it is the caller's own finished take of exactly that clip — the record
 * travels with the workflow, so the person who opens it may not be the one
 * whose take it records. Anything the node cannot show — no record of the
 * batch (a single run, a server run's take, a record cleared at a run's start),
 * a ticket that changed, a take with no count — counts as rendering, at full
 * price: the figure may be above what the run costs, never below it.
 *
 * Content-free: the wires are compared as they are, never read, except for
 * each ticket's clip number (its `index`) and the plan's finish call.
 */

/** One clip the run expects handed back: its place in the tickets (from 1), the job of its take, and the Re-render count the run sends. */
export interface UgcReuseClaim {
  readonly clip: number
  readonly jobId: string
  readonly nonce: number
}

/** What the ticket form of the UGC quote is asked for a run's clips. */
export interface UgcClipTicketQuote {
  /** The UGC Clips' saved tickets (wires), in clip order. */
  readonly tickets: readonly string[]
  /** The clips the run expects handed back from the node's last batch (by their place in `tickets`, from 1): priced at nothing once the quote has checked each. */
  readonly reusedClips: readonly UgcReuseClaim[]
  /** The clips go through UGC Finish's job (the saved plan carries a finish call). */
  readonly finishes: boolean
  /** Every take the node holds from its last batch is accounted for (claimed, or known to render), so no other clip can be handed back. */
  readonly reuseKnown: boolean
}

/** The most clips a UGC video has: the ticket form's own bound. */
const MAX_TICKETS = 11

type Data = Readonly<Record<string, unknown>>

const obj = (v: unknown): Data | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Data) : undefined)

function parsed(wire: unknown): Data | undefined {
  if (typeof wire !== "string") return obj(wire)
  try {
    return obj(JSON.parse(wire))
  } catch {
    return undefined
  }
}

/** A ticket's clip number (its `index` + 1), or undefined when it carries none. */
function clipNumberOf(ticket: string): number | undefined {
  const index = parsed(ticket)?.index
  return typeof index === "number" && Number.isInteger(index) && index >= 0 ? index + 1 : undefined
}

/** The saved tickets of a UGC Clips: 1 to 11 wires, each a JSON object, else none. */
function savedTickets(clipsData: Data): string[] | undefined {
  const list = clipsData.__listResults
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_TICKETS) return undefined
  return list.every((t): t is string => typeof t === "string" && parsed(t) !== undefined) ? [...list] : undefined
}

/** The saved plan's finish call: present (a video cut from one recorded speech), absent, or unreadable. */
function savedFinishes(clipsData: Data): boolean | undefined {
  const planOut = obj(clipsData.ugcOutputs)?.["plan-out"]
  const plan = parsed(planOut)
  return plan === undefined ? undefined : "finish" in plan
}

const filled = (v: unknown): boolean => typeof v === "string" && v.length > 0

/** The node holds a take from an earlier run: a batch's row, a result, or its video. */
function holdsTake(clipData: Data): boolean {
  const rows = clipData.__listResults
  const results = clipData.generatedResults
  return (
    (Array.isArray(rows) && rows.some(filled)) ||
    (Array.isArray(results) && results.some((r) => filled(obj(r)?.url))) ||
    filled(clipData.generatedVideoUrl)
  )
}

/** A job id the clip route made (a uuid): never the editor's synthetic `iter-…` id of a row whose lane wrote no result. */
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0

/** The Re-render count a run sends for a clip: its `rerender` count, else 0 (`ugcClipBody`'s own reading). */
function runNonceOf(clipData: Data, clip: number): number {
  const count = obj(clipData.rerender)?.[String(clip)]
  return isCount(count) ? count : 0
}

/** The take a row made, as the node holds it: the job that made it and the Re-render count it was made at, when it names both. */
function takeRecordOf(clipData: Data, url: string): { readonly jobId: string; readonly nonce: number } | undefined {
  const results = clipData.generatedResults
  if (!Array.isArray(results)) return undefined
  const entry = results.map(obj).find((r) => r?.url === url)
  const jobId = entry?.jobId
  const nonce = entry?.ugcClipNonce
  return typeof jobId === "string" && JOB_ID.test(jobId) && isCount(nonce) ? { jobId, nonce } : undefined
}

/**
 * Which of `tickets` a run of the UGC Clip whose data is `clipData` expects handed back (each by
 * place, from 1, with its take's job and the count the run sends), and whether its record accounts
 * for every take it holds. Pure.
 */
export function ugcReusedClips(tickets: readonly string[], clipData: Data): { readonly reusedClips: UgcReuseClaim[]; readonly reuseKnown: boolean } {
  const inputs = clipData.__listInputs
  const takes = clipData.__listResults
  if (!Array.isArray(inputs) || !Array.isArray(takes) || inputs.length !== takes.length) {
    // No record of the batch: none is known to be handed back; one may be, when the node holds a take.
    return { reusedClips: [], reuseKnown: !holdsTake(clipData) }
  }
  const marks = obj(clipData.rerenderPending) ?? {}
  const claims: UgcReuseClaim[] = []
  let accounted = 0
  for (const [i, ticket] of tickets.entries()) {
    const row = inputs.findIndex((input, j) => input === ticket && filled(takes[j]))
    if (row < 0) continue
    // A Re-render mark is keyed by the ticket's own clip number; a ticket that names none renders.
    const clip = clipNumberOf(ticket)
    if (clip === undefined || Object.hasOwn(marks, String(clip))) {
      accounted++
      continue
    }
    const take = takeRecordOf(clipData, takes[row] as string)
    // A take that names no job or count, or one made at another count: the run may or may not get it back.
    if (!take || take.nonce !== runNonceOf(clipData, clip)) continue
    accounted++
    claims.push({ clip: i + 1, jobId: take.jobId, nonce: take.nonce })
  }
  const madeTakes = takes.filter(filled).length
  return { reusedClips: claims, reuseKnown: accounted === madeTakes }
}

/**
 * The ticket quote a run of UGC Clip is priced by when its UGC Clips does not run: the saved tickets,
 * the clips handed back, and the finish. `null` when the saved clips cannot be read (no tickets, more
 * than a video has, a plan that cannot be read): the run is then priced as one that renders every clip.
 */
export function ugcClipTicketQuote(clipsData: Data, clipData: Data): UgcClipTicketQuote | null {
  const tickets = savedTickets(clipsData)
  if (!tickets) return null
  const finishes = savedFinishes(clipsData)
  if (finishes === undefined) return null
  const { reusedClips, reuseKnown } = ugcReusedClips(tickets, clipData)
  return { tickets, reusedClips, finishes, reuseKnown }
}
