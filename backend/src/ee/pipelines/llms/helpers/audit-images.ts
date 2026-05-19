import type { SupabaseClient } from "@supabase/supabase-js"
import {
  type AuditImagesResult,
  type AuditImagesShotEntry,
  type SceneNodeData,
  type ShowrunnerPlan,
} from "@nodaro/shared"
import { runImageCritic } from "../image-critic.js"
import { settledWithLimit } from "../../../../lib/settled-with-limit.js"

/**
 * §6.11.12 Audit Images — Phase 1C.1 vision-keyframe helper.
 *
 * Loops every shot in the scene that has a `keyframe_url`, calls
 * {@link runImageCritic} per shot with the scene context + the shot's
 * visual_keyframe_prompt, and aggregates the verdicts into a per-shot issue
 * list. Reuses the Image Critic Sonnet vision call (existing G1 module) so
 * the same audit-trail row lands in `image_critic_verdicts` with
 * `invoked_via='helper:audit_images'`.
 *
 * Shots without a keyframe yet (Stage 6 not run for that shot, or shot was
 * added post-Stage-6 via Add B-Roll) are surfaced as `skipped: true` rather
 * than failing — the user explicitly chose to audit what's there.
 *
 * Per-shot Image Critic calls fan out at concurrency=3 — the per-call latency
 * is dominated by the LLM round-trip + a verdict-row insert, and at typical
 * scene size (≤8 shots) concurrency=3 cuts wall-clock to ~1/3 without
 * exceeding Sonnet vision quota. Output ordering is preserved via
 * `settledWithLimit`'s position-stable result array.
 */
export interface RunAuditImagesArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  /** sceneId — used as pipelineEntityId for the verdict row link. */
  sceneId: string
  userId: string
  plan: ShowrunnerPlan
  scene: SceneNodeData
}

export async function runAuditImages(
  args: RunAuditImagesArgs,
): Promise<AuditImagesResult> {
  const sceneId = args.sceneId
  const globalStyle = args.plan.global_style

  // Build per-shot tasks. Skipped shots resolve synchronously with the
  // standard `{ ok:true, verdict:null, skipped:true }` payload so they keep
  // their place in the ordered result array without bumping the LLM concurrency.
  const tasks: Array<() => Promise<AuditImagesShotEntry>> = args.scene.shots.map(
    (shot) => async () => {
      if (!shot.keyframe_url) {
        return { shot_id: shot.shot_id, ok: true, verdict: null, skipped: true }
      }
      const verdict = await runImageCritic({
        supabase: args.supabase,
        pipelineId: args.pipelineId,
        pipelineEntityId: sceneId,
        assetId: shot.keyframe_asset_id,
        shotId: shot.shot_id,
        userId: args.userId,
        keyframeUrl: shot.keyframe_url,
        // Audit Images is the parallel-mode equivalent of Stage 7b-pre — no
        // prior-frame continuity check (that's `fix_continuity`'s job).
        priorLastFrameUrl: null,
        sceneDescription: composeSceneDescription(args.scene, globalStyle),
        emotionalBeat: args.scene.emotional_beat,
        shotStartState: shot.start_state,
        continuityWithPrevious: shot.continuity_with_previous,
        visualKeyframePrompt: shot.visual_keyframe_prompt,
        invokedVia: "helper:audit_images",
      })
      return {
        shot_id: shot.shot_id,
        ok: verdict.ok,
        verdict,
        skipped: false,
      }
    },
  )
  const settled = await settledWithLimit(tasks, 3, undefined, false)
  const shotEntries: AuditImagesShotEntry[] = settled.map((r, idx) => {
    if (r.status === "fulfilled") return r.value
    // Critic call threw — record it as a non-skipped fail so the scene-level
    // ok rollup picks it up. `runImageCritic` does NOT log its own reasons
    // before throwing, so we surface the reason here so audit-images failures
    // aren't silently swallowed.
    const shot = args.scene.shots[idx]!
    console.warn(
      `[audit_images] runImageCritic rejected for scene=${sceneId} shot=${shot.shot_id}:`,
      r.reason instanceof Error ? r.reason.message : r.reason,
    )
    return {
      shot_id: shot.shot_id,
      ok: false,
      verdict: null,
      skipped: false,
    }
  })

  const auditedCount = shotEntries.filter((e) => !e.skipped).length
  const failingCount = shotEntries.filter((e) => !e.skipped && !e.ok).length
  const skippedCount = shotEntries.filter((e) => e.skipped).length

  const summary = buildSummary(auditedCount, failingCount, skippedCount)

  return {
    scene_id: sceneId,
    ok: failingCount === 0,
    shot_issues: shotEntries,
    summary,
  }
}

/**
 * Builds the scene-description text the Image Critic uses for prompt-mismatch
 * + identity-mismatch + style-drift checks. Embeds the global_style so the
 * critic can flag style_drift when a keyframe departs from the cinematography.
 */
function composeSceneDescription(
  scene: SceneNodeData,
  globalStyle: ShowrunnerPlan["global_style"],
): string {
  return [
    scene.description,
    `Global style — visual_style: ${globalStyle.visual_style}, color_palette: ${globalStyle.color_palette}, lighting: ${globalStyle.lighting}, camera_language: ${globalStyle.camera_language}.`,
  ].join("\n")
}

function buildSummary(audited: number, failing: number, skipped: number): string {
  if (audited === 0 && skipped > 0) {
    return `No keyframes to audit yet (${skipped} shot${skipped === 1 ? "" : "s"} pending generation).`
  }
  if (failing === 0) {
    return `All ${audited} keyframe${audited === 1 ? "" : "s"} pass review${
      skipped > 0 ? ` (${skipped} skipped — no keyframe yet)` : ""
    }.`
  }
  return `${failing} of ${audited} shot${audited === 1 ? "" : "s"} have blocking issues${
    skipped > 0 ? ` (${skipped} skipped — no keyframe yet)` : ""
  }.`
}
