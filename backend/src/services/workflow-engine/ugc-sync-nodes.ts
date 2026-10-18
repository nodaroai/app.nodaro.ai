/**
 * The five UGC nodes on the orchestrator's sync-HTTP lane: their routes (all
 * served by the Nodaro Cloud plugin — no app route file registers one), the
 * bodies of the three nodes whose route answers in the call itself or with a
 * job to poll, UGC Clips' answer as the node's output, and the runners of the
 * two nodes that start child jobs of their own (UGC Creator's images and
 * readings, UGC Cards' two timing jobs). Every body and output comes from the
 * shared UGC wires (`@nodaro/shared`) and UGC Creator's round from
 * `@nodaro/render-rules` — the same functions the editor calls, so the two
 * engines cannot disagree.
 */
import {
  UGC_FINISH_CLIPS_TYPE,
  UGC_NEWER_APP_MESSAGE,
  UGC_PRELUDE_ROUTES,
  UGC_SCREENSHOT_HANDLES,
  ugcCallToRouteBody,
  ugcCardsBody,
  ugcCardsJobs,
  ugcCardsOutputs,
  ugcClipBody,
  ugcClipsBody,
  ugcClipsOutputs,
  ugcClipsPhase,
  ugcClipsPhase2Body,
  ugcFinishOutputs,
  ugcFinishPlan,
  ugcLaneNeedsFinish,
  ugcPrelude,
  ugcPreludeOutput,
  ugcRenderHoldBody,
  ugcRenderHoldVerdict,
  ugcRunEstimateInput,
  ugcCreatorBody,
  ugcCreatorOutputs,
  ugcFailure,
  ugcScriptBody,
  type UgcPreludeStep,
  type UgcRunEstimateInput,
  type UgcCreatorCandidate,
  type UgcCreatorFields,
  type UgcRouteBody,
  type UgcToolCall,
  UGC_NODE_TYPES,
} from "@nodaro/shared/ugc"
import {
  type ClipNote,
  nodeRunRoute,
} from "@nodaro/shared/nodes"
import { createHash } from "node:crypto"
import {
  UGC_SPEND_REFUSAL_CODES,
  UgcCreatorRoundStopped,
  runUgcCreatorRound,
  ugcCreatorCheck,
  ugcCreatorCheckPasses,
  type UgcCreatorRoundResult,
} from "@nodaro/render-rules"
import { DrainAbortError } from "../../lib/worker-drain.js"
import { withChargedCredits } from "./failed-node-output.js"
import type { ExecuteNodeResult } from "./node-executor.js"
import type { NodeOutput, OrchestratorContext, ResolvedInputs, SimpleNode } from "./types.js"

/** Each UGC node's route, from the shared node-route table (`nodeRunRoute` in @nodaro/shared). */
export const UGC_SYNC_ROUTES: Readonly<Record<string, string>> = Object.fromEntries(
  [...UGC_NODE_TYPES].map((type) => {
    const route = nodeRunRoute(type)
    if (!route) throw new Error(`UGC node "${type}" has no run route`)
    return [type, route]
  }),
)

/** The sync-HTTP nodes whose route the Nodaro Cloud plugin serves: a failed call reads through `ugcFailure`. */
export const PLUGIN_SERVED_SYNC_TYPES: ReadonlySet<string> = new Set(Object.keys(UGC_SYNC_ROUTES))

/**
 * The UGC nodes whose route answers with a job of its own (the job is queued under the node's
 * type, so a picked-up row's `job_type` is the node type). The run stamps the job with itself,
 * registers it, and a resumed run adopts it while its worker runs.
 */
export const UGC_JOB_TYPES: ReadonlySet<string> = new Set(["ugc-script", "ugc-clip"])

/**
 * The UGC nodes that run several jobs of their own as the steps of ONE node (UGC Creator's
 * images and readings, UGC Cards' two timing jobs, UGC Clips' speech-first steps on a video cut
 * from one recorded speech, UGC Finish's finish job). No one job's end is the node's: a crash
 * recovery never settles them off a child — the node runs again, and each child is handed
 * back by its own idempotency key.
 */
export const UGC_STEP_JOB_TYPES: ReadonlySet<string> = new Set(["ugc-creator", "ugc-cards", "ugc-clips", UGC_FINISH_CLIPS_TYPE])

