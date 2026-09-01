import { z } from "zod"
import {
  PEOPLE,
  PERSON_DIMENSION_ORDER,
  PERSON_DIMENSION_LABELS,
  PERSON_FIELD_BY_DIMENSION,
  getPersonDimensionLimit,
} from "./person.js"
import { STYLINGS, STYLING_DIMENSION_ORDER, STYLING_DIMENSION_LABELS, STYLING_FIELD_BY_DIMENSION, getStylingDimensionLimit } from "./styling.js"
import { FRAMINGS, FRAMING_CATEGORY_ORDER, FRAMING_CATEGORY_LABELS, FRAMING_FIELD_BY_CATEGORY, getFramingCategoryLimit } from "./framing.js"
import { LENSES } from "./lens.js"
import { CAMERA_FORMATS } from "./camera-format.js"
import { ANIMALS, VEHICLES, WEAPONS, FURNITURE } from "@nodaro/shared"
import { SETTINGS } from "./setting.js"
import { ATMOSPHERES } from "./atmosphere.js"
import { STYLES } from "./style.js"
import { MOODS } from "./mood.js"
import { COLOR_LOOKS } from "./color-look.js"
import { PHOTOGRAPHERS } from "./photographer.js"
import { AESTHETICS } from "./aesthetic.js"
import { ERAS } from "./era.js"
import { PHOTO_GENRES } from "./photo-genre.js"
import { BACKDROPS } from "./backdrop.js"
import { RENDER_QUALITIES } from "./render-quality.js"
import { COMPOSITION_EFFECTS } from "./composition-effects.js"
import { POST_PROCESS_EFFECTS } from "./post-process-effects.js"
import { ACTION_FX } from "./action-fx.js"
import { LOOP_SUBJECTS } from "./loop-subject.js"
import { TRANSITIONS } from "./transitions.js"
import { CHARACTER_FX } from "./character-fx.js"
import { POSES } from "./pose.js"
import { MATERIALS } from "./materials.js"
import { HELD_PROPS } from "./held-prop.js"
import { CAMERA_MOTIONS } from "./camera-motions.js"
import { LIGHTINGS, LIGHTING_CATEGORY_ORDER, LIGHTING_CATEGORY_LABELS, LIGHTING_FIELD_BY_CATEGORY } from "./lighting.js"
import { TEMPORALS } from "./temporal.js"
import { EXPOSURE_SETTINGS } from "./exposure-settings.js"
import { MUSIC_GENRES, MUSIC_ERAS } from "./music-genre.js"
import { MUSIC_ENERGIES, MUSIC_EMOTIONS, MUSIC_VIBES } from "./music-mood.js"
import { INSTRUMENTS, PRODUCTION_STYLES, VOCAL_PRESENCE, SINGING_STYLES } from "./instrumentation.js"
import { VOICE_AGES, VOICE_GENDERS, VOICE_LANGUAGES, VOICE_ACCENTS, VOICE_TIMBRES } from "./voice-character.js"
import { VOICE_PACES, VOICE_EMOTIONS, VOICE_ARCHETYPES } from "./voice-delivery.js"

// ─── Descriptor model ────────────────────────────────────────────────────────

/** A catalog entry as the analyzer consumes it. Flat catalogs lack
 *  dimension/category; discriminated catalogs carry exactly one. */
interface AnalyzerEntry {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly dimension?: string
  readonly category?: string
}

export type PickerApplyMode = "override" | "overwrite-detected" | "fill-empty"
type ApplyCleanup = (patch: Record<string, unknown>, mode: PickerApplyMode) => void

/** Describes how to build an analyzer spec for one picker type. Three shapes:
 *  - "discriminated": ONE catalog whose entries carry `dimension` or `category`;
 *    `order`/`fieldByKey`/`labels` translate keys → fields/labels; `limitFn`
 *    gives the per-key cardinality.
 *  - "flat": a single-value catalog (lens, camera-format) → one limit-1
 *    dimension whose key == the node-data field. */
