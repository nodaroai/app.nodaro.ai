// Re-export shared buildScenePrompt (single source of truth for both frontend and backend)
export { buildScenePrompt, SCENE_PROMPT_MAX_LENGTH as PROMPT_MAX_LENGTH } from "@nodaro/shared"

import { SHOT_LABELS, MOVEMENT_LABELS, truncateText } from "@nodaro/shared"
import type { SceneNodeDataType } from "@/types/nodes"

/**
 * Build a video-optimized prompt from scene data.
 * Focuses on camera movement, atmosphere, lighting, and action
 * rather than static visual description.
 */
export function buildVideoPrompt(data: SceneNodeDataType): string {
  const parts: string[] = []

  // Camera: shot type + angle + movement
  const shot = SHOT_LABELS[data.shotType] ?? "MEDIUM SHOT"
  const movement = data.cameraMovement !== "static"
    ? (MOVEMENT_LABELS[data.cameraMovement] ?? data.cameraMovement).toUpperCase()
    : undefined
  parts.push(movement ? `${shot} with ${movement}` : shot)

  // Lighting / environment
  const envParts: string[] = []
  if (data.timeOfDay !== "noon") envParts.push(data.timeOfDay)
  if (data.weather !== "clear") envParts.push(data.weather)
  if (data.lighting !== "natural") envParts.push(`${data.lighting} lighting`)
  if (envParts.length > 0) parts.push(envParts.join(", "))

  // Mood / atmosphere
  if (data.mood.length > 0) {
    parts.push(`${data.mood.join(", ")} atmosphere`)
  }

  // Action: summary is the main scene description (mapped from visualDescription)
  if (data.summary.trim()) {
    parts.push(truncateText(data.summary.trim(), 500))
  }

  // Narration as action context if no summary
  if (!data.summary.trim() && data.narration.trim()) {
    parts.push(truncateText(data.narration.trim(), 300))
  }

  // Fallback to generatedPrompt (the image prompt) if nothing else
  if (parts.length <= 2 && data.generatedPrompt.trim()) {
    parts.push(truncateText(data.generatedPrompt.trim(), 400))
  }

  const result = parts.join(". ")
  return result || "smooth cinematic motion"
}