/**
 * Whether a job a UGC route handed back is this run's: one this run stamped (an earlier attempt
 * of the same run), or one no run stamped that had not finished when this run got it (the job
 * the call just started). A job another run stamped, or one that had already finished (UGC Clip
 * hands back a finished clip of the same ticket), is not — its charge was another run's, and the
 * run neither re-stamps it nor counts it. A row the lane could not read counts as this run's.
 */
export function ugcJobIsThisRuns(
  row: { readonly workflow_execution_id?: unknown; readonly status?: unknown } | null | undefined,
  executionId: string,
): boolean {
  if (!row) return true
  const stampedBy = row.workflow_execution_id
  if (stampedBy === executionId) return true
  return (stampedBy === null || stampedBy === undefined) && row.status !== "completed"
}

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)

/**
 * What a UGC Clip names its run by (`runKey`): nothing off an app run (a clip of the same ticket is
 * handed back to any of the user's runs); on an app run, its continuation chain's root
 * (`ctx.runRootExecutionId`: a continuation hands back the clips its earlier attempts finished),
 * else the run's own execution — so two app runs never share a clip. Pure.
 */
export function ugcClipRunKey(ctx: Pick<OrchestratorContext, "isAppRun" | "executionId" | "runRootExecutionId">): string | undefined {
  if (!ctx.isAppRun) return undefined
  return ctx.runRootExecutionId ?? ctx.executionId
}

/**
 * The request body of UGC Script, UGC Clips or UGC Clip, from the node's data and its inputs by
 * handle (`inputs.ugc`). Throws the wires' sentence — a missing input, a wire from a newer
 * version — before any call. The user is always the run's (`ctx.userId`); a UGC Clip on an app
 * run names its run (`ugcClipRunKey`), so each app run renders its own clip.
 */
export function buildUgcSyncBody(node: SimpleNode, inputs: ResolvedInputs, ctx: OrchestratorContext): Record<string, unknown> {
  const ugc = inputs.ugc ?? {}
  const data = node.data as Record<string, unknown>
  const built = (() => {
    switch (node.type) {
      case "ugc-script":
        return ugcScriptBody({
          site: asString(ugc.site),
          screenshots: UGC_SCREENSHOT_HANDLES.map((handle) => asString(ugc[handle])),
          productImage: asString(ugc.product),
          targetDurationSec: typeof data.targetDurationSec === "number" ? data.targetDurationSec : undefined,
          language: data.language,
        })
      case "ugc-clips":
        return ugcClipsBody({ planWire: ugc.plan, creatorWire: ugc.creator, voiceId: asString(data.voiceId) })
      case "ugc-clip":
        return ugcClipBody({
          ticketWire: ugc.clip,
          rerender: data.rerender as Readonly<Record<string, number>> | undefined,
          runKey: ugcClipRunKey(ctx),
        })
      default:
        throw new Error(`No UGC request body for node type ${node.type}`)
    }
  })()
  if ("error" in built) throw new Error(built.error)
  return { ...built.body, userId: ctx.userId }
}

/**
 * A UGC node's answer given in the call itself → the node's output. UGC Clips: its outputs by
 * pip, and this run's tickets as `listResults` (what UGC Clip runs once per item over — never a
 * list an earlier run left on the node). Throws "The script needs changes: …" when the answer
 * asks for changes.
 */
export function ugcSyncOutput(type: string, answer: Record<string, unknown>): NodeOutput {
  if (type !== "ugc-clips") throw new Error(`No UGC answer is read from the call for node type ${type}`)
  const read = ugcClipsOutputs(answer)
  if ("error" in read) throw new Error(read.error)
  return { ugcOutputs: read.outputs, listResults: read.tickets }
}

// ── UGC Creator and UGC Cards: the nodes that run child jobs of their own ────

/**
 * What the two runners call — each engine its own (the orchestrator's: `ugcDepsFor` in
 * node-executor.ts). A runner never builds a header or reads a row itself.
 */
