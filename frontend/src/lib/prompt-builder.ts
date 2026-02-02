import type { SceneNodeDataType, CharacterDefinition } from "@/types/nodes"

export const PROMPT_MAX_LENGTH = 2000
const PROMPT_SAFE_LENGTH = 1800

const SHOT_LABELS: Record<string, string> = {
  "extreme-wide": "EXTREME WIDE SHOT",
  "wide": "WIDE SHOT",
  "medium-wide": "MEDIUM WIDE SHOT",
  "medium": "MEDIUM SHOT",
  "medium-close": "MEDIUM CLOSE-UP",
  "close-up": "CLOSE-UP",
  "extreme-close-up": "EXTREME CLOSE-UP",
}

const ANGLE_LABELS: Record<string, string> = {
  "eye-level": "eye level",
  "low-angle": "low angle",
  "high-angle": "high angle",
  "birds-eye": "bird's eye view",
  "worms-eye": "worm's eye view",
  "dutch": "dutch angle",
}

const ASPECT_RATIO_LABELS: Record<string, string> = {
  "16:9": "wide landscape composition",
  "9:16": "vertical portrait composition",
  "1:1": "square composition",
  "4:3": "classic frame composition",
  "21:9": "ultrawide cinematic composition",
  "4:5": "tall portrait composition",
}

const MOVEMENT_LABELS: Record<string, string> = {
  static: "static camera",
  pan: "camera panning",
  tilt: "camera tilting",
  dolly: "dolly shot",
  tracking: "tracking shot",
  crane: "crane shot",
  handheld: "handheld camera",
  zoom: "zoom",
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 3) + "..."
}

