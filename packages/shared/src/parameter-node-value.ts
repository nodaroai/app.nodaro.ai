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
  "photographer",
  "aesthetic",
  "era",
  "pose",
  "styling",
  "temporal",
  "material",
  "animal",
  "vehicle",
  "weapon",
  "photo-genre",
  "backdrop",
  "held-prop",
  "exposure-settings",
  "render-quality",
  "composition-effects",
  "post-process-effects",
  "action-fx",
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
        trim(data.lightingDirection) ??
        trim(data.lightingRatio) ??
        trim(data.colorTemperature)
      )
    case "color-look":
      return trim(data.colorLook)
    case "atmosphere":
      return trim(data.atmosphere)
    case "action-fx":
      return trim(data.actionFx)
    case "style":
      return trim(data.style)
    case "setting":
      return trim(data.setting)
    case "loop-subject":
      return trim(data.loopSubject)
    case "material":
      return trim(data.material)
    case "animal":
      return trim(data.animal)
    case "vehicle":
      return trim(data.vehicle)
    case "weapon":
      return trim(data.weapon)
    case "photo-genre":
      return trim(data.photoGenre)
    case "backdrop":
      return trim(data.backdrop)
    case "held-prop":
      return trim(data.heldProp)
    case "person":
      // Multi-dimension: return the first set per-dimension value (used for
      // single-string field-mapping resolution; full hint composition goes
      // through buildPersonHints in the executors).
      return (
        trim(data.type) ??
        trim(data.age) ??
        trim(data.ethnicity) ??
        trim(data.regionalAesthetic) ??
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
        trim(data.distinctiveFeature) ??
        trim(data.lipState) ??
        trim(data.eyeState)
      )
    case "mood":
      return trim(data.mood)
    case "photographer":
      return trim(data.photographer)
    case "aesthetic":
      return trim(data.aesthetic)
    case "era":
      return trim(data.era)
    case "pose":
      return (
        trim(data.pose) ??
        trim(data.handPosition) ??
        trim(data.bodyLean) ??
        trim(data.headTilt) ??
        trim(data.activity)
      )
    case "styling":
      // Multi-dimension: return the first set per-dimension value (used for
      // single-string field-mapping resolution; full hint composition goes
      // through buildStylingHints in the executors).
      return (
        trim(data.makeup) ??
        trim(data.hairCut) ??
        trim(data.hairTreatment) ??
        trim(data.hairState) ??
        trim(data.eyewear) ??
        trim(data.headwear) ??
        trim(data.jewelry) ??
        trim(data.nails) ??
        trim(data.facePaint) ??
        trim(data.outfit) ??
        trim(data.top) ??
        trim(data.bottom) ??
        trim(data.outerwear) ??
        trim(data.legwear) ??
        trim(data.footwear) ??
        trim(data.fabric) ??
        trim(data.wardrobeState)
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
    case "exposure-settings":
      return (
        trim(data.aperture) ??
        trim(data.shutterSpeed) ??
        trim(data.isoValue)
      )
    case "render-quality":
      return trim(data.renderQuality)
    case "composition-effects":
      return trim(data.compositionEffect)
    case "post-process-effects":
      return trim(data.postProcess)
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
  if (typeof v === "string") {
    const s = v.trim()
    return s.length > 0 ? s : undefined
  }
  // Multi-pick fields (ethnicity, mood, aesthetic) may be a string[]. The
  // single-string field-mapping resolver only needs *some* value to indicate
  // the field is set — return the first non-empty entry.
  if (Array.isArray(v)) {
    for (const item of v) {
      if (typeof item === "string") {
        const s = item.trim()
        if (s.length > 0) return s
      }
    }
  }
  return undefined
}
