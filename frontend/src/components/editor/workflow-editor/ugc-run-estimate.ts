/**
 * The UGC part of a run's price (Nodaro Cloud). A run set that holds UGC nodes
 * is priced with the server's figure for the UGC parts it executes (the
 * `/v1/ugc/quote` estimate, every creator option drawn, as an editor run draws
 * them) plus the editor's own figure for every other node.
 *
 * Each UGC video the run touches (`ugcEstimateRunParts`: one per UGC Clips
 * node, read through its own wires) is its own answer, cached by the very
 * request it asks. Every surface that prices a run set (the run's confirmation,
 * the Run's balance check, the run buttons and the Execute badge) reads those
 * cached answers, so a run set has one figure.
 *
 * Two figures, as the app runner has them: the price (each part's expected
 * credits), which every surface quotes, and the hold (each clip held at the
 * server's multiple of its price while it renders, at the longest length the
 * estimate allows), which a run's balance check compares.
 *
 * A UGC Clip whose UGC Clips the run does not execute renders clips that are
 * already fixed (the ones UGC Clips saved), so its part is priced from them —
 * the ticket form of the quote, each clip the node shows it will hand back at
 * nothing (`ugcClipTicketQuote`, @nodaro/render-rules) — never from the
 * video's estimate. Until that answer lands, or when it cannot be had, the
 * clip's part is the estimate's: every clip at full price.
 *
 * The confirmation and the balance check wait for the answers (5 s at most).
 * The buttons and the badge never wait: until the answers land they show the
 * editor's own figure, marked as an estimate. When one cannot be had, or is
 * still on its way when the wait ends, the caller says which; a run is never
 * blocked on the price.
 */
import { hashKey, isCancelledError, type QueryState } from "@tanstack/react-query"
import {
  UGC_ESTIMATE_PARTS,
  ugcEstimateRunParts,
  ugcFiguresPerNode,
  type UgcClipTicketQuote,
  type UgcEstimateInput,
  type UgcEstimateRunParts,
} from "@nodaro/render-rules"
import { ugcEstimateApi, ugcTicketQuoteApi, type UgcRunEstimate, type UgcTicketQuote, type UgcTicketQuoteRequest } from "@/lib/api"
import type { MessageKey } from "@/lib/i18n/en"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { estimateRunCreditLines, estimateRunCredits, sumRunCreditLines } from "./estimate-run-credits"
import { previewRunnable } from "./preview-gate"

/** How long the confirmation and the balance check wait for the server's figure. */
export const UGC_ESTIMATE_TIMEOUT_MS = 5000
/** How long a figure that could not be had is remembered, so the next surface to ask does not wait again. */
export const UGC_UNCHECKED_FOR_MS = 60_000
/** How long an answer stays current: it reads the platform's price rows, which rarely move. */
const UGC_ESTIMATE_STALE_MS = 5 * 60_000

type CachedCost = (modelId: string) => number | undefined

/** Where a run set's figure came from: the server's answers, the editor's own (marked as an estimate), or no UGC part at all. */
export type UgcRunFigureSource = "server" | "client" | "none"

/** The server's answer for one video's input, or undefined while it is not in. */
export type UgcAnswerOf = (input: UgcEstimateInput) => UgcRunEstimate | undefined

/** The server's quote of a UGC Clip's saved clips, or undefined while it is not in (or cannot be had). */
export type UgcTicketAnswerOf = (quote: UgcClipTicketQuote) => UgcTicketQuote | undefined

/** A run set's figure. */
export interface UgcRunFigure {
  /** The price every surface quotes: each part's expected credits. */
  readonly credits: number
  /** What the run can hold while it renders, the balance check's figure. The price itself without the server's answers. */
  readonly hold: number
  readonly estimate: UgcRunFigureSource
  /** The run renders a video's clips. */
  readonly rendersClips: boolean
  /**
   * It renders the clips of a UGC Clip that has rendered before, and the figure does not show
   * which of them are handed back: unchanged clips are reused at no cost, so the run may cost less.
   */
  readonly mayReuseClips: boolean
  /** A saved plan the run hands on carries no length the editor can read: the server's figure is for the length setting. */
  readonly lengthUnread: boolean
  /** A saved plan the run hands on has no beats the editor can read: the server's figure is for the wires' screenshot cards. */
  readonly screenshotsUnread: boolean
  /**
   * With the server's answers: each node the UGC estimates cover, at its figure (0 for one priced
   * at nothing: UGC Clips, a kept script or creator). Their sum and the other nodes' own figures
   * make `credits`, so an itemised confirmation adds up to it.
   */
  readonly nodeCredits?: ReadonlyMap<string, number>
}

