/**
 * Parameter-picker WIRING — the single source of truth for how each picker
 * node type binds to its catalog: value field(s), defaults, entries, grouping,
 * and per-field option lists for multi-dim pickers.
 *
 * Pure data, no React. Extracted from the app's parameter-picker-registry so
 * THREE consumers share one definition and cannot drift:
 *   1. The app's community fallback registry (chip pickers, no rich previews).
 *   2. `@nodaro/picker-ui`'s registry (attaches preview/Picker renderers).
 *   3. Nodaro Cine's builder panels.
 *
 * Renderers (preview components, multi-dim Picker components) deliberately do
 * NOT live here — presentation is the private package's concern; this file is
 * the public vocabulary.
 */
import {
  ANIMALS,
  ANIMAL_SUBCATEGORY_LABELS,
  ANIMAL_SUBCATEGORY_ORDER,
  VEHICLES,
  VEHICLE_SUBCATEGORY_LABELS,
  VEHICLE_SUBCATEGORY_ORDER,
  WEAPONS,
  WEAPON_SUBCATEGORY_LABELS,
  WEAPON_SUBCATEGORY_ORDER,
  FURNITURE,
  FURNITURE_SUBCATEGORY_LABELS,
  FURNITURE_SUBCATEGORY_ORDER,
  type I18nCatalogId,
} from "@nodaro/shared"
import { SETTINGS, SETTING_CATEGORY_LABELS } from "./setting.js"
import { MATERIALS, MATERIAL_CATEGORY_LABELS, MATERIAL_CATEGORY_ORDER } from "./materials.js"
import { ATMOSPHERES } from "./atmosphere.js"
import { STYLES } from "./style.js"
import { MOODS, MOOD_CATEGORY_LABELS, MOOD_CATEGORY_ORDER } from "./mood.js"
import { POSES, POSE_CATEGORY_LABELS, POSE_CATEGORY_ORDER } from "./pose.js"
import { CAMERA_MOTIONS, CAMERA_MOTION_CATEGORY_LABELS, CAMERA_MOTION_CATEGORY_ORDER } from "./camera-motions.js"
import { LENSES } from "./lens.js"
import { CAMERA_FORMATS } from "./camera-format.js"
import { COLOR_LOOKS, COLOR_LOOK_CATEGORY_LABELS, COLOR_LOOK_CATEGORY_ORDER } from "./color-look.js"
import { PHOTOGRAPHERS, PHOTOGRAPHER_CATEGORY_LABELS, PHOTOGRAPHER_CATEGORY_ORDER } from "./photographer.js"
import { AESTHETICS, AESTHETIC_CATEGORY_LABELS, AESTHETIC_CATEGORY_ORDER } from "./aesthetic.js"
import { ERAS, ERA_CATEGORY_LABELS, ERA_CATEGORY_ORDER } from "./era.js"
import { PHOTO_GENRES, PHOTO_GENRE_CATEGORY_LABELS, PHOTO_GENRE_CATEGORY_ORDER } from "./photo-genre.js"
import { BACKDROPS, BACKDROP_CATEGORY_LABELS, BACKDROP_CATEGORY_ORDER } from "./backdrop.js"
import { HELD_PROPS, HELD_PROP_CATEGORY_LABELS, HELD_PROP_CATEGORY_ORDER } from "./held-prop.js"
import { RENDER_QUALITIES } from "./render-quality.js"
import { COMPOSITION_EFFECTS } from "./composition-effects.js"
import { POST_PROCESS_EFFECTS } from "./post-process-effects.js"
import { ACTION_FX, ACTION_FX_CATEGORY_LABELS, ACTION_FX_CATEGORY_ORDER } from "./action-fx.js"
import { LOOP_SUBJECTS, LOOP_SUBJECT_CATEGORY_LABELS, LOOP_SUBJECT_CATEGORY_ORDER } from "./loop-subject.js"
import { TRANSITIONS, TRANSITION_CATEGORY_LABELS, TRANSITION_CATEGORY_ORDER } from "./transitions.js"
import { CHARACTER_FX, CHARACTER_FX_CATEGORY_LABELS, CHARACTER_FX_CATEGORY_ORDER } from "./character-fx.js"
import { FRAMINGS, FRAMING_CATEGORY_ORDER, FRAMING_FIELD_BY_CATEGORY } from "./framing.js"
import { LIGHTINGS, LIGHTING_CATEGORY_ORDER, LIGHTING_FIELD_BY_CATEGORY } from "./lighting.js"
import { STYLINGS, STYLING_DIMENSION_ORDER, STYLING_FIELD_BY_DIMENSION } from "./styling.js"
import { PEOPLE, PERSON_DIMENSION_ORDER, PERSON_FIELD_BY_DIMENSION } from "./person.js"
import { TEMPORALS } from "./temporal.js"
import { EXPOSURE_SETTINGS } from "./exposure-settings.js"
import { MUSIC_GENRES, MUSIC_ERAS } from "./music-genre.js"
import { MUSIC_ENERGIES, MUSIC_EMOTIONS, MUSIC_VIBES } from "./music-mood.js"
import { INSTRUMENTS, PRODUCTION_STYLES, VOCAL_PRESENCE, SINGING_STYLES } from "./instrumentation.js"
import { VOICE_AGES, VOICE_GENDERS, VOICE_LANGUAGES, VOICE_ACCENTS, VOICE_TIMBRES } from "./voice-character.js"
import { VOICE_PACES, VOICE_EMOTIONS, VOICE_ARCHETYPES } from "./voice-delivery.js"

