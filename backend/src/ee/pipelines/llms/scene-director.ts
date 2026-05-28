import type { SupabaseClient } from "@supabase/supabase-js"
import {
  PIPELINE_PINNABLE_IMAGE_MODELS,
  SceneNodeDataSchema,
  type SceneNodeData,
  modelsForInputMode,
  VIDEO_MODEL_CAPS,
  type SceneInputMode,
  type ShowrunnerPlan,
} from "@nodaro/shared"
import { callLLM } from "./call-llm.js"
import { pipelineEvents } from "../events.js"

const _REDACTED_PROMPT_3 = `[REDACTED — moved to private plugin, S9 extraction]`

export interface RunSceneDirectorArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  userId: string
  sceneId: string // pipeline_entities.id for the scene entity
  plan: ShowrunnerPlan
  sceneIndex: number // 1-based; resolves against plan.scenes
  shotInputMode: SceneInputMode
  criticFeedback?: unknown
  // Pre-built lookup maps to avoid O(N×M) scans per scene. Built once in shot-list.ts.
  castByKey?: Map<string, ShowrunnerPlan["cast"][number]>
  locationsByKey?: Map<string, ShowrunnerPlan["locations"][number]>
  objectsByKey?: Map<string, ShowrunnerPlan["objects"][number]>
  /**
   * User picks (from `pipelines.config.image_model` /
   * `stage_models.scene_keyframes_image`). When set, the LLM is constrained
   * to ONLY this identifier. When unset, the full capability registry is
   * offered and the LLM picks per-shot (today's behavior).
   */
  imageModelOverride?: string
  /**
   * Same idea for video. The override MUST still be in the per-input-mode
   * eligible set; an incompatible pick is silently dropped so the LLM keeps
   * picking from the full eligible list (it would otherwise be rejected by
   * the post-LLM validation gate at the bottom of this function).
   */
  videoModelOverride?: string
}