export interface UgcDeps {
  /**
   * POST on the lane's headers (the orchestrator secret, the run's user, X-App-Run,
   * X-Web-Free-Mode, the workspace payer); the user also rides `body.userId`. `step` names a
   * child call within the node's run, which then carries an idempotency key of its own (its step
   * and its request); with no `step` the call is the node's own and carries the node's key.
   */
  post(path: string, body: Record<string, unknown>, step?: string): Promise<{ status: number; text: string }>
  /** GET on the same headers: a bodyless call names its user only in X-Internal-User-Id. */
  get(path: string): Promise<{ status: number; text: string }>
  /** Poll a child job to its end: its output, and its charge when its row mirrors one. */
  poll(jobId: string, nodeType: string): Promise<ExecuteNodeResult>
  /** Register a child job with the run: its job link and its progress. */
  onJobCreated(jobId: string): void
  /** What a finished child job charged: jobs.credits_actual, else jobs.credits (its committed reservation), else 0. */
  jobCharge(jobId: string): Promise<number>
}

/** The node type each child route's job is read as. */
const CHILD_JOB_TYPE: Readonly<Record<UgcRouteBody["path"], string>> = {
  "/v1/generate-image": "generate-image",
  "/v1/image-to-image": "image-to-image",
  "/v1/image-to-text/describe": "image-to-text",
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
const asObject = (x: unknown): Record<string, unknown> | undefined =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : undefined

/** A route's `{ error: { code } }`, when its body names one. */
function routeCodeOf(text: string): string | undefined {
  const code = asObject(asObject(parseJson(text))?.error)?.code
  return typeof code === "string" ? code : undefined
}

/** A 402's `required` and `balance`, when its body names both: the buy-credits dialog's numbers. */
function shortfallOf(text: unknown): { required: number; balance: number } | undefined {
  const body = typeof text === "string" ? asObject(parseJson(text)) : undefined
  const { required, balance } = body ?? {}
  return typeof required === "number" && typeof balance === "number" ? { required, balance } : undefined
}

/** A child route's refusal: its sentence, with its status, code and body riding along for the round. */
function childRefusal(status: number, text: string): Error {
  return Object.assign(new Error(ugcFailure(status, text)), { status, code: routeCodeOf(text), body: text })
}

/** A route's answer as an object; anything else is the route's failure. */
function answerOf(res: { status: number; text: string }): Record<string, unknown> {
  const answer = asObject(parseJson(res.text))
  if (!answer) throw new Error(ugcFailure(res.status, res.text))
  return answer
}

/** The job a child route started (or handed back by its key). */
function jobIdOf(res: { status: number; text: string }, answer: Record<string, unknown>): string {
  if (typeof answer.jobId !== "string" || answer.jobId === "") throw new Error(ugcFailure(res.status, res.text))
  return answer.jobId
}

/** The run itself is stopping — a deploy drain, or a cancel: never a child's own failure. */
const runStops = (ctx: OrchestratorContext) => (err: unknown): boolean => err instanceof DrainAbortError || ctx.cancelled === true

/** A child route's answer that the run cannot pay (`UGC_SPEND_REFUSAL_CODES`): a credits stop, never a failed option. */
const isSpendRefusal = (err: unknown): boolean => {
  const { status, code } = (err ?? {}) as { status?: unknown; code?: unknown }
  return typeof status === "number" && typeof code === "string" && UGC_SPEND_REFUSAL_CODES.has(code)
}

/**
 * A credits stop as the node's failure — the standard one: the refusing route's message and
 * code (`errorCode`), retaining what is already checked (UGC Creator's options) and the 402's
 * shortfall when it names one.
 */
function spendStop(refusal: unknown, candidates: readonly UgcCreatorCandidate[] = []): Error {
  const r = (refusal ?? {}) as { message?: unknown; code?: unknown; body?: unknown }
  const shortfall = shortfallOf(r.body)
  const output: NodeOutput = {
    ...(candidates.length > 0 ? { ugcCandidates: candidates } : {}),
    ...(shortfall ? { ugcShortfall: shortfall } : {}),
  }
  return Object.assign(new Error(typeof r.message === "string" ? r.message : "Insufficient credits"), {
    errorCode: typeof r.code === "string" ? r.code : "insufficient_credits",
    ...(Object.keys(output).length > 0 ? { output } : {}),
  })
}

/**
 * The seed a sampled creator nobody pinned draws with on a run, fixed by the node's own
 * idempotency key (the execution, the sub-workflow path, the node and its fan-out iteration). A
 * re-pick of the run asks the builder for the SAME creator, so it sends the same child requests,
 * which the routes hand back by their keys instead of selling them again; every new run draws a
 * new creator. A re-roll's seed is the next one, so it is fixed by the round as well. A seed the
 * builder takes: an integer in [0, 2^31).
 */
export function ugcRunSeed(nodeKey: string): number {
  return Number.parseInt(createHash("sha256").update(`ugc-creator-seed:${nodeKey}`).digest("hex").slice(0, 8), 16) % 2 ** 31
}

/**
 * UGC Creator on the orchestrator. A photo: the builder's photo check on the photo, which then
 * is the creator. A sampled creator: the round (`runUgcCreatorRound`) — every option where a
 * person picks (`opts.personPicks`), the primary alone elsewhere — drawn with the node's seed,
 * else the run's (`opts.runSeed`, `ugcRunSeed`). Two or more passing options wait for the pick
 * (`ugcCandidates`, no creator wire); one is handed on as a single draw is. A credits stop fails
 * the node with the route's code, retaining the options that passed and the shortfall.
 * `creditsUsed` is every child job's charge: each image, each reading.
 */
export async function runUgcCreator(
  node: SimpleNode,
  inputs: ResolvedInputs,
  ctx: OrchestratorContext,
  deps: UgcDeps,
  opts: { readonly personPicks: boolean; readonly runSeed?: number } = { personPicks: false },
): Promise<ExecuteNodeResult> {
  const ugc = inputs.ugc ?? {}
  const req = ugcCreatorBody({
    data: node.data as UgcCreatorFields,
    photoUrl: asString(ugc.photo),
    category: asString(ugc.category),
    pickers: asObject(ugc.pickers) as Record<string, Record<string, unknown>> | undefined,
  })
  if ("error" in req) throw new Error(req.error)
  // A sampled creator nobody pinned draws the run's own seed, so a re-pick redraws the same one.
  const unpinned = asObject(req.body.source)?.kind === "sampled" && req.body.seed === undefined && typeof opts.runSeed === "number"
  const request: Record<string, unknown> = unpinned ? { ...req.body, seed: opts.runSeed } : req.body
  let credits = 0
  let builderCalls = 0

  const child = async (call: UgcToolCall, image?: string, step?: string): Promise<{ imageUrl?: string; text?: string }> => {
    const mapped = ugcCallToRouteBody(call, image ? { image } : {})
    if (mapped === undefined || "error" in mapped) throw new Error(UGC_NEWER_APP_MESSAGE)
    const res = await deps.post(mapped.path, { ...mapped.body, userId: ctx.userId }, step)
    if (res.status >= 400) throw childRefusal(res.status, res.text)
    const answer = answerOf(res)
    const jobId = jobIdOf(res, answer)
    deps.onJobCreated(jobId)
    if (typeof answer.generatedText === "string") {
      // The reading answers in the call itself and commits its own charge without mirroring
      // credits_actual: the charge is read off its row.
      const charge = await deps.jobCharge(jobId)
      credits += charge
      return { text: answer.generatedText }
    }
    // An image job — or a reading the route handed back by its key (a resumed run): the job's own result.
    const polled = await deps.poll(jobId, CHILD_JOB_TYPE[mapped.path])
    // Awaited BEFORE the sum: options settle side by side, and `credits += await …` would lose one.
    const charge = polled.creditsUsed ?? (await deps.jobCharge(jobId))
    credits += charge
    return { imageUrl: polled.output.imageUrl, text: polled.output.text }
  }
  const builder = async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
    // The node's own call first; the round's re-call is a call of its own.
    const step = builderCalls === 0 ? undefined : `builder-${builderCalls}`
    builderCalls++
    const res = await deps.post(UGC_SYNC_ROUTES["ugc-creator"]!, { ...body, userId: ctx.userId }, step)
    if (res.status >= 400) throw new Error(ugcFailure(res.status, res.text))
    return answerOf(res)
  }

  const draw = async (): Promise<ExecuteNodeResult> => {
    const answer = await builder(request)
    if (answer.kind === "photo") {
      const photo = asString(asObject(request.source)?.imageUrl)
      // A photo is handed on only once its check passed: an answer whose check the app cannot run is refused.
      const check = ugcCreatorCheck(answer.photoCheck)
      if (!check || !photo) throw new Error(UGC_NEWER_APP_MESSAGE)
      const read = await child(check, photo, "photo-check").catch((err: unknown) => {
        throw isSpendRefusal(err) ? spendStop(err) : err
      })
      if (!ugcCreatorCheckPasses(read.text, check)) throw new Error(check.refusal)
      const out = ugcCreatorOutputs(answer, [photo])
      return { output: { ugcOutputs: out.outputs, imageUrl: out.imageUrl }, creditsUsed: credits }
    }

    let round: UgcCreatorRoundResult
    try {
      round = await runUgcCreatorRound(answer, request, { child, builder, isInsufficientCredits: isSpendRefusal, isAbort: runStops(ctx) }, opts)
    } catch (err) {
      if (err instanceof UgcCreatorRoundStopped) throw spendStop(err.refusal, err.candidates)
      throw err
    }
    const note = round.optionFailed ? { ugcOptionFailed: true } : {}
    if (round.kind === "pick") return { output: { ugcCandidates: round.candidates, ...note }, creditsUsed: credits }
    const out = ugcCreatorOutputs(round.answer, round.images)
    return { output: { ugcOutputs: out.outputs, imageUrl: out.imageUrl, ...note }, creditsUsed: credits }
  }
  try {
    return await draw()
  } catch (err) {
    // A creator that fails still reports what its paid images and readings were charged.
    throw withChargedCredits(err, credits)
  }
}

