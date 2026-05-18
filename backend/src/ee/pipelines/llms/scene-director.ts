import type { SupabaseClient } from "@supabase/supabase-js"
import {
  SceneNodeDataSchema,
  type SceneNodeData,
  modelsForInputMode,
  VIDEO_MODEL_CAPS,
  type SceneInputMode,
  type ShowrunnerPlan,
} from "@nodaro/shared"
import { callLLM } from "./call-llm.js"

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

CAPABILITY REGISTRY (video models eligible for this scene's input mode):
\`\`\`json
${JSON.stringify(eligibleVideoModelsWithStyle, null, 2)}
\`\`\`

CAPABILITY REGISTRY (image models — all eligible in Phase 1B.2):
- nano-banana-2
- flux-pro
- gpt-image

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

  return result.output
}
