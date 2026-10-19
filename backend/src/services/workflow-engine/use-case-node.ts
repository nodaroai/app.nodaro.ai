/**
 * A use-case node (Tighten Episode and the rest, decided 2026-10-13/14) inside a workflow on
 * the backend engine: one job node that calls its route on the internal lane
 * (use-case-request.ts) and waits on the wrapper job the route answers with —
 * the executeComponentNode wait (a budgeted deadline, cancel, drain), plus:
 *
 *  - an Idempotency-Key from the execution, the node, its fan-out iteration
 *    and its sub-workflow scope: a re-picked run sends the same key and the
 *    route hands back the SAME wrapper (one run, one fee); every fan-out item
 *    is a key, a wrapper and a fee of its own. The wrapper never names the
 *    outer execution — the node state's job pointer (`onJobCreated`) is how
 *    the run finds it, and the wait reads the execution's status itself, so a
 *    cancel of the run reaches the wrapper.
 *  - a wrapper is this node's OWN when this call started it or this node's
 *    key did (a crash re-pick): only an own wrapper's credits are this run's,
 *    and only an own wrapper is cancelled when the node stops waiting.
 *  - a continue answered "already running" waits on the continuation named;
 *    one answered "superseded" (a newer generation failed too) continues
 *    that one, as does a waited-on continuation that fails; one still
 *    settling is asked again.
 *  - a continued outer run (`ctx.continuedFromStates`) whose earlier run of
 *    this node failed continues that node's inner run from where it failed
 *    (its fee once overall) — but only when the node's inputs and settings
 *    are still the ones that attempt ran with (failed-attempt.ts
 *    `attemptRanWithInputs`, asked first, before the route is called): a
 *    changed recording, music or setting runs the node fresh instead, charged
 *    once for that run, and so does an attempt whose wrapper or graph is gone
 *    (or never started). When the route says there is nothing to continue,
 *    the recorded wrapper decides: done → its result (paid in the run being
 *    continued), still running → waited on; a run that started and stopped →
 *    the node fails, nothing charged (a fresh run would pay again for steps
 *    already paid for); never started, or gone → a fresh run.
 */
import { CONTINUATION_NOT_FAILED, CONTINUATION_NOT_FOUND, CONTINUATION_SUBSET_REQUIRED, CONTINUATION_SUPERSEDED } from "@nodaro/shared/nodes"
import { isUseCaseNodeType, usecaseCancelledMessage, usecaseDescriptor } from "@nodaro/render-rules"
import { supabase } from "../../lib/supabase.js"
import { BudgetedDeadline, executionBudgetExcessMs } from "../../lib/execution-budget.js"
import { addBudgetExcess } from "../../lib/job-budget.js"
import { DrainAbortError, isWorkerDraining } from "../../lib/worker-drain.js"
import { cancelOwnedJob } from "../../lib/cancel-job.js"
import { IN_FLIGHT_JOB_STATUSES } from "../../lib/job-status.js"
import { USE_CASE_MAX_DEPTH } from "../../lib/use-case/lanes.js"
import { usecaseMulticamAvailable } from "../../lib/use-case/inner-availability.js"
import { syncHttpIdempotencyKey } from "./idempotency-key.js"
import { retainedOutputOfFailedJob } from "./failed-node-output.js"
import { usecaseJobOutput } from "./use-case-output.js"
import { executionCancelledNow } from "./execution-cancel-check.js"
import { askRoute, coded, continuingGeneration, failedAttemptOf, freshRunInputs, requestOf, type CodedError, type UseCaseRequest } from "./use-case-request.js"
import { attemptMediaKind, attemptRanWithInputs } from "./failed-attempt.js"
import { loadExecutionForWrapper } from "../../lib/execution-inline-graph.js"
import type { UseCaseNodeType } from "@nodaro/render-rules"
import { JOB_POLL_INTERVAL_MS, POLL_ABSOLUTE_TIMEOUT_MS, type NodeOutput, type OrchestratorContext, type ResolvedInputs, type SimpleNode } from "./types.js"