/**
 * A person can pick among a creator's options: the editor's own run (a reviewer present), never
 * an app run, a fan-out iteration or a node inside a sub-workflow — nobody sees that graph, so it
 * never waits.
 */
export function ugcPersonPicks(
  ctx: Pick<OrchestratorContext, "reviewerPresent" | "isAppRun">,
  iterationIndex?: number,
  idempotencyScope?: readonly string[],
): boolean {
  return ctx.reviewerPresent === true && !ctx.isAppRun && iterationIndex === undefined && (idempotencyScope?.length ?? 0) === 0
}

/**
 * UGC Cards on the orchestrator: the free categories call first (no plugin → nothing paid
 * starts), then the two timing jobs on the joined video side by side — a forced alignment of the
 * transcript and a word-timed transcription — then the cards from whichever came back (`failed`
 * names the others) and the clips' notes. A timing job the run cannot pay for fails the node with
 * the standard credits stop instead. `creditsUsed` is the timing jobs' charge.
 */
export async function runUgcCards(node: SimpleNode, inputs: ResolvedInputs, ctx: OrchestratorContext, deps: UgcDeps): Promise<ExecuteNodeResult> {
  const pre = await deps.get("/v1/ugc/categories")
  if (pre.status >= 400) throw new Error(ugcFailure(pre.status, pre.text))
  const ugc = inputs.ugc ?? {}
  const videoUrl = asString(ugc.video)
  const jobs = ugcCardsJobs({ planOutWire: ugc.plan, videoUrl, transcript: asString(ugc.transcript) })
  if ("error" in jobs) throw new Error(jobs.error)
  let credits = 0
  const timing = async (path: string, body: Record<string, unknown>, nodeType: string, step: string): Promise<NodeOutput> => {
    const res = await deps.post(path, { ...body, userId: ctx.userId }, step)
    if (res.status >= 400) throw childRefusal(res.status, res.text)
    const jobId = jobIdOf(res, answerOf(res))
    deps.onJobCreated(jobId)
    const polled = await deps.poll(jobId, nodeType)
    // Awaited BEFORE the sum: the two timing jobs settle side by side.
    const charge = polled.creditsUsed ?? (await deps.jobCharge(jobId))
    credits += charge
    return polled.output
  }
  const make = async (): Promise<ExecuteNodeResult> => {
    const [aligned, heard] = await Promise.allSettled([
      timing(jobs.alignment.path, jobs.alignment.body, "forced-alignment", "alignment"),
      timing(jobs.transcribe.path, jobs.transcribe.body, "transcribe", "transcribe"),
    ])
    // A stopping run is never a timing job that failed: the node stops with it.
    const stops = runStops(ctx)
    for (const settled of [aligned, heard]) if (settled.status === "rejected" && stops(settled.reason)) throw settled.reason
    // A run that cannot pay for a timing job fails the node with the standard credits stop: the
    // cards are never made without their captions.
    for (const settled of [aligned, heard]) if (settled.status === "rejected" && isSpendRefusal(settled.reason)) throw spendStop(settled.reason)
    const failed = [...(aligned.status === "rejected" ? ["alignment" as const] : []), ...(heard.status === "rejected" ? ["words" as const] : [])]
    const body = ugcCardsBody({
      plan: jobs.plan,
      videoUrl: jobs.alignment.body.audioUrl as string,
      alignment: aligned.status === "fulfilled" ? aligned.value.alignment : undefined,
      words: heard.status === "fulfilled" ? asObject(heard.value.json)?.words : undefined,
      failed,
      clipNotes: (inputs.clipNotes ?? []) as ClipNote[],
    })
    const res = await deps.post(UGC_SYNC_ROUTES["ugc-cards"]!, { ...body, userId: ctx.userId })
    if (res.status >= 400) throw new Error(ugcFailure(res.status, res.text))
    const outputs = ugcCardsOutputs(answerOf(res))
    // The Notes are also the node's text: what a published app's Notes card and the API's run
    // result read (`output.text`), as the editor's canvas reads `generatedText`.
    return { output: { ugcOutputs: outputs, text: outputs.report }, creditsUsed: credits }
  }
  try {
    return await make()
  } catch (err) {
    // The node fails, and still reports what its timing jobs were charged.
    throw withChargedCredits(err, credits)
  }
}

