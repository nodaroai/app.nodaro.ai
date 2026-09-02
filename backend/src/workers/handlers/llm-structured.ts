/**
 * `llm-structured` — the async twin of POST /v1/llm/structured. The route
 * (`routes/llm-structured-jobs.ts`) inserted the row, reserved the LLM
 * credits and, for a movie run, created a `video-analysis` child through the
 * analysis route; this handler waits for the child, composes the input, runs
 * the completion and completes the row. Handler body: see below (Task 6).
 */
import type { Job } from "bullmq"
import { stripDerivedAnalysisFields, videoAnalysisResultSchema, LLM_TEXT_INPUT_MAX, type VideoAnalysisResult } from "@nodaro/shared"
import { supabase } from "../../lib/supabase.js"
import { markProviderCallStart } from "../../lib/reconcile/persistence.js"
import { throwIfJobCancelled } from "../../lib/job-cancellation.js"
import { commitReservedCreditsForJob } from "../../lib/credits-job-lifecycle.js"
import { prepareStructuredRequest, runStructuredCompletion } from "../../lib/llm-structured-request.js"
import { markJobCompleted, setJobProgress, type HandlerFn, type JobContext } from "../shared.js"
import type { LlmStructuredBody } from "../../lib/llm-structured-request.js"

/** The BullMQ `job.data` the route enqueues and this handler reads. The full
 *  `system` / `jsonSchema` ride HERE, not on the row (the row stores a digest
 *  and a size — a 100k-char prompt per row is not something to store; a
 *  1000-entry `removeOnComplete` window in Redis is). */
export interface LlmStructuredJobPayload extends LlmStructuredBody {
  jobId: string
  usageLogId?: string | null
  /** Set by the route for movie runs: the `video-analysis` child to wait on. */
  analysisJobId?: string
}

/** Re-stamp the `pre-task` sentinel this often: the parent may wait 10+
 *  minutes on an analysis and then hold a 240 s LLM window, and the reconcile
 *  sweep fails a `pre-task` row untouched for 30 min (video-analysis
 *  precedent). */
export const LLM_STRUCTURED_HEARTBEAT_MS = 60_000
export const ANALYSIS_POLL_MS = 5_000
/** Longer than recast's 15 min: a 600 s source at the Standard tier is the
 *  slowest analysis a run can wait on. Shorter than the sweep's 30 min. */
export const ANALYSIS_WAIT_BUDGET_MS = 20 * 60_000
/** Progress bands on the parent: the analysis owns 0–70, the draft sits at
 *  75 until completion writes 100. */
const ANALYSIS_PROGRESS_CAP = 70
const DRAFT_PROGRESS = 75

const ANALYSIS_TERMINAL_FAILURE: ReadonlySet<string> = new Set(["failed", "cancelled"])

export interface AnalysisRow {
  status: string
  progress: number | null
  output_data: unknown
  error_message: string | null
  user_id: string | null
  credits: number | null
}

export interface AnalysisWaitDeps {
  /** `null` = the row is genuinely gone. A REJECTION is a transient read
   *  failure — the waiter retries those instead of declaring the child lost. */
  readJob: (id: string) => Promise<AnalysisRow | null>
  onProgress: (pct: number) => Promise<void>
  sleep: (ms: number) => Promise<void>
  now: () => number
}

/**
 * Poll the analysis child until terminal (recast's `waitForAnalysis` shape).
 * Checks the PARENT's cancellation every tick so a cancelled draft stops
 * waiting; mirrors the child's progress into the analysis band; validates
 * the finished result against the canonical schema before handing it on.
 * A failed READ is retried, not reported as absence — see the loop.
 */
export async function waitForAnalysis(
  analysisJobId: string,
  userId: string | undefined,
  deps: AnalysisWaitDeps,
): Promise<{ analysis: VideoAnalysisResult; credits: number | null }> {
  const deadline = deps.now() + ANALYSIS_WAIT_BUDGET_MS
  for (;;) {
    await throwIfJobCancelled()
    if (deps.now() >= deadline) throw new Error("Video analysis did not finish in time")
    let row: AnalysisRow | null
    try {
      row = await deps.readJob(analysisJobId)
    } catch (err) {
      // A transient read failure is NOT absence. Reporting "not found" here
      // would fail and refund the PARENT while the child keeps running and
      // billing; retry instead — the budget checked above still bounds us.
      console.warn(`[worker] analysis read failed for ${analysisJobId}:`, err)
      await deps.sleep(ANALYSIS_POLL_MS)
      continue
    }
    if (!row || (userId && row.user_id !== userId)) throw new Error("Video analysis job not found")
    if (ANALYSIS_TERMINAL_FAILURE.has(row.status)) {
      throw new Error(`Video analysis ${row.status}${row.error_message ? `: ${row.error_message}` : ""}`)
    }
    if (row.status === "completed") {
      const json = (row.output_data as Record<string, unknown> | null)?.json
      const parsed = videoAnalysisResultSchema.safeParse(json)
      if (!parsed.success) throw new Error("Video analysis finished without a readable result")
      return { analysis: parsed.data, credits: row.credits }
    }
    await deps.onProgress(Math.min(ANALYSIS_PROGRESS_CAP, Math.round(((row.progress ?? 0) * ANALYSIS_PROGRESS_CAP) / 100)))
    await deps.sleep(ANALYSIS_POLL_MS)
  }
}