/** The UGC parts a run of `executable` executes: only of the nodes it really runs (a Preview render holds back what follows it). */
export function ugcRunParts(executable: WorkflowNode[], allNodes: WorkflowNode[], edges: WorkflowEdge[]): UgcEstimateRunParts | null {
  return ugcEstimateRunParts(previewRunnable(executable, allNodes, edges), allNodes, edges)
}

/** The inputs of the UGC videos a run of `executable` executes, each once: two videos with one input share one answer. */
export function ugcRunInputs(executable: WorkflowNode[], allNodes: WorkflowNode[], edges: WorkflowEdge[]): UgcEstimateInput[] {
  const byKey = new Map<string, UgcEstimateInput>()
  for (const chain of ugcRunParts(executable, allNodes, edges)?.chains ?? []) {
    byKey.set(hashKey(ugcRunEstimateQuery(chain.input).queryKey), chain.input)
  }
  return [...byKey.values()]
}

const isPartFigures = (v: unknown): boolean =>
  !!v &&
  typeof v === "object" &&
  UGC_ESTIMATE_PARTS.every((p) => {
    const n = (v as Record<string, unknown>)[p]
    return typeof n === "number" && Number.isFinite(n) && n >= 0
  })

/** An answer the editor can price with: every part a credit figure, price and hold. Anything else is no answer at all. */
function readRunEstimate(raw: unknown): UgcRunEstimate {
  const answer = raw && typeof raw === "object" ? (raw as { parts?: unknown; holdParts?: unknown }) : undefined
  if (!answer || !isPartFigures(answer.parts) || !isPartFigures(answer.holdParts)) throw new Error("The UGC estimate answered without its parts")
  return raw as UgcRunEstimate
}

/** The UGC Clips' saved clips the run renders, each once: what the ticket form is asked for each UGC Clip it prices from them. */
export function ugcRunTicketQuotes(executable: WorkflowNode[], allNodes: WorkflowNode[], edges: WorkflowEdge[]): UgcClipTicketQuote[] {
  const byKey = new Map<string, UgcClipTicketQuote>()
  for (const chain of ugcRunParts(executable, allNodes, edges)?.chains ?? []) {
    for (const node of chain.nodes) {
      if (node.ticketQuote) byKey.set(hashKey(ugcRunTicketQuery(node.ticketQuote).queryKey), node.ticketQuote)
    }
  }
  return [...byKey.values()]
}

/** The ticket form a UGC Clip's saved clips are asked with: only the clip part is read, so no screenshot cards. */
function ticketRequest(quote: UgcClipTicketQuote): UgcTicketQuoteRequest {
  return { tickets: quote.tickets, hasCards: false, finishes: quote.finishes, reusedClips: quote.reusedClips }
}

/** An answer the clip's part can be priced with: its clip part, price and hold. Anything else is no answer at all. */
function readTicketQuote(raw: unknown): UgcTicketQuote {
  const answer = raw && typeof raw === "object" ? (raw as { parts?: unknown; holdParts?: unknown }) : undefined
  if (!answer || !isPartFigures(answer.parts) || !isPartFigures(answer.holdParts)) throw new Error("The UGC quote answered without its parts")
  return raw as UgcTicketQuote
}

/** One UGC Clip's saved-clips query, keyed by the very request it asks. */
export function ugcRunTicketQuery(quote: UgcClipTicketQuote) {
  const request = ticketRequest(quote)
  return {
    queryKey: queryKeys.ugc.ticketQuote(request),
    queryFn: ({ signal }: { signal: AbortSignal }) => ugcTicketQuoteApi(request, { signal }).then(readTicketQuote),
    staleTime: UGC_ESTIMATE_STALE_MS,
    retry: false as const,
  }
}

/** The ticket answers the cache holds now, never asking. */
const cachedTicketAnswerOf: UgcTicketAnswerOf = (quote) => queryClient.getQueryData<UgcTicketQuote>(ugcRunTicketQuery(quote).queryKey)

