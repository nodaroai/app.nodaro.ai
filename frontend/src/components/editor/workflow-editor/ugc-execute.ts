/**
 * The canvas's own runs of the five UGC nodes (Nodaro Cloud only) — the twins
 * of the orchestrator's sync-HTTP lane (backend ugc-sync-nodes.ts): the same
 * request bodies, built by the same shared wires (`@nodaro/shared`
 * ugc-node-wires.ts); UGC Creator's round by the same implementation
 * (`@nodaro/render-rules`); and the same outputs, written through the one
 * mapping every lane shares (`ugcRunPatch`, lib/ugc-run-patch.ts).
 *
 * The canvas keeps no run credit total: every child job is reserved and
 * committed by its own route. Every call carries an idempotency key when the
 * run has one (the click's): the node's own calls the node's key, each child
 * step its own (lib/ugc-child-key.ts), so a repeat of the same run is handed
 * the jobs it already started. A child step is never tagged as the node's job:
 * a reload must not restore one step's output onto the node.
 *
 * A Stop is never a failure (and never a failed option); a run the node no
 * longer shows (discarded, replaced, deleted) writes nothing.
 */
import {
  UGC_NEWER_APP_MESSAGE,
  UGC_PRELUDE_ROUTES,
  UGC_PRIMARY_HANDLE,
  UGC_SCREENSHOT_HANDLES,
  fanOutItemMeta,
  ugcCallToRouteBody,
  ugcCardsBody,
  ugcCardsJobs,
  ugcCardsOutputs,
  ugcClipBody,
  ugcClipsBody,
  ugcClipsOutputs,
  ugcClipsPhase,
  ugcClipsPhase2Body,
  ugcCreatorBody,
  ugcFinishOutputs,
  ugcFinishPlan,
  ugcLaneNeedsFinish,
  ugcPrelude,
  ugcPreludeOutput,
  ugcCreatorOutputs,
  ugcKeptOutputs,
  ugcScriptBody,
  type ClipNote,
  type UgcCreatorFields,
  type UgcOutputs,
  type UgcPreludeStep,
  type UgcToolCall,
} from "@nodaro/shared"
import {
  UGC_SPEND_REFUSAL_CODES,
  UgcCreatorRoundStopped,
  runUgcCreatorRound,
  ugcCreatorCheck,
  ugcCreatorCheckPasses,
  type UgcCreatorRoundResult,
} from "@nodaro/render-rules"
import {
  SubscriptionRequiredError,
  UgcInsufficientCreditsError,
  setCurrentNodeId,
  startUgcChildJob,
  ugcCardsApi,
  ugcCategoriesApi,
  ugcClipApi,
  ugcClipsApi,
  ugcCreatorApi,
  ugcQuoteApi,
  ugcScriptApi,
  type UgcChildJobPath,
} from "@/lib/api"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { tx } from "@/lib/i18n"
import { iterationIdempotencyKey } from "@/lib/idempotency-key"
import { ugcChildIdempotencyKey, ugcNodeIdempotencyKey } from "@/lib/ugc-child-key"
import { promptUgcCredits } from "@/lib/ugc-creator-run"
import { ugcNodeMessageText } from "@/lib/ugc-copy"
import { serverNowIso } from "@/lib/server-clock"
import { ugcCanvasRunMark, ugcJobNoOutputMessage, ugcJobResultPatch, ugcRunPatch, ugcStopPatch } from "@/lib/ugc-run-patch"
import type { WorkflowNode } from "@/types/nodes"
import { shouldAbandonNode } from "./abandon-guard"
import { writeListResultMeta } from "./list-execution"
import type { FrontendResolvedInputs } from "./node-input-resolver"
import { RUN_START_RESET, guardedToast, pollJobOutputWithEnd, pollScrapeJobOutput } from "./poll-job"
import { runGraph } from "./run-graph"
import { checkStorageError, type ExecutionContext } from "./types"

