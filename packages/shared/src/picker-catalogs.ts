/**
 * Public, discoverable registry of the parameter-picker catalogs.
 *
 * This is the pure-data mirror of the frontend picker registry
 * (`frontend/src/lib/parameter-picker-registry.tsx`). It contains NO React —
 * just the catalog metadata + flattened options — so it can be consumed by
 * the backend, the public SDK, docs tooling, and the editor alike from one
 * source of truth.
 *
 * Two kinds of entry (mirroring the frontend):
 *  - "single": one value field whose value is a string id chosen from a
 *    catalog. `options` carries the full flattened catalog (id/label/
 *    description/category/promptHint), so a consumer can render a picker or
 *    resolve an id → prompt fragment without importing the heavy frontend
 *    registry.
 *  - "multi": several value fields (e.g. Framing.shotSize + .angle + …).
 *    Structured / multi-dimensional. There is no single catalog to flatten,
 *    so instead of top-level `options` each multi entry carries a
 *    `dimensions` array — one self-describing entry per field
 *    ({ field, label, options }) in `fields` order — so a consumer can render
 *    a per-field picker or resolve any field's id → prompt fragment without
 *    importing the heavy frontend registry.
 *
 * A drift-guard test (`frontend/src/lib/__tests__/picker-catalogs-sync.test.ts`)
 * asserts parity between this registry and the frontend one so the two cannot
 * silently diverge.
 *
 * NOTE on `promptHint` for the four Object-entity catalogs (animal / vehicle /
 * weapon / furniture): those catalog entries do NOT carry a `promptHint`
 * field — at runtime `getParameterPromptHint` synthesizes the fragment from
 * `label` + `description` ("featuring a golden retriever, …"). We reproduce the
 * exact same phrasing here so each option's `promptHint` is non-empty AND
 * matches what actually gets injected downstream.
 */