/** How long a continue answered "still settling" (or a wrapper not written yet) waits before it asks again. */
export const USE_CASE_SETTLING_RETRY_MS = 5_000
/** How many newer failed generations a continue follows before it gives up. */
export const MAX_GENERATION_HOPS = 5
/** A continue refused with one of these had nothing to continue. */
const NOTHING_TO_CONTINUE: ReadonlySet<string> = new Set(["not_found", CONTINUATION_NOT_FOUND, CONTINUATION_NOT_FAILED, CONTINUATION_SUBSET_REQUIRED])
const IN_FLIGHT: ReadonlySet<string> = new Set(IN_FLIGHT_JOB_STATUSES)

type Result = { output: NodeOutput; jobId: string; creditsUsed: number }
interface WrapperRow {
  status: string
  output_data: unknown
  error_message: string | null
  credits_actual: unknown
  idempotency_key: string | null
  input_data: unknown
}
/** The wrapper waited on: whether this call started it, and whether it is this node's own (null: not read yet). */
interface Target {
  readonly jobId: string
  readonly startedHere: boolean
  own: boolean | null
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A wrapper row, `undefined` when the read failed (try again), `null` when there is none. */
async function readWrapper(jobId: string, userId: string): Promise<WrapperRow | null | undefined> {
  const { data, error } = await supabase
    .from("jobs")
    .select("status, output_data, error_message, credits_actual, idempotency_key, input_data")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) return undefined
  return (data as WrapperRow | null) ?? null
}

/** Whether a wrapper's run ever started: its run stamped on its input or its output (the continue route's own rule). */
function runStarted(row: WrapperRow): boolean {
  return runOf(row) !== null
}

/**
 * A completed wrapper's output as the node hands it on. Each row of a list
 * result (Trailer's formats) names the wrapper as its job: a Render final of
 * a server-run take needs a real run to name.
 */
export function wrapperOutputOf(outputData: unknown, jobId: string): NodeOutput {
  return usecaseJobOutput((outputData ?? {}) as Record<string, unknown>, jobId)
}

/** What a node continuing a run that can't be resumed says when the run left no message. */
export const CANNOT_CONTINUE_MESSAGE = "This run can't be continued — run the workflow again to start it fresh"

/**
 * How the node's own failures name it: its type's label (Tighten Episode,
 * Chapters, Trailer) — the editor shows the cancelled one in the reader's
 * language (`usecaseCancelledMessage`, matched there word for word).
 */
export function usecaseNodeLabel(type: string): string {
  return isUseCaseNodeType(type) ? usecaseDescriptor(type).label : type
}

/** The run a wrapper started, as its input (the start's stamp) or its output (the finaliser's) names it. */
function runOf(row: WrapperRow): string | null {
  for (const v of [row.input_data, row.output_data]) {
    const id = (v as Record<string, unknown> | null | undefined)?._executionId
    if (typeof id === "string" && id.length > 0) return id
  }
  return null
}

/**
 * May the failed attempt `jobId` be resumed: did it run with what the node
 * would run with now (failed-attempt.ts)? Also what a continued run's
 * up-front credit check asks of the node (lib/use-case/resume-credits.ts), so
 * the run is priced on the decision it will make. `undefined` when its wrapper or its
 * run could not be read (asked again — a read error is never a fresh run,
 * which would pay again for steps already paid for). `false` for a wrapper
 * that is gone or whose run never started (nothing to resume), a run whose
 * graph is gone, a node with no recording wired, or any input or setting that
 * differs.
 */