/** What a canvas UGC run is handed beyond the node: the fan-out iteration it is, and the item it runs on. */
export interface UgcRunOptions {
  readonly listIterationIndex?: number
  readonly overrideInput?: string
}

type Data = Record<string, unknown>
type UgcType = "ugc-creator" | "ugc-script" | "ugc-clips" | "ugc-clip" | "ugc-cards" | "ugc-finish-clips"

/** A UGC Script or UGC Clip job follows the orchestrator's per-node ceiling (90 minutes), not a scrape's. */
const UGC_JOB_POLL_BUDGET_MS = 90 * 60_000

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined)
const labelOf = (node: WorkflowNode): string => str((node.data as Data).label) || node.type || node.id
const write = (nodeId: string, patch: Record<string, unknown>) => useWorkflowStore.getState().updateNodeData(nodeId, patch)

/** Stop pressed: never a failure on the node, never an option that failed. */
const isStop = (err: unknown, ctx: ExecutionContext): boolean =>
  (err as { name?: unknown } | null)?.name === "AbortError" || ctx.signal?.aborted === true

/** A refusal that means the run cannot pay, by the route's stable code: one list for both engines. */
function isUgcSpendRefusal(err: unknown): boolean {
  if (err instanceof SubscriptionRequiredError) return true
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === "string" && UGC_SPEND_REFUSAL_CODES.has(code)
}

/** The node still shows this run — several jobs, so no one job id to match: not discarded, stopped or deleted. */
function showsThisRun(nodeId: string): boolean {
  const data = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data as Data | undefined
  return !!data && (data.__listRunning === true || data.executionStatus === "running")
}

/** An input the wires refuse: the node fails with the wires' sentence before any call. */
function refuse(node: WorkflowNode, message: string): Promise<never> {
  write(node.id, { executionStatus: "failed", errorMessage: message, errorHint: undefined, currentJobId: undefined, currentJobProgress: undefined })
  guardedToast.error(tx("nodeRun.failed", { label: labelOf(node) }), { description: ugcNodeMessageText(message) })
  return Promise.reject(new Error(message))
}

/** A run's end on failure: the caught error's message is what the node shows (a Stop, or a run the node no longer shows, writes nothing). */
async function guardedRun(node: WorkflowNode, ctx: ExecutionContext, run: () => Promise<string>, stillShown: () => boolean = () => showsThisRun(node.id)): Promise<string> {
  try {
    return await run()
  } catch (err) {
    if (isStop(err, ctx) || !stillShown()) return ""
    const message = err instanceof Error && err.message ? err.message : tx("lib.unknownError")
    write(node.id, {
      executionStatus: "failed",
      errorMessage: message,
      // A moderation block's classified hint, when the job carried one; a stale one goes.
      errorHint: (err as { errorHint?: unknown } | null)?.errorHint ?? undefined,
      currentJobId: undefined,
      currentJobProgress: undefined,
      jobAwaitingReview: undefined,
    })
    if (!checkStorageError(err, ctx)) guardedToast.error(tx("nodeRun.failed", { label: labelOf(node) }), { description: ugcNodeMessageText(message) })
    throw err
  }
}

/** A finished run: these fields, the node completed. */
function completeWith(nodeId: string, fields: Record<string, unknown>): void {
  write(nodeId, {
    ...fields,
    executionStatus: "completed",
    errorMessage: undefined,
    currentJobId: undefined,
    currentJobProgress: undefined,
    jobAwaitingReview: undefined,
  })
}

/** A finished run: exactly what every lane writes for this output, stamped with this run (`ugcCanvasRunMark`). */
function finish(node: WorkflowNode, type: UgcType, output: Readonly<Record<string, unknown>>): void {
  completeWith(node.id, { ...(ugcRunPatch(type, output) ?? {}), ...ugcCanvasRunMark(node.id) })
}

/** Keep on: the node hands on the result it holds without running — no call, no charge (the orchestrator's kept branch). */
function handOnKept(node: WorkflowNode, type: "ugc-creator" | "ugc-script", kept: UgcOutputs): string {
  completeWith(node.id, { ...ugcRunPatch(type, { ugcOutputs: kept }), errorHint: undefined })
  return kept[UGC_PRIMARY_HANDLE[type]!] ?? ""
}