import { SETTINGS, SETTING_CATEGORY_LABELS } from "./setting.js"
import { ATMOSPHERES } from "./atmosphere.js"
import { STYLES } from "./style.js"
import { COLOR_LOOKS, COLOR_LOOK_CATEGORY_LABELS, COLOR_LOOK_CATEGORY_ORDER } from "./color-look.js"
import { MOODS, MOOD_CATEGORY_LABELS, MOOD_CATEGORY_ORDER } from "./mood.js"
import { PHOTOGRAPHERS, PHOTOGRAPHER_CATEGORY_LABELS, PHOTOGRAPHER_CATEGORY_ORDER } from "./photographer.js"
import { AESTHETICS, AESTHETIC_CATEGORY_LABELS, AESTHETIC_CATEGORY_ORDER } from "./aesthetic.js"
import { ERAS, ERA_CATEGORY_LABELS, ERA_CATEGORY_ORDER } from "./era.js"
import { PHOTO_GENRES, PHOTO_GENRE_CATEGORY_LABELS, PHOTO_GENRE_CATEGORY_ORDER } from "./photo-genre.js"
import { BACKDROPS, BACKDROP_CATEGORY_LABELS, BACKDROP_CATEGORY_ORDER } from "./backdrop.js"
import { RENDER_QUALITIES } from "./render-quality.js"
import { COMPOSITION_EFFECTS } from "./composition-effects.js"
import { ACTION_FX, ACTION_FX_CATEGORY_LABELS, ACTION_FX_CATEGORY_ORDER } from "./action-fx.js"
import { LOOP_SUBJECTS, LOOP_SUBJECT_CATEGORY_LABELS, LOOP_SUBJECT_CATEGORY_ORDER } from "./loop-subject.js"
import { POST_PROCESS_EFFECTS } from "./post-process-effects.js"
import { CAMERA_MOTIONS, CAMERA_MOTION_CATEGORY_LABELS, CAMERA_MOTION_CATEGORY_ORDER } from "./camera-motions.js"
import { LENSES } from "./lens.js"
import { CAMERA_FORMATS } from "./camera-format.js"
import { TRANSITIONS, TRANSITION_CATEGORY_LABELS, TRANSITION_CATEGORY_ORDER } from "./transitions.js"
import { CHARACTER_FX, CHARACTER_FX_CATEGORY_LABELS, CHARACTER_FX_CATEGORY_ORDER } from "./character-fx.js"
import { POSES, POSE_CATEGORY_LABELS, POSE_CATEGORY_ORDER } from "./pose.js"
import { MATERIALS, MATERIAL_CATEGORY_LABELS, MATERIAL_CATEGORY_ORDER } from "./materials.js"
import { ANIMALS, ANIMAL_SUBCATEGORY_LABELS, ANIMAL_SUBCATEGORY_ORDER } from "./animals.js"
import { VEHICLES, VEHICLE_SUBCATEGORY_LABELS, VEHICLE_SUBCATEGORY_ORDER } from "./vehicles.js"
import { WEAPONS, WEAPON_SUBCATEGORY_LABELS, WEAPON_SUBCATEGORY_ORDER } from "./weapons.js"
import { FURNITURE, FURNITURE_SUBCATEGORY_LABELS, FURNITURE_SUBCATEGORY_ORDER } from "./furniture.js"
import { HELD_PROPS, HELD_PROP_CATEGORY_LABELS, HELD_PROP_CATEGORY_ORDER } from "./held-prop.js"
import { FRAMINGS, FRAMING_FIELD_BY_CATEGORY, FRAMING_CATEGORY_LABELS } from "./framing.js"
import { LIGHTINGS, LIGHTING_FIELD_BY_CATEGORY, LIGHTING_CATEGORY_LABELS } from "./lighting.js"
import { TEMPORALS, TEMPORAL_FIELD_BY_CATEGORY, TEMPORAL_CATEGORY_LABELS } from "./temporal.js"
import { EXPOSURE_SETTINGS, EXPOSURE_FIELD_BY_CATEGORY, EXPOSURE_CATEGORY_LABELS } from "./exposure-settings.js"
import { PEOPLE, PERSON_FIELD_BY_DIMENSION, PERSON_DIMENSION_LABELS } from "./person.js"
import { STYLINGS, STYLING_FIELD_BY_DIMENSION, STYLING_DIMENSION_LABELS } from "./styling.js"
import { MUSIC_GENRES, MUSIC_ERAS } from "./music-genre.js"
import { MUSIC_ENERGIES, MUSIC_EMOTIONS, MUSIC_VIBES } from "./music-mood.js"
import { INSTRUMENTS, PRODUCTION_STYLES, VOCAL_PRESENCE, SINGING_STYLES } from "./instrumentation.js"
import { VOICE_AGES, VOICE_GENDERS, VOICE_LANGUAGES, VOICE_ACCENTS, VOICE_TIMBRES } from "./voice-character.js"
import { VOICE_PACES, VOICE_EMOTIONS, VOICE_ARCHETYPES } from "./voice-delivery.js"

export interface PickerOption {
  readonly id: string
  readonly label: string
  readonly description?: string
  /** The group id (matches `categoryOrder` / `categoryLabels`). */
  readonly category?: string
  readonly promptHint: string
  /** Only present if the source catalog entry already carries a data icon/emoji/thumbnail field. */
  readonly icon?: string
}

/**
 * A self-describing dimension of a multi-dim picker: one value field plus the
 * full option list valid for that field. `dimensions[i].field` mirrors the
 * frontend picker's `fields[i]` exactly (same order), so a consumer can render
 * a per-field picker or resolve an id → prompt fragment for any dimension
 * without importing the heavy frontend registry.
 */
export interface PickerDimension {
  /** The node-data field this dimension writes to (e.g. "shotSize"). */
  readonly field: string
  /** Human-readable label for the dimension (e.g. "Shot Size"). */
  readonly label: string
  /** Flattened options valid for this field. */
  readonly options: readonly PickerOption[]
}