/** One video's query. Its key is the very request the estimate is asked, so no input it reads can change without changing the key. */
export function ugcRunEstimateQuery(input: UgcEstimateInput) {
  // An editor run draws every creator option for the person to pick.
  const request = { ...input, rendersEveryCandidate: true } as const
  return {
    queryKey: queryKeys.ugc.runEstimate(request),
    queryFn: ({ signal }: { signal: AbortSignal }) => ugcEstimateApi(request, { signal }).then(readRunEstimate),
    staleTime: UGC_ESTIMATE_STALE_MS,
    retry: false as const,
  }
}

/** A UGC Clip that holds clips from an earlier run. */
function hasRendered(node: WorkflowNode | undefined): boolean {
  const data = (node?.data ?? {}) as { __listResults?: unknown; generatedResults?: unknown; generatedVideoUrl?: unknown }
  return (
    (Array.isArray(data.__listResults) && data.__listResults.length > 0) ||
    (Array.isArray(data.generatedResults) && data.generatedResults.length > 0) ||
    (typeof data.generatedVideoUrl === "string" && data.generatedVideoUrl.length > 0)
  )
}

/**
 * A run set's one figure. With every video's answer: the editor's own figure for
 * every node the UGC estimates do not cover (priced as part of this whole run),
 * plus each priced node's part from its own video's answer, times the runs of
 * the node that executes it (a UGC Clip's clips are all in its part already, so
 * it runs as many times as its UGC Clips does); a node two videos share counts
 * once, at the larger figure. Without one: the editor's own figure for the
 * whole set, marked as an estimate.
 */
export function ugcRunCredits(
  executable: WorkflowNode[],
  allNodes: WorkflowNode[],
  edges: WorkflowEdge[],
  cachedCost: CachedCost,
  answerOf: UgcAnswerOf,
  /** The quotes of UGC Clips' saved clips (`ugcRunTicketQuery`); absent or unanswered: the estimate prices those clips. */
  ticketAnswerOf: UgcTicketAnswerOf = () => undefined,
): UgcRunFigure {
  const lines = estimateRunCreditLines(executable, allNodes, edges, cachedCost)
  const own = sumRunCreditLines(lines)
  const ugc = ugcRunParts(executable, allNodes, edges)
  if (!ugc) return { credits: own, hold: own, estimate: "none", rendersClips: false, mayReuseClips: false, lengthUnread: false, screenshotsUnread: false }
  const clipNodes = ugc.chains.flatMap((c) => c.nodes.filter((m) => m.part === "clip"))
  const byId = new Map(allNodes.map((n) => [n.id, n] as const))
  // A UGC Clip priced from its saved clips, with what it hands back known: its figure already counts the reuse.
  const reuseCounted = (m: (typeof clipNodes)[number]) => !!m.ticketQuote && m.ticketQuote.reuseKnown && ticketAnswerOf(m.ticketQuote) !== undefined
  const shape = {
    rendersClips: clipNodes.length > 0,
    mayReuseClips: clipNodes.some((m) => hasRendered(byId.get(m.id)) && !reuseCounted(m)),
    lengthUnread: ugc.chains.some((c) => c.lengthUnread),
    screenshotsUnread: ugc.chains.some((c) => c.screenshotsUnread),
  }
  const answers = ugc.chains.map((c) => answerOf(c.input))
  if (answers.some((a) => a === undefined)) return { credits: own, hold: own, estimate: "client", ...shape }
  const runsOf = (id: string | null) => (id === null ? 1 : (lines.find((l) => l.nodeId === id)?.quantity.fanOut ?? 1))
  const rest = sumRunCreditLines(lines.filter((line) => !ugc.coveredIds.has(line.nodeId)))
  // Each node's figures: a UGC Clip priced from its saved clips takes the clip part of their quote (its
  // UGC Clips does not run, so it runs once); every other node its part of its video's estimate.
  const figuresOf = (m: (typeof ugc.chains)[number]["nodes"][number], answer: UgcRunEstimate) => {
    const tickets = m.ticketQuote ? ticketAnswerOf(m.ticketQuote) : undefined
    return tickets ? { parts: tickets.parts, holdParts: tickets.holdParts } : { parts: answer.parts, holdParts: answer.holdParts }
  }
  const priced = ugc.chains.flatMap((c, i) => c.nodes.map((m) => ({ id: m.id, runs: runsOf(m.fanOutOf), part: m.part, figures: figuresOf(m, answers[i]!) })))
  const prices = ugcFiguresPerNode(priced.map((p) => ({ id: p.id, credits: p.figures.parts[p.part] * p.runs })))
  const holds = ugcFiguresPerNode(priced.map((p) => ({ id: p.id, credits: p.figures.holdParts[p.part] * p.runs })))
  const total = (figures: ReadonlyMap<string, number>) => [...figures.values()].reduce((sum, c) => sum + c, 0)
  return {
    credits: rest + total(prices),
    hold: rest + total(holds),
    estimate: "server",
    ...shape,
    nodeCredits: new Map([...ugc.coveredIds].map((id) => [id, prices.get(id) ?? 0] as const)),
  }
}

