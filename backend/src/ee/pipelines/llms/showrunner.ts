import type { SupabaseClient } from "@supabase/supabase-js"
import {
  ShowrunnerPlanSchema,
  type ShowrunnerPlan,
  type DetectionResult,
  type PipelineFormat,
  type PipelineOutputResolution,
  type PipelineMode,
  type PipelineActivationMode,
  type StyleDirectives,
  type ScriptCriticVerdict,
  type CastCoverageCriticVerdict,
  type LocationsCoverageCriticVerdict,
  type ObjectsValidationResult,
} from "@nodaro/shared"
import { callLLM, type ProgressUpdate } from "./call-llm.js"
import { pipelineEvents } from "../events.js"

const _REDACTED_PROMPT_2 = `[REDACTED — moved to private plugin, S9 extraction]`

export interface RunShowrunnerArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  userId: string
  storyPrompt: string
  detectionResult: DetectionResult
  targetDurationSeconds: number
  format: PipelineFormat
  outputResolution: PipelineOutputResolution
  language: string
  pipelineType: "story_to_video" | "song_to_music_video"
  userTier: string
  activationMode: PipelineActivationMode
  mode: PipelineMode
  styleDirectives?: StyleDirectives
  criticFeedback?: {
    scriptVerdict?: ScriptCriticVerdict
    castVerdict?: CastCoverageCriticVerdict
    locationsVerdict?: LocationsCoverageCriticVerdict
    objectsVerdict?: ObjectsValidationResult
  }
  /**
   * Optional LLM override. When set (via `pipelines.config.script_llm` or a
   * per-stage `stage_models.script_llm`), this model is used instead of the
   * default. Caller resolves precedence via `resolvePipelineModel`.
   */
  scriptLlmOverride?: string
}

export async function runShowrunner(args: RunShowrunnerArgs): Promise<ShowrunnerPlan> {
  const criticPreamble = args.criticFeedback
    ? `\n\nPRIOR ATTEMPT WAS REJECTED BY THE CRITIC:\n${JSON.stringify(args.criticFeedback, null, 2)}\n\nAddress every blocking issue.\n\n`
    : ""

  const userPrompt = `${criticPreamble}USER STORY PROMPT:
"""
${args.storyPrompt}
"""

DETECTION SEED (suggestions — feel free to merge/split/extend):
\`\`\`json
${JSON.stringify(args.detectionResult, null, 2)}
\`\`\`

REQUIRED CONSTRAINTS:
- target_duration_seconds: ${args.targetDurationSeconds}   // MUST respect ±10%
- format: ${args.format}
- output_resolution: ${args.outputResolution}
- language: ${args.language}

CONTEXT:
- pipeline_type: ${args.pipelineType}
- user_tier: ${args.userTier}
- activation_mode: ${args.activationMode}
- run_mode: ${args.mode}

OPTIONAL STYLE OVERRIDES FROM USER (may be empty):
\`\`\`json
${JSON.stringify(args.styleDirectives ?? {}, null, 2)}
\`\`\`

EMIT SCHEMA — your emit tool call MUST include these exact top-level fields:
- title: a short cinematic title for this production
- logline: one-sentence premise, max 200 chars
- target_duration_seconds: ${args.targetDurationSeconds}
- format: "${args.format}"
- output_resolution: "${args.outputResolution}"
- language: "${args.language}"

Produce the ShowrunnerPlan as JSON via the emit tool.`

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    userId: args.userId,
    role: "showrunner",
    task: "script",
    // The Showrunner is the creative core (plan + script). Default to Sonnet
    // for a FAST draft — real testing showed an Opus default made the slowest
    // (and first-visible) stage painfully slow. Opus stays available via
    // scriptLlmOverride and is the right pick for the on-demand critic/refine
    // (quality on demand, per the script-checkpoint design).
    modelId: args.scriptLlmOverride ?? "claude-sonnet-4-6",
    temperature: 0.4,
    systemPrompt: '[REDACTED]',
    userPrompt,
    schema: ShowrunnerPlanSchema,
    maxRetries: 1,
    // Live "Drafting plan…" banner in the panel. Showrunner is the slowest
    // Stage 1 LLM call (1-3 min) — without streaming the panel shows a
    // spinner for the whole duration. The callback runs at observable
    // stream boundaries; the panel renders the latest message + a coarse
    // progress proxy (bytes received).
    //
    // Two delivery paths:
    //   - SSE event (pipelineEvents.publish) for in-tab users watching
    //     the panel in real time. Sub-second latency.
    //   - DB persist (current_progress_message column) for users who
    //     refresh mid-stream OR open the panel for the first time
    //     during an in-flight LLM call. Without this they'd stare at
    //     an empty panel until the next live event (~750ms throttle
    //     window). The cleared NULL on the `finalizing` phase prevents
    //     a stale "Drafting plan…" from outliving the stream.
    onProgress: (update) => {
      const message = showrunnerProgressMessage(update, !!args.criticFeedback)
      pipelineEvents.publish({
        type: "stage:progress",
        pipelineId: args.pipelineId,
        stageName: "script",
        message,
        bytesSoFar:
          update.phase === "drafting" || update.phase === "finalizing"
            ? update.bytesSoFar
            : undefined,
      })
      // Fire-and-forget DB write. The `finalizing` phase clears the
      // column back to NULL so the banner disappears for refresh-survivor
      // viewers once the stream ends. Errors logged but not rethrown —
      // a DB hiccup must not poison the LLM call.
      const dbValue = update.phase === "finalizing" ? null : message
      void args.supabase
        .from("pipelines")
        .update({ current_progress_message: dbValue })
        .eq("id", args.pipelineId)
        .then(({ error }) => {
          if (error) {
            // eslint-disable-next-line no-console
            console.error(
              "[showrunner] current_progress_message write failed:",
              error.message,
            )
          }
        })
    },
  })
  return result.output
}

function showrunnerProgressMessage(
  update: ProgressUpdate,
  isRetry: boolean,
): string {
  const prefix = isRetry ? "Refining plan after critic feedback" : "Drafting plan"
  switch (update.phase) {
    case "starting":
      return `${prefix}…`
    case "drafting":
      return `${prefix} (${formatBytes(update.bytesSoFar)} so far)…`
    case "finalizing":
      return "Finalizing plan…"
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}