/** The caller's input + the analysis in the ONE compact form both sides
 *  read (`stripDerivedAnalysisFields`, shared). Compact, not pretty-printed:
 *  a 600 s analysis at two-space indentation approaches the 100k-char input
 *  ceiling; whitespace carries no meaning for the mapping. */
export function composeAnalysisInput(input: string, analysis: VideoAnalysisResult): string {
  return `${input}\n\n${JSON.stringify(stripDerivedAnalysisFields(analysis))}`
}

/** The child row, or `null` when it genuinely does not exist (PostgREST's
 *  `single()` "no rows"). Every OTHER read failure THROWS: absence fails the
 *  parent for good, so a transient one must not be spelled the same way. */
async function readAnalysisRow(id: string): Promise<AnalysisRow | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select("status, progress, output_data, error_message, user_id, credits")
    .eq("id", id)
    .single()
  if (error) {
    if (error.code === "PGRST116") return null
    throw new Error(`Failed to read analysis job ${id}: ${error.message}`, { cause: error })
  }
  return (data as AnalysisRow | null) ?? null
}

export const handleLlmStructured: HandlerFn = async function handleLlmStructured(job: Job, ctx: JobContext) {
  const p = job.data as LlmStructuredJobPayload
  const heartbeat = setInterval(() => {
    void markProviderCallStart(ctx.jobId, "pre-task")
  }, LLM_STRUCTURED_HEARTBEAT_MS)
  try {
    // The route already ran this; re-running it here converts the schema
    // for THIS process and keeps the two entry points on one pre-flight.
    const prepared = prepareStructuredRequest(p)
    if (!prepared.ok) throw new Error(prepared.error.message)

    let input = p.input
    let analysisCredits: number | null = null
    if (p.analysisJobId) {
      const waited = await waitForAnalysis(p.analysisJobId, ctx.jobUserId, {
        readJob: readAnalysisRow,
        onProgress: (pct) => setJobProgress(job, ctx.jobId, pct),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: Date.now,
      })
      analysisCredits = waited.credits
      input = composeAnalysisInput(p.input, waited.analysis)
      if (input.length > LLM_TEXT_INPUT_MAX) {
        throw new Error(`The analysis is too long to draft from (${input.length} characters; the limit is ${LLM_TEXT_INPUT_MAX})`)
      }
    }

    await throwIfJobCancelled()
    await supabase
      .from("jobs")
      .update({ output_data: { stage: "drafting", ...(p.analysisJobId ? { analysisJobId: p.analysisJobId } : {}) } })
      .eq("id", ctx.jobId)
    await setJobProgress(job, ctx.jobId, DRAFT_PROGRESS)

    const { output, inputTokens, outputTokens } = await runStructuredCompletion(p, prepared, input)

    // markJobCompleted REPLACES output_data — the ids must ride this write.
    const ok = await markJobCompleted(ctx.jobId, {
      output_data: {
        output,
        inputTokens,
        outputTokens,
        ...(p.analysisJobId ? { analysisJobId: p.analysisJobId } : {}),
        ...(analysisCredits != null ? { analysisCredits } : {}),
      },
    })
    if (!ok) return // cancelled mid-flight — the cancel route owns the refund
    // Flat per tier, exactly as the synchronous route commits.
    await commitReservedCreditsForJob(ctx.jobId)
    console.log(`[worker] Job ${ctx.jobId} completed: llm-structured (${inputTokens} in / ${outputTokens} out${p.analysisJobId ? `, analysis ${p.analysisJobId}` : ""})`)
  } finally {
    clearInterval(heartbeat)
  }
}

export const llmStructuredHandlers: Record<string, HandlerFn> = {
  "llm-structured": handleLlmStructured,
}