/** The run's key for this node's calls: the click's, with the fan-out iteration. None → no call is keyed. */
const runKeyOf = (ctx: ExecutionContext, opts: UgcRunOptions) => iterationIdempotencyKey(ctx.idempotencyKey, opts.listIterationIndex)
/** The key of the node's own call: the run's key and the node (lib/ugc-child-key.ts). */
const nodeKeyOf = (ctx: ExecutionContext, opts: UgcRunOptions, node: WorkflowNode) => ugcNodeIdempotencyKey(runKeyOf(ctx, opts), node.id)

const stopIfStopping = (ctx: ExecutionContext) => {
  if (ctx.signal?.aborted) throw new DOMException("Aborted", "AbortError")
}

// ── UGC Creator ──────────────────────────────────────────────────────────────

/**
 * UGC Creator on the canvas. A photo: the builder's photo check on the photo, which then is the
 * creator. A sampled creator: the round — every option where a person picks (a node of the canvas
 * itself, never a sub-workflow's hidden copy or a fan-out iteration), else the primary alone. Two
 * or more passing options wait for the pick, handing nothing on; one is the creator. A credits
 * stop keeps the options that passed, opens the buy-credits dialog when the route names its
 * numbers, and fails the node with the route's error.
 */
export async function executeUgcCreator(node: WorkflowNode, inputs: FrontendResolvedInputs, ctx: ExecutionContext, opts: UgcRunOptions = {}): Promise<string> {
  const data = node.data as Data
  const kept = ugcKeptOutputs("ugc-creator", data)
  if (kept) return handOnKept(node, "ugc-creator", kept)
  const ugc = inputs.ugc ?? {}
  const req = ugcCreatorBody({
    data: data as UgcCreatorFields,
    photoUrl: str(ugc.photo),
    category: str(ugc.category),
    pickers: obj(ugc.pickers) as Record<string, Record<string, unknown>> | undefined,
  })
  if ("error" in req) return refuse(node, req.error)
  write(node.id, { ...RUN_START_RESET, optionFailed: undefined })
  setCurrentNodeId(null)
  const runKey = runKeyOf(ctx, opts)

  let builderCalls = 0
  const builder = async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
    stopIfStopping(ctx)
    // The node's own call keeps the node's key; the round's re-call is a step of its own.
    const step = builderCalls === 0 ? undefined : `builder-${builderCalls}`
    builderCalls++
    const full = { ...body, userId: ctx.userId }
    const idempotencyKey = step === undefined ? await ugcNodeIdempotencyKey(runKey, node.id) : await ugcChildIdempotencyKey({ runKey, nodeId: node.id, step, path: "/v1/ugc/creator", body: full })
    return ugcCreatorApi(full, { idempotencyKey })
  }
  const child = async (call: UgcToolCall, image?: string, step?: string): Promise<{ imageUrl?: string; text?: string }> => {
    stopIfStopping(ctx)
    const mapped = ugcCallToRouteBody(call, image ? { image } : {})
    if (mapped === undefined || "error" in mapped) throw new Error(UGC_NEWER_APP_MESSAGE)
    const body = { ...mapped.body, userId: ctx.userId }
    const idempotencyKey = step ? await ugcChildIdempotencyKey({ runKey, nodeId: node.id, step, path: mapped.path, body }) : undefined
    const started = await startUgcChildJob(mapped.path as UgcChildJobPath, body, { idempotencyKey })
    // A reading answers in the call; an image job — or a reading handed back by its key — is polled.
    if (typeof started.generatedText === "string") return { text: started.generatedText }
    if (mapped.path !== "/v1/image-to-text/describe") write(node.id, { currentJobId: started.jobId })
    const out = await pollScrapeJobOutput(started.jobId, node.id, { signal: ctx.signal })
    return { imageUrl: str(out.imageUrl), text: str(out.generatedText) ?? str(out.text) }
  }
  /** The buy-credits dialog, when the refusing route named both of its numbers. */
  const creditsDialog = (refusal: unknown) => {
    if (refusal instanceof UgcInsufficientCreditsError) promptUgcCredits(ctx, { required: refusal.required, balance: refusal.balance })
  }

  return guardedRun(node, ctx, async () => {
    const answer = await builder(req.body)
    if (answer.kind === "photo") {
      const photo = str(obj(req.body.source)?.imageUrl)
      // A photo is handed on only once its check passed: an answer whose check cannot run is refused.
      const check = ugcCreatorCheck(answer.photoCheck)
      if (!check || !photo) throw new Error(UGC_NEWER_APP_MESSAGE)
      const read = await child(check, photo, "photo-check").catch((err: unknown) => {
        if (isUgcSpendRefusal(err)) creditsDialog(err)
        throw err
      })
      if (!ugcCreatorCheckPasses(read.text, check)) throw new Error(check.refusal)
      if (!showsThisRun(node.id)) return ""
      const out = ugcCreatorOutputs(answer, [photo])
      finish(node, "ugc-creator", { ugcOutputs: out.outputs })
      guardedToast.success(tx("nodeRun.complete", { label: labelOf(node) }))
      return out.outputs.creator ?? ""
    }

    let round: UgcCreatorRoundResult
    try {
      round = await runUgcCreatorRound(answer, req.body, { child, builder, isInsufficientCredits: isUgcSpendRefusal, isAbort: (err) => isStop(err, ctx) }, {
        personPicks: node.hidden !== true && opts.listIterationIndex === undefined,
      })
    } catch (err) {
      if (!(err instanceof UgcCreatorRoundStopped)) throw err
      // The standard credits stop: the options already checked stay to pick after a top-up.
      if (showsThisRun(node.id)) write(node.id, ugcStopPatch({ ugcCandidates: err.candidates }))
      creditsDialog(err.refusal)
      throw err.refusal
    }
    if (!showsThisRun(node.id)) return ""
    const note = round.optionFailed ? { ugcOptionFailed: true } : {}
    if (round.kind === "pick") {
      finish(node, "ugc-creator", { ugcCandidates: round.candidates, ...note })
      guardedToast.info(tx("run.ugcPickCreator"), { description: tx("run.ugcPickCreatorDesc") })
      return ""
    }
    const outputs = ugcCreatorOutputs(round.answer, round.images).outputs
    finish(node, "ugc-creator", { ugcOutputs: outputs, ...note })
    guardedToast.success(tx("nodeRun.complete", { label: labelOf(node) }))
    return outputs.creator ?? ""
  })
}

