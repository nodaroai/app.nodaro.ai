import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  ShowrunnerPlan,
  ScriptCriticVerdict,
  CastCoverageCriticVerdict,
  LocationsCoverageCriticVerdict,
  ObjectsValidationResult,
  PipelineMode,
  PipelineActivationMode,
  PipelineFormat,
  PipelineOutputResolution,
  StyleDirectives,
} from "@nodaro/shared"
import { validateObjects } from "@nodaro/shared"
import { runDetection } from "../llms/detection.js"
import { runShowrunner } from "../llms/showrunner.js"
import { runScriptCritic } from "../llms/script-critic.js"
import { runCastCoverageCritic } from "../llms/cast-coverage-critic.js"
import { runLocationsCoverageCritic } from "../llms/locations-coverage-critic.js"
import { pipelineEvents } from "../events.js"
import { ensureStageRow, incrementCriticRetry } from "../stage-utils.js"

/**
 * Stage 1 live-progress narration. The Showrunner LLM streams its own
 * "Drafting plan…" updates (showrunner.ts `onProgress`), but the
 * Detection -> Critic-review -> refine-loop steps between drafts were
 * invisible — the panel showed a bare spinner through the entire review and
 * revision phase. Emitting the same `stage:progress` event the banner already
 * renders turns the draft -> review -> refine pipeline into a live, legible
 * sequence (the whole point of surfacing the refinement process to the user).
 *
 * Mirrors showrunner.ts's dual delivery:
 *   - SSE (pipelineEvents.publish) for in-tab viewers — sub-second latency.
 *   - DB persist (current_progress_message) for refresh-survivors / first
 *     open mid-stage. clearScriptProgress NULLs it once the stage settles so a
 *     stale "Reviewing…" can't outlive the run (the banner falls back to this
 *     column when no live SSE event is in hand).
 */
function emitScriptProgress(
  supabase: SupabaseClient,
  pipelineId: string,
  message: string,
): void {
  pipelineEvents.publish({
    type: "stage:progress",
    pipelineId,
    stageName: "script",
    message,
  })
  void supabase
    .from("pipelines")
    .update({ current_progress_message: message })
    .eq("id", pipelineId)
    .then(({ error }) => {
      if (error) {
        // eslint-disable-next-line no-console
        console.error(
          "[script-stage] current_progress_message write failed:",
          error.message,
        )
      }
    })
}

/** Clears the live-progress banner once Stage 1 settles (see emitScriptProgress). */
function clearScriptProgress(supabase: SupabaseClient, pipelineId: string): void {
  void supabase
    .from("pipelines")
    .update({ current_progress_message: null })
    .eq("id", pipelineId)
    .then(({ error }) => {
      if (error) {
        // eslint-disable-next-line no-console
        console.error(
          "[script-stage] current_progress_message clear failed:",
          error.message,
        )
      }
    })
}

export interface RunScriptStageArgs {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
  storyPrompt: string
  targetDurationSeconds: number
  format: PipelineFormat
  outputResolution: PipelineOutputResolution
  language: string
  mode: PipelineMode
  activationMode: PipelineActivationMode
  userTier: string
  styleDirectives?: StyleDirectives
}

export type ScriptStageOutcome =
  | {
      status: "approved" | "awaiting_approval"
      plan: ShowrunnerPlan
      scriptCritic: ScriptCriticVerdict
      castCoverageCritic: CastCoverageCriticVerdict
      locationsCoverageCritic: LocationsCoverageCriticVerdict
      objectsValidation: ObjectsValidationResult
    }
  | {
      status: "failed"
      reason: string
      failure_detail?: string
    }

/**
 * Stage 1 orchestrator (Architecture §4 stage 1; LLM spec §1–§4.2).
 *
 *   Detection (Haiku) → Showrunner (Opus) → Script Critic + Cast Coverage Critic (parallel Sonnet)
 *
 * Both critics ALWAYS run (even in manual mode). On Critic fail, retry Showrunner once
 * with critic feedback injected; cap at critic_retry_count <= 2 in DB (handled by engine).
 *
 * Returns the final outcome. The engine writes the pipeline_stages row + handles approval
 * gating; this function is pure orchestration of LLM calls.
 */
