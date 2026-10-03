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
  "furniture",
  "photo-genre",
  "backdrop",
  "held-prop",
  "exposure-settings",
  "render-quality",
  "composition-effects",
  "post-process-effects",
  "action-fx",
  "character-fx",
  "character-motion",
  "transition",
  "loop-subject",
  "scene-count",
  "duration",
  "aspect-ratio",
  // Generation Settings "Provider": a model id read from data at run time, like
  // duration / aspect-ratio (it used to be only a SKIP node, so a server run
  // could not read it at all).
  "provider",
  "music-genre",
  "music-mood",
  "instrumentation",
  "voice-character",
  "voice-delivery",
])

/**
 * Parameter types that intentionally produce NO prompt hint from
 * `getParameterPromptHint` (in `@nodaro/prompts`). They carry pure runtime
 * parameters — counts, durations, aspect ratios, a model id — consumed by the
 * executor directly, never appended to a downstream prompt.
 *
 * Consumers that treat "parameter node" as "text producer" (the `{Label}`
 * auto-fill in `main-text-handle.ts`, ref-map builders) must exclude these:
 * their extracted output is undefined, so an auto-filled `{Label}` would stay
 * in the outgoing prompt as literal brace text. Guarded by
 * `parameter-registry-sync.test.ts` (each member really returns "") and
 * `main-text-handle.test.ts` (members are not text-producing).
 */
export const HINT_EXEMPT_PARAMETER_TYPES: ReadonlySet<string> = new Set([
  "scene-count",
  "duration",
  "aspect-ratio",
  "provider",
])

/**
 * Parameter nodes whose fragment only makes sense in MOTION — a camera move,
 * a transition, a timeline, a character effect, a character movement or the
 * shot's motion intensity (the Motion node). Every
 * still-image consumer (generate-image, edit-image, image-to-image,
 * modify-image, location) excludes these on BOTH executors and in the add-node
 * popup. One set instead of three hand-synced copies: `STILL_IMAGE_EXCLUDE_TYPES`
 * (frontend cinematography-hints.ts and backend payload-builder.ts) and
 * `MOTION_ONLY_PICKER_TYPES` (frontend node-compatibility.ts) alias it.
 */
export const VIDEO_ONLY_PARAMETER_NODE_TYPES: ReadonlySet<string> = new Set([
  "camera-motion",
  "temporal",
  "transition",
  "character-fx",
  "character-motion",
  "motion",
])

/**
 * Pickers whose fragment depends on OTHER nodes wired into them — camera
 * motion's and transition's start / end states, character motion's target and
 * partner names, character FX's target name — so both executors must pass the
 * graph to `getParameterPromptHint` for them.
 *
 * TRANSITION AND CHARACTER-FX JOINED THIS SET (signed off). They compose from
 * the graph everywhere a human LOOKS at them — the config panel's injection
 * preview and the canvas card both run
 * `getParameterPromptHint(node, { nodes, edges })` — and on the frontend
 * `{Label}` path (`execution-graph.ts :: extractNodeOutput`), but the two
 * cinematography collectors that read THIS set dispatched them without the
 * graph, so a wired `startState` / `target` was promised in the preview and
 * dropped at execution. Admitting them here closes that gap on BOTH executors
 * at once.
 *
 * THE BOUND, and it is proved rather than asserted: a picker with NOTHING
 * wired to its own `startState` / `endState` / `target` handles emits
 * byte-identical text with and without the graph — the composers are simply
 * called with empty clause arrays either way. So only workflows that actually
 * wire those handles change at all, and they change to the text their own
 * preview already shows. The prompts package's
 * `graph-composed-unwired-identity.test.ts` walks every transition and
 * character-fx catalog entry in both hint modes, under two unwired graph
 * shapes, and asserts that equality — with a wired positive control so it
 * cannot go vacuous.
 *
 * ADD A NEW GRAPH-COMPOSED PICKER HERE AND TO
 * `LABEL_REF_GRAPH_COMPOSED_PARAMETER_TYPES` (backend
 * `services/workflow-engine/label-ref-hint-context.ts`) when it ships, so its
 * `{Label}` text and its directly-wired text agree from its first release.
 */
export const EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES: ReadonlySet<string> = new Set([
  "camera-motion",
  "character-motion",
  "transition",
  "character-fx",
])

/**
 * Extra person-dimension data-field names contributed by registered person
 * packs. Content-free (field-name strings only) — populated at runtime by
 * `@nodaro/prompts`'s `registerPersonPack`; empty on mainline (identity).
 * shared MUST NOT import prompts, so the field list is pushed in, not pulled.
 */
let registeredPersonPackFields: readonly string[] = []
export function setRegisteredPersonPackFields(fields: readonly string[]): void {
  registeredPersonPackFields = [...fields]
}

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
    case "music-genre":
      return trim(data.subgenre) ?? trim(data.genre) ?? trim(data.era)
    case "music-mood":
      return trim(data.emotion) ?? trim(data.energy) ?? trim(data.vibe)
    case "instrumentation":
      return (
        trim(data.production) ??
        trim(data.instruments) ??
        trim(data.vocalPresence) ??
        trim(data.singingStyle)
      )
    case "voice-character":
      return (
        trim(data.timbre) ??
        trim(data.accent) ??
        trim(data.language) ??
        trim(data.gender) ??
        trim(data.age)
      )
    case "voice-delivery":
      return trim(data.archetype) ?? trim(data.emotion) ?? trim(data.pace)
    case "atmosphere":
      return trim(data.atmosphere)
    case "action-fx":
      return trim(data.actionFx)
    case "character-fx":
      return trim(data.characterFx)
    case "character-motion":
      return trim(data.characterMotion)
    case "transition":
      return trim(data.transition)
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
    case "furniture":
      return trim(data.furniture)
    case "photo-genre":
      return trim(data.photoGenre)
    case "backdrop":
      return trim(data.backdrop)
    case "held-prop":
      return trim(data.heldProp)
    case "person": {
      // Multi-dimension: return the first set per-dimension value (used for
      // single-string field-mapping resolution; full hint composition goes
      // through buildPersonHints in the executors).
      const base =
        trim(data.type) ??
        trim(data.age) ??
        trim(data.ethnicity) ??
        trim(data.regionalAesthetic) ??
        trim(data.frame) ??
        trim(data.bodyMass) ??
        trim(data.bust) ??
        trim(data.waist) ??
        trim(data.hips) ??
        trim(data.silhouette) ??
        trim(data.faceShape) ??
        trim(data.jawline) ??
        trim(data.cheekbones) ??
        trim(data.facialFullness) ??
        trim(data.eyeShape) ??
        trim(data.eyelidType) ??
        trim(data.canthalTilt) ??
        trim(data.eyeSpacing) ??
        trim(data.eyeSetBrow) ??
        trim(data.nose) ??
        trim(data.noseTip) ??
        trim(data.lipFullness) ??
        trim(data.lipShape) ??
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
      if (base !== undefined) return base
      // Fall back to any registered person-pack dimension field (G4): a
      // deployment overlay's extra person dimensions resolve in the
      // `{PersonLabel}` field-mapping single-string path. Empty on mainline.
      for (const field of registeredPersonPackFields) {
        const v = trim(data[field])
        if (v !== undefined) return v
      }
      return undefined
    }
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
    case "provider":
      return trim(data.provider)
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