export interface PickerCatalog {
  readonly nodeType: string
  readonly label: string
  /** The i18n catalog id (mirrors the frontend entry's `catalogId`). */
  readonly catalogId: string
  readonly kind: "single" | "multi"
  /** single only — the node-data field the chosen id is written to. */
  readonly valueField?: string
  /** single only — the catalog id selected by default. */
  readonly defaultValue?: string
  readonly categoryOrder?: readonly string[]
  readonly categoryLabels?: Readonly<Record<string, string>>
  /** single-dim: flattened catalog options. */
  readonly options?: readonly PickerOption[]
  /** multi-dim: the dimension keys (no single catalog to flatten). */
  readonly fields?: readonly string[]
  /** multi-dim: one self-describing entry per dimension field, in `fields` order. */
  readonly dimensions?: readonly PickerDimension[]
}

/** Minimal shape every single-dim catalog entry satisfies. */
interface BaseCatalogEntry {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
}

/**
 * Flatten a single-dim catalog array into `PickerOption`s.
 *
 * `categoryField` mirrors the field the frontend's `mapCat(ARR, "<field>")`
 * used — `"category"`, `"subcategory"`, or omitted (no grouping). None of the
 * catalogs carry an entry-level icon/emoji/thumbnail field, so `icon` is never
 * emitted (icons are derived from the id via render helpers, which are React
 * and intentionally excluded).
 */
function toOptions<T extends BaseCatalogEntry>(
  arr: ReadonlyArray<T>,
  categoryField?: keyof T,
): ReadonlyArray<PickerOption> {
  return arr.map((e) => {
    const opt: { -readonly [K in keyof PickerOption]?: PickerOption[K] } = {
      id: e.id,
      label: e.label,
      promptHint: e.promptHint,
    }
    if (e.description) opt.description = e.description
    if (categoryField) opt.category = e[categoryField] as unknown as string
    return opt as PickerOption
  })
}

/**
 * The four Object-entity catalogs (animal / vehicle / weapon / furniture) lack
 * a `promptHint` field; their fragment is synthesized at runtime from
 * label + description. Reproduce the exact phrasing from
 * `getParameterPromptHint` so the registry stays faithful + every option's
 * `promptHint` is non-empty.
 */
interface ObjectCatalogEntry {
  readonly id: string
  readonly label: string
  readonly subcategory: string
  readonly description: string
}
function objectOptions(
  arr: ReadonlyArray<ObjectCatalogEntry>,
  phrase: (label: string, description: string) => string,
): ReadonlyArray<PickerOption> {
  return arr.map((e) => ({
    id: e.id,
    label: e.label,
    description: e.description,
    category: e.subcategory,
    promptHint: phrase(e.label.toLowerCase(), e.description),
  }))
}

// ---------------------------------------------------------------------------
// Multi-dim `dimensions` builders
//
// Each builder is driven by the picker's `fields` array (the canonical order
// mirrored from `MULTI_PICKERS` in the frontend registry), so a dimension is
// emitted for exactly those fields, in that order. Catalog dimensions that
// have no corresponding picker field (e.g. lighting's lighting-ratio /
// color-temperature, person's regional-aesthetic, styling's outfit/top/…) are
// intentionally omitted — they aren't exposed by the multi-dim picker UI.
// ---------------------------------------------------------------------------

/** "shotSize" → "Shot Size", "vocalPresence" → "Vocal Presence". */
function humanize(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase())
}

/**
 * Pattern A — category-discriminated. ONE catalog whose entries each carry a
 * `category`; a `fieldByCategory` map translates category → consumer field.
 * For each picker `field`, options = catalog entries whose mapped field equals
 * it; the dimension label comes from `categoryLabels[category]`.
 */
function categoryDiscriminatedDims<C extends string, T extends BaseCatalogEntry & { category: C }>(
  fields: ReadonlyArray<string>,
  arr: ReadonlyArray<T>,
  fieldByCategory: Readonly<Record<C, string>>,
  categoryLabels: Readonly<Record<C, string>>,
): ReadonlyArray<PickerDimension> {
  // Resolve, per field, the category whose mapped field equals it.
  const categoryByField = new Map<string, C>()
  for (const cat of Object.keys(fieldByCategory) as C[]) {
    categoryByField.set(fieldByCategory[cat], cat)
  }
  return fields.map((field) => {
    const category = categoryByField.get(field)
    if (!category) {
      throw new Error(`picker-catalogs: no category maps to field "${field}"`)
    }
    const options = toOptions(arr.filter((e) => e.category === category))
    return { field, label: categoryLabels[category], options }
  })
}