/**
 * Why a run's figure is not the server's checked one, on any surface: `UgcRunUnchecked` (the buttons and
 * the badge, which never wait, say `checking` while an answer is on its way).
 */
export type UgcPriceState = UgcRunUnchecked

/** The sentence that says so, for a confirmation, a tooltip or a toast. */
export function ugcPriceNoteKey(state: UgcPriceState): MessageKey {
  switch (state) {
    case "checking": return "ugc.price.checking"
    case "checkingHeld": return "ugc.price.checkingHeld"
    case "editor": return "ugc.price.unchecked"
    case "held": return "ugc.price.uncheckedHeld"
    case "length": return "ugc.price.uncheckedLength"
  }
}

/**
 * A run set's figure from what the cache holds now, never asking: for a figure read outside React
 * (the Copilot's single-node card). `unchecked` says why it is not the server's checked one.
 */
export function ugcRunFigureNow(
  executable: WorkflowNode[],
  allNodes: WorkflowNode[],
  edges: WorkflowEdge[],
  cachedCost: CachedCost,
): { readonly figure: UgcRunFigure; readonly unchecked: UgcPriceState | null } {
  let failed = false
  let held = false
  const figure = ugcRunCredits(executable, allNodes, edges, cachedCost, (input) => {
    const state = queryClient.getQueryState<UgcRunEstimate, Error>(ugcRunEstimateQuery(input).queryKey)
    if (state?.status === "error") {
      if (state.data === undefined) failed = true
      else held = true
    }
    return state?.data
  }, cachedTicketAnswerOf)
  const unchecked: UgcPriceState | null =
    figure.estimate === "client" ? (failed ? "editor" : "checking")
      : figure.estimate === "server" ? (held ? "held" : figure.lengthUnread ? "length" : figure.screenshotsUnread ? "editor" : null)
        : null
  return { figure, unchecked }
}

/** An answer still current: it landed less than five minutes ago. An older one is the last answer a re-check has not confirmed. */
function isCurrent(state: QueryState<unknown, Error> | undefined): boolean {
  return state?.data !== undefined && Date.now() - state.dataUpdatedAt < UGC_ESTIMATE_STALE_MS
}

/** When each figure that could not be had was given up on, by query key. */
const uncheckedAt = new Map<string, number>()

function remembered(key: string): boolean {
  const at = uncheckedAt.get(key)
  return at !== undefined && Date.now() - at < UGC_UNCHECKED_FOR_MS
}

/** `p`, or a rejection after `ms`. The timer is cleared either way. */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The UGC estimate did not answer in time")), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

/** Ask the server, until `deadline` at most. A failure is remembered; any answer that lands, a late one too, ends the memory. */
async function askServer(fetchAnswer: () => Promise<unknown>, key: string, deadline: number): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    // Shared with a fetch already in flight for the same key (a button's). It goes on after the wait, and its
    // answer lands in the cache, where every surface reads it.
    const fetching = fetchAnswer()
    void fetching.then(() => uncheckedAt.delete(key), () => undefined)
    try {
      await within(fetching, Math.max(0, deadline - Date.now()))
      uncheckedAt.delete(key)
      return
    } catch (err) {
      // That button went away and its fetch was cancelled: ask once more, within the same wait.
      if (attempt === 0 && isCancelledError(err) && Date.now() < deadline) continue
      uncheckedAt.set(key, Date.now())
      return
    }
  }
}

/** Why a run's figure is not the server's checked one. */
export type UgcRunUnchecked =
  /** An answer is still on its way (the wait ended before it landed): the figure is the editor's own. */
  | "checking"
  /** A re-check of an older answer is still on its way (the wait ended before it landed): the figure is the server's last answer. */
  | "checkingHeld"
  /**
   * An answer could not be had: the figure is the editor's own. Also a saved plan handed on whose
   * beats could not be read: the server's figure is for the screenshot cards the editor guessed.
   */
  | "editor"
  /** A re-check of an older answer could not be had: the figure is the server's last answer. */
  | "held"
  /** A saved plan handed on carries no length the editor can read: the server's figure is for the length setting. */
  | "length"