// ── UGC Clips and UGC Finish on a video cut from one recorded speech ─────────

/** What UGC Clips' runner reads of the graph: whether a UGC Finish takes its Script (sized) output. */
export interface UgcGraph {
  readonly nodes: ReadonlyArray<{ readonly id?: string; readonly type?: string | null }>
  readonly edges: ReadonlyArray<{ readonly source?: string; readonly target?: string; readonly sourceHandle?: string | null; readonly targetHandle?: string | null }>
}

/**
 * UGC Clips on the orchestrator. The node's own call first; an answer with no phase (one call) is the
 * node's output, as before. A phase-1 answer (a video cut from one recorded speech): refused before anything
 * is spent when no UGC Finish takes this node's Script (sized) output; else the three steps run as child jobs
 * keyed by their step — record the speech, time its words, split it at its pauses — and the second call,
 * with the segments, answers the clips. `creditsUsed` is the three jobs' charge (the node's own calls are free).
 */
export async function runUgcClips(node: SimpleNode, inputs: ResolvedInputs, ctx: OrchestratorContext, deps: UgcDeps, graph: UgcGraph): Promise<ExecuteNodeResult> {
  const body = buildUgcSyncBody(node, inputs, ctx)
  const route = UGC_SYNC_ROUTES["ugc-clips"]!
  const first = await deps.post(route, body)
  if (first.status >= 400) throw new Error(ugcFailure(first.status, first.text))
  const answer = answerOf(first)
  if (ugcClipsPhase(answer) !== 1) return { output: ugcSyncOutput("ugc-clips", answer) }
  // An answer with errors is the script's refusal, worded as English's is, before any step.
  if (Array.isArray(answer.errors) && answer.errors.length > 0) return { output: ugcSyncOutput("ugc-clips", answer) }
  const refused = ugcLaneNeedsFinish(graph.edges, graph.nodes, node.id)
  if (refused) throw new Error(refused)
  const prelude = ugcPrelude(answer)
  if ("error" in prelude) throw new Error(prelude.error)
  // The video's estimate input for the hold check, read now: a plan it cannot read refuses before any spend.
  const estimateInput = ugcRunEstimateInput(body.plan)
  if ("error" in estimateInput) throw new Error(estimateInput.error)
  let credits = 0
  const step = async (name: UgcPreludeStep, stepBody: Record<string, unknown>): Promise<unknown> => {
    const { path, jobType } = UGC_PRELUDE_ROUTES[name]
    const res = await deps.post(path, { ...stepBody, userId: ctx.userId }, name)
    if (res.status >= 400) throw childRefusal(res.status, res.text)
    const jobId = jobIdOf(res, answerOf(res))
    deps.onJobCreated(jobId)
    const polled = await deps.poll(jobId, jobType)
    credits += polled.creditsUsed ?? (await deps.jobCharge(jobId))
    const read = ugcPreludeOutput(name, (name === "split" ? polled.output.json : polled.output) as Record<string, unknown> | undefined)
    if ("error" in read) throw new Error(read.error)
    return read.value
  }
  const make = async (): Promise<ExecuteNodeResult> => {
    const audioUrl = (await step("speech", prelude.speech)) as string
    const alignment = await step("alignment", prelude.alignment(audioUrl))
    const segments = (await step("split", prelude.split(audioUrl, alignment))) as unknown[]
    const second = await deps.post(route, ugcClipsPhase2Body(body, segments), "phase-2")
    if (second.status >= 400) throw new Error(ugcFailure(second.status, second.text))
    const clips = answerOf(second)
    await checkRenderHold(estimateInput.runEstimate, clips, deps)
    return { output: ugcSyncOutput("ugc-clips", clips), creditsUsed: credits }
  }
  try {
    return await make()
  } catch (err) {
    // A credits stop on a step is the standard one; any failure still reports what the steps were charged.
    throw withChargedCredits(isSpendRefusal(err) ? spendStop(err) : err, credits)
  }
}

