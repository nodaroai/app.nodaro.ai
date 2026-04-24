/**
 * Read the "primary value" of a parameter node directly from its data.
 *
 * Parameter nodes (framing, camera-motion, motion, tone, etc.) are pickers on
 * canvas — they don't execute, so they produce no NodeExecutionState.output on
 * the backend. Both the frontend extractNodeOutput fallthrough and the backend
 * resolver adapter call this when a mapped source is a parameter node, so that
 * fieldMappings on non-text fields (framing, cameraMotion, etc.) resolve
 * correctly at execution time.
 */

export const PARAMETER_NODE_TYPES: ReadonlySet<string> = new Set([
  "text-prompt",
  "tone",
  "style-guide",
  "motion",
  "camera-motion",
  "framing",
  "lens",
  "camera-format",
  "lighting",
  "color-look",
  "atmosphere",
  "style",
  "setting",
  "person",
  "mood",
  "pose",
  "styling",
  "temporal",
  "material",
  "animal",
  "vehicle",
  "weapon",
  "scene-count",
  "duration",
  "aspect-ratio",
])

export function getParameterValue(
  data: Record<string, unknown>,
  nodeType: string,
): string | undefined {
  switch (nodeType) {
    case "text-prompt":
      return trim(data.text)
    case "tone":
      return trim(data.tone)
    case "style-guide":
      return trim(data.text)
    case "motion":
      return trim(data.motion)
    case "camera-motion":
      return trim(data.cameraMotion)
    case "framing":
      // Multi-category: return the first set per-category value (used for
      // single-string field-mapping resolution; full hint composition goes
      // through buildFramingHints in the executors).
      return (
        trim(data.shotSize) ??
        trim(data.angle) ??
        trim(data.coverage) ??
        trim(data.composition) ??
        trim(data.vantage)
      )
    case "lens":
      return trim(data.lens)
    case "camera-format":
      return trim(data.cameraFormat)
    case "lighting":
      // Multi-category: return the first set per-category value (used for
      // single-string field-mapping resolution; full hint composition goes
      // through buildLightingHints in the executors).
      return (
        trim(data.timeOfDay) ??
        trim(data.lightingStyle) ??
        trim(data.lightingDirection)
      )
    case "color-look":
      return trim(data.colorLook)
    case "atmosphere":
      return trim(data.atmosphere)
    case "style":
      return trim(data.style)
    case "setting":
      return trim(data.setting)
    case "material":
      return trim(data.material)
    case "animal":
      return trim(data.animal)
    case "vehicle":
      return trim(data.vehicle)
    case "weapon":
      return trim(data.weapon)
    case "person":
      // Multi-dimension: return the first set per-dimension value (used for
      // single-string field-mapping resolution; full hint composition goes
      // through buildPersonHints in the executors).
      return (
        trim(data.type) ??
        trim(data.age) ??
        trim(data.ethnicity) ??
        trim(data.build) ??
        trim(data.bodyProportions) ??
        trim(data.faceShape) ??
        trim(data.jawline) ??
        trim(data.eyeShape) ??
        trim(data.nose) ??
        trim(data.lips) ??
        trim(data.hairColor) ??
        trim(data.hairBase) ??
        trim(data.eyebrows) ??
        trim(data.skinTone) ??
        trim(data.skinTexture) ??
        trim(data.eyeColor) ??
        trim(data.facialHair) ??
        trim(data.distinctiveFeature)
      )
    case "mood":
      return trim(data.mood)
    case "pose":
      return trim(data.pose)
    case "styling":
      // Multi-dimension: return the first set per-dimension value (used for
      // single-string field-mapping resolution; full hint composition goes
      // through buildStylingHints in the executors).
      return (
        trim(data.makeup) ??
        trim(data.hairCut) ??
        trim(data.hairTreatment) ??
        trim(data.eyewear) ??
        trim(data.headwear) ??
        trim(data.jewelry) ??
        trim(data.nails) ??
        trim(data.facePaint) ??
        trim(data.fabric)
      )
    case "temporal":
      // Multi-category: return the first set per-category value (used for
      // single-string field-mapping resolution; full hint composition goes
      // through buildTemporalHints in the executors).
      return (
        trim(data.temporalSpeed) ??
        trim(data.temporalFreeze) ??
        trim(data.temporalDirection) ??
        trim(data.temporalShutter)
      )
    case "scene-count":
      return data.count != null ? String(data.count) : undefined
    case "duration":
      return data.seconds != null ? String(data.seconds) : undefined
    case "aspect-ratio":
      return trim(data.ratio)
    default:
      return undefined
  }
}

function trim(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined
  const s = v.trim()
  return s.length > 0 ? s : undefined
}