/**
 * Pattern A' — dimension-discriminated. ONE catalog whose entries each carry a
 * `dimension` (kebab-case); a `fieldByDimension` map translates dimension →
 * consumer field (camelCase). For each picker `field`, options = catalog
 * entries whose mapped field equals it; the dimension label comes from
 * `dimensionLabels[dimension]`.
 */
function dimensionDiscriminatedDims<D extends string, T extends BaseCatalogEntry & { dimension: D }>(
  fields: ReadonlyArray<string>,
  arr: ReadonlyArray<T>,
  fieldByDimension: Readonly<Record<D, string>>,
  dimensionLabels: Readonly<Record<D, string>>,
): ReadonlyArray<PickerDimension> {
  const dimensionByField = new Map<string, D>()
  for (const dim of Object.keys(fieldByDimension) as D[]) {
    dimensionByField.set(fieldByDimension[dim], dim)
  }
  return fields.map((field) => {
    const dimension = dimensionByField.get(field)
    if (!dimension) {
      throw new Error(`picker-catalogs: no dimension maps to field "${field}"`)
    }
    const options = toOptions(arr.filter((e) => e.dimension === dimension))
    return { field, label: dimensionLabels[dimension], options }
  })
}

/**
 * Pattern B — one independent catalog array per field, in `fields` order.
 * The dimension label is humanized from the field name.
 */
function perFieldDims(
  fieldArrays: ReadonlyArray<readonly [field: string, arr: ReadonlyArray<BaseCatalogEntry>]>,
): ReadonlyArray<PickerDimension> {
  return fieldArrays.map(([field, arr]) => ({
    field,
    label: humanize(field),
    options: toOptions(arr),
  }))
}

/**
 * Pattern C — hierarchical music-genre. Three fields:
 *  - genre    → MUSIC_GENRES (top-level)
 *  - subgenre → every MUSIC_GENRES[].subgenres flattened
 *  - era      → MUSIC_ERAS
 *
 * Genre / subgenre / era entries each carry their own `promptHint` (the exact
 * fragment `buildMusicGenreHints` injects for the genre and era cases). We
 * pass those through directly rather than re-deriving via
 * `getParameterPromptHint`, because that helper resolves a subgenre only in
 * the context of its parent genre — a lone `{ subgenre }` yields an empty
 * string. Pass-through keeps every option's hint non-empty and faithful.
 */
function musicGenreDims(fields: ReadonlyArray<string>): ReadonlyArray<PickerDimension> {
  const optionsByField: Record<string, ReadonlyArray<PickerOption>> = {
    genre: MUSIC_GENRES.map((g) => ({ id: g.id, label: g.label, description: g.description, category: g.category, promptHint: g.promptHint })),
    subgenre: MUSIC_GENRES.flatMap((g) =>
      g.subgenres.map((s) => ({ id: s.id, label: s.label, promptHint: s.promptHint })),
    ),
    era: MUSIC_ERAS.map((e) => ({ id: e.id, label: e.label, description: e.description, promptHint: e.promptHint })),
  }
  return fields.map((field) => {
    const options = optionsByField[field]
    if (!options) throw new Error(`picker-catalogs: music-genre has no options for field "${field}"`)
    return { field, label: humanize(field), options }
  })
}

