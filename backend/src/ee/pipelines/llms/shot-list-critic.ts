import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import type { SceneNodeData, ShotSpec } from "@nodaro/shared"
import { VIDEO_MODEL_CAPS } from "@nodaro/shared"
import { callLLM } from "./call-llm.js"

const _REDACTED_PROMPT_9 = `[REDACTED — moved to private plugin, S9 extraction]`

export const ShotListCriticIssueSchema = z.object({
  severity: z.enum(["blocking", "warning"]),
  shot_id: z.string().nullable(),
  issue_type: z.enum([
    "duration",
    "key_consistency",
    "shot_count",
    "per_shot_duration",
    "dialogue_feasibility",
    "camera_motion_realism",
    "internal_continuity",
    // Phase 1C.3 — Method 3/8/10 eligibility gates (deterministic pre-checks)
    "video_continuation_eligibility",
    "frame_interpolation_eligibility",
    "camera_path_eligibility",
  ]),
  description: z.string(),
  suggested_fix: z.string(),
})
export type ShotListCriticIssue = z.infer<typeof ShotListCriticIssueSchema>

export const ShotListCriticVerdictSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  issues: z.array(ShotListCriticIssueSchema),
  duration_analysis: z.object({
    target_seconds: z.number(),
    actual_sum_seconds: z.number(),
    deviation_percent: z.number(),
    within_tolerance: z.boolean(),
  }),
})
export type ShotListCriticVerdict = z.infer<typeof ShotListCriticVerdictSchema>

export interface RunShotListCriticArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  sceneId: string
  userId: string
  sceneNodeData: SceneNodeData
}

/**
 * validateMethod3_8_10Eligibility — Phase 1C.3 deterministic pre-checks for
 * the 3 new shot_input_mode values activated in 1C.3 E1/F1/G1:
 *   - video_continuation (Method 3) — extends prior shot's clip
 *   - frame_interpolation (Method 8) — sparse keyframes → interpolated video
 *   - camera_path (Method 10) — parametric 3D camera path
 *
 * Returns programmatic issues that merge with the LLM critic's findings.
 * Runs BEFORE the LLM call so we can short-circuit the LLM round-trip when
 * the shot list has structural problems the LLM cannot fix.
 *
 * Exported for unit testing.
 */