export function buildScenePrompt(
  data: SceneNodeDataType,
  assets: readonly CharacterDefinition[],
  options?: { forDisplay?: boolean }
): string {
  const noTruncate = options?.forDisplay === true
  const t = noTruncate ? (text: string, _max: number) => text : truncate
  // High priority parts (always included)
  const highParts: string[] = []
  // Medium priority parts (dropped if over limit)
  const medParts: string[] = []
  // Low priority parts (dropped first if over limit)
  const lowParts: string[] = []

  // Shot type and angle (high)
  const shot = SHOT_LABELS[data.shotType] ?? "MEDIUM SHOT"
  const angle = ANGLE_LABELS[data.cameraAngle] ?? "eye level"
  highParts.push(`${shot}, ${angle}`)

  // Aspect ratio composition hint (medium)
  if (data.aspectRatio && data.aspectRatio !== "16:9") {
    const ratioLabel = ASPECT_RATIO_LABELS[data.aspectRatio]
    if (ratioLabel) medParts.push(ratioLabel)
  }

  // Characters with mood and action (high, but truncate descriptions)
  if (data.characters.length > 0) {
    const maxDescLen = data.characters.length > 2 ? 80 : 150
    const charDescs = data.characters.map((entry) => {
      const asset = assets.find((a) => a.id === entry.assetId)
      const name = asset?.name ?? "a figure"
      const desc = asset?.description ? `, ${t(asset.description, maxDescLen)}` : ""
      const mood = entry.mood ? `, ${entry.mood}` : ""
      const action = entry.action ? ` ${entry.action}` : ""
      const pos = entry.positionInFrame ? ` (${entry.positionInFrame})` : ""
      return `${name}${desc}${mood}${action}${pos}`
    })
    highParts.push(`of ${charDescs.join(" and ")}`)
  }

  // Locations (high, but truncate names)
  if (data.locations?.length > 0) {
    const locDescs = data.locations.map((loc) => {
      const asset = assets.find((a) => a.id === loc.assetId)
      const rawName = loc.name ?? asset?.description ?? asset?.name ?? "location"
      const name = t(rawName, 120)
      const envParts: string[] = []
      const tod = loc.timeOfDay ?? data.timeOfDay
      const wth = loc.weather ?? data.weather
      const lit = loc.lighting ?? data.lighting
      if (tod !== "noon") envParts.push(`${tod} light`)
      if (wth !== "clear") envParts.push(wth)
      if (lit !== "natural") envParts.push(`${lit} lighting`)
      return envParts.length > 0 ? `${name} (${envParts.join(", ")})` : name
    })
    highParts.push(`in ${locDescs.join(" and ")}`)
  } else {
    const envParts: string[] = []
    if (data.timeOfDay !== "noon") envParts.push(`${data.timeOfDay} light`)
    if (data.weather !== "clear") envParts.push(data.weather)
    if (data.lighting !== "natural") envParts.push(`${data.lighting} lighting`)
    if (envParts.length > 0) highParts.push(envParts.join(", "))
  }

  // Objects (medium)
  if (data.objects.length > 0) {
    const objDescs = data.objects.map((o) => {
      const asset = assets.find((a) => a.id === o.assetId)
      return o.description ?? asset?.name ?? "object"
    })
    medParts.push(`with ${objDescs.join(", ")}`)
  }

  // Mood (medium)
  if (data.mood.length > 0) {
    medParts.push(`${data.mood.join(", ")} atmosphere`)
  }

  // Visual style (medium)
  if (data.visualStyle) {
    medParts.push(`${data.visualStyle} style`)
  }

  // Depth of field (low)
  if (data.depthOfField !== "medium") {
    lowParts.push(`${data.depthOfField} depth of field`)
  }

  // Lens (low)
  if (data.lensType !== "normal") {
    lowParts.push(`${data.lensType} lens`)
  }

  // Camera movement (medium)
  if (data.cameraMovement !== "static") {
    medParts.push(MOVEMENT_LABELS[data.cameraMovement] ?? data.cameraMovement)
  }

  // Color palette (low)
  if (data.colorPalette.length > 0) {
    lowParts.push(`${data.colorPalette.join(", ")} color palette`)
  }

  // Summary as additional context (medium, truncated)
  if (data.summary.trim()) {
    medParts.push(t(data.summary.trim(), 300))
  }

  // Dialogue context (low, truncated)
  if (data.dialogue?.length > 0) {
    const dialogueDesc = data.dialogue
      .filter((d) => d.text.trim())
      .map((d) => `${d.characterName}${d.emotion ? ` (${d.emotion})` : ""}: "${t(d.text.trim(), 80)}"`)
      .join("; ")
    if (dialogueDesc) lowParts.push(`dialogue: ${t(dialogueDesc, 250)}`)
  }

  // Director notes (low, truncated)
  if (data.directorNotes?.trim()) {
    lowParts.push(t(data.directorNotes.trim(), 200))
  }

  // Assemble with progressive dropping
  let result = [...highParts, ...medParts, ...lowParts].join(", ")

  if (!noTruncate) {
    if (result.length > PROMPT_SAFE_LENGTH) {
      // Drop low priority parts one by one from the end
      let dropCount = 0
      while (dropCount < lowParts.length && result.length > PROMPT_SAFE_LENGTH) {
        dropCount++
        result = [...highParts, ...medParts, ...lowParts.slice(0, lowParts.length - dropCount)].join(", ")
      }
    }

    if (result.length > PROMPT_SAFE_LENGTH) {
      // Drop medium priority parts one by one from the end
      const medRemaining = [...medParts]
      while (medRemaining.length > 0 && result.length > PROMPT_SAFE_LENGTH) {
        medRemaining.pop()
        result = [...highParts, ...medRemaining].join(", ")
      }
    }

    // Final hard truncation as safety net
    if (result.length > PROMPT_MAX_LENGTH) {
      result = result.slice(0, PROMPT_MAX_LENGTH - 3) + "..."
    }
  }

  return result
}

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
    parts.push(truncate(data.summary.trim(), 500))
  }

  // Narration as action context if no summary
  if (!data.summary.trim() && data.narration.trim()) {
    parts.push(truncate(data.narration.trim(), 300))
  }

  // Fallback to generatedPrompt (the image prompt) if nothing else
  if (parts.length <= 2 && data.generatedPrompt.trim()) {
    parts.push(truncate(data.generatedPrompt.trim(), 400))
  }

  const result = parts.join(". ")
  return result || "smooth cinematic motion"
}
