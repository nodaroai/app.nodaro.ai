import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  ShowrunnerPlan,
  ScriptCriticVerdict,
  CastCoverageCriticVerdict,
  PipelineMode,
  PipelineActivationMode,
  PipelineFormat,
  PipelineOutputResolution,
  StyleDirectives,
} from "@nodaro/shared"
import { runDetection } from "../llms/detection.js"
import { runShowrunner } from "../llms/showrunner.js"
import { runScriptCritic } from "../llms/script-critic.js"
import { runCastCoverageCritic } from "../llms/cast-coverage-critic.js"
import { pipelineEvents } from "../events.js"
import { ensureStageRow, incrementCriticRetry } from "../stage-utils.js"

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
      status: "awaiting_approval"
      plan: ShowrunnerPlan
      scriptCritic: ScriptCriticVerdict
      castCoverageCritic: CastCoverageCriticVerdict
    }
  | {
      status: "failed"
      reason: string
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

    let [scriptVerdict, castVerdict] = await Promise.all([
      runScriptCritic({
        supabase: args.supabase, pipelineId: args.pipelineId, stageId, userId: args.userId, plan,
      }),
      runCastCoverageCritic({
        supabase: args.supabase, pipelineId: args.pipelineId, stageId, userId: args.userId, plan,
      }),
    ])

    let criticRetryCount = 0
    while (
      (scriptVerdict.verdict === "fail" || castVerdict.verdict === "fail") &&
      criticRetryCount < 2 &&
      hasBlockingIssue(scriptVerdict, castVerdict)
    ) {
      criticRetryCount++
      await incrementCriticRetry(args.supabase, stageId)
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
        criticFeedback: { scriptVerdict, castVerdict },
      })
      ;[scriptVerdict, castVerdict] = await Promise.all([
        runScriptCritic({
          supabase: args.supabase, pipelineId: args.pipelineId, stageId, userId: args.userId, plan,
        }),
        runCastCoverageCritic({
          supabase: args.supabase, pipelineId: args.pipelineId, stageId, userId: args.userId, plan,
        }),
      ])
    }

    if (scriptVerdict.verdict === "fail" && hasBlockingIssue(scriptVerdict, castVerdict)) {
      return { status: "failed", reason: "script_critic_unresolvable" }
    }

    return {
      status: "awaiting_approval",
      plan,
      scriptCritic: scriptVerdict,
      castCoverageCritic: castVerdict,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { status: "failed", reason }
  }
}

function hasBlockingIssue(s: ScriptCriticVerdict, c: CastCoverageCriticVerdict): boolean {
  return (
    s.issues.some((i) => i.severity === "blocking") ||
    c.issues.some((i) => i.severity === "blocking")
  )
}