const SINGLE_CATALOGS: readonly PickerCatalog[] = [
  // -------- "Look" family --------
  {
    nodeType: "setting",
    label: "Setting",
    catalogId: "setting",
    kind: "single",
    valueField: "setting",
    defaultValue: "forest",
    // Frontend hardcodes this order (there is no SETTING_CATEGORY_ORDER export).
    categoryOrder: ["indoor", "urban", "nature", "fantastical"],
    categoryLabels: SETTING_CATEGORY_LABELS,
    options: toOptions(SETTINGS, "category"),
  },
  {
    nodeType: "atmosphere",
    label: "Atmosphere",
    catalogId: "atmosphere",
    kind: "single",
    valueField: "atmosphere",
    defaultValue: "clear",
    options: toOptions(ATMOSPHERES),
  },
  {
    nodeType: "style",
    label: "Style",
    catalogId: "style",
    kind: "single",
    valueField: "style",
    defaultValue: "cinematic",
    options: toOptions(STYLES),
  },
  {
    nodeType: "color-look",
    label: "Color / Look",
    catalogId: "color-look",
    kind: "single",
    valueField: "colorLook",
    defaultValue: "warm",
    categoryOrder: COLOR_LOOK_CATEGORY_ORDER,
    categoryLabels: COLOR_LOOK_CATEGORY_LABELS,
    options: toOptions(COLOR_LOOKS, "category"),
  },
  {
    nodeType: "mood",
    label: "Mood",
    catalogId: "mood",
    kind: "single",
    valueField: "mood",
    defaultValue: "calm",
    categoryOrder: MOOD_CATEGORY_ORDER,
    categoryLabels: MOOD_CATEGORY_LABELS,
    options: toOptions(MOODS, "category"),
  },
  {
    nodeType: "photographer",
    label: "Photographer / Artist",
    catalogId: "photographer",
    kind: "single",
    valueField: "photographer",
    defaultValue: "tim-walker",
    categoryOrder: PHOTOGRAPHER_CATEGORY_ORDER,
    categoryLabels: PHOTOGRAPHER_CATEGORY_LABELS,
    options: toOptions(PHOTOGRAPHERS, "category"),
  },
  {
    nodeType: "aesthetic",
    label: "Aesthetic / Microtrend",
    catalogId: "aesthetic",
    kind: "single",
    valueField: "aesthetic",
    defaultValue: "y2k",
    categoryOrder: AESTHETIC_CATEGORY_ORDER,
    categoryLabels: AESTHETIC_CATEGORY_LABELS,
    options: toOptions(AESTHETICS, "category"),
  },
  {
    nodeType: "era",
    label: "Era / Period",
    catalogId: "era",
    kind: "single",
    valueField: "era",
    defaultValue: "1990s-mall",
    categoryOrder: ERA_CATEGORY_ORDER,
    categoryLabels: ERA_CATEGORY_LABELS,
    options: toOptions(ERAS, "category"),
  },
  {
    nodeType: "photo-genre",
    label: "Photo Genre",
    catalogId: "photo-genre",
    kind: "single",
    valueField: "photoGenre",
    defaultValue: "fashion-editorial",
    categoryOrder: PHOTO_GENRE_CATEGORY_ORDER,
    categoryLabels: PHOTO_GENRE_CATEGORY_LABELS,
    options: toOptions(PHOTO_GENRES, "category"),
  },
  {
    nodeType: "backdrop",
    label: "Backdrop",
    catalogId: "backdrop",
    kind: "single",
    valueField: "backdrop",
    defaultValue: "white-seamless",
    categoryOrder: BACKDROP_CATEGORY_ORDER,
    categoryLabels: BACKDROP_CATEGORY_LABELS,
    options: toOptions(BACKDROPS, "category"),
  },
  {
    nodeType: "render-quality",
    label: "Render Quality",
    catalogId: "render-quality",
    kind: "single",
    valueField: "renderQuality",
    defaultValue: "raytracing",
    options: toOptions(RENDER_QUALITIES),
  },
  {
    nodeType: "composition-effects",
    label: "Composition Effect",
    catalogId: "composition-effects",
    kind: "single",
    valueField: "compositionEffect",
    defaultValue: "bursting-through-frame",
    options: toOptions(COMPOSITION_EFFECTS),
  },
  {
    nodeType: "action-fx",
    label: "Action FX",
    catalogId: "action-fx",
    kind: "single",
    valueField: "actionFx",
    defaultValue: "earthquake-tremor",
    categoryOrder: ACTION_FX_CATEGORY_ORDER,
    categoryLabels: ACTION_FX_CATEGORY_LABELS,
    options: toOptions(ACTION_FX, "category"),
  },
  {
    nodeType: "loop-subject",
    label: "Loop Subject",
    catalogId: "loop-subject",
    kind: "single",
    valueField: "loopSubject",
    defaultValue: "tunnel",
    categoryOrder: LOOP_SUBJECT_CATEGORY_ORDER,
    categoryLabels: LOOP_SUBJECT_CATEGORY_LABELS,
    options: toOptions(LOOP_SUBJECTS, "category"),
  },
  {
    nodeType: "post-process-effects",
    label: "Post-Process Effect",
    catalogId: "post-process-effects",
    kind: "single",
    valueField: "postProcess",
    defaultValue: "vignette-soft",
    options: toOptions(POST_PROCESS_EFFECTS),
  },

  // -------- "Camera" family --------
  {
    nodeType: "camera-motion",
    label: "Camera Motion",
    catalogId: "camera-motions",
    kind: "single",
    valueField: "cameraMotion",
    defaultValue: "static",
    categoryOrder: CAMERA_MOTION_CATEGORY_ORDER,
    categoryLabels: CAMERA_MOTION_CATEGORY_LABELS,
    options: toOptions(CAMERA_MOTIONS, "category"),
  },
  {
    nodeType: "lens",
    label: "Lens",
    catalogId: "lens",
    kind: "single",
    valueField: "lens",
    defaultValue: "normal-50mm",
    options: toOptions(LENSES),
  },
  {
    nodeType: "camera-format",
    label: "Camera / Film",
    catalogId: "camera-format",
    kind: "single",
    valueField: "cameraFormat",
    defaultValue: "35mm-film",
    options: toOptions(CAMERA_FORMATS),
  },
  {
    nodeType: "transition",
    label: "Transition",
    catalogId: "transitions",
    kind: "single",
    valueField: "transition",
    defaultValue: "auto",
    categoryOrder: TRANSITION_CATEGORY_ORDER,
    categoryLabels: TRANSITION_CATEGORY_LABELS,
    options: toOptions(TRANSITIONS, "category"),
  },
  {
    nodeType: "character-fx",
    label: "Character FX",
    catalogId: "character-fx",
    kind: "single",
    valueField: "characterFx",
    defaultValue: "auto",
    categoryOrder: CHARACTER_FX_CATEGORY_ORDER,
    categoryLabels: CHARACTER_FX_CATEGORY_LABELS,
    options: toOptions(CHARACTER_FX, "category"),
  },

  // -------- "Subject / Object" family --------
  {
    nodeType: "pose",
    label: "Pose",
    catalogId: "pose",
    kind: "single",
    valueField: "pose",
    defaultValue: "standing-upright",
    categoryOrder: POSE_CATEGORY_ORDER,
    categoryLabels: POSE_CATEGORY_LABELS,
    options: toOptions(POSES, "category"),
  },
  {
    nodeType: "material",
    label: "Material",
    catalogId: "materials",
    kind: "single",
    valueField: "material",
    defaultValue: "silk",
    categoryOrder: MATERIAL_CATEGORY_ORDER,
    categoryLabels: MATERIAL_CATEGORY_LABELS,
    options: toOptions(MATERIALS, "category"),
  },
  {
    nodeType: "animal",
    label: "Animal",
    catalogId: "animals",
    kind: "single",
    valueField: "animal",
    defaultValue: "dog-golden-retriever",
    categoryOrder: ANIMAL_SUBCATEGORY_ORDER,
    categoryLabels: ANIMAL_SUBCATEGORY_LABELS,
    options: objectOptions(ANIMALS, (label, description) => `featuring a ${label}, ${description}`),
  },
  {
    nodeType: "vehicle",
    label: "Vehicle",
    catalogId: "vehicles",
    kind: "single",
    valueField: "vehicle",
    defaultValue: "sedan",
    categoryOrder: VEHICLE_SUBCATEGORY_ORDER,
    categoryLabels: VEHICLE_SUBCATEGORY_LABELS,
    options: objectOptions(VEHICLES, (label, description) => `featuring a ${label}, ${description}`),
  },
  {
    nodeType: "weapon",
    label: "Weapon",
    catalogId: "weapons",
    kind: "single",
    valueField: "weapon",
    defaultValue: "katana",
    categoryOrder: WEAPON_SUBCATEGORY_ORDER,
    categoryLabels: WEAPON_SUBCATEGORY_LABELS,
    options: objectOptions(WEAPONS, (label, description) => `with a ${label}, ${description}`),
  },
  {
    nodeType: "furniture",
    label: "Furniture",
    catalogId: "furniture",
    kind: "single",
    valueField: "furniture",
    defaultValue: "sofa",
    categoryOrder: FURNITURE_SUBCATEGORY_ORDER,
    categoryLabels: FURNITURE_SUBCATEGORY_LABELS,
    options: objectOptions(FURNITURE, (label, description) => `including a ${label}, ${description}`),
  },
  {
    nodeType: "held-prop",
    label: "Held Prop",
    catalogId: "held-prop",
    kind: "single",
    valueField: "heldProp",
    defaultValue: "smartphone",
    categoryOrder: HELD_PROP_CATEGORY_ORDER,
    categoryLabels: HELD_PROP_CATEGORY_LABELS,
    options: toOptions(HELD_PROPS, "category"),
  },
]