// ── UGC Script ───────────────────────────────────────────────────────────────

/** UGC Script on the canvas: the script job, its plan and category handed on; Keep on hands on the script it holds. */
export async function executeUgcScript(node: WorkflowNode, inputs: FrontendResolvedInputs, ctx: ExecutionContext, opts: UgcRunOptions = {}): Promise<string> {
  const data = node.data as Data
  const kept = ugcKeptOutputs("ugc-script", data)
  if (kept) return handOnKept(node, "ugc-script", kept)
  const ugc = inputs.ugc ?? {}
  const built = ugcScriptBody({
    site: str(ugc.site),
    screenshots: UGC_SCREENSHOT_HANDLES.map((handle) => str(ugc[handle])),
    productImage: str(ugc.product),
    targetDurationSec: typeof data.targetDurationSec === "number" ? data.targetDurationSec : undefined,
    language: data.language,
  })
  if ("error" in built) return refuse(node, built.error)
  write(node.id, { ...RUN_START_RESET })
  let jobId = ""
  return guardedRun(node, ctx, async () => {
    jobId = (await ugcScriptApi({ ...built.body, userId: ctx.userId }, { idempotencyKey: await nodeKeyOf(ctx, opts, node) })).jobId
    write(node.id, { currentJobId: jobId })
    const { output: row, completedAt } = await pollJobOutputWithEnd(jobId, node.id, { signal: ctx.signal, budgetMs: UGC_JOB_POLL_BUDGET_MS })
    if (shouldAbandonNode(node.id, jobId)) return ""
    // The job lands as every lane lands it, stamped with the job and its end on the server's clock (lib/ugc-run-patch.ts).
    const patch = ugcJobResultPatch("ugc-script", row, { id: jobId, endedAt: completedAt ?? serverNowIso() })
    if (!patch) throw new Error(ugcJobNoOutputMessage(jobId))
    completeWith(node.id, patch)
    guardedToast.success(tx("nodeRun.complete", { label: labelOf(node) }))
    return (patch.ugcOutputs as UgcOutputs).plan ?? ""
  }, () => !jobId || !shouldAbandonNode(node.id, jobId))
}