/** One selectable catalog entry as picker UIs consume it. */
export interface PickerWiringEntry {
  readonly id: string
  readonly label: string
  readonly description: string
  /** Optional group key for category headers. */
  readonly group?: string
}

export interface SingleDimPickerWiring {
  readonly kind: "single"
  readonly nodeType: string
  readonly label: string
  readonly valueField: string
  readonly defaultValue: string
  readonly catalogId: I18nCatalogId
  readonly entries: ReadonlyArray<PickerWiringEntry>
  readonly groupOrder?: ReadonlyArray<string>
  readonly groupLabels?: Readonly<Record<string, string>>
}

export interface MultiDimPickerWiring {
  readonly kind: "multi"
  readonly nodeType: string
  readonly label: string
  /** Data fields the picker reads/writes — used to slice node.data into a value object. */
  readonly fields: ReadonlyArray<string>
  readonly catalogId: I18nCatalogId
  /** Flat id→label list — used to resolve ids into labels for summary chips. */
  readonly catalogEntries: ReadonlyArray<{ readonly id: string; readonly label: string }>
  /** Per-field option lists — lets a data-only consumer (community fallback,
   *  Cine simple mode) render one select per field without knowing the
   *  catalog's discriminator scheme. */
  readonly fieldOptions: Readonly<Record<string, ReadonlyArray<{ readonly id: string; readonly label: string }>>>
}

export type PickerWiring = SingleDimPickerWiring | MultiDimPickerWiring

function mapCat<T extends { id: string; label: string; description: string }>(
  arr: ReadonlyArray<T>,
  groupKey?: keyof T,
): ReadonlyArray<PickerWiringEntry> {
  return arr.map((e) => ({
    id: e.id,
    label: e.label,
    description: e.description,
    group: groupKey ? (e[groupKey] as unknown as string) : undefined,
  }))
}

function flatCat<T extends { id: string; label: string }>(
  arr: ReadonlyArray<T>,
): ReadonlyArray<{ id: string; label: string }> {
  return arr.map((e) => ({ id: e.id, label: e.label }))
}

/** Group a discriminated catalog into per-field option lists via key→field map. */
function optionsByDiscriminator<T extends { id: string; label: string }>(
  arr: ReadonlyArray<T>,
  keyOf: (e: T) => string,
  fieldByKey: Readonly<Record<string, string>>,
): Record<string, Array<{ id: string; label: string }>> {
  const out: Record<string, Array<{ id: string; label: string }>> = {}
  for (const e of arr) {
    const field = fieldByKey[keyOf(e)]
    if (!field) continue
    ;(out[field] ??= []).push({ id: e.id, label: e.label })
  }
  return out
}