export type PickerAnalyzerDescriptor =
  | {
      readonly kind: "discriminated"
      readonly toolName: string
      readonly discriminator: "dimension" | "category"
      readonly order: ReadonlyArray<string>
      readonly fieldByKey: Readonly<Record<string, string>>
      readonly labels: Readonly<Record<string, string>>
      readonly entries: ReadonlyArray<AnalyzerEntry>
      readonly limitFn: (key: string) => number
      readonly excludedIds?: ReadonlySet<string>
      readonly cleanup?: ApplyCleanup
    }
  | {
      readonly kind: "flat"
      readonly toolName: string
      readonly field: string
      readonly label: string
      readonly entries: ReadonlyArray<AnalyzerEntry>
    }

// ─── Registry (person only in Task 2; +4 in Task 3) ─────────────────────────

const PERSON_EXCLUDED = new Set<string>(["age-custom"])

/** Tag catalog entries with an explicit dimension — for discriminated pickers
 *  whose fields live in SEPARATE catalogs (music/voice) rather than one
 *  discriminated catalog. */
function tagDim<T extends { id: string; label: string; description: string }>(
  arr: ReadonlyArray<T>,
  dimension: string,
): ReadonlyArray<AnalyzerEntry> {
  return arr.map((e) => ({ id: e.id, label: e.label, description: e.description, dimension }))
}

const personCleanup: ApplyCleanup = (patch, mode) => {
  if (mode === "override") {
    patch.customAge = undefined
    patch.lips = undefined
  } else if ("age" in patch && patch.age !== "age-custom") {
    patch.customAge = undefined
  }
}

