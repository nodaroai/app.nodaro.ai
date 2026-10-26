/**
 * A workflow node's charge includes its job's STEPS (child jobs, billed on
 * their own) through the one run loader (`runCreditsFor`). The node executor
 * adds what has settled when the node's job completes — but a worker marks a
 * job completed before it commits the job's credits, so a step can settle a
 * moment AFTER its parent completed, and a read of the steps can fail. Neither
 * may freeze a partial figure into the execution total, the app-run total or a
 * monetized app's creator fee base.
 *
 * So the executor NOTES, per job, what it counted (`noteStepCharges`), and when
 * the run ends the orchestrator SETTLES them (`settleRunStepCharges`): it reads
 * again every job whose steps were not all settled and read, plus every failed
 * node's job (whose steps the executor never counted), waits a bounded time for
 * a step still held to settle, and adds the difference to the node and to the
 * run's total. Jobs already final cost no read.
 */
import { runCreditsFor, runCreditsOf, type RunCredits } from "../../lib/job-credit-status.js"
import type { NodeExecutionState, OrchestratorContext } from "./types.js"

type StepNotes = Pick<OrchestratorContext, "stepCharges">

/** Record what a node's figure counted of `jobId`'s steps (`credits` from `runCreditsFor`). */
export function noteStepCharges(ctx: StepNotes, jobId: string | null | undefined, credits: RunCredits): void {
  if (!jobId) return
  const figures = runCreditsOf(jobId, credits)
  const notes = (ctx.stepCharges ??= new Map())
  const prev = notes.get(jobId)
  notes.set(jobId, {
    included: (prev?.included ?? 0) + (figures?.stepsCharged ?? 0),
    final: !!figures && figures.complete && figures.stepsSettled,
  })
}

/** How long the run's end waits for a step still held: a worker commits right after it completes the job. */
export const STEP_SETTLE_ATTEMPTS = 5
export const STEP_SETTLE_DELAY_MS = 1_000

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The job ids a node state names. */
const jobIdsOf = (state: NodeExecutionState | undefined): string[] =>
  [state?.jobId, ...(state?.jobIds ?? [])].filter((id): id is string => typeof id === "string" && id.length > 0)

/**
 * Bring every node's step charges up to date before the run's totals are
 * written. Returns what to add to the run's total (the sum of the differences);
 * each node it can name gets its own difference added to its `creditsUsed` in
 * `nodeStates` (replaced, never mutated). A job whose steps still cannot be
 * read after the bounded retries keeps what was counted — logged, never a
 * guess.
 */
export async function settleRunStepCharges(
  ctx: StepNotes & Pick<OrchestratorContext, "userId">,
  nodeStates: Record<string, NodeExecutionState>,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<number> {
  const notes = (ctx.stepCharges ??= new Map())
  const pending = new Set<string>()
  for (const [jobId, note] of notes) if (!note.final) pending.add(jobId)
  // A failed node's job: its steps were never counted (it did not complete).
  for (const state of Object.values(nodeStates)) {
    if (state?.status !== "failed") continue
    for (const id of jobIdsOf(state)) if (!notes.get(id)?.final) pending.add(id)
  }
  if (pending.size === 0) return 0

  const attempts = Math.max(1, opts.attempts ?? STEP_SETTLE_ATTEMPTS)
  const delayMs = opts.delayMs ?? STEP_SETTLE_DELAY_MS
  const ids = [...pending]
  let credits = await runCreditsFor(ids.map((id) => ({ id })), ctx.userId)
  for (let attempt = 1; attempt < attempts; attempt++) {
    const figures = ids.map((id) => runCreditsOf(id, credits))
    // A step still held: give its worker a moment to commit. A read that
    // failed: try again at once (nothing to wait for).
    const held = figures.some((f) => !!f && f.complete && !f.stepsSettled)
    const unread = figures.some((f) => !f || !f.complete)
    if (!held && !unread) break
    if (held) await sleep(delayMs)
    credits = await runCreditsFor(ids.map((id) => ({ id })), ctx.userId)
  }

  let total = 0
  for (const id of ids) {
    const f = runCreditsOf(id, credits)
    if (!f || !f.complete) {
      console.warn(`[run-step-charges] the steps of job ${id} could not be read: its node keeps what was counted`)
      continue
    }
    const note = notes.get(id)
    const delta = (f.stepsCharged ?? 0) - (note?.included ?? 0)
    notes.set(id, { included: f.stepsCharged ?? 0, final: f.stepsSettled })
    if (!f.stepsSettled) console.warn(`[run-step-charges] a step of job ${id} is still held at the run's end: counted once it settled, it is not in this total`)
    if (delta === 0) continue
    total += delta
    const nodeId = Object.keys(nodeStates).find((n) => jobIdsOf(nodeStates[n]).includes(id))
    if (nodeId) {
      const state = nodeStates[nodeId]!
      nodeStates[nodeId] = { ...state, creditsUsed: (state.creditsUsed ?? 0) + delta }
    }
  }
  return total
}
