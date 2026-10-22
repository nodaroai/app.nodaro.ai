import { resolveLlmParams, type LlmAdvancedInput } from "../../lib/llm-advanced-mode.js"
import { cheapLanesParam, type LlmCheapLanesInput } from "../../lib/llm-cheap-lanes.js"
import { llmComplete } from "../../lib/llm-client.js"
import { getLlmModel, type LlmReasoningEffort } from "@nodaro/shared/llm-models"
import type { LlmRequest } from "../../lib/llm/types.js"
import type { LlmSpend } from "../../lib/llm-billing.js"
import { SCRIPT_SCENE_COUNT_DEFAULT, SCRIPT_TARGET_DURATION_DEFAULT } from "@nodaro/shared/nodes"

export interface ScriptSceneCharacter {
  readonly name: string
  readonly description: string
  readonly mood: string
  readonly action: string
  readonly position?: string
}

export interface ScriptSceneDialogue {
  readonly speaker: string
  readonly text: string
  readonly emotion?: string
}

export interface ScriptSceneLocation {
  readonly name: string
  readonly description: string
  readonly timeOfDay: string
  readonly weather?: string
  readonly lighting?: string
}

export interface ScriptSceneCinematography {
  readonly shotType: string
  readonly cameraAngle: string
  readonly cameraMovement?: string
}

export interface ScriptScene {
  readonly sceneNumber: number
  readonly sceneName?: string
  readonly visualDescription: string
  readonly action: string
  readonly mood: string | readonly string[]
  readonly durationHint: number
  readonly duration?: number
  readonly imagePrompt: string
  readonly characters?: readonly string[] | readonly ScriptSceneCharacter[]
  readonly dialogue?: readonly ScriptSceneDialogue[]
  readonly location?: ScriptSceneLocation
  readonly cinematography?: ScriptSceneCinematography
  readonly musicMood?: string
  readonly soundEffects?: readonly string[]
}

export interface GeneratedScript {
  readonly title: string
  readonly totalDuration: number
  readonly scenes: readonly ScriptScene[]
}

const SYSTEM_PROMPT = `You are a cinematic script writer for AI video generation. You create structured scripts that will be used to generate images, videos, and audio.

OUTPUT FORMAT: You MUST respond with ONLY valid JSON, no markdown, no code fences, no explanation. The JSON must match this exact structure:

{
  "title": "Script title",
  "totalDuration": 60,
  "scenes": [
    {
      "sceneNumber": 1,
      "sceneName": "The Awakening",
      "visualDescription": "WIDE SHOT - Detailed cinematic description with camera angles, lighting, atmosphere",
      "action": "What happens in this scene",
      "characters": [
        {
          "name": "Character Name",
          "description": "Brief visual description",
          "mood": "emotional state",
          "action": "what they are doing",
          "position": "center"
        }
      ],
      "dialogue": [
        {
          "speaker": "Character Name",
          "text": "What they say",
          "emotion": "how they say it"
        }
      ],
      "location": {
        "name": "Location Name",
        "description": "Visual details of the setting",
        "timeOfDay": "dawn",
        "weather": "clear",
        "lighting": "natural"
      },
      "cinematography": {
        "shotType": "wide",
        "cameraAngle": "eye-level",
        "cameraMovement": "static"
      },
      "mood": ["tense", "mysterious"],
      "musicMood": "epic orchestral",
      "soundEffects": ["wind howling", "distant thunder"],
      "durationHint": 8,
      "duration": 8,
      "imagePrompt": "Concise prompt optimized for AI image generation"
    }
  ]
}

RULES:
- sceneName: Short evocative name for the scene (2-4 words)
- visualDescription: Write cinematic descriptions with camera movements (WIDE SHOT, CLOSE-UP, TRACKING), lighting details, atmosphere, textures
- characters: Array of objects with name, visual description, mood, action, and position (left/center/right/background). Include ALL characters visible in the scene
- dialogue: Array of spoken lines. Use "Narrator" as speaker for voiceover. Include emotion hints. Only include if the scene has speech
- location: Describe the setting with time of day (dawn/morning/noon/afternoon/evening/night), weather (clear/cloudy/rainy/stormy/snowy/foggy), and lighting (natural/dramatic/soft/harsh/backlit/neon)
- cinematography: Suggest shot type (extreme-wide/wide/medium-wide/medium/medium-close/close-up/extreme-close-up), camera angle (eye-level/low-angle/high-angle/birds-eye/worms-eye/dutch), and camera movement (static/pan/tilt/dolly/tracking/crane/handheld/zoom)
- mood: Array of 1-3 mood keywords (e.g. ["tense", "mysterious"])
- musicMood: Background music feel (e.g. "epic orchestral", "gentle piano", "dark ambient")
- soundEffects: Array of ambient/SFX sounds for the scene
- duration: Scene duration in seconds (integer). All durations should sum to totalDuration
- durationHint: Same as duration (for backward compatibility)
- imagePrompt: Write concise prompts optimized for AI image generation - include style, composition, colors, lighting
- Each scene should flow naturally into the next
- Respond with ONLY the JSON object, nothing else`

// The model resolution lives in a leaf the billing estimator reads too.
export { resolveScriptModelId, type ScriptProvider } from "./script-model-id.js"
import { resolveScriptModelId, type ScriptProvider } from "./script-model-id.js"

