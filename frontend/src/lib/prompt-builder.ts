import type { SceneNodeDataType, CharacterDefinition } from "@/types/nodes"

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

export function buildScenePrompt(
  data: SceneNodeDataType,
  assets: readonly CharacterDefinition[]
): string {
  const parts: string[] = []

  // Shot type and angle
  const shot = SHOT_LABELS[data.shotType] ?? "MEDIUM SHOT"
  const angle = ANGLE_LABELS[data.cameraAngle] ?? "eye level"
  parts.push(`${shot}, ${angle}`)

  // Characters with mood and action
  if (data.characters.length > 0) {
    const charDescs = data.characters.map((entry) => {
      const asset = assets.find((a) => a.id === entry.assetId)
      const name = asset?.name ?? "a figure"
      const desc = asset?.description ? `, ${asset.description}` : ""
      const mood = entry.mood ? `, ${entry.mood}` : ""
      const action = entry.action ? ` ${entry.action}` : ""
      const pos = entry.positionInFrame ? ` (${entry.positionInFrame})` : ""
      return `${name}${desc}${mood}${action}${pos}`
    })
    parts.push(`of ${charDescs.join(" and ")}`)
  }

  // Location
  const locationAsset = data.locationAssetId
    ? assets.find((a) => a.id === data.locationAssetId)
    : undefined
  if (locationAsset) {
    const locDesc = locationAsset.description ?? locationAsset.name
    parts.push(`in ${locDesc}`)
  }

  // Time, weather, lighting
  const envParts: string[] = []
  if (data.timeOfDay !== "noon") envParts.push(`${data.timeOfDay} light`)
  if (data.weather !== "clear") envParts.push(data.weather)
  if (data.lighting !== "natural") envParts.push(`${data.lighting} lighting`)
  if (envParts.length > 0) parts.push(envParts.join(", "))

  // Objects
  if (data.objects.length > 0) {
    const objDescs = data.objects.map((o) => {
      const asset = assets.find((a) => a.id === o.assetId)
      return o.description ?? asset?.name ?? "object"
    })
    parts.push(`with ${objDescs.join(", ")}`)
  }

  // Mood
  if (data.mood.length > 0) {
    parts.push(`${data.mood.join(", ")} atmosphere`)
  }

  // Visual style
  if (data.visualStyle) {
    parts.push(`${data.visualStyle} style`)
  }

  // Depth of field
  if (data.depthOfField !== "medium") {
    parts.push(`${data.depthOfField} depth of field`)
  }

  // Lens
  if (data.lensType !== "normal") {
    parts.push(`${data.lensType} lens`)
  }

  // Camera movement
  if (data.cameraMovement !== "static") {
    parts.push(MOVEMENT_LABELS[data.cameraMovement] ?? data.cameraMovement)
  }

  // Color palette
  if (data.colorPalette.length > 0) {
    parts.push(`${data.colorPalette.join(", ")} color palette`)
  }

  // Summary as additional context
  if (data.summary.trim()) {
    parts.push(data.summary.trim())
  }

  // Dialogue context
  if (data.dialogue?.length > 0) {
    const dialogueDesc = data.dialogue
      .filter((d) => d.text.trim())
      .map((d) => `${d.characterName}${d.emotion ? ` (${d.emotion})` : ""}: "${d.text.trim()}"`)
      .join("; ")
    if (dialogueDesc) parts.push(`dialogue: ${dialogueDesc}`)
  }

  // Director notes
  if (data.directorNotes?.trim()) {
    parts.push(data.directorNotes.trim())
  }

  return parts.join(", ")
}