export const PICKER_ANALYZER_REGISTRY = {
  person: {
    kind: "discriminated",
    toolName: "emit_person",
    discriminator: "dimension",
    order: PERSON_DIMENSION_ORDER as ReadonlyArray<string>,
    fieldByKey: PERSON_FIELD_BY_DIMENSION as Readonly<Record<string, string>>,
    labels: PERSON_DIMENSION_LABELS as Readonly<Record<string, string>>,
    entries: PEOPLE as ReadonlyArray<AnalyzerEntry>,
    limitFn: (k) => getPersonDimensionLimit(k as never),
    excludedIds: PERSON_EXCLUDED,
    cleanup: personCleanup,
  },
  styling: {
    kind: "discriminated",
    toolName: "emit_styling",
    discriminator: "dimension",
    order: STYLING_DIMENSION_ORDER as ReadonlyArray<string>,
    fieldByKey: STYLING_FIELD_BY_DIMENSION as Readonly<Record<string, string>>,
    labels: STYLING_DIMENSION_LABELS as Readonly<Record<string, string>>,
    entries: STYLINGS as ReadonlyArray<AnalyzerEntry>,
    limitFn: (k) => getStylingDimensionLimit(k as never),
  },
  framing: {
    kind: "discriminated",
    toolName: "emit_framing",
    discriminator: "category",
    order: FRAMING_CATEGORY_ORDER as ReadonlyArray<string>,
    fieldByKey: FRAMING_FIELD_BY_CATEGORY as Readonly<Record<string, string>>,
    labels: FRAMING_CATEGORY_LABELS as Readonly<Record<string, string>>,
    entries: FRAMINGS as ReadonlyArray<AnalyzerEntry>,
    limitFn: (k) => getFramingCategoryLimit(k as never),
  },
  lens: {
    kind: "flat",
    toolName: "emit_lens",
    field: "lens",
    label: "Lens",
    entries: LENSES as ReadonlyArray<AnalyzerEntry>,
  },
  "camera-format": {
    kind: "flat",
    toolName: "emit_camera_format",
    field: "cameraFormat",
    label: "Camera / Film Stock",
    entries: CAMERA_FORMATS as ReadonlyArray<AnalyzerEntry>,
  },

  // ─── Text-to-picker expansion (Cine AI Fill): every remaining catalog ─────
  // Flat single-value pickers — field names match the picker wiring's
  // valueField (and the node-data shape the published-app input card writes).
  setting: { kind: "flat", toolName: "emit_setting", field: "setting", label: "Setting", entries: SETTINGS as ReadonlyArray<AnalyzerEntry> },
  atmosphere: { kind: "flat", toolName: "emit_atmosphere", field: "atmosphere", label: "Atmosphere", entries: ATMOSPHERES as ReadonlyArray<AnalyzerEntry> },
  style: { kind: "flat", toolName: "emit_style", field: "style", label: "Style", entries: STYLES as ReadonlyArray<AnalyzerEntry> },
  mood: { kind: "flat", toolName: "emit_mood", field: "mood", label: "Mood", entries: MOODS as ReadonlyArray<AnalyzerEntry> },
  "color-look": { kind: "flat", toolName: "emit_color_look", field: "colorLook", label: "Color / Look", entries: COLOR_LOOKS as ReadonlyArray<AnalyzerEntry> },
  photographer: { kind: "flat", toolName: "emit_photographer", field: "photographer", label: "Photographer / Artist", entries: PHOTOGRAPHERS as ReadonlyArray<AnalyzerEntry> },
  aesthetic: { kind: "flat", toolName: "emit_aesthetic", field: "aesthetic", label: "Aesthetic / Microtrend", entries: AESTHETICS as ReadonlyArray<AnalyzerEntry> },
  era: { kind: "flat", toolName: "emit_era", field: "era", label: "Era / Period", entries: ERAS as ReadonlyArray<AnalyzerEntry> },
  "photo-genre": { kind: "flat", toolName: "emit_photo_genre", field: "photoGenre", label: "Photo Genre", entries: PHOTO_GENRES as ReadonlyArray<AnalyzerEntry> },
  backdrop: { kind: "flat", toolName: "emit_backdrop", field: "backdrop", label: "Backdrop", entries: BACKDROPS as ReadonlyArray<AnalyzerEntry> },
  "render-quality": { kind: "flat", toolName: "emit_render_quality", field: "renderQuality", label: "Render Quality", entries: RENDER_QUALITIES as ReadonlyArray<AnalyzerEntry> },
  "composition-effects": { kind: "flat", toolName: "emit_composition_effects", field: "compositionEffect", label: "Composition Effect", entries: COMPOSITION_EFFECTS as ReadonlyArray<AnalyzerEntry> },
  "post-process-effects": { kind: "flat", toolName: "emit_post_process_effects", field: "postProcess", label: "Post-Process Effect", entries: POST_PROCESS_EFFECTS as ReadonlyArray<AnalyzerEntry> },
  "action-fx": { kind: "flat", toolName: "emit_action_fx", field: "actionFx", label: "Action FX", entries: ACTION_FX as ReadonlyArray<AnalyzerEntry> },
  "loop-subject": { kind: "flat", toolName: "emit_loop_subject", field: "loopSubject", label: "Loop Subject", entries: LOOP_SUBJECTS as ReadonlyArray<AnalyzerEntry> },
  transition: { kind: "flat", toolName: "emit_transition", field: "transition", label: "Transition", entries: TRANSITIONS as ReadonlyArray<AnalyzerEntry> },
  "character-fx": { kind: "flat", toolName: "emit_character_fx", field: "characterFx", label: "Character FX", entries: CHARACTER_FX as ReadonlyArray<AnalyzerEntry> },
  pose: { kind: "flat", toolName: "emit_pose", field: "pose", label: "Pose", entries: POSES as ReadonlyArray<AnalyzerEntry> },
  material: { kind: "flat", toolName: "emit_material", field: "material", label: "Material", entries: MATERIALS as ReadonlyArray<AnalyzerEntry> },
  "held-prop": { kind: "flat", toolName: "emit_held_prop", field: "heldProp", label: "Held Prop", entries: HELD_PROPS as ReadonlyArray<AnalyzerEntry> },
  "camera-motion": { kind: "flat", toolName: "emit_camera_motion", field: "cameraMotion", label: "Camera Motion", entries: CAMERA_MOTIONS as ReadonlyArray<AnalyzerEntry> },
  animal: { kind: "flat", toolName: "emit_animal", field: "animal", label: "Animal", entries: ANIMALS as ReadonlyArray<AnalyzerEntry> },
  vehicle: { kind: "flat", toolName: "emit_vehicle", field: "vehicle", label: "Vehicle", entries: VEHICLES as ReadonlyArray<AnalyzerEntry> },
  weapon: { kind: "flat", toolName: "emit_weapon", field: "weapon", label: "Weapon", entries: WEAPONS as ReadonlyArray<AnalyzerEntry> },
  furniture: { kind: "flat", toolName: "emit_furniture", field: "furniture", label: "Furniture", entries: FURNITURE as ReadonlyArray<AnalyzerEntry> },

  // Discriminated multi-dim pickers. lighting/temporal/exposure discriminate
  // on the single catalog's `category`; the sound/voice pickers span several
  // per-field catalogs, so their entries are synthesized with an explicit
  // `dimension` tag (tagDim below) — same wire shape either way.
  lighting: {
    kind: "discriminated",
    toolName: "emit_lighting",
    discriminator: "category",
    order: LIGHTING_CATEGORY_ORDER as ReadonlyArray<string>,
    fieldByKey: LIGHTING_FIELD_BY_CATEGORY as Readonly<Record<string, string>>,
    labels: LIGHTING_CATEGORY_LABELS as Readonly<Record<string, string>>,
    entries: LIGHTINGS as ReadonlyArray<AnalyzerEntry>,
    limitFn: () => 1,
  },
  temporal: {
    kind: "discriminated",
    toolName: "emit_temporal",
    discriminator: "category",
    order: ["speed", "freeze", "direction", "shutter"],
    fieldByKey: { speed: "temporalSpeed", freeze: "temporalFreeze", direction: "temporalDirection", shutter: "temporalShutter" },
    labels: { speed: "Playback Speed", freeze: "Freeze", direction: "Direction", shutter: "Shutter" },
    entries: TEMPORALS as ReadonlyArray<AnalyzerEntry>,
    limitFn: () => 1,
  },
  "exposure-settings": {
    kind: "discriminated",
    toolName: "emit_exposure_settings",
    discriminator: "category",
    order: ["aperture", "shutter-speed", "iso"],
    fieldByKey: { aperture: "aperture", "shutter-speed": "shutterSpeed", iso: "isoValue" },
    labels: { aperture: "Aperture", "shutter-speed": "Shutter Speed", iso: "ISO" },
    entries: EXPOSURE_SETTINGS as ReadonlyArray<AnalyzerEntry>,
    limitFn: () => 1,
  },
  "music-genre": {
    kind: "discriminated",
    toolName: "emit_music_genre",
    discriminator: "dimension",
    order: ["genre", "subgenre", "era"],
    fieldByKey: { genre: "genre", subgenre: "subgenre", era: "era" },
    labels: { genre: "Genre", subgenre: "Subgenre", era: "Era" },
    entries: [
      ...tagDim(MUSIC_GENRES, "genre"),
      // Subgenres carry promptHint but no description — the hint doubles as
      // the legend text (it describes the sound well enough for matching).
      ...MUSIC_GENRES.flatMap((g) =>
        g.subgenres.map((s) => ({ id: s.id, label: s.label, description: s.promptHint, dimension: "subgenre" })),
      ),
      ...tagDim(MUSIC_ERAS, "era"),
    ],
    limitFn: (k) => (k === "genre" ? 2 : 1),
  },
  "music-mood": {
    kind: "discriminated",
    toolName: "emit_music_mood",
    discriminator: "dimension",
    order: ["energy", "emotion", "vibe"],
    fieldByKey: { energy: "energy", emotion: "emotion", vibe: "vibe" },
    labels: { energy: "Energy", emotion: "Emotion", vibe: "Vibe" },
    entries: [...tagDim(MUSIC_ENERGIES, "energy"), ...tagDim(MUSIC_EMOTIONS, "emotion"), ...tagDim(MUSIC_VIBES, "vibe")],
    limitFn: (k) => (k === "energy" ? 1 : 2),
  },
  instrumentation: {
    kind: "discriminated",
    toolName: "emit_instrumentation",
    discriminator: "dimension",
    order: ["instruments", "production", "vocalPresence", "singingStyle"],
    fieldByKey: { instruments: "instruments", production: "production", vocalPresence: "vocalPresence", singingStyle: "singingStyle" },
    labels: { instruments: "Instruments", production: "Production Style", vocalPresence: "Vocal Presence", singingStyle: "Singing Style" },
    entries: [
      ...tagDim(INSTRUMENTS, "instruments"),
      ...tagDim(PRODUCTION_STYLES, "production"),
      ...tagDim(VOCAL_PRESENCE, "vocalPresence"),
      ...tagDim(SINGING_STYLES, "singingStyle"),
    ],
    limitFn: (k) => (k === "instruments" ? 3 : k === "production" ? 1 : 2),
  },
  "voice-character": {
    kind: "discriminated",
    toolName: "emit_voice_character",
    discriminator: "dimension",
    order: ["age", "gender", "language", "accent", "timbre"],
    fieldByKey: { age: "age", gender: "gender", language: "language", accent: "accent", timbre: "timbre" },
    labels: { age: "Age", gender: "Gender", language: "Language", accent: "Accent", timbre: "Timbre" },
    entries: [
      ...tagDim(VOICE_AGES, "age"),
      ...tagDim(VOICE_GENDERS, "gender"),
      ...tagDim(VOICE_LANGUAGES, "language"),
      ...tagDim(VOICE_ACCENTS, "accent"),
      ...tagDim(VOICE_TIMBRES, "timbre"),
    ],
    limitFn: (k) => (k === "language" ? 2 : 1),
  },
  "voice-delivery": {
    kind: "discriminated",
    toolName: "emit_voice_delivery",
    discriminator: "dimension",
    order: ["pace", "emotion", "archetype"],
    fieldByKey: { pace: "pace", emotion: "emotion", archetype: "archetype" },
    labels: { pace: "Pace", emotion: "Emotion", archetype: "Archetype" },
    entries: [...tagDim(VOICE_PACES, "pace"), ...tagDim(VOICE_EMOTIONS, "emotion"), ...tagDim(VOICE_ARCHETYPES, "archetype")],
    limitFn: () => 1,
  },
} satisfies Record<string, PickerAnalyzerDescriptor>