/**
 * Before any clip of a video cut from one recorded speech renders: its clips, priced as they will be held,
 * against the most the video's estimate holds for them (what the run's balance was checked against before
 * it started). Over it, or with no figure to compare, the node fails here and no clip is admitted; the
 * speech steps stay charged. An answer that refuses the script is left to `ugcSyncOutput`, which words it.
 */
async function checkRenderHold(runEstimate: UgcRunEstimateInput, clips: Record<string, unknown>, deps: UgcDeps): Promise<void> {
  const read = ugcClipsOutputs(clips)
  if ("error" in read) return
  const hold = ugcRenderHoldBody({ runEstimate, tickets: clips.tickets, hasCards: read.hasCards, finishes: read.finishes })
  if ("error" in hold) throw new Error(hold.error)
  const res = await deps.post(hold.path, hold.body, "hold-check")
  if (res.status >= 400) throw new Error(ugcFailure(res.status, res.text))
  const verdict = ugcRenderHoldVerdict(parseJson(res.text))
  if ("error" in verdict) throw new Error(verdict.error)
}

/**
 * UGC Finish on the orchestrator. Its clips are the fan-in list, in clip order (`inputs.inputs`); its plan is
 * UGC Clips' Script (sized) output. No finish call on the plan: the clips go on as they came — no call, no job,
 * no charge. Else one finish job over all of them; its answer is the finished clips in order, each with its
 * real length, handed on as the node's list (`listResults`, `listResultMeta`), the first as its video.
 */