// ── UGC Clips ────────────────────────────────────────────────────────────────

/** How long UGC Clips' quote may take before it is given up: the figure is shown, never waited for. */
const UGC_QUOTE_TIMEOUT_MS = 30_000

/**
 * What a UGC Clips run's tickets cost, priced by this platform (a server run fetches none), fetched
 * after the run has ended: it is shown, never waited for. A Stop or a quote that takes too long
 * gives it up, one that fails leaves the node with none, and it lands only while the node still
 * holds the tickets it priced — never over a newer run's.
 */
function quoteUgcClips(nodeId: string, tickets: unknown, body: { readonly tickets: readonly unknown[]; readonly hasCards: boolean; readonly finishes: boolean }, runSignal: AbortSignal | undefined): void {
  // The tickets it prices, by their content: a save made elsewhere may hand the node new objects.
  const priced = JSON.stringify(tickets)
  const giveUp = new AbortController()
  const abort = () => giveUp.abort()
  const timer = setTimeout(abort, UGC_QUOTE_TIMEOUT_MS)
  if (runSignal?.aborted) abort()
  else runSignal?.addEventListener("abort", abort, { once: true })
  void ugcQuoteApi(body, { signal: giveUp.signal })
    .then((quote) => {
      const data = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data as Data | undefined
      if (giveUp.signal.aborted || JSON.stringify(data?.__listResults) !== priced) return
      write(nodeId, { quote })
    })
    .catch(() => {})
    .finally(() => {
      clearTimeout(timer)
      runSignal?.removeEventListener("abort", abort)
    })
}

/** UGC Clips on the canvas: this run's tickets (never a list an earlier run left), then what they cost. */
export async function executeUgcClips(node: WorkflowNode, inputs: FrontendResolvedInputs, ctx: ExecutionContext, opts: UgcRunOptions = {}): Promise<string> {
  const data = node.data as Data
  const ugc = inputs.ugc ?? {}
  const built = ugcClipsBody({ planWire: ugc.plan, creatorWire: ugc.creator, voiceId: str(data.voiceId) })
  if ("error" in built) return refuse(node, built.error)
  write(node.id, { ...RUN_START_RESET, __listResults: undefined, quote: undefined })
  // This run's Stop: a later run of the node gets a signal of its own.
  const runSignal = ctx.signal
  const runKey = runKeyOf(ctx, opts)
  return guardedRun(node, ctx, async () => {
    const body = { ...built.body, userId: ctx.userId }
    const first = await ugcClipsApi(body, { idempotencyKey: await nodeKeyOf(ctx, opts, node) })
    // A video cut from one recorded speech: the speech, its word timings and its split first (the server lane's runUgcClips).
    const answer = ugcClipsPhase(first) === 1 ? await runUgcClipsPrelude(node, first, body, ctx, runKey) : first
    const read = ugcClipsOutputs(answer)
    if ("error" in read) throw new Error(read.error)
    if (!showsThisRun(node.id)) return ""
    // The tickets and the end of the run in one write; the quote follows on its own.
    finish(node, "ugc-clips", { ugcOutputs: read.outputs, listResults: read.tickets })
    guardedToast.success(tx("nodeRun.complete", { label: labelOf(node) }))
    quoteUgcClips(node.id, read.tickets, { tickets: answer.tickets as unknown[], hasCards: read.hasCards, finishes: read.finishes }, runSignal)
    return read.outputs.clips ?? ""
  })
}