export async function runSceneDirector(args: RunSceneDirectorArgs): Promise<SceneNodeData> {
  const scene = args.plan.scenes.find((s) => s.scene_index === args.sceneIndex)
  if (!scene) {
    throw new Error(`Scene ${args.sceneIndex} not found in Showrunner plan`)
  }

  // Resolve cast/location/object refs (description-only — assets land in Stage 6).
  // Prefer pre-built Maps when provided (shot-list.ts builds them once for the whole
  // stage to avoid O(N×M) scans per scene); fall back to find() so the helper is
  // standalone-callable.
  const castRefs = scene.cast_keys.map((key) => {
    const c = args.castByKey?.get(key) ?? args.plan.cast.find((x) => x.key === key)
    return c
      ? { key, name: c.name, visual_description: c.visual_description, voice_profile: c.voice_profile }
      : { key, name: key, visual_description: "(unknown — Detection missed it)", voice_profile: "neutral" }
  })
  const locationRef = (() => {
    const l =
      args.locationsByKey?.get(scene.location_key) ??
      args.plan.locations.find((x) => x.key === scene.location_key)
    return l
      ? { key: l.key, name: l.name, visual_description: l.visual_description }
      : { key: scene.location_key, name: scene.location_key, visual_description: "(unknown)" }
  })()
  const objectRefs = scene.object_keys.map((key) => {
    const o = args.objectsByKey?.get(key) ?? args.plan.objects.find((x) => x.key === key)
    return o
      ? { key, name: o.name, visual_description: o.visual_description }
      : { key, name: key, visual_description: "(unknown)" }
  })

  const eligibleVideoModels = modelsForInputMode(args.shotInputMode)
  if (eligibleVideoModels.length === 0) {
    throw new Error(
      `No video models support shot_input_mode='${args.shotInputMode}' (no entries in VIDEO_MODEL_CAPS yet)`,
    )
  }
  const eligibleVideoModelsWithStyle = eligibleVideoModels.map((m) => ({
    model: m,
    prompting_style: VIDEO_MODEL_CAPS[m]!.prompting_style,
    maxDurationSeconds: VIDEO_MODEL_CAPS[m]!.maxDurationSeconds,
  }))

  // User overrides: narrow what we tell the LLM about.
  //
  // For VIDEO: an incompatible pick (one that's not in the per-input-mode
  // eligible set) is dropped — rather than crashing the stage — so a single
  // misconfigured pipeline doesn't fail every scene. We surface it as a
  // pipeline:warning event so the UI shows the user that their pin didn't
  // apply and they got the Director's pick instead. Billing-affecting code
  // path; silent drops are not OK.
  //
  // For IMAGE: we additionally re-validate against the pinnable allowlist
  // (defense-in-depth — the Zod schema in `PipelineConfigSchema` should have
  // caught any non-allowlist string at the route, but if a future codepath
  // bypasses Zod we mustn't propagate an arbitrary user string into the LLM
  // prompt — prompt-injection vector).
  const userVideoPick =
    args.videoModelOverride &&
    eligibleVideoModels.includes(args.videoModelOverride as (typeof eligibleVideoModels)[number])
      ? args.videoModelOverride
      : undefined
  if (args.videoModelOverride && !userVideoPick) {
    pipelineEvents.publish({
      type: "pipeline:warning",
      pipelineId: args.pipelineId,
      code: "video_model_override_dropped",
      message: `Pinned video_model='${args.videoModelOverride}' isn't compatible with shot_input_mode='${args.shotInputMode}'. Using the Director's per-shot pick instead.`,
    })
  }
  const videoModelsForPrompt = userVideoPick
    ? eligibleVideoModelsWithStyle.filter((m) => m.model === userVideoPick)
    : eligibleVideoModelsWithStyle

  const userImagePick =
    args.imageModelOverride &&
    (PIPELINE_PINNABLE_IMAGE_MODELS as readonly string[]).includes(args.imageModelOverride)
      ? args.imageModelOverride
      : undefined
  if (args.imageModelOverride && !userImagePick) {
    pipelineEvents.publish({
      type: "pipeline:warning",
      pipelineId: args.pipelineId,
      code: "image_model_override_dropped",
      message: `Pinned image_model='${args.imageModelOverride}' isn't on the pinnable allowlist. Letting the Director pick.`,
    })
  }
  const imageRegistrySection = userImagePick
    ? `CAPABILITY REGISTRY (image model — user-pinned for this pipeline):
- ${userImagePick}

You MUST set image_model="${userImagePick}" for every shot. Do not pick anything else.`
    : `CAPABILITY REGISTRY (image models — all eligible in Phase 1B.2):
- nano-banana-2
- flux
- gpt-image`

  const criticPreamble = args.criticFeedback
    ? `\n\nPRIOR ATTEMPT WAS REJECTED BY THE SHOT LIST CRITIC:\n${JSON.stringify(args.criticFeedback, null, 2)}\n\nAddress every blocking issue.\n\n`
    : ""

  const userPrompt = `${criticPreamble}SHOWRUNNER CONTEXT:
- title: ${args.plan.title}
- format: ${args.plan.format}
- global_style: ${JSON.stringify(args.plan.global_style, null, 2)}
- bpm_target: ${args.plan.music_plan.bpm_target}
- beats this scene serves: ${
    args.plan.beats
      .filter((b) => b.scene_indices.includes(args.sceneIndex))
      .map((b) => b.type)
      .join(", ") || "(none)"
  }

THIS SCENE (SceneSpec):
\`\`\`json
${JSON.stringify(scene, null, 2)}
\`\`\`

RESOLVED REFS:
- cast: ${JSON.stringify(castRefs, null, 2)}
- location: ${JSON.stringify(locationRef, null, 2)}
- objects: ${JSON.stringify(objectRefs, null, 2)}

USER PREFERENCES:
- shot_input_mode: ${args.shotInputMode}

CAPABILITY REGISTRY (video models eligible for this scene's input mode${userVideoPick ? " — user-pinned" : ""}):
\`\`\`json
${JSON.stringify(videoModelsForPrompt, null, 2)}
\`\`\`
${userVideoPick ? `\nYou MUST set video_model="${userVideoPick}" for every shot.\n` : ""}
${imageRegistrySection}

Return a SceneNodeData via the emit tool.`

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    sceneId: args.sceneId,
    userId: args.userId,
    role: "scene_director",
    task: "shot_list",
    modelId: "claude-sonnet-4-6",
    temperature: 0.5,
    systemPrompt: '[REDACTED]',
    userPrompt,
    schema: SceneNodeDataSchema,
    maxRetries: 1,
  })

  // Post-validate: video_model must be in eligibleVideoModels (defense-in-depth).
  if (!eligibleVideoModels.includes(result.output.video_model)) {
    throw new Error(
      `Scene Director picked video_model='${result.output.video_model}' which is not eligible for shot_input_mode='${args.shotInputMode}'. Eligible: ${eligibleVideoModels.join(", ")}`,
    )
  }
  // Post-validate: when the user pinned an image model, force the LLM's pick
  // to honor it. The prompt told the LLM to use only `userImagePick`, but
  // historically non-Sonnet models have ignored prompt constraints. Symmetric
  // to the video gate above, but we coerce rather than throw because the
  // user's billing was already estimated assuming their pinned model.
  if (userImagePick && result.output.image_model !== userImagePick) {
    return { ...result.output, image_model: userImagePick }
  }

  return result.output
}