export type PickerType = keyof typeof PICKER_ANALYZER_REGISTRY
export const PICKER_TYPES = Object.keys(PICKER_ANALYZER_REGISTRY) as PickerType[]

/**
 * Family grouping for BATCHED analysis. A single call across all 38 catalogs
 * carries a ~211k-char legend (~53k tokens — measured 2026-08-09, the
 * measure-first probe from the text-to-picker spec), which is slow, costly,
 * and dilutes per-section accuracy. The text-to-picker route fans out one
 * structured call per family (6-15k tokens each) and merges. Mirrors the
 * build-brief's §5 UI grouping so Cine can reuse the same partition.
 */
export const PICKER_ANALYZER_FAMILIES: Readonly<Record<string, ReadonlyArray<PickerType>>> = {
  scene: ["setting", "atmosphere", "backdrop", "era", "temporal"],
  look: ["style", "color-look", "mood", "aesthetic", "photographer", "photo-genre", "render-quality", "composition-effects", "post-process-effects"],
  camera: ["framing", "camera-motion", "lens", "camera-format", "lighting", "exposure-settings"],
  character: ["person", "styling", "pose", "character-fx"],
  elements: ["animal", "vehicle", "weapon", "furniture", "held-prop", "material", "action-fx", "loop-subject", "transition"],
  audio: ["music-genre", "music-mood", "instrumentation", "voice-character", "voice-delivery"],
}
export const ANALYZABLE_PICKER_TYPES: ReadonlySet<string> = new Set(PICKER_TYPES)
export function isAnalyzablePicker(t: string): t is PickerType {
  return ANALYZABLE_PICKER_TYPES.has(t)
}