/**
 * UGC Clips' prelude on the canvas, after a phase-1 answer: refused before anything is spent when no UGC Finish
 * takes this node's Script (sized) output; else the speech, its word timings and its split as child jobs keyed by
 * their step, then the second call with the segments, whose answer is returned. An answer with errors is returned
 * as it came (the script's refusal is worded by `ugcClipsOutputs`).
 */
async function runUgcClipsPrelude(node: WorkflowNode, first: Record<string, unknown>, body: Record<string, unknown>, ctx: ExecutionContext, runKey: string | undefined): Promise<Record<string, unknown>> {
  if (Array.isArray(first.errors) && first.errors.length > 0) return first
  // The graph as the runner reads it (runGraph: wires as they carry, Teleport pairs bypassed).
  const { nodes, edges } = runGraph()
  const refused = ugcLaneNeedsFinish(edges, nodes, node.id)
  if (refused) throw new Error(refused)
  const prelude = ugcPrelude(first)
  if ("error" in prelude) throw new Error(prelude.error)
  const step = async (name: UgcPreludeStep, stepBody: Record<string, unknown>): Promise<unknown> => {
    stopIfStopping(ctx)
    const path = UGC_PRELUDE_ROUTES[name].path as UgcChildJobPath
    const full = { ...stepBody, userId: ctx.userId }
    const idempotencyKey = await ugcChildIdempotencyKey({ runKey, nodeId: node.id, step: name, path, body: full })
    const started = await startUgcChildJob(path, full, { idempotencyKey })
    // The UGC jobs' own ceiling (the orchestrator's per-node one), not a scrape's.
    const out = await pollScrapeJobOutput(started.jobId, node.id, { signal: ctx.signal, budgetMs: UGC_JOB_POLL_BUDGET_MS })
    const read = ugcPreludeOutput(name, out)
    if ("error" in read) throw new Error(read.error)
    return read.value
  }
  const audioUrl = (await step("speech", prelude.speech)) as string
  const alignment = await step("alignment", prelude.alignment(audioUrl))
  const segments = (await step("split", prelude.split(audioUrl, alignment))) as unknown[]
  stopIfStopping(ctx)
  const second = ugcClipsPhase2Body(body, segments)
  return ugcClipsApi(second, { idempotencyKey: await ugcChildIdempotencyKey({ runKey, nodeId: node.id, step: "phase-2", path: "/v1/ugc/clips", body: second }) })
}

// ── UGC Clip ─────────────────────────────────────────────────────────────────

/**
 * UGC Clip on the canvas: one clip job for its ticket (the fan-out's item, else the wired one).
 * A video node: its take lands as every video node's does, and the take it shows is the one it
 * hands on; then the clip's own fields. A fan-out iteration writes its notes row.
 */