export function validateMethod3_8_10Eligibility(
  sceneNodeData: SceneNodeData,
): ShotListCriticIssue[] {
  const issues: ShotListCriticIssue[] = []
  const shotsById = new Map(sceneNodeData.shots.map((s) => [s.shot_id, s]))

  // Quick helper: every shot has the same video_model on SceneNodeData. We treat
  // sceneNodeData.video_model as the model for "this shot" when checking caps.
  const sceneVideoModel = sceneNodeData.video_model

  for (let i = 0; i < sceneNodeData.shots.length; i++) {
    const shot: ShotSpec = sceneNodeData.shots[i]!
    const mode = sceneNodeData.shot_input_mode

    // ─── Method 3 — video_continuation ────────────────────────────────────────
    if (mode === "video_continuation") {
      // Per-shot extension only meaningful for shots after the first inside the scene
      // (Stage 7 stitches scene-1's last frame onto scene-2's shot-1 via external
      // continuity; intra-scene extension chains are what this gate guards).
      const priorShotId = shot.extends_shot_id
      if (!priorShotId) {
        if (i > 0) {
          issues.push({
            severity: "blocking",
            shot_id: shot.shot_id,
            issue_type: "video_continuation_eligibility",
            description: `Shot ${shot.shot_id}: shot_input_mode='video_continuation' but extends_shot_id is missing — every continuation shot must point at the prior shot it extends.`,
            suggested_fix: `Set extends_shot_id to the prior shot's shot_id (e.g., "${sceneNodeData.shots[i - 1]?.shot_id ?? "shot_01"}"), or change shot_input_mode if this shot is not a continuation.`,
          })
        }
      } else {
        // Must resolve to a shot in the same scene
        const priorShot = shotsById.get(priorShotId)
        if (!priorShot) {
          issues.push({
            severity: "blocking",
            shot_id: shot.shot_id,
            issue_type: "video_continuation_eligibility",
            description: `Shot ${shot.shot_id}: extends_shot_id='${priorShotId}' does not resolve to any shot in this scene (cross-scene extension is not supported in 1C.3).`,
            suggested_fix: `Set extends_shot_id to a shot_id present in this scene's shots[], or remove the directive.`,
          })
        } else {
          // Prior shot's video_model must support extension
          const priorCaps = VIDEO_MODEL_CAPS[sceneVideoModel]
          if (!priorCaps?.supportsVideoExtension) {
            issues.push({
              severity: "blocking",
              shot_id: shot.shot_id,
              issue_type: "video_continuation_eligibility",
              description: `Shot ${shot.shot_id}: video_continuation requires prior shot's video_model to support extension (only VEO + Seedance 2 family currently); got '${sceneVideoModel}'.`,
              suggested_fix: `Pick a video_model with supportsVideoExtension=true (veo3.1, seedance-2), or switch shot_input_mode to first_frame.`,
            })
          }
        }
      }
    }

    // ─── Method 8 — frame_interpolation ───────────────────────────────────────
    if (mode === "frame_interpolation") {
      const caps = VIDEO_MODEL_CAPS[sceneVideoModel]
      const supports = (caps?.maxInterpolationKeyframes ?? 0) > 0

      const kfs = shot.interpolation_keyframes ?? []
      if (kfs.length < 2) {
        issues.push({
          severity: "blocking",
          shot_id: shot.shot_id,
          issue_type: "frame_interpolation_eligibility",
          description: `Shot ${shot.shot_id}: frame_interpolation requires ≥2 interpolation_keyframes (got ${kfs.length}).`,
          suggested_fix: `Add at least 2 keyframes with monotonic timestamps; the first MUST be timestamp_sec=0 and the last MUST be ≤ duration_seconds.`,
        })
      } else {
        // Monotonic ascending timestamps
        for (let k = 1; k < kfs.length; k++) {
          if (kfs[k]!.timestamp_sec <= kfs[k - 1]!.timestamp_sec) {
            issues.push({
              severity: "blocking",
              shot_id: shot.shot_id,
              issue_type: "frame_interpolation_eligibility",
              description: `Shot ${shot.shot_id}: interpolation_keyframes[${k}].timestamp_sec (${kfs[k]!.timestamp_sec}) is not strictly greater than [${k - 1}] (${kfs[k - 1]!.timestamp_sec}); keyframe timestamps must be monotonic ascending.`,
              suggested_fix: `Reorder or adjust keyframes so timestamp_sec is strictly increasing.`,
            })
            break // one ordering error per shot is enough
          }
        }
        // First keyframe must be at t=0
        if (kfs[0]!.timestamp_sec !== 0) {
          issues.push({
            severity: "blocking",
            shot_id: shot.shot_id,
            issue_type: "frame_interpolation_eligibility",
            description: `Shot ${shot.shot_id}: first interpolation keyframe must be at timestamp_sec=0 (got ${kfs[0]!.timestamp_sec}).`,
            suggested_fix: `Insert a keyframe with timestamp_sec=0 describing the shot's opening frame.`,
          })
        }
        // Last keyframe must be ≤ shot duration
        const lastTs = kfs[kfs.length - 1]!.timestamp_sec
        if (lastTs > shot.duration_seconds) {
          issues.push({
            severity: "blocking",
            shot_id: shot.shot_id,
            issue_type: "frame_interpolation_eligibility",
            description: `Shot ${shot.shot_id}: last interpolation keyframe timestamp_sec=${lastTs} exceeds duration_seconds=${shot.duration_seconds}.`,
            suggested_fix: `Reduce the final keyframe timestamp to ≤ duration_seconds, or extend duration_seconds.`,
          })
        }
      }

      if (!supports) {
        issues.push({
          severity: "blocking",
          shot_id: shot.shot_id,
          issue_type: "frame_interpolation_eligibility",
          description: `Shot ${shot.shot_id}: frame_interpolation requires video_model with supportsFrameInterpolation (maxInterpolationKeyframes > 0); got '${sceneVideoModel}'.`,
          suggested_fix: `Pick a video_model that registers maxInterpolationKeyframes (rife, topaz-apollo), or switch shot_input_mode to first_frame.`,
        })
      }
    }

    // ─── Method 10 — camera_path ──────────────────────────────────────────────
    if (mode === "camera_path") {
      const directive = shot.camera_path_directive
      if (!directive) {
        issues.push({
          severity: "blocking",
          shot_id: shot.shot_id,
          issue_type: "camera_path_eligibility",
          description: `Shot ${shot.shot_id}: shot_input_mode='camera_path' but camera_path_directive is missing.`,
          suggested_fix: `Add camera_path_directive with path_kind ∈ {orbit, dolly, crane, arc, reveal}.`,
        })
      } else {
        const allowedKinds = ["orbit", "dolly", "crane", "arc", "reveal"] as const
        if (!allowedKinds.includes(directive.path_kind)) {
          issues.push({
            severity: "blocking",
            shot_id: shot.shot_id,
            issue_type: "camera_path_eligibility",
            description: `Shot ${shot.shot_id}: camera_path requires camera_path_directive.path_kind ∈ {orbit, dolly, crane, arc, reveal}; got '${directive.path_kind}'.`,
            suggested_fix: `Set path_kind to one of: orbit, dolly, crane, arc, reveal.`,
          })
        }
      }
      // camera_path is allowed for any video model (text-prompt fallback works
      // universally; SV3D gets native path when wired). No model gate here.
    }
  }

  return issues
}

export async function runShotListCritic(args: RunShotListCriticArgs): Promise<ShotListCriticVerdict> {
  // Phase 1C.3 — deterministic pre-checks for Method 3/8/10 eligibility.
  // These run BEFORE the LLM call and merge into the verdict's issues[]. They
  // do NOT short-circuit the LLM (the LLM still validates duration/dialogue/etc).
  const deterministicIssues = validateMethod3_8_10Eligibility(args.sceneNodeData)

  const userPrompt = `SCENE NODE DATA:
\`\`\`json
${JSON.stringify(args.sceneNodeData, null, 2)}
\`\`\`

Validate and respond as JSON.`

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    sceneId: args.sceneId,
    userId: args.userId,
    role: "critic",
    task: "shot_list",
    modelId: "claude-sonnet-4-6",
    temperature: 0.2,
    systemPrompt: '[REDACTED]',
    userPrompt,
    schema: ShotListCriticVerdictSchema,
    maxRetries: 1,
  })

  // Merge deterministic issues with the LLM's findings. If we added any
  // blocking issues, force the overall verdict to "fail" so the retry loop in
  // shot-list.ts kicks in.
  const mergedIssues = [...deterministicIssues, ...result.output.issues]
  const hasBlocking = mergedIssues.some((i) => i.severity === "blocking")
  return {
    ...result.output,
    verdict: hasBlocking ? "fail" : result.output.verdict,
    issues: mergedIssues,
  }
}
