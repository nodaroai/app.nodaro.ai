import { llmComplete } from "../../lib/llm-client.js"
import { getLlmModel, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"

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

export type ScriptProvider = "gemini" | "claude" | "gpt"

/** Legacy provider names → new LLM model IDs */
const LEGACY_PROVIDER_MAP: Record<string, string> = {
  gemini: "gemini-3-flash",
  claude: "claude-sonnet-4.6",
  gpt: "gpt-5.2",
}

export async function generateScript(
  prompt: string,
  sceneCount: number = 5,
  tone?: string,
  targetDuration?: number,
  provider?: ScriptProvider,
  llmModel?: string,
): Promise<GeneratedScript> {
  // Resolve model: prefer explicit llmModel, then map legacy provider, then feature default
  let resolvedModelId = llmModel
  if (!resolvedModelId && provider) {
    resolvedModelId = LEGACY_PROVIDER_MAP[provider]
  }
  if (!resolvedModelId) {
    resolvedModelId = LLM_FEATURE_DEFAULTS["generate-script"]
  }

  const duration = targetDuration ?? 60

  let userPrompt = `Create a ${sceneCount}-scene cinematic script for the following concept:\n\n${prompt}\n\nTarget duration: ${duration} seconds.`
  if (tone) {
    userPrompt += `\nTone: ${tone}`
  }

  const modelDef = getLlmModel(resolvedModelId)
  console.log(`[generateScript] Model: ${resolvedModelId} (${modelDef?.displayName ?? "unknown"})`)
  console.log(`[generateScript] Prompt: "${prompt}", scenes: ${sceneCount}, tone: "${tone ?? "none"}"`)

  const modelMaxTokens = modelDef?.maxOutputTokens ?? 16384
  const response = await llmComplete({
    modelId: resolvedModelId,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    maxTokens: Math.min(modelMaxTokens, 16384),
  })

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