export async function executeUgcClip(node: WorkflowNode, inputs: FrontendResolvedInputs, ctx: ExecutionContext, opts: UgcRunOptions = {}): Promise<string> {
  const data = node.data as Data
  const ugc = inputs.ugc ?? {}
  const built = ugcClipBody({ ticketWire: opts.overrideInput ?? ugc.clip, rerender: data.rerender as Readonly<Record<string, number>> | undefined })
  if ("error" in built) return refuse(node, built.error)
  // A clip pressed for Re-render keeps its mark until a run renders it: this one, once its take lands.
  write(node.id, { ...RUN_START_RESET })
  let jobId = ""
  return guardedRun(node, ctx, async () => {
    jobId = (await ugcClipApi({ ...built.body, userId: ctx.userId }, { idempotencyKey: await nodeKeyOf(ctx, opts, node) })).jobId
    write(node.id, { currentJobId: jobId })
    const { output: row, completedAt } = await pollJobOutputWithEnd(jobId, node.id, { signal: ctx.signal, budgetMs: UGC_JOB_POLL_BUDGET_MS })
    if (shouldAbandonNode(node.id, jobId)) return ""
    // A fan-out iteration owns one notes row, never the batch's notes or its stamp.
    const fanOut = opts.listIterationIndex !== undefined
    const prior = (useWorkflowStore.getState().nodes.find((n) => n.id === node.id)?.data as Data | undefined)?.generatedResults
    // The take lands as every lane lands it, stamped with the job and its end on the server's clock (lib/ugc-run-patch.ts).
    const patch = ugcJobResultPatch("ugc-clip", row, { id: jobId, endedAt: completedAt ?? serverNowIso() }, { priorResults: prior, batchRow: fanOut })
    if (!patch) throw new Error(ugcJobNoOutputMessage(jobId))
    if (fanOut) writeListResultMeta(node.id, opts.listIterationIndex!, fanOutItemMeta(row))
    // This run rendered one clip: its mark alone goes (the others' are their own runs').
    const { rerenderPending: _everyMark, ...landed } = patch
    completeWith(node.id, { ...landed, ...renderedClipMark(node.id, built.clipNumber, built.body.nonce) })
    guardedToast.success(tx("nodeRun.complete", { label: labelOf(node) }))
    return patch.generatedVideoUrl as string
  }, () => !jobId || !shouldAbandonNode(node.id, jobId))
}

/**
 * The Re-render mark of the clip a canvas run just rendered goes — unless the clip was pressed
 * again while the run went on (its count moved past the one this run rendered with): that press
 * is the next run's.
 */
function renderedClipMark(nodeId: string, clipNumber: number, renderedWith: unknown): Record<string, unknown> {
  const data = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data as Data | undefined
  const marks = data?.rerenderPending
  const key = String(clipNumber)
  if (!marks || typeof marks !== "object" || !(key in marks)) return {}
  const counts = data?.rerender && typeof data.rerender === "object" ? (data.rerender as Record<string, unknown>) : {}
  if ((counts[key] ?? 0) !== renderedWith) return {}
  const { [key]: _rendered, ...rest } = marks as Record<string, true>
  return { rerenderPending: Object.keys(rest).length > 0 ? rest : undefined }
}

// ── UGC Cards ────────────────────────────────────────────────────────────────

/**
 * UGC Cards on the canvas: the free categories call first (no UGC routes here → nothing paid
 * starts), then the two timing jobs on the joined video side by side, then the cards from
 * whichever came back (`failed` names the others) and the clips' notes. A timing job the run
 * cannot pay for fails the node with the route's error: the cards are never made without their
 * captions for want of credits.
 */
