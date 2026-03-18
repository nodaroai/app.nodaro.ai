/**
 * KIE.ai Sora Character Extraction Provider
 *
 * Extracts reusable characters from a video file or a prior Sora generation task.
 * Supports two modes:
 *   - "video": extracts from a hosted video URL (standard mode)
 *   - "sora-task": extracts from a completed Sora task by task ID + timestamps (pro mode)
 *
 * API docs: https://docs.kie.ai/market/sora2/sora-2-characters.md
 */

import { runKieTask } from "./client.js"
import { KIE_CHARACTER_MODELS } from "./models.js"

export interface SoraCharacterResult {
  characterId: string
  cost: number
  taskId?: string
}

/**
 * Extract a reusable Sora character.
 *
 * @param mode - "video" uses a hosted video URL; "sora-task" uses a prior Sora KIE task ID
 * @param characterPrompt - Text description of the character to extract
 * @param options.videoUrl - Required for "video" mode — publicly accessible video URL
 * @param options.kieTaskId - Required for "sora-task" mode — task ID from prior Sora generation
 * @param options.characterName - Display name for the character (used in "sora-task" mode)
 * @param options.timestamps - Required for "sora-task" mode — timestamp(s) to sample the character from
 * @param options.safetyInstruction - Optional safety/style guidance for "video" mode
 */
export async function extractSoraCharacter(
  mode: "video" | "sora-task",
  characterPrompt: string,
  options: {
    videoUrl?: string
    kieTaskId?: string
    characterName?: string
    timestamps?: string
    safetyInstruction?: string
  },
): Promise<SoraCharacterResult> {
  const modelConfig = mode === "video"
    ? KIE_CHARACTER_MODELS["sora-character"]
    : KIE_CHARACTER_MODELS["sora-character-pro"]

  let input: Record<string, unknown>

  if (mode === "video") {
    if (!options.videoUrl) throw new Error("videoUrl required for standard character extraction")
    input = {
      character_file_url: [options.videoUrl],
      character_prompt: characterPrompt,
      ...(options.safetyInstruction && { safety_instruction: options.safetyInstruction }),
    }
  } else {
    if (!options.kieTaskId) throw new Error("kieTaskId required for pro character extraction")
    if (!options.timestamps) throw new Error("timestamps required for pro character extraction")
    input = {
      origin_task_id: options.kieTaskId,
      timestamps: options.timestamps,
      character_user_name: options.characterName || "character",
      character_prompt: characterPrompt,
    }
  }

  const result = await runKieTask(modelConfig.model, input)

  // The KIE.ai Sora Characters endpoint returns character_id in resultJson
  // Try both snake_case and camelCase variants for robustness
  const resultJson = result.resultJson as Record<string, unknown>
  const characterId = (resultJson.character_id as string)
    || (resultJson.characterId as string)
  if (!characterId) {
    throw new Error(
      `No character_id returned from KIE.ai. resultJson: ${JSON.stringify(resultJson)}`
    )
  }

  return { characterId, cost: modelConfig.cost, taskId: result.taskId }
}