/** What `generateScript` is asked: the topic and the node's settings. */
export interface ScriptRequestInput {
  prompt: string
  sceneCount?: number
  tone?: string
  targetDuration?: number
  provider?: ScriptProvider
  llmModel?: string
  reasoningEffort?: string
  /** Advanced-mode params. */
  advanced?: LlmAdvancedInput
  /** The node's style guide: how the script should read and look. */
  brief?: { styleGuide?: string }
  /** "Cheap lanes only" (lib/llm-cheap-lanes.ts): no direct-vendor fallback. */
  lanes?: LlmCheapLanesInput
}

/**
 * The request `generateScript` sends, built in ONE place: the call itself and
 * the metered hold reserved before it (the route's `reserveLlmCall` and the
 * workflow engine's `computeLlmMeteredHold`) read the same request, so the
 * hold is sized from what is really sent — model (the legacy `provider` alias
 * included), output cap, Advanced pin and lanes.
 */
export function buildScriptRequest(input: ScriptRequestInput): LlmRequest {
  const resolvedModelId = resolveScriptModelId(input.provider, input.llmModel)
  const sceneCount = input.sceneCount ?? SCRIPT_SCENE_COUNT_DEFAULT
  const duration = input.targetDuration ?? SCRIPT_TARGET_DURATION_DEFAULT

  let userPrompt = `Create a ${sceneCount}-scene cinematic script for the following concept:\n\n${input.prompt}\n\nTarget duration: ${duration} seconds.`
  if (input.tone) {
    userPrompt += `\nTone: ${input.tone}`
  }
  if (input.brief?.styleGuide) {
    userPrompt += `\n\nStyle guide (follow it for the writing, the visuals and the pacing):\n${input.brief.styleGuide}`
  }

  const modelMaxTokens = getLlmModel(resolvedModelId)?.maxOutputTokens ?? 16384
  return {
    modelId: resolvedModelId,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    reasoningEffort: input.reasoningEffort as LlmReasoningEffort | undefined,
    ...resolveLlmParams(input.advanced ?? {}, { maxTokens: Math.min(modelMaxTokens, 16384) }),
    ...cheapLanesParam(input.lanes),
  }
}

export async function generateScript(
  prompt: string,
  sceneCount: number = SCRIPT_SCENE_COUNT_DEFAULT,
  tone?: string,
  targetDuration?: number,
  provider?: ScriptProvider,
  llmModel?: string,
  reasoningEffort?: string,
  /** Advanced-mode params. An OBJECT rather than a 9th positional scalar —
   *  this signature is already 7 deep and every existing call site passes
   *  positionally. */
  advanced?: LlmAdvancedInput,
  /** The node's style guide: how the script should read and look. */
  brief?: { styleGuide?: string },
  /** "Cheap lanes only" (lib/llm-cheap-lanes.ts): no direct-vendor fallback. */
  lanes?: LlmCheapLanesInput,
  /**
   * The job's metered spend: the call is recorded on it — answered (even when
   * the answer then fails to parse, which is still a billed call) or failed
   * with billed usage — so the worker settles what the call really cost.
   */
  spend?: Pick<LlmSpend, "add">,
): Promise<GeneratedScript> {
  const request = buildScriptRequest({ prompt, sceneCount, tone, targetDuration, provider, llmModel, reasoningEffort, advanced, brief, lanes })
  const resolvedModelId = request.modelId

  const modelDef = getLlmModel(resolvedModelId)
  console.log(`[generateScript] Model: ${resolvedModelId} (${modelDef?.displayName ?? "unknown"})`)
  console.log(`[generateScript] Prompt: "${prompt}", scenes: ${sceneCount}, tone: "${tone ?? "none"}"`)

  let response: Awaited<ReturnType<typeof llmComplete>>
  try {
    response = await llmComplete(request)
  } catch (err) {
    spend?.add(resolvedModelId, request, { error: err })
    throw err
  }
  spend?.add(resolvedModelId, request, { response })

  const raw = response.text
  console.log(`[generateScript] Raw output length: ${raw.length}`)

  if (!raw || raw.trim().length === 0) {
    throw new Error("LLM returned empty response — try a different model")
  }

  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim()

  try {
    const parsed = JSON.parse(cleaned) as GeneratedScript
    if (!parsed.title || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
      throw new Error("Invalid script structure: missing title or scenes")
    }
    // Normalize: ensure duration and durationHint are both set
    const normalizedScenes = parsed.scenes.map((scene) => ({
      ...scene,
      duration: scene.duration ?? scene.durationHint,
      durationHint: scene.durationHint ?? scene.duration ?? 5,
      mood: Array.isArray(scene.mood) ? scene.mood : scene.mood ? [scene.mood] : [],
    }))
    const result: GeneratedScript = { ...parsed, scenes: normalizedScenes }
    console.log(`[generateScript] Generated "${result.title}" with ${result.scenes.length} scenes`)
    return result
  } catch (err) {
    console.error(`[generateScript] Failed to parse output:`, cleaned.slice(0, 200))
    throw new Error(`Failed to parse script output: ${err instanceof Error ? err.message : "Unknown error"}`)
  }
}