export async function executeUgcCards(node: WorkflowNode, inputs: FrontendResolvedInputs, ctx: ExecutionContext, opts: UgcRunOptions = {}): Promise<string> {
  write(node.id, { ...RUN_START_RESET })
  setCurrentNodeId(null)
  const runKey = runKeyOf(ctx, opts)
  return guardedRun(node, ctx, async () => {
    await ugcCategoriesApi()
    const ugc = inputs.ugc ?? {}
    const jobs = ugcCardsJobs({ planOutWire: ugc.plan, videoUrl: str(ugc.video), transcript: str(ugc.transcript) })
    if ("error" in jobs) throw new Error(jobs.error)
    const timing = async (path: UgcChildJobPath, body: Record<string, unknown>, step: string): Promise<Record<string, unknown>> => {
      stopIfStopping(ctx)
      const full = { ...body, userId: ctx.userId }
      const idempotencyKey = await ugcChildIdempotencyKey({ runKey, nodeId: node.id, step, path, body: full })
      const started = await startUgcChildJob(path, full, { idempotencyKey })
      return pollScrapeJobOutput(started.jobId, node.id, { signal: ctx.signal })
    }
    const [aligned, heard] = await Promise.allSettled([
      timing(jobs.alignment.path, jobs.alignment.body, "alignment"),
      timing(jobs.transcribe.path, jobs.transcribe.body, "transcribe"),
    ])
    // A Stop is never a timing job that failed; a run that cannot pay never makes the cards.
    for (const s of [aligned, heard]) if (s.status === "rejected" && isStop(s.reason, ctx)) throw s.reason
    for (const s of [aligned, heard]) if (s.status === "rejected" && isUgcSpendRefusal(s.reason)) throw s.reason
    const failed = [...(aligned.status === "rejected" ? ["alignment" as const] : []), ...(heard.status === "rejected" ? ["words" as const] : [])]
    const body = ugcCardsBody({
      plan: jobs.plan,
      videoUrl: jobs.alignment.body.audioUrl as string,
      // Where the two jobs write them: the alignment's words, the transcription's timed words on its json.
      alignment: aligned.status === "fulfilled" ? aligned.value.alignment : undefined,
      words: heard.status === "fulfilled" ? obj(heard.value.json)?.words : undefined,
      failed,
      clipNotes: (inputs.clipNotes ?? []) as ClipNote[],
    })
    const answer = await ugcCardsApi({ ...body, userId: ctx.userId }, { idempotencyKey: await ugcNodeIdempotencyKey(runKey, node.id) })
    if (!showsThisRun(node.id)) return ""
    const outputs = ugcCardsOutputs(answer)
    finish(node, "ugc-cards", { ugcOutputs: outputs })
    guardedToast.success(tx("nodeRun.complete", { label: labelOf(node) }))
    return outputs.layerPlan ?? ""
  })
}

// ── UGC Finish ───────────────────────────────────────────────────────────────

/**
 * UGC Finish on the canvas: every clip at once, in clip order (the fan-in list). No finish call on the plan: the
 * clips go on as they came — no call, no job. Else one finish job over all of them; its finished clips, in order,
 * are the node's list (`__listResults`, with each clip's notes), shown as its results, the first handed on.
 */
export async function executeUgcFinishClips(node: WorkflowNode, inputs: FrontendResolvedInputs, ctx: ExecutionContext, opts: UgcRunOptions = {}): Promise<string> {
  const plan = ugcFinishPlan({ planOutWire: inputs.ugc?.plan, clipUrls: inputs.inputs ?? [] })
  if ("error" in plan) return refuse(node, plan.error)
  write(node.id, { ...RUN_START_RESET })
  setCurrentNodeId(null)
  const runKey = runKeyOf(ctx, opts)
  const land = (urls: readonly string[], meta: ReadonlyArray<{ warnings: readonly string[]; durationSec: number | null }>): string => {
    finish(node, "ugc-finish-clips", { listResults: [...urls], listResultMeta: [...meta] })
    write(node.id, { generatedVideoUrl: urls[0], generatedResults: urls.map((url) => ({ url })), activeResultIndex: 0 })
    guardedToast.success(tx("nodeRun.complete", { label: labelOf(node) }))
    return urls[0] ?? ""
  }
  return guardedRun(node, ctx, async () => {
    if (plan.kind === "pass") return land(plan.clips, plan.clips.map(() => ({ warnings: [], durationSec: null })))
    stopIfStopping(ctx)
    const full = { ...plan.body, userId: ctx.userId }
    const idempotencyKey = await ugcChildIdempotencyKey({ runKey, nodeId: node.id, step: "finish", path: plan.path, body: full })
    const started = await startUgcChildJob(plan.path, full, { idempotencyKey })
    write(node.id, { currentJobId: started.jobId })
    const out = await pollScrapeJobOutput(started.jobId, node.id, { signal: ctx.signal, budgetMs: UGC_JOB_POLL_BUDGET_MS })
    const read = ugcFinishOutputs(out)
    if ("error" in read) throw new Error(read.error)
    if (!showsThisRun(node.id)) return ""
    return land(read.clips.map((c) => c.url), read.clips.map((c) => c.meta))
  })
}
