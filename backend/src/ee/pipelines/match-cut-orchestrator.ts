import type { SupabaseClient } from "@supabase/supabase-js"
import type { SceneNodeData, ShowrunnerPlan } from "@nodaro/shared"
import { type MatchCutVerdict } from "@nodaro/shared"
import { settledWithLimit } from "../../lib/settled-with-limit.js"
import { runValidateMatchCut } from "./llms/helpers/validate-match-cut.js"

/**
 * §6.11.14 matchCutOrchestrator — Phase 1D.1 Method 7.
 *
 * Iterates every shot in the scene (except the last — no next to pair with)
 * and runs `runValidateMatchCut` for each shot that:
 *   1. Has `shot_intent.is_match_cut === true`
 *   2. Has a `keyframe_url` (Stage 6 must have run first)
 *   3. The NEXT shot also has a `keyframe_url`
 *   4. Does NOT have `accepted_match_cut_break === true`
 *      (user already accepted the break — skip re-checking)
 *
 * Returns:
 *   - `verdicts`: a Record<shotId, MatchCutVerdict> keyed by the TARGET shot_id
 *   - `pendingBreaks`: shot_ids whose `match_strength === "break"` (user must
 *     accept before Stage 7 can proceed)
 *
 * On a rejected promise (LLM/network failure): log a warning and omit the
 * shot from `verdicts` entirely. A missing entry does NOT gate Stage 7 (the
 * gate only fires when an entry IS present with `match_strength="break"`).
 *
 * Runs at concurrency=3 to stay within Anthropic tier-1 vision limits.
 */

export interface MatchCutOrchestratorArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  sceneId: string
  userId: string
  plan: ShowrunnerPlan
  scene: SceneNodeData
}

export interface MatchCutOrchestratorResult {
  /** One entry per eligible match-cut shot pair that was checked. */
  verdicts: Record<string, MatchCutVerdict>
  /**
   * shot_ids (TARGET) where `match_strength === "break"` — these require the
   * user to set `accepted_match_cut_break=true` before Stage 7 runs.
   */
  pendingBreaks: string[]
}

const MATCH_CUT_CONCURRENCY = 3

export async function runMatchCutOrchestrator(
  args: MatchCutOrchestratorArgs,
): Promise<MatchCutOrchestratorResult> {
  const { scene } = args
  const shots = scene.shots

  // Collect eligible [targetShotId] entries (skip last shot — no next to pair with).
  const eligibleShotIds: string[] = []
  for (let i = 0; i < shots.length - 1; i++) {
    const shot = shots[i]!
    const next = shots[i + 1]!

    if (!shot.shot_intent.is_match_cut) continue
    if (shot.accepted_match_cut_break === true) continue
    if (!shot.keyframe_url) continue
    if (!next.keyframe_url) continue

    eligibleShotIds.push(shot.shot_id)
  }

  if (eligibleShotIds.length === 0) {
    return { verdicts: {}, pendingBreaks: [] }
  }

  const tasks = eligibleShotIds.map((targetShotId) => async () => {
    return runValidateMatchCut({
      supabase: args.supabase,
      pipelineId: args.pipelineId,
      stageId: args.stageId,
      sceneId: args.sceneId,
      userId: args.userId,
      plan: args.plan,
      scene: args.scene,
      targetShotId,
    })
  })

  const settled = await settledWithLimit(tasks, MATCH_CUT_CONCURRENCY, undefined, false)

  const verdicts: Record<string, MatchCutVerdict> = {}
  const pendingBreaks: string[] = []

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]!
    const targetShotId = eligibleShotIds[i]!

    if (result.status === "rejected") {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
      console.warn(
        `[match-cut-orchestrator] runValidateMatchCut failed for shot=${targetShotId} scene=${args.sceneId}: ${reason}`,
      )
      // Omit from verdicts — no entry means no gate triggered (safe fallback).
      continue
    }

    const verdict = result.value
    const matchCutVerdict: MatchCutVerdict = {
      shot_pair: verdict.shot_pair,
      match_strength: verdict.match_strength,
      suggested_adjustments: verdict.suggested_adjustments,
      checked_at: new Date().toISOString(),
    }
    verdicts[targetShotId] = matchCutVerdict

    if (verdict.match_strength === "break") {
      pendingBreaks.push(targetShotId)
    }
  }

  return { verdicts, pendingBreaks }
}