export async function runScriptStage(args: RunScriptStageArgs): Promise<ScriptStageOutcome> {
  const stageId = await ensureStageRow(args.supabase, args.pipelineId, "script", 1)

  try {
    pipelineEvents.publish({
      type: "stage:status",
      pipelineId: args.pipelineId,
      stageName: "script",
      status: "running",
    })

    emitScriptProgress(
      args.supabase,
      args.pipelineId,
      "Analyzing your story — identifying characters, locations, and props…",
    )

    // 1. Detection.
    const detection = await runDetection({
      supabase: args.supabase,
      pipelineId: args.pipelineId,
      stageId,
      userId: args.userId,
      storyPrompt: args.storyPrompt,
      format: args.format,
      targetDurationSeconds: args.targetDurationSeconds,
      language: args.language,
    })

    // 2. Showrunner (retry once on Critic fail).
    let plan = await runShowrunner({
      supabase: args.supabase,
      pipelineId: args.pipelineId,
      stageId,
      userId: args.userId,
      storyPrompt: args.storyPrompt,
      detectionResult: detection,
      targetDurationSeconds: args.targetDurationSeconds,
      format: args.format,
      outputResolution: args.outputResolution,
      language: args.language,
      pipelineType: "story_to_video",
      userTier: args.userTier,
      activationMode: args.activationMode,
      mode: args.mode,
      styleDirectives: args.styleDirectives,
    })

    emitScriptProgress(
      args.supabase,
      args.pipelineId,
      "Reviewing the draft — story structure, cast, and locations…",
    )

    let [scriptVerdict, castVerdict, locationsVerdict] = await Promise.all([
      runScriptCritic({
        supabase: args.supabase, pipelineId: args.pipelineId, stageId, userId: args.userId, plan,
      }),
      runCastCoverageCritic({
        supabase: args.supabase, pipelineId: args.pipelineId, stageId, userId: args.userId, plan,
      }),
      runLocationsCoverageCritic({
        supabase: args.supabase, pipelineId: args.pipelineId, stageId, userId: args.userId, plan,
      }),
    ])
    let objectsVerdict = validateObjects(plan.objects, plan)

    let criticRetryCount = 0
    while (
      hasBlockingIssue(scriptVerdict, castVerdict, locationsVerdict, objectsVerdict) &&
      criticRetryCount < 2
    ) {
      criticRetryCount++
      await incrementCriticRetry(args.supabase, stageId)
      emitScriptProgress(
        args.supabase,
        args.pipelineId,
        `Refining the script (revision ${criticRetryCount + 1}) from the review notes…`,
      )
      plan = await runShowrunner({
        supabase: args.supabase,
        pipelineId: args.pipelineId,
        stageId,
        userId: args.userId,
        storyPrompt: args.storyPrompt,
        detectionResult: detection,
        targetDurationSeconds: args.targetDurationSeconds,
        format: args.format,
        outputResolution: args.outputResolution,
        language: args.language,
        pipelineType: "story_to_video",
        userTier: args.userTier,
        activationMode: args.activationMode,
        mode: args.mode,
        styleDirectives: args.styleDirectives,
        criticFeedback: { scriptVerdict, castVerdict, locationsVerdict, objectsVerdict },
      })
      emitScriptProgress(
        args.supabase,
        args.pipelineId,
        "Re-reviewing the revised draft…",
      )
      ;[scriptVerdict, castVerdict, locationsVerdict] = await Promise.all([
        runScriptCritic({
          supabase: args.supabase, pipelineId: args.pipelineId, stageId, userId: args.userId, plan,
        }),
        runCastCoverageCritic({
          supabase: args.supabase, pipelineId: args.pipelineId, stageId, userId: args.userId, plan,
        }),
        runLocationsCoverageCritic({
          supabase: args.supabase, pipelineId: args.pipelineId, stageId, userId: args.userId, plan,
        }),
      ])
      objectsVerdict = validateObjects(plan.objects, plan)
    }

    clearScriptProgress(args.supabase, args.pipelineId)

    // Cap-reached failure guard. Note: previously this branch was prefixed with
    // `scriptVerdict.verdict === "fail" &&`, which silently let a blocking-only
    // CAST/locations/objects failure slip through to `awaiting_approval`. The
    // new guard fires on any blocking critic regardless of script verdict.
    if (hasBlockingIssue(scriptVerdict, castVerdict, locationsVerdict, objectsVerdict)) {
      return {
        status: "failed",
        reason: "script_critic_unresolvable",
        failure_detail: pickBlockingDetail(scriptVerdict, castVerdict, locationsVerdict, objectsVerdict),
      }
    }

    return {
      status: args.mode === "auto" ? "approved" : "awaiting_approval",
      plan,
      scriptCritic: scriptVerdict,
      castCoverageCritic: castVerdict,
      locationsCoverageCritic: locationsVerdict,
      objectsValidation: objectsVerdict,
    }
  } catch (err) {
    clearScriptProgress(args.supabase, args.pipelineId)
    const reason = err instanceof Error ? err.message : String(err)
    return { status: "failed", reason }
  }
}

function hasBlockingIssue(
  s: ScriptCriticVerdict,
  c: CastCoverageCriticVerdict,
  l: LocationsCoverageCriticVerdict,
  o: ObjectsValidationResult,
): boolean {
  return (
    s.issues.some((i) => i.severity === "blocking") ||
    c.issues.some((i) => i.severity === "blocking") ||
    l.issues.some((i) => i.severity === "blocking") ||
    o.issues.some((i) => i.severity === "blocking")
  )
}

function pickBlockingDetail(
  s: ScriptCriticVerdict,
  c: CastCoverageCriticVerdict,
  l: LocationsCoverageCriticVerdict,
  o: ObjectsValidationResult,
): string {
  if (s.issues.some((i) => i.severity === "blocking")) return "script"
  if (c.issues.some((i) => i.severity === "blocking")) return "cast_coverage"
  if (l.issues.some((i) => i.severity === "blocking")) return "locations_coverage"
  if (o.issues.some((i) => i.severity === "blocking")) return "objects_validation"
  return "unknown"
}

