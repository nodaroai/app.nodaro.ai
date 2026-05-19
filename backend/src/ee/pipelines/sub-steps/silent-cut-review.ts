import type { SupabaseClient } from "@supabase/supabase-js"
import { pipelineCombineVideos } from "../services/pipeline-combine-videos.js"

/**
 * Phase 1C.2 sub-step 7e' — Silent-cut review.
 *
 * After dialogue-recheck (7d') succeeds, manual + guided modes pause for a
 * user-driven sanity check on the cut timing BEFORE music is laid down. The
 * preview is a straight concatenation of every scene's composite_video_url
 * (no music overlay, no Editor cut decisions) so the user can confirm pacing
 * + transitions before committing to a music gen + per-shot trim.
 *
 * Behavior by mode:
 *   - auto:          skip entirely; return `{ok: true, awaitingApproval: false}`.
 *   - manual/guided: build the preview via `pipelineCombineVideos` and return
 *                    `{ok: true, previewUrl, awaitingApproval: true}`. The
 *                    orchestrator is responsible for merging `previewUrl` into
 *                    its in-memory `stageOutputAcc` + calling `setSubGate` so
 *                    the row write batches with `sub_step_completed` and SSE
 *                    emission. Doing the persistence here would race the
 *                    batched flush in animate-audio-edit (commit a0a23642)
 *                    and silently wipe `current_sub_gate`.
 *
 * Single-scene short-circuit: when the pipeline has exactly one scene we use
 * that scene's composite URL directly — `pipelineCombineVideos` requires ≥2
 * inputs (route Zod check) so a single combine call would throw.
 *
 * Reject path is owned by the route layer (Section L); 1C.2 rejects mark the
 * stage failed with `failure_reason='silent_cut_rejected'`. Proper
 * branch-from-stage integration lands in Phase 1D.
 */

export interface SilentCutReviewArgs {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
  mode: "manual" | "guided" | "auto"
}

export interface SilentCutReviewResult {
  ok: boolean
  previewUrl?: string
  awaitingApproval: boolean
}

export async function runSilentCutReview(
  args: SilentCutReviewArgs,
): Promise<SilentCutReviewResult> {
  const { supabase, pipelineId, userId, mode } = args

  // Auto mode skips the preview entirely.
  if (mode === "auto") {
    return { ok: true, awaitingApproval: false }
  }

  // Load scenes in canvas order, extract composite_video_urls.
  const { data: scenes, error: scenesErr } = await supabase
    .from("pipeline_entities")
    .select("metadata, entity_key")
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "scene")
    .order("entity_key", { ascending: true })
  if (scenesErr) {
    return { ok: false, awaitingApproval: false }
  }
  if (!scenes || scenes.length === 0) {
    return { ok: false, awaitingApproval: false }
  }

  const sceneUrls: string[] = []
  for (const scene of scenes) {
    const meta = (scene.metadata as Record<string, unknown> | null) ?? {}
    const sceneNodeData = meta.scene_node_data as
      | { composite_video_url?: string }
      | undefined
    const url = sceneNodeData?.composite_video_url
    if (url) sceneUrls.push(url)
  }
  if (sceneUrls.length === 0) {
    return { ok: false, awaitingApproval: false }
  }

  // Build the preview reel.
  let previewUrl: string
  if (sceneUrls.length === 1) {
    // Single-scene short-circuit — pipelineCombineVideos needs ≥2 inputs.
    previewUrl = sceneUrls[0]!
  } else {
    try {
      const combined = await pipelineCombineVideos({
        supabase,
        pipelineId,
        userId,
        videoUrls: sceneUrls,
        // Straight concat — NO transition, NO music, NO trim. The reel
        // mirrors exactly what the Editor LLM will work with as raw input.
        transition: "cut",
        audioMode: "keep",
      })
      previewUrl = combined.assetUrl
    } catch (_err) {
      return { ok: false, awaitingApproval: false }
    }
  }

  return { ok: true, previewUrl, awaitingApproval: true }
}