export async function attemptStillApplies(
  jobId: string,
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
  userId: string,
  /** Whether the run's viewer may use Speaker Map: what a fresh run of the node would read (`freshRunInputs`). */
  multicam = false,
): Promise<boolean | undefined> {
  const row = await readWrapper(jobId, userId)
  if (row === undefined) return undefined
  const run = row ? runOf(row) : null
  if (!row || !run) return false
  const type = node.type as UseCaseNodeType
  let execution: Awaited<ReturnType<typeof loadExecutionForWrapper>>
  try {
    execution = await loadExecutionForWrapper(run)
  } catch {
    return undefined
  }
  const graph = execution && execution.userId === userId ? execution.inlineGraph : null
  const ranWith = (row.input_data && typeof row.input_data === "object" ? row.input_data : {}) as Record<string, unknown>
  const kind = graph ? attemptMediaKind(type, graph, ranWith) : null
  if (!kind) return false
  let now: Record<string, unknown>
  try {
    now = freshRunInputs(node, resolvedInputs, multicam)
  } catch {
    return false
  }
  return attemptRanWithInputs(type, ranWith, kind, now)
}

/** The run a wrapper job started — stamped on its `input_data._executionId` by the route. */
async function innerExecutionIdOf(jobId: string): Promise<string | null> {
  const { data } = await supabase.from("jobs").select("input_data").eq("id", jobId).maybeSingle()
  const id = (data?.input_data as Record<string, unknown> | null | undefined)?._executionId
  return typeof id === "string" ? id : null
}

