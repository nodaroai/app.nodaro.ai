import Replicate from "replicate"
import { config } from "../../lib/config.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

export interface ScriptScene {
  readonly sceneNumber: number
  readonly visualDescription: string
  readonly action: string
  readonly mood: string
  readonly durationHint: number
  readonly imagePrompt: string
}

export interface GeneratedScript {
  readonly title: string
  readonly totalDuration: number
  readonly scenes: readonly ScriptScene[]
}

const SYSTEM_PROMPT = `You are a cinematic script writer for AI video generation. You create structured scripts that will be used to generate images and videos.

OUTPUT FORMAT: You MUST respond with ONLY valid JSON, no markdown, no code fences, no explanation. The JSON must match this exact structure:

{
  "title": "Script title",
  "totalDuration": 60,
  "scenes": [
    {
      "sceneNumber": 1,
      "visualDescription": "WIDE SHOT - Detailed cinematic description with camera angles, lighting, atmosphere",
      "action": "What happens in this scene",
      "mood": "emotional tone keywords",
      "durationHint": 8,
      "imagePrompt": "Concise, optimized prompt for AI image generation - focus on visual details, composition, lighting"
    }
  ]
}

RULES:
- visualDescription: Write cinematic descriptions with camera movements (WIDE SHOT, CLOSE-UP, TRACKING), lighting details, atmosphere, textures
- imagePrompt: Write concise prompts optimized for AI image generation - include style, composition, colors, lighting
- durationHint: Estimated seconds for this scene (all hints should sum to totalDuration)
- Each scene should flow naturally into the next
- Respond with ONLY the JSON object, nothing else`

export async function generateScript(
  prompt: string,
  sceneCount: number = 5,
  tone?: string,
  targetDuration?: number,
): Promise<GeneratedScript> {
  const duration = targetDuration ?? 60

  let userPrompt = `Create a ${sceneCount}-scene cinematic script for the following concept:\n\n${prompt}\n\nTarget duration: ${duration} seconds.`
  if (tone) {
    userPrompt += `\nTone: ${tone}`
  }

  console.log(`[generateScript] Prompt: "${prompt}", scenes: ${sceneCount}, tone: "${tone ?? "none"}"`)

  const output = await replicate.run("google/gemini-2.5-flash", {
    input: {
      prompt: `${SYSTEM_PROMPT}\n\n${userPrompt}`,
      max_tokens: 4096,
    },
  })

  const raw = Array.isArray(output) ? output.join("") : String(output)
  console.log(`[generateScript] Raw output length: ${raw.length}`)

  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim()

  try {
    const parsed = JSON.parse(cleaned) as GeneratedScript
    if (!parsed.title || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
      throw new Error("Invalid script structure: missing title or scenes")
    }
    console.log(`[generateScript] Generated "${parsed.title}" with ${parsed.scenes.length} scenes`)
    return parsed
  } catch (err) {
    console.error(`[generateScript] Failed to parse output:`, cleaned.slice(0, 200))
    throw new Error(`Failed to parse script output: ${err instanceof Error ? err.message : "Unknown error"}`)
  }
}
