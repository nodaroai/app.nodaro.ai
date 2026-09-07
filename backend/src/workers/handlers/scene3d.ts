/**
 * `generate-3d-scene` / `edit-3d-scene` — the durable half of Scene3D
 * authoring. The route (`routes/3d-scene.ts`) inserted the row, reserved the
 * credits, minted the revision id and — when the request carried a video
 * reference — created a `video-analysis` child through the analysis route.
 * This handler waits for that child, runs the authoring (or, on the
 * deterministic lane, does not call a model at all) and completes the row with
 * `{ scenePlan, changeSummary? }`.
 *
 * The deterministic lane is here rather than in the route on purpose: one
 * completion path, one refund path, one place the job policy sees a Scene3D
 * result. The only difference between the lanes is whether a model is asked.
 */
import type { Job } from "bullmq"
import { LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import type {
  LlmReasoningEffort,
  Scene3DEditOperation,
  Scene3DJobOutput,
  Scene3DPlan,
  Scene3DReference,
  VideoAnalysisResult,
} from "@nodaro/shared"
import { supabase } from "../../lib/supabase.js"
import { commitReservedCreditsForJob } from "../../lib/credits-job-lifecycle.js"
import { throwIfJobCancelled } from "../../lib/job-cancellation.js"
import { markProviderCallStart } from "../../lib/reconcile/persistence.js"
import {
  applyDeterministicScene3DEdit,
  editScenePlan,
  generateScenePlan,
} from "../../services/scene3d/index.js"
import { markJobCompleted, setJobProgress, type HandlerFn, type JobContext } from "../shared.js"
import { waitForAnalysis, type AnalysisRow } from "./llm-structured.js"

/** Re-stamp the reconcile sentinel this often. The parent can wait 20 minutes
 *  on a video analysis and then hold a 240 s authoring window; the sweep fails
 *  a `pre-task` row untouched for 30 minutes. */
export const SCENE3D_HEARTBEAT_MS = 60_000
/** The analysis owns 0–70 on the parent's progress bar; authoring sits at 75
 *  until completion writes 100. */
const ANALYSIS_PROGRESS_CAP = 70
const AUTHORING_PROGRESS = 75
const ANALYSIS_POLL_MS = 5_000

interface Scene3DJobPayloadBase {
  jobId: string
  usageLogId?: string | null
  llmModel?: string
  reasoningEffort?: LlmReasoningEffort
  references: Scene3DReference[]
  /** The revision this job will produce — minted by the route so a re-run and
   *  the route's own dry run agree. */
  revisionId: string
  /** Set when the request carried a video reference: the child to wait on. */
  analysisJobId?: string
  /** Which reference `analysisJobId` describes, so the authoring input
   *  presents THAT clip and not merely the first video on the list. */
  analyzedReferenceId?: string
}

export interface Scene3DGeneratePayload extends Scene3DJobPayloadBase {
  kind: "generate"
  prompt: string
  width: number
  height: number
  fps: number
  durationInFrames: number
}

export interface Scene3DEditPayload extends Scene3DJobPayloadBase {
  kind: "edit"
  plan: Scene3DPlan
  expectedRevisionId: string
  lockedObjectIds: string[]
  selectedObjectIds: string[]
  /** The deterministic lane. Mutually exclusive with `instruction` — the route
   *  refuses a body carrying both. */
  operations?: Scene3DEditOperation[]
  instruction?: string
}

export type Scene3DJobPayload = Scene3DGeneratePayload | Scene3DEditPayload

/** The child row, or `null` when it genuinely does not exist. Every OTHER read
 *  failure THROWS — absence fails the parent for good, so a transient read must
 *  not be spelled the same way (the `llm-structured` rule, verbatim). */
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

async function awaitReferenceAnalysis(
  payload: Scene3DJobPayload,
  job: Job,
  ctx: JobContext,
): Promise<{ analysis?: VideoAnalysisResult; analysisCredits?: number | null }> {
  if (!payload.analysisJobId) return {}
  const waited = await waitForAnalysis(payload.analysisJobId, ctx.jobUserId, {
    readJob: readAnalysisRow,
    onProgress: (pct) => setJobProgress(job, ctx.jobId, Math.min(ANALYSIS_PROGRESS_CAP, pct)),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
  })
  return { analysis: waited.analysis, analysisCredits: waited.credits }
}

async function complete(
  ctx: JobContext,
  output: Scene3DJobOutput,
  extra: Record<string, unknown>,
): Promise<boolean> {
  // markJobCompleted REPLACES output_data — every id must ride this write.
  return markJobCompleted(ctx.jobId, { output_data: { ...output, ...extra } })
}

export const handleGenerate3dScene: HandlerFn = async function handleGenerate3dScene(job, ctx) {
  const payload = job.data as Scene3DGeneratePayload
  const heartbeat = setInterval(() => {
    void markProviderCallStart(ctx.jobId, "pre-task")
  }, SCENE3D_HEARTBEAT_MS)
  try {
    const { analysis, analysisCredits } = await awaitReferenceAnalysis(payload, job, ctx)
    await throwIfJobCancelled()
    await setJobProgress(job, ctx.jobId, AUTHORING_PROGRESS)

    const authored = await generateScenePlan({
      prompt: payload.prompt,
      width: payload.width,
      height: payload.height,
      fps: payload.fps,
      durationInFrames: payload.durationInFrames,
      llmModel: payload.llmModel ?? LLM_FEATURE_DEFAULTS["3d-scene"],
      reasoningEffort: payload.reasoningEffort,
      references: payload.references ?? [],
      analysis,
      analyzedReferenceId: payload.analyzedReferenceId,
      revisionId: payload.revisionId,
    })

    const ok = await complete(ctx, { scenePlan: authored.plan }, {
      inputTokens: authored.inputTokens,
      outputTokens: authored.outputTokens,
      revisions: authored.revisions,
      ...(payload.analysisJobId ? { analysisJobId: payload.analysisJobId } : {}),
      ...(analysisCredits != null ? { analysisCredits } : {}),
    })
    if (!ok) return // cancelled or held mid-flight — that path owns the refund
    await commitReservedCreditsForJob(ctx.jobId)
  } finally {
    clearInterval(heartbeat)
  }
}

export const handleEdit3dScene: HandlerFn = async function handleEdit3dScene(job, ctx) {
  const payload = job.data as Scene3DEditPayload
  const heartbeat = setInterval(() => {
    void markProviderCallStart(ctx.jobId, "pre-task")
  }, SCENE3D_HEARTBEAT_MS)
  try {
    // The DETERMINISTIC lane. No analysis to wait on, no model to call, no
    // provider window to hold — apply and settle.
    if (payload.operations) {
      const applied = applyDeterministicScene3DEdit({
        plan: payload.plan,
        operations: payload.operations,
        // The caller's references are merged into the plan's own and land on
        // the produced revision — the deterministic lane attaches references
        // exactly like the instruction lane, it just does not show them to a
        // model.
        references: payload.references ?? [],
        expectedRevisionId: payload.expectedRevisionId,
        lockedObjectIds: payload.lockedObjectIds,
        revisionId: payload.revisionId,
      })
      if (!applied.ok) throw new Error(applied.message)
      const ok = await complete(
        ctx,
        { scenePlan: applied.plan, changeSummary: applied.changeSummary },
        { mode: "operations", changedObjectIds: applied.changedObjectIds },
      )
      if (!ok) return
      await commitReservedCreditsForJob(ctx.jobId)
      return
    }

    const { analysis, analysisCredits } = await awaitReferenceAnalysis(payload, job, ctx)
    await throwIfJobCancelled()
    await setJobProgress(job, ctx.jobId, AUTHORING_PROGRESS)

    const authored = await editScenePlan({
      plan: payload.plan,
      instruction: payload.instruction ?? "",
      lockedObjectIds: payload.lockedObjectIds ?? [],
      selectedObjectIds: payload.selectedObjectIds ?? [],
      llmModel: payload.llmModel ?? LLM_FEATURE_DEFAULTS["3d-scene"],
      reasoningEffort: payload.reasoningEffort,
      references: payload.references ?? [],
      analysis,
      analyzedReferenceId: payload.analyzedReferenceId,
      revisionId: payload.revisionId,
    })

    const ok = await complete(
      ctx,
      { scenePlan: authored.plan, changeSummary: authored.changeSummary },
      {
        mode: "prompt",
        inputTokens: authored.inputTokens,
        outputTokens: authored.outputTokens,
        revisions: authored.revisions,
        ...(payload.analysisJobId ? { analysisJobId: payload.analysisJobId } : {}),
        ...(analysisCredits != null ? { analysisCredits } : {}),
      },
    )
    if (!ok) return
    await commitReservedCreditsForJob(ctx.jobId)
  } finally {
    clearInterval(heartbeat)
  }
}

export const scene3dHandlers: Record<string, HandlerFn> = {
  "generate-3d-scene": handleGenerate3dScene,
  "edit-3d-scene": handleEdit3dScene,
}

export { ANALYSIS_POLL_MS }