// ─── Spec model ──────────────────────────────────────────────────────────────

export interface PickerDimensionSpec {
  /** Catalog dimension id, e.g. "hair-color". Also the JSON key in the emitted pickerJson. */
  readonly dimension: string
  /** Target node-data field, e.g. "hairColor". */
  readonly field: string
  /** Human label/description, for the system-prompt legend. */
  readonly label: string
  /** 1 = single select; 2/3 = array with maxItems. */
  readonly limit: number
  /** Allowed catalog entry ids (the forced enum). */
  readonly entryIds: ReadonlyArray<string>
  /** id → human label/description, for the system-prompt legend. */
  readonly legend: ReadonlyArray<{ id: string; label: string; description: string }>
}

export interface PickerAnalyzerSpec {
  readonly pickerType: PickerType
  readonly toolName: string
  readonly dimensions: ReadonlyArray<PickerDimensionSpec>
  readonly cleanup?: ApplyCleanup
}

export function buildPickerAnalyzerSpec(pickerType: PickerType): PickerAnalyzerSpec {
  const d = PICKER_ANALYZER_REGISTRY[pickerType] as PickerAnalyzerDescriptor
  if (d.kind === "flat") {
    return {
      pickerType,
      toolName: d.toolName,
      dimensions: [
        {
          dimension: d.field,
          field: d.field,
          label: d.label,
          limit: 1,
          entryIds: d.entries.map((e) => e.id),
          legend: d.entries.map((e) => ({ id: e.id, label: e.label, description: e.description })),
        },
      ],
    }
  }
  const dimensions: PickerDimensionSpec[] = d.order.map((key) => {
    const entries = d.entries.filter(
      (e) =>
        (d.discriminator === "dimension" ? e.dimension : e.category) === key &&
        !(d.excludedIds?.has(e.id)),
    )
    return {
      dimension: key,
      field: d.fieldByKey[key],
      label: d.labels[key] ?? key,
      limit: d.limitFn(key),
      entryIds: entries.map((e) => e.id),
      legend: entries.map((e) => ({ id: e.id, label: e.label, description: e.description })),
    }
  })
  return { pickerType, toolName: d.toolName, dimensions, cleanup: d.cleanup }
}