// Canonical per-picker `fields` order (mirrors `MULTI_PICKERS` in
// `frontend/src/lib/parameter-picker-registry.tsx`). Declared once and reused
// for both `fields` and the `dimensions` builder so the two can never drift.
const FRAMING_FIELDS = ["shotSize", "angle", "coverage", "composition", "vantage"] as const
const LIGHTING_FIELDS = ["timeOfDay", "lightingStyle", "lightingDirection"] as const
const PERSON_FIELDS = [
  "type", "age", "ethnicity", "build", "bodyProportions",
  "faceShape", "jawline", "eyeShape", "nose", "lips", "lipState",
  "hairColor", "hairBase", "eyebrows", "skinTone", "skinTexture",
  "eyeColor", "eyeState", "facialHair", "distinctiveFeature",
] as const
const STYLING_FIELDS = [
  "makeup", "eyewear", "headwear", "hairCut", "hairTreatment",
  "jewelry", "nails", "facePaint", "fabric",
] as const
const TEMPORAL_FIELDS = ["temporalSpeed", "temporalFreeze", "temporalDirection", "temporalShutter"] as const
const EXPOSURE_FIELDS = ["aperture", "shutterSpeed", "isoValue"] as const
const MUSIC_GENRE_FIELDS = ["genre", "subgenre", "era"] as const
const MUSIC_MOOD_FIELDS = ["energy", "emotion", "vibe"] as const
const INSTRUMENTATION_FIELDS = ["instruments", "production", "vocalPresence", "singingStyle"] as const
const VOICE_CHARACTER_FIELDS = ["age", "gender", "language", "accent", "timbre"] as const
const VOICE_DELIVERY_FIELDS = ["pace", "emotion", "archetype"] as const