export const SINGLE_PICKER_WIRING: ReadonlyArray<SingleDimPickerWiring> = [
  // -------- "Look" family --------
  { kind: "single", nodeType: "setting", label: "Setting", valueField: "setting", defaultValue: "forest", catalogId: "setting", entries: mapCat(SETTINGS, "category"), groupOrder: ["indoor", "urban", "nature", "fantastical"], groupLabels: SETTING_CATEGORY_LABELS },
  { kind: "single", nodeType: "atmosphere", label: "Atmosphere", valueField: "atmosphere", defaultValue: "clear", catalogId: "atmosphere", entries: mapCat(ATMOSPHERES) },
  { kind: "single", nodeType: "style", label: "Style", valueField: "style", defaultValue: "cinematic", catalogId: "style", entries: mapCat(STYLES) },
  { kind: "single", nodeType: "color-look", label: "Color / Look", valueField: "colorLook", defaultValue: "warm", catalogId: "color-look", entries: mapCat(COLOR_LOOKS, "category"), groupOrder: COLOR_LOOK_CATEGORY_ORDER as ReadonlyArray<string>, groupLabels: COLOR_LOOK_CATEGORY_LABELS as Record<string, string> },
  { kind: "single", nodeType: "mood", label: "Mood", valueField: "mood", defaultValue: "calm", catalogId: "mood", entries: mapCat(MOODS, "category"), groupOrder: MOOD_CATEGORY_ORDER as ReadonlyArray<string>, groupLabels: MOOD_CATEGORY_LABELS },
  { kind: "single", nodeType: "photographer", label: "Photographer / Artist", valueField: "photographer", defaultValue: "tim-walker", catalogId: "photographer", entries: mapCat(PHOTOGRAPHERS, "category"), groupOrder: PHOTOGRAPHER_CATEGORY_ORDER as ReadonlyArray<string>, groupLabels: PHOTOGRAPHER_CATEGORY_LABELS },
  { kind: "single", nodeType: "aesthetic", label: "Aesthetic / Microtrend", valueField: "aesthetic", defaultValue: "y2k", catalogId: "aesthetic", entries: mapCat(AESTHETICS, "category"), groupOrder: AESTHETIC_CATEGORY_ORDER as ReadonlyArray<string>, groupLabels: AESTHETIC_CATEGORY_LABELS },
  { kind: "single", nodeType: "era", label: "Era / Period", valueField: "era", defaultValue: "1990s-mall", catalogId: "era", entries: mapCat(ERAS, "category"), groupOrder: ERA_CATEGORY_ORDER as ReadonlyArray<string>, groupLabels: ERA_CATEGORY_LABELS },
  { kind: "single", nodeType: "photo-genre", label: "Photo Genre", valueField: "photoGenre", defaultValue: "fashion-editorial", catalogId: "photo-genre", entries: mapCat(PHOTO_GENRES, "category"), groupOrder: PHOTO_GENRE_CATEGORY_ORDER as ReadonlyArray<string>, groupLabels: PHOTO_GENRE_CATEGORY_LABELS },
  { kind: "single", nodeType: "backdrop", label: "Backdrop", valueField: "backdrop", defaultValue: "white-seamless", catalogId: "backdrop", entries: mapCat(BACKDROPS, "category"), groupOrder: BACKDROP_CATEGORY_ORDER as ReadonlyArray<string>, groupLabels: BACKDROP_CATEGORY_LABELS },
  { kind: "single", nodeType: "render-quality", label: "Render Quality", valueField: "renderQuality", defaultValue: "raytracing", catalogId: "render-quality", entries: mapCat(RENDER_QUALITIES) },
  { kind: "single", nodeType: "composition-effects", label: "Composition Effect", valueField: "compositionEffect", defaultValue: "bursting-through-frame", catalogId: "composition-effects", entries: mapCat(COMPOSITION_EFFECTS) },
  { kind: "single", nodeType: "action-fx", label: "Action FX", valueField: "actionFx", defaultValue: "earthquake-tremor", catalogId: "action-fx", entries: mapCat(ACTION_FX, "category"), groupOrder: ACTION_FX_CATEGORY_ORDER as ReadonlyArray<string>, groupLabels: ACTION_FX_CATEGORY_LABELS as Record<string, string> },
  { kind: "single", nodeType: "loop-subject", label: "Loop Subject", valueField: "loopSubject", defaultValue: "tunnel", catalogId: "loop-subject", entries: mapCat(LOOP_SUBJECTS, "category"), groupOrder: LOOP_SUBJECT_CATEGORY_ORDER as ReadonlyArray<string>, groupLabels: LOOP_SUBJECT_CATEGORY_LABELS as Record<string, string> },
  { kind: "single", nodeType: "post-process-effects", label: "Post-Process Effect", valueField: "postProcess", defaultValue: "vignette-soft", catalogId: "post-process-effects", entries: mapCat(POST_PROCESS_EFFECTS) },

  // -------- "Camera" family --------
  { kind: "single", nodeType: "camera-motion", label: "Camera Motion", valueField: "cameraMotion", defaultValue: "static", catalogId: "camera-motions", entries: mapCat(CAMERA_MOTIONS, "category"), groupOrder: CAMERA_MOTION_CATEGORY_ORDER as ReadonlyArray<string>, groupLabels: CAMERA_MOTION_CATEGORY_LABELS },
  { kind: "single", nodeType: "lens", label: "Lens", valueField: "lens", defaultValue: "normal-50mm", catalogId: "lens", entries: mapCat(LENSES) },
  { kind: "single", nodeType: "camera-format", label: "Camera / Film", valueField: "cameraFormat", defaultValue: "35mm-film", catalogId: "camera-format", entries: mapCat(CAMERA_FORMATS) },
  { kind: "single", nodeType: "transition", label: "Transition", valueField: "transition", defaultValue: "auto", catalogId: "transitions", entries: mapCat(TRANSITIONS, "category"), groupOrder: TRANSITION_CATEGORY_ORDER as ReadonlyArray<string>, groupLabels: TRANSITION_CATEGORY_LABELS },
  { kind: "single", nodeType: "character-fx", label: "Character FX", valueField: "characterFx", defaultValue: "auto", catalogId: "character-fx", entries: mapCat(CHARACTER_FX, "category"), groupOrder: CHARACTER_FX_CATEGORY_ORDER as ReadonlyArray<string>, groupLabels: CHARACTER_FX_CATEGORY_LABELS },

  // -------- "Subject / Object" family --------
  { kind: "single", nodeType: "pose", label: "Pose", valueField: "pose", defaultValue: "standing-upright", catalogId: "pose", entries: mapCat(POSES, "category"), groupOrder: POSE_CATEGORY_ORDER as ReadonlyArray<string>, groupLabels: POSE_CATEGORY_LABELS },
  { kind: "single", nodeType: "material", label: "Material", valueField: "material", defaultValue: "silk", catalogId: "materials", entries: mapCat(MATERIALS, "category"), groupOrder: MATERIAL_CATEGORY_ORDER as ReadonlyArray<string>, groupLabels: MATERIAL_CATEGORY_LABELS },
  { kind: "single", nodeType: "animal", label: "Animal", valueField: "animal", defaultValue: "dog-golden-retriever", catalogId: "animals", entries: mapCat(ANIMALS, "subcategory"), groupOrder: ANIMAL_SUBCATEGORY_ORDER as ReadonlyArray<string>, groupLabels: ANIMAL_SUBCATEGORY_LABELS },
  { kind: "single", nodeType: "vehicle", label: "Vehicle", valueField: "vehicle", defaultValue: "sedan", catalogId: "vehicles", entries: mapCat(VEHICLES, "subcategory"), groupOrder: VEHICLE_SUBCATEGORY_ORDER as ReadonlyArray<string>, groupLabels: VEHICLE_SUBCATEGORY_LABELS },
  { kind: "single", nodeType: "weapon", label: "Weapon", valueField: "weapon", defaultValue: "katana", catalogId: "weapons", entries: mapCat(WEAPONS, "subcategory"), groupOrder: WEAPON_SUBCATEGORY_ORDER as ReadonlyArray<string>, groupLabels: WEAPON_SUBCATEGORY_LABELS },
  { kind: "single", nodeType: "furniture", label: "Furniture", valueField: "furniture", defaultValue: "sofa", catalogId: "furniture", entries: mapCat(FURNITURE, "subcategory"), groupOrder: FURNITURE_SUBCATEGORY_ORDER as ReadonlyArray<string>, groupLabels: FURNITURE_SUBCATEGORY_LABELS },
  { kind: "single", nodeType: "held-prop", label: "Held Prop", valueField: "heldProp", defaultValue: "smartphone", catalogId: "held-prop", entries: mapCat(HELD_PROPS, "category"), groupOrder: HELD_PROP_CATEGORY_ORDER as ReadonlyArray<string>, groupLabels: HELD_PROP_CATEGORY_LABELS },
]