// ─── Zod schema / legend / analyzer cache (unchanged logic) ──────────────────

/** Zod object: each dimension is an optional enum (single) or capped enum array
 *  (multi). `.strict()` blocks unknown keys. Mirrors the field cardinality. */
export function buildPickerZodSchema(
  spec: PickerAnalyzerSpec,
): z.ZodType<Record<string, string | string[]>, unknown> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const d of spec.dimensions) {
    const ids = d.entryIds as unknown as [string, ...string[]]
    const enumZ = z.enum(ids)
    shape[d.dimension] = d.limit > 1 ? z.array(enumZ).max(d.limit).optional() : enumZ.optional()
  }
  // dynamic shape → Zod can't infer the narrowed output type; runtime-validated by picker-analyzer-registry.test.ts
  return z.object(shape).strict() as unknown as z.ZodType<Record<string, string | string[]>, unknown>
}

export interface PickerAnalyzer {
  readonly spec: PickerAnalyzerSpec
  readonly schema: z.ZodType<Record<string, string | string[]>, unknown>
  readonly legend: string
}

const ANALYZER_CACHE = new Map<PickerType, PickerAnalyzer>()

/** Memoized analyzer build: spec → Zod schema → legend, computed once per
 *  picker type and cached at module level. The three artifacts are catalog-
 *  derived and stable, so the per-request route handler can reuse them instead
 *  of rebuilding all three on every analysis call. */