export async function executeUseCaseNode(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
  ctx: OrchestratorContext,
  iterationIndex?: number,
  idempotencyScope: readonly string[] = [],
): Promise<Result> {
  const depth = ctx.componentDepth ?? 0
  if (depth >= USE_CASE_MAX_DEPTH) {
    throw new Error(`Component nesting depth exceeded (max ${USE_CASE_MAX_DEPTH}). Current depth: ${depth}`)
  }
  const key = syncHttpIdempotencyKey(ctx.executionId, node.id, iterationIndex, idempotencyScope)
  const label = usecaseNodeLabel(node.type)
  const failedAttempt = failedAttemptOf(node, ctx, iterationIndex, idempotencyScope)
  // Several recordings and a Master audio are read only for a viewer who may use Speaker Map (decided 2026-10-19).
  const multicam = await usecaseMulticamAvailable(ctx.userId)
  let request: UseCaseRequest = requestOf(node, resolvedInputs, ctx, failedAttempt, multicam)
  /** A failed attempt this call would resume, not yet held to the node's current inputs. */
  let attemptToCheck = failedAttempt !== null && request.fallback ? failedAttempt : null
  let target: Target | undefined
  /** The recorded wrapper to read, and the route's answer, after the route found nothing to continue. */
  let recorded: { readonly jobId: string; readonly code: string } | undefined
  let hops = 0
  let pollCycle = 0

  const deadline = new BudgetedDeadline(POLL_ABSOLUTE_TIMEOUT_MS, async () => {
    const inner = target ? await innerExecutionIdOf(target.jobId) : null
    return inner ? executionBudgetExcessMs(inner, ctx.userId) : 0
  })
  const follow = (jobId: string, startedHere: boolean, own: boolean | null) => {
    target = { jobId, startedHere, own }
    ctx.onJobCreated?.(node.id, jobId)
  }
  const hop = (jobId: string, message: string) => {
    if (++hops > MAX_GENERATION_HOPS) throw coded(message, CONTINUATION_SUPERSEDED)
    request = continuingGeneration(request, jobId)
    target = undefined
  }
  // Stopping: only this node's own wrapper is cancelled (another request's run is left to it).
  // An adopted wrapper not read yet is read once to tell.
  const stop = async () => {
    if (!target) return
    if (target.own === null) {
      const row = await readWrapper(target.jobId, ctx.userId).catch(() => undefined)
      if (row) target.own = row.idempotency_key === key
    }
    if (target.own === true) await cancelOwnedJob(target.jobId, ctx.userId).catch(() => undefined)
  }

  const startedAt = Date.now()
  while (!(await deadline.reached(Date.now() - startedAt))) {
    if (ctx.cancelled) {
      await stop()
      throw new Error(usecaseCancelledMessage(label))
    }
    let wait = USE_CASE_SETTLING_RETRY_MS
    if (recorded) {
      // The route found nothing to continue: the recorded wrapper decides.
      const row = await readWrapper(recorded.jobId, ctx.userId)
      if (row?.status === "completed") {
        // Done (and paid) in the run being continued: its result, none of its credits.
        return { output: wrapperOutputOf(row.output_data, recorded.jobId), jobId: recorded.jobId, creditsUsed: 0 }
      }
      if (row && IN_FLIGHT.has(row.status)) {
        follow(recorded.jobId, false, row.idempotency_key === key)
        recorded = undefined
        continue
      }
      if (row && runStarted(row)) {
        // Its run started and can't be resumed: the node fails, nothing is
        // charged (decided 2026-10-13) — a fresh run would pay again for
        // steps that run already paid for.
        throw coded(row.error_message ?? CANNOT_CONTINUE_MESSAGE, recorded.code, retainedOutputOfFailedJob(row.output_data, node.type))
      }
      if (row !== undefined) {
        // Never started, or gone: a fresh run.
        request = request.fallback!()
        recorded = undefined
        continue
      }
    } else if (attemptToCheck) {
      // The attempt is resumed only on the inputs it ran with; else a fresh run.
      const applies = await attemptStillApplies(attemptToCheck, node, resolvedInputs, ctx.userId, multicam)
      if (applies !== undefined) {
        attemptToCheck = null
        if (!applies) request = request.fallback!()
        continue
      }
    } else if (!target) {
      let answer
      try {
        answer = await askRoute(request, key, ctx)
      } catch (err) {
        const code = (err as CodedError).errorCode
        if (request.fallback && code && NOTHING_TO_CONTINUE.has(code)) {
          recorded = { jobId: String(request.body.jobId), code }
          continue
        }
        throw err
      }
      if (answer.kind === "started") follow(answer.jobId, true, true)
      else if (answer.kind === "running") follow(answer.jobId, false, null)
      else if (answer.kind === "superseded") hop(answer.jobId, answer.message)
      if (answer.kind !== "settling") continue
    } else {
      wait = JOB_POLL_INTERVAL_MS
      const row = await readWrapper(target.jobId, ctx.userId)
      if (row === null) {
        // A continuation named while its claim is taken may not have its row
        // yet: ask the route again. A wrapper this call started is gone.
        if (target.startedHere) throw new Error(`${label} job not found`)
        target = undefined
        wait = USE_CASE_SETTLING_RETRY_MS
      } else if (row) {
        if (target.own === null) target.own = row.idempotency_key === key
        if (row.status === "completed") return completed(target, row, deadline.excessMs)
        if (row.status === "failed" && !target.startedHere) {
          // A continuation this node did not start failed: continue it in turn.
          hop(target.jobId, row.error_message ?? `${label} failed`)
          continue
        }
        if (row.status === "failed" || row.status === "cancelled") {
          // What the run made before it stopped (its plan, its transcript) stays on the failed node state.
          const kept = retainedOutputOfFailedJob(row.output_data, node.type)
          throw coded(row.error_message ?? (row.status === "cancelled" ? usecaseCancelledMessage(label) : `${label} failed`), undefined, kept)
        }
      }
      // (a read that failed is asked again on the next turn)
    }
    // Every wait — a poll, a settling retry, a read retried — asks whether the run was cancelled.
    if (await executionCancelledNow(ctx, ++pollCycle)) {
      await stop()
      throw new Error(usecaseCancelledMessage(label))
    }
    if (isWorkerDraining()) throw new DrainAbortError()
    await sleep(wait)
  }
  await stop()
  throw new Error(`${label} timed out after ${Math.round(deadline.limitMs / 60000)} minutes`)

  async function completed(t: Target, row: WrapperRow, excessSoFar: number): Promise<Result> {
    const out = (row.output_data ?? {}) as Record<string, unknown>
    const inner = typeof out._executionId === "string" ? out._executionId : null
    addBudgetExcess(ctx, Math.max(excessSoFar, inner ? await executionBudgetExcessMs(inner, ctx.userId) : 0))
    // Another request's continuation was paid there, not by this run.
    const credits = t.own && typeof row.credits_actual === "number" ? row.credits_actual : 0
    return { output: wrapperOutputOf(out, t.jobId), jobId: t.jobId, creditsUsed: credits }
  }
}
