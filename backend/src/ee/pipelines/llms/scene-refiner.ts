/**
 * Phase 2 (granular-pipeline-control spec) — Scene Refiner.
 *
 * Regenerates ONE scene from an existing ShowrunnerPlan based on user
 * feedback. Unlike the full Showrunner, the rosters (cast / locations /
 * objects) are LOCKED — the refiner may only reference entities that
 * already exist in the plan.
 *
 * Design choice (vs. full-plan regen): a single SceneSpec LLM call costs
 * ~1/9th of a full plan and is deterministic in scope (no risk of the LLM
 * silently rewriting other scenes the user already approved or inline-
 * edited). The plan's adjacent scenes (prev + next) are passed as context
 * so the refined scene stays coherent.
 *
 * Validation after emit:
 *   - scene_index is force-corrected to args.sceneIndex (LLM occasionally
 *     emits a different index; we don't trust it)
 *   - cast_keys / location_key / object_keys must reference entries from
 *     the plan's rosters. If any ref is invalid, the helper returns
 *     `{ok:false, reason:"roster_ref_invalid"}` and the route surfaces a
 *     422 — the user retries with clearer feedback.
 *   - Duration is NOT hard-validated. The Phase 1 duration meter already
 *     surfaces drift; the user decides.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { SceneSpecSchema, type ShowrunnerPlan } from "@nodaro/shared"
import { callLLM } from "./call-llm.js"

type SceneSpec = ShowrunnerPlan["scenes"][number]

const _REDACTED_PROMPT_5 = `[REDACTED — moved to private plugin, S9 extraction]`

export interface RunSceneRefinerArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  userId: string
  /** Full current plan — used as locked context for the LLM. */
  plan: ShowrunnerPlan
  /** Index of the scene to refine (0-based against plan.scenes). */
  sceneIndex: number
  /** User's free-form guidance, e.g. "make it more tense" or "shorter — 4 seconds". */
  feedback: string
}

export type RunSceneRefinerResult =
  | { ok: true; newScene: SceneSpec }
  | { ok: false; reason: "scene_index_out_of_range"; detail: { sceneIndex: number; sceneCount: number } }
  | {
      ok: false
      reason: "roster_ref_invalid"
      detail: {
        invalid_cast_keys?: string[]
        invalid_location_key?: string
        invalid_object_keys?: string[]
      }
    }

export async function runSceneRefiner(args: RunSceneRefinerArgs): Promise<RunSceneRefinerResult> {
  const { supabase, pipelineId, stageId, userId, plan, sceneIndex, feedback } = args

  // 1. Cheap pre-check: scene_index in range BEFORE any LLM call.
  if (sceneIndex < 0 || sceneIndex >= plan.scenes.length) {
    return {
      ok: false,
      reason: "scene_index_out_of_range",
      detail: { sceneIndex, sceneCount: plan.scenes.length },
    }
  }

  const targetScene = plan.scenes[sceneIndex]!
  const prevScene = sceneIndex > 0 ? plan.scenes[sceneIndex - 1]! : null
  const nextScene = sceneIndex < plan.scenes.length - 1 ? plan.scenes[sceneIndex + 1]! : null

  // 2. Build the user prompt. Full plan as locked context + target + adjacent
  //    scenes (for transition coherence) + the user's feedback verbatim.
  const userPrompt = `FULL PLAN (locked context — only the target scene will be replaced):
\`\`\`json
${JSON.stringify(plan, null, 2)}
\`\`\`

TARGET SCENE INDEX: ${sceneIndex}

CURRENT TARGET SCENE:
\`\`\`json
${JSON.stringify(targetScene, null, 2)}
\`\`\`

ADJACENT CONTEXT (for transition coherence):
- Previous scene: ${prevScene ? JSON.stringify(prevScene, null, 2) : '"none — this is the first scene"'}
- Next scene: ${nextScene ? JSON.stringify(nextScene, null, 2) : '"none — this is the last scene"'}

USER FEEDBACK:
"""
${feedback}
"""

Emit the regenerated SceneSpec via the emit tool.`

  // 3. Call the LLM. Sonnet 4.6, temp 0.4 to match Showrunner. maxRetries=1
  //    — Sonnet's roster-ref errors don't improve with auto-retry; let the
  //    user re-prompt with clearer feedback instead.
  const result = await callLLM({
    supabase,
    pipelineId,
    stageId,
    userId,
    role: "specialist",
    task: "regenerate_scene",
    modelId: "claude-sonnet-4-6",
    temperature: 0.4,
    systemPrompt: '[REDACTED]',
    userPrompt,
    schema: SceneSpecSchema,
    maxRetries: 1,
  })

  // 4. Force-correct scene_index — Sonnet sometimes emits a different value
  //    despite the prompt directive. We trust the caller's sceneIndex.
  const emittedScene: SceneSpec = { ...result.output, scene_index: sceneIndex + 1 }
  // NOTE: schema's scene_index is 1-based (min(1)), so we store sceneIndex + 1.
  // The route still uses the 0-based index for array operations.

  // 5. Validate roster references against the LOCKED rosters.
  const validCastKeys = new Set(plan.cast.map((c) => c.key))
  const validLocationKeys = new Set(plan.locations.map((l) => l.key))
  const validObjectKeys = new Set(plan.objects.map((o) => o.key))

  const invalidCastKeys = emittedScene.cast_keys.filter((k) => !validCastKeys.has(k))
  const invalidLocationKey = validLocationKeys.has(emittedScene.location_key)
    ? undefined
    : emittedScene.location_key
  const invalidObjectKeys = emittedScene.object_keys.filter((k) => !validObjectKeys.has(k))

  if (invalidCastKeys.length > 0 || invalidLocationKey || invalidObjectKeys.length > 0) {
    return {
      ok: false,
      reason: "roster_ref_invalid",
      detail: {
        ...(invalidCastKeys.length > 0 ? { invalid_cast_keys: invalidCastKeys } : {}),
        ...(invalidLocationKey ? { invalid_location_key: invalidLocationKey } : {}),
        ...(invalidObjectKeys.length > 0 ? { invalid_object_keys: invalidObjectKeys } : {}),
      },
    }
  }

  return { ok: true, newScene: emittedScene }
}