const MULTI_CATALOGS: readonly PickerCatalog[] = [
  {
    nodeType: "framing",
    label: "Framing",
    catalogId: "framing",
    kind: "multi",
    fields: FRAMING_FIELDS,
    dimensions: categoryDiscriminatedDims(FRAMING_FIELDS, FRAMINGS, FRAMING_FIELD_BY_CATEGORY, FRAMING_CATEGORY_LABELS),
  },
  {
    nodeType: "lighting",
    label: "Lighting",
    catalogId: "lighting",
    kind: "multi",
    fields: LIGHTING_FIELDS,
    dimensions: categoryDiscriminatedDims(LIGHTING_FIELDS, LIGHTINGS, LIGHTING_FIELD_BY_CATEGORY, LIGHTING_CATEGORY_LABELS),
  },
  {
    nodeType: "person",
    label: "Person",
    catalogId: "person",
    kind: "multi",
    fields: PERSON_FIELDS,
    dimensions: dimensionDiscriminatedDims(PERSON_FIELDS, PEOPLE, PERSON_FIELD_BY_DIMENSION, PERSON_DIMENSION_LABELS),
  },
  {
    nodeType: "styling",
    label: "Styling",
    catalogId: "styling",
    kind: "multi",
    fields: STYLING_FIELDS,
    dimensions: dimensionDiscriminatedDims(STYLING_FIELDS, STYLINGS, STYLING_FIELD_BY_DIMENSION, STYLING_DIMENSION_LABELS),
  },
  {
    nodeType: "temporal",
    label: "Temporal",
    catalogId: "temporal",
    kind: "multi",
    fields: TEMPORAL_FIELDS,
    dimensions: categoryDiscriminatedDims(TEMPORAL_FIELDS, TEMPORALS, TEMPORAL_FIELD_BY_CATEGORY, TEMPORAL_CATEGORY_LABELS),
  },
  {
    nodeType: "exposure-settings",
    label: "Exposure Settings",
    catalogId: "exposure-settings",
    kind: "multi",
    fields: EXPOSURE_FIELDS,
    dimensions: categoryDiscriminatedDims(EXPOSURE_FIELDS, EXPOSURE_SETTINGS, EXPOSURE_FIELD_BY_CATEGORY, EXPOSURE_CATEGORY_LABELS),
  },
  // -------- "Sound" family --------
  {
    nodeType: "music-genre",
    label: "Music Genre",
    catalogId: "music-genre",
    kind: "multi",
    fields: MUSIC_GENRE_FIELDS,
    dimensions: musicGenreDims(MUSIC_GENRE_FIELDS),
  },
  {
    nodeType: "music-mood",
    label: "Music Mood",
    catalogId: "music-mood",
    kind: "multi",
    fields: MUSIC_MOOD_FIELDS,
    dimensions: perFieldDims([
      ["energy", MUSIC_ENERGIES],
      ["emotion", MUSIC_EMOTIONS],
      ["vibe", MUSIC_VIBES],
    ]),
  },
  {
    nodeType: "instrumentation",
    label: "Instrumentation",
    catalogId: "instrumentation",
    kind: "multi",
    fields: INSTRUMENTATION_FIELDS,
    dimensions: perFieldDims([
      ["instruments", INSTRUMENTS],
      ["production", PRODUCTION_STYLES],
      ["vocalPresence", VOCAL_PRESENCE],
      ["singingStyle", SINGING_STYLES],
    ]),
  },
  {
    nodeType: "voice-character",
    label: "Voice Character",
    catalogId: "voice-character",
    kind: "multi",
    fields: VOICE_CHARACTER_FIELDS,
    dimensions: perFieldDims([
      ["age", VOICE_AGES],
      ["gender", VOICE_GENDERS],
      ["language", VOICE_LANGUAGES],
      ["accent", VOICE_ACCENTS],
      ["timbre", VOICE_TIMBRES],
    ]),
  },
  {
    nodeType: "voice-delivery",
    label: "Voice Delivery",
    catalogId: "voice-delivery",
    kind: "multi",
    fields: VOICE_DELIVERY_FIELDS,
    dimensions: perFieldDims([
      ["pace", VOICE_PACES],
      ["emotion", VOICE_EMOTIONS],
      ["archetype", VOICE_ARCHETYPES],
    ]),
  },
]

export const PICKER_CATALOGS: readonly PickerCatalog[] = [
  ...SINGLE_CATALOGS,
  ...MULTI_CATALOGS,
]

/** Resolve a catalog by `nodeType` first, then by `catalogId`. */
export function getPickerCatalog(nodeTypeOrCatalogId: string): PickerCatalog | undefined {
  return (
    PICKER_CATALOGS.find((c) => c.nodeType === nodeTypeOrCatalogId) ??
    PICKER_CATALOGS.find((c) => c.catalogId === nodeTypeOrCatalogId)
  )
}

export function listPickerCatalogs(): readonly PickerCatalog[] {
  return PICKER_CATALOGS
}