export async function runUgcFinish(node: SimpleNode, inputs: ResolvedInputs, ctx: OrchestratorContext, deps: UgcDeps): Promise<ExecuteNodeResult> {
  const plan = ugcFinishPlan({ planOutWire: inputs.ugc?.plan, clipUrls: inputs.inputs ?? [] })
  if ("error" in plan) throw new Error(plan.error)
  if (plan.kind === "pass") {
    return { output: { listResults: [...plan.clips], listResultMeta: plan.clips.map(() => ({ warnings: [], durationSec: null })), videoUrl: plan.clips[0] } }
  }
  let credits = 0
  const make = async (): Promise<ExecuteNodeResult> => {
    const res = await deps.post(plan.path, { ...plan.body, userId: ctx.userId }, "finish")
    if (res.status >= 400) throw childRefusal(res.status, res.text)
    const jobId = jobIdOf(res, answerOf(res))
    deps.onJobCreated(jobId)
    const polled = await deps.poll(jobId, "ugc-finish")
    credits += polled.creditsUsed ?? (await deps.jobCharge(jobId))
    const read = ugcFinishOutputs(polled.output.json as Record<string, unknown> | undefined)
    if ("error" in read) throw new Error(read.error)
    const urls = read.clips.map((c) => c.url)
    return { output: { listResults: urls, listResultMeta: read.clips.map((c) => c.meta), videoUrl: urls[0] }, creditsUsed: credits }
  }
  try {
    return await make()
  } catch (err) {
    throw withChargedCredits(isSpendRefusal(err) ? spendStop(err) : err, credits)
  }
}