// Derived from the canonical dimension/category order + field map (same source
// the picker components and the describe-to-picker analyzer use). Deriving
// (not hand-listing) means these can never drift from the node-data shape.
const STYLING_FIELDS = STYLING_DIMENSION_ORDER.map((d) => STYLING_FIELD_BY_DIMENSION[d])
const PERSON_FIELDS = PERSON_DIMENSION_ORDER.map((d) => PERSON_FIELD_BY_DIMENSION[d])
const LIGHTING_FIELDS = LIGHTING_CATEGORY_ORDER.map((c) => LIGHTING_FIELD_BY_CATEGORY[c])

// Literal category→field maps for the two catalogs whose discriminators don't
// ship a shared FIELD_BY map (kept tiny + local; a wrong key = the field
// silently missing from fieldOptions, which the wiring guard test catches).
const TEMPORAL_FIELD_BY_CATEGORY: Readonly<Record<string, string>> = {
  speed: "temporalSpeed",
  freeze: "temporalFreeze",
  direction: "temporalDirection",
  shutter: "temporalShutter",
}
const EXPOSURE_FIELD_BY_CATEGORY: Readonly<Record<string, string>> = {
  aperture: "aperture",
  "shutter-speed": "shutterSpeed",
  iso: "isoValue",
}

export const MULTI_PICKER_WIRING: ReadonlyArray<MultiDimPickerWiring> = [
  {
    kind: "multi",
    nodeType: "framing",
    label: "Framing",
    fields: ["shotSize", "angle", "coverage", "composition", "vantage"],
    catalogId: "framing",
    catalogEntries: flatCat(FRAMINGS),
    fieldOptions: optionsByDiscriminator(FRAMINGS, (e) => e.category, FRAMING_FIELD_BY_CATEGORY as Readonly<Record<string, string>>),
  },
  {
    kind: "multi",
    nodeType: "lighting",
    label: "Lighting",
    fields: LIGHTING_FIELDS,
    catalogId: "lighting",
    catalogEntries: flatCat(LIGHTINGS),
    fieldOptions: optionsByDiscriminator(LIGHTINGS, (e) => e.category, LIGHTING_FIELD_BY_CATEGORY as Readonly<Record<string, string>>),
  },
  {
    kind: "multi",
    nodeType: "person",
    label: "Person",
    fields: PERSON_FIELDS,
    catalogId: "person",
    catalogEntries: flatCat(PEOPLE),
    fieldOptions: optionsByDiscriminator(PEOPLE, (e) => e.dimension, PERSON_FIELD_BY_DIMENSION as Readonly<Record<string, string>>),
  },
  {
    kind: "multi",
    nodeType: "styling",
    label: "Styling",
    fields: STYLING_FIELDS,
    catalogId: "styling",
    catalogEntries: flatCat(STYLINGS),
    fieldOptions: optionsByDiscriminator(STYLINGS, (e) => e.dimension, STYLING_FIELD_BY_DIMENSION as Readonly<Record<string, string>>),
  },
  {
    kind: "multi",
    nodeType: "temporal",
    label: "Temporal",
    fields: ["temporalSpeed", "temporalFreeze", "temporalDirection", "temporalShutter"],
    catalogId: "temporal",
    catalogEntries: flatCat(TEMPORALS),
    fieldOptions: optionsByDiscriminator(TEMPORALS, (e) => e.category, TEMPORAL_FIELD_BY_CATEGORY),
  },
  {
    kind: "multi",
    nodeType: "exposure-settings",
    label: "Exposure Settings",
    fields: ["aperture", "shutterSpeed", "isoValue"],
    catalogId: "exposure-settings",
    catalogEntries: flatCat(EXPOSURE_SETTINGS),
    fieldOptions: optionsByDiscriminator(EXPOSURE_SETTINGS, (e) => e.category, EXPOSURE_FIELD_BY_CATEGORY),
  },
  // -------- "Sound" family --------
  // Music Genre catalog is hierarchical: flatten genres + every subgenre +
  // eras so summary chips can resolve any selected id back to a human label.
  {
    kind: "multi",
    nodeType: "music-genre",
    label: "Music Genre",
    fields: ["genre", "subgenre", "era"],
    catalogId: "music-genre",
    catalogEntries: [
      ...flatCat(MUSIC_GENRES),
      ...MUSIC_GENRES.flatMap((g) => g.subgenres.map((s) => ({ id: s.id, label: s.label }))),
      ...flatCat(MUSIC_ERAS),
    ],
    fieldOptions: {
      genre: flatCat(MUSIC_GENRES),
      subgenre: MUSIC_GENRES.flatMap((g) => g.subgenres.map((s) => ({ id: s.id, label: s.label }))),
      era: flatCat(MUSIC_ERAS),
    },
  },
  {
    kind: "multi",
    nodeType: "music-mood",
    label: "Music Mood",
    fields: ["energy", "emotion", "vibe"],
    catalogId: "music-mood",
    catalogEntries: [...flatCat(MUSIC_ENERGIES), ...flatCat(MUSIC_EMOTIONS), ...flatCat(MUSIC_VIBES)],
    fieldOptions: {
      energy: flatCat(MUSIC_ENERGIES),
      emotion: flatCat(MUSIC_EMOTIONS),
      vibe: flatCat(MUSIC_VIBES),
    },
  },
  {
    kind: "multi",
    nodeType: "instrumentation",
    label: "Instrumentation",
    fields: ["instruments", "production", "vocalPresence", "singingStyle"],
    catalogId: "instrumentation",
    catalogEntries: [...flatCat(INSTRUMENTS), ...flatCat(PRODUCTION_STYLES), ...flatCat(VOCAL_PRESENCE), ...flatCat(SINGING_STYLES)],
    fieldOptions: {
      instruments: flatCat(INSTRUMENTS),
      production: flatCat(PRODUCTION_STYLES),
      vocalPresence: flatCat(VOCAL_PRESENCE),
      singingStyle: flatCat(SINGING_STYLES),
    },
  },
  {
    kind: "multi",
    nodeType: "voice-character",
    label: "Voice Character",
    fields: ["age", "gender", "language", "accent", "timbre"],
    catalogId: "voice-character",
    catalogEntries: [...flatCat(VOICE_AGES), ...flatCat(VOICE_GENDERS), ...flatCat(VOICE_LANGUAGES), ...flatCat(VOICE_ACCENTS), ...flatCat(VOICE_TIMBRES)],
    fieldOptions: {
      age: flatCat(VOICE_AGES),
      gender: flatCat(VOICE_GENDERS),
      language: flatCat(VOICE_LANGUAGES),
      accent: flatCat(VOICE_ACCENTS),
      timbre: flatCat(VOICE_TIMBRES),
    },
  },
  {
    kind: "multi",
    nodeType: "voice-delivery",
    label: "Voice Delivery",
    fields: ["pace", "emotion", "archetype"],
    catalogId: "voice-delivery",
    catalogEntries: [...flatCat(VOICE_PACES), ...flatCat(VOICE_EMOTIONS), ...flatCat(VOICE_ARCHETYPES)],
    fieldOptions: {
      pace: flatCat(VOICE_PACES),
      emotion: flatCat(VOICE_EMOTIONS),
      archetype: flatCat(VOICE_ARCHETYPES),
    },
  },
]

export const ALL_PICKER_WIRING: ReadonlyArray<PickerWiring> = [
  ...SINGLE_PICKER_WIRING,
  ...MULTI_PICKER_WIRING,
]

const WIRING_MAP = new Map<string, PickerWiring>(ALL_PICKER_WIRING.map((w) => [w.nodeType, w]))

export function getPickerWiring(nodeType: string | undefined | null): PickerWiring | undefined {
  if (!nodeType) return undefined
  return WIRING_MAP.get(nodeType)
}