/** The confirmation's and the balance check's figure. */
export interface UgcRunPriced {
  readonly credits: number
  readonly hold: number
  /** Absent: the figure is checked (the server's current answers, every length read) or the run has no UGC part. */
  readonly unchecked?: UgcRunUnchecked
  readonly rendersClips: boolean
  readonly mayReuseClips: boolean
  /** With the server's answers: each covered node's figure (`UgcRunFigure.nodeCredits`). */
  readonly nodeCredits?: ReadonlyMap<string, number>
}

/**
 * The confirmation's and the balance check's figure: the server's when every
 * video's answer can be had within 5 s, else as `unchecked` says, for the
 * caller to say so. A failure is remembered for 60 s, so the balance check,
 * asked right after the confirmation, does not wait again; an answer in the
 * cache, a late one included, always comes first. An older answer whose
 * re-check failed still prices the run, flagged `held`. An ask the wait gave up
 * on that is still on its way has not failed: it is flagged `checking` (no
 * answer yet) or `checkingHeld` (an older answer's re-check), read from the
 * query's own state when the figure is read, never from the wait alone.
 */
export async function runCreditsWithUgc(
  executable: WorkflowNode[],
  allNodes: WorkflowNode[],
  edges: WorkflowEdge[],
  cachedCost: CachedCost,
): Promise<UgcRunPriced> {
  const inputs = ugcRunInputs(executable, allNodes, edges)
  if (inputs.length === 0) {
    const credits = estimateRunCredits(executable, allNodes, edges, cachedCost)
    return { credits, hold: credits, rendersClips: false, mayReuseClips: false }
  }
  // One wait for every video, and for the quote of every UGC Clip's saved clips.
  const deadline = Date.now() + UGC_ESTIMATE_TIMEOUT_MS
  await Promise.all([
    ...inputs.map(async (input) => {
      const query = ugcRunEstimateQuery(input)
      const key = hashKey(query.queryKey)
      if (isCurrent(queryClient.getQueryState<UgcRunEstimate, Error>(query.queryKey))) uncheckedAt.delete(key)
      else if (!remembered(key)) await askServer(() => queryClient.fetchQuery(query), key, deadline)
    }),
    // A quote that cannot be had leaves those clips at the estimate's full price: nothing to flag.
    ...ugcRunTicketQuotes(executable, allNodes, edges).map(async (quote) => {
      const query = ugcRunTicketQuery(quote)
      const key = hashKey(query.queryKey)
      if (isCurrent(queryClient.getQueryState<UgcTicketQuote, Error>(query.queryKey))) uncheckedAt.delete(key)
      else if (!remembered(key)) await askServer(() => queryClient.fetchQuery(query), key, deadline)
    }),
  ])
  // Whatever answers the cache holds now, these asks', late ones or a button's, are the figure on every surface.
  // An ask still in flight (the wait ended first) has not failed: only one that is not is "could not be checked".
  let missingFailed = false
  let held = false
  let checkingHeld = false
  const figure = ugcRunCredits(executable, allNodes, edges, cachedCost, (input) => {
    const state = queryClient.getQueryState<UgcRunEstimate, Error>(ugcRunEstimateQuery(input).queryKey)
    const inFlight = state?.fetchStatus === "fetching"
    if (state?.data === undefined) {
      if (!inFlight) missingFailed = true
    } else if (!isCurrent(state)) {
      if (inFlight) checkingHeld = true
      else held = true
    }
    return state?.data
  }, cachedTicketAnswerOf)
  const unchecked: UgcRunUnchecked | undefined =
    figure.estimate === "client" ? (missingFailed ? "editor" : "checking")
      : held ? "held" : checkingHeld ? "checkingHeld" : figure.lengthUnread ? "length" : figure.screenshotsUnread ? "editor" : undefined
  return {
    credits: figure.credits,
    hold: figure.hold,
    ...(unchecked ? { unchecked } : {}),
    rendersClips: figure.rendersClips,
    mayReuseClips: figure.mayReuseClips,
    ...(figure.nodeCredits ? { nodeCredits: figure.nodeCredits } : {}),
  }
}