export function getPickerAnalyzer(pickerType: PickerType): PickerAnalyzer {
  const cached = ANALYZER_CACHE.get(pickerType)
  if (cached) return cached
  const spec = buildPickerAnalyzerSpec(pickerType)
  const analyzer: PickerAnalyzer = {
    spec,
    schema: buildPickerZodSchema(spec),
    legend: buildPickerLegend(spec),
  }
  ANALYZER_CACHE.set(pickerType, analyzer)
  return analyzer
}

// ─── Gaps + multi-picker union spec ──────────────────────────────────────────

export const GAPS_SCHEMA = z
  .object({
    missingItems: z
      .array(
        z.object({
          picker: z.string(),
          dimension: z.string(),
          observed: z.string().max(120),
        }),
      )
      .max(8)
      .default([]),
    missingCategories: z
      .array(
        z.object({
          picker: z.string(),
          suggestedDimension: z.string(),
          observed: z.string().max(120),
        }),
      )
      .max(8)
      .default([]),
  })
  .default({ missingItems: [], missingCategories: [] })

export interface PickerGaps {
  readonly missingItems: ReadonlyArray<{ picker: string; dimension: string; observed: string }>
  readonly missingCategories: ReadonlyArray<{
    picker: string
    suggestedDimension: string
    observed: string
  }>
}

export interface MultiPickerAnalyzerSpec {
  readonly schema: z.ZodType<Record<string, unknown>, unknown>
  readonly toolName: string
  readonly legend: string
  /** Compact bullet list of the pickers NOT wired into this spec (PICKER_TYPES
   *  minus `types`), keyed by picker-type key so the LLM can ATTRIBUTE a gap to
   *  the right picker even when it was not wired. Names + dimension labels only,
   *  never catalog ids. Empty string when every picker is already wired. */
  readonly otherPickersLegend: string
}

const MULTI_CACHE = new Map<string, MultiPickerAnalyzerSpec>()

/** Title-case a picker-type key for display, e.g. "person" → "Person",
 *  "exposure-settings" → "Exposure Settings". */
function pickerDisplayName(type: string): string {
  return type
    .split("-")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
}

/** One compact bullet per non-wired picker so the LLM can attribute a gap to a
 *  picker it wasn't handed. Flat pickers show their registry `label` (one axis);
 *  discriminated pickers show a title-cased name plus their dimension labels.
 *  Never lists catalog ids. Empty string when every PICKER_TYPES member is
 *  wired. */
function buildOtherPickersLegend(sorted: ReadonlyArray<PickerType>): string {
  const otherTypes = PICKER_TYPES.filter((t) => !sorted.includes(t))
  if (otherTypes.length === 0) return ""
  const lines = otherTypes.map((type) => {
    const descriptor = PICKER_ANALYZER_REGISTRY[type as PickerType] as PickerAnalyzerDescriptor
    if (descriptor.kind === "flat") {
      return `- ${type}: ${descriptor.label}`
    }
    const dims = descriptor.order
      .map((k) => descriptor.labels[k])
      .filter(Boolean)
      .join(", ")
    return `- ${type}: ${pickerDisplayName(type)}${dims ? ` — ${dims}` : ""}`
  })
  return `Non-wired pickers — use one of these keys in a gap's \`picker\` when an attribute belongs to it:\n${lines.join("\n")}`
}

/** Build ONE forced-tool schema spanning the given pickers (each section
 *  optional so an omitted picker doesn't trigger a validation retry) plus the
 *  capped `gaps` sidecar. Memoized by the sorted picker-set key. */
export function buildMultiPickerAnalyzerSpec(types: ReadonlyArray<PickerType>): MultiPickerAnalyzerSpec {
  const sorted = [...new Set(types)].sort()
  const key = sorted.join(",")
  const cached = MULTI_CACHE.get(key)
  if (cached) return cached

  const shape: Record<string, z.ZodTypeAny> = {}
  const legendParts: string[] = []
  for (const t of sorted) {
    const spec = buildPickerAnalyzerSpec(t)
    shape[t] = buildPickerZodSchema(spec).optional()
    legendParts.push(`# ${t.toUpperCase()} PICKER\n${buildPickerLegend(spec)}`)
  }
  shape.gaps = GAPS_SCHEMA
  const result: MultiPickerAnalyzerSpec = {
    schema: z.object(shape).strict() as unknown as MultiPickerAnalyzerSpec["schema"],
    toolName: "emit_pickers",
    legend: legendParts.join("\n\n"),
    otherPickersLegend: buildOtherPickersLegend(sorted),
  }
  MULTI_CACHE.set(key, result)
  return result
}

/** Human-readable legend appended to the system prompt so enum ids are meaningful. */
export function buildPickerLegend(spec: PickerAnalyzerSpec): string {
  const lines: string[] = []
  for (const d of spec.dimensions) {
    const cap = d.limit > 1 ? `up to ${d.limit}` : "one"
    lines.push(`## ${d.label} (key: "${d.dimension}", choose ${cap})`)
    for (const e of d.legend) {
      lines.push(`- ${e.id}: ${e.label}${e.description ? ` — ${e.description}` : ""}`)
    }
  }
  return lines.join("\n")
}

// ─── applyPickerJson (cleanup now via spec, not hardcoded person) ────────────

function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (Array.isArray(v)) return v.length === 0
  return String(v).length === 0
}

function coerce(value: unknown, limit: number): string | string[] {
  const arr = Array.isArray(value) ? value.map(String) : [String(value)]
  return limit > 1 ? arr.slice(0, limit) : arr[0]
}

/**
 * Produces the patch to merge into the picker node's data. Touches ONLY the
 * dimension fields (never label/preText/postText/maxItemsPerRow). `override`
 * also clears undetected dimension fields, and runs the picker's `cleanup`
 * (e.g. person resets customAge + clears the deprecated `lips` field).
 */
export function applyPickerJson(
  current: Record<string, unknown>,
  pickerJson: Record<string, unknown>,
  mode: PickerApplyMode,
  spec: PickerAnalyzerSpec,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const d of spec.dimensions) {
    const incoming = pickerJson[d.dimension]
    const present = !isEmptyValue(incoming)
    if (mode === "override") {
      patch[d.field] = present ? coerce(incoming, d.limit) : undefined
    } else if (mode === "overwrite-detected") {
      if (present) patch[d.field] = coerce(incoming, d.limit)
    } else {
      if (present && isEmptyValue(current[d.field])) patch[d.field] = coerce(incoming, d.limit)
    }
  }
  spec.cleanup?.(patch, mode)
  return patch
}

// ─── Edge-derived fan-out selection (shared by frontend + backend) ───────────

/** The analyzable picker node types wired to a producer's `picker-json` output
 *  (deduped). The ONE definition of edge-derived selection; the frontend
 *  execute path and the backend orchestrator both call this so they can't
 *  drift. Accepts minimal structural node/edge shapes so both layers' richer
 *  types satisfy it. */
export function pickerFanoutTargets(
  producerId: string,
  edges: ReadonlyArray<{ source: string; target: string; sourceHandle?: string | null }>,
  nodes: ReadonlyArray<{ id: string; type?: string }>,
): PickerType[] {
  const out = new Set<string>()
  for (const e of edges) {
    if (e.source !== producerId || e.sourceHandle !== "picker-json") continue
    const t = nodes.find((n) => n.id === e.target)?.type
    if (t && isAnalyzablePicker(t)) out.add(t)
  }
  return [...out] as PickerType[]
}
