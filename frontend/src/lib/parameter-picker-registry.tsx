"use client"

/**
 * Registry of parameter picker nodes for presentation mode.
 *
 * Two kinds:
 * - "single": one value field with a string id chosen from a catalog. Renders
 *   the standard search-grid picker. Supports `allowedValues` whitelist.
 * - "multi":  several value fields (e.g. Framing.shotSize + .angle + .coverage).
 *   Renders the existing multi-dim picker component verbatim. No
 *   per-value restrict in this round — too complex to surface.
 *
 * PickerInputCard dispatches on `kind`.
 */

import type { ComponentType, ReactNode } from "react"
import type { I18nCatalogId } from "@nodaro/shared"

import { SETTINGS, SETTING_CATEGORY_LABELS } from "@nodaro/shared"
import { MATERIALS, MATERIAL_CATEGORY_LABELS, MATERIAL_CATEGORY_ORDER } from "@nodaro/shared"
import { ATMOSPHERES } from "@nodaro/shared"
import { STYLES } from "@nodaro/shared"
import { MOODS, MOOD_CATEGORY_LABELS, MOOD_CATEGORY_ORDER } from "@nodaro/shared"
import { POSES, POSE_CATEGORY_LABELS, POSE_CATEGORY_ORDER } from "@nodaro/shared"
import { CAMERA_MOTIONS, CAMERA_MOTION_CATEGORY_LABELS, CAMERA_MOTION_CATEGORY_ORDER } from "@nodaro/shared"
import { LENSES } from "@nodaro/shared"
import { CAMERA_FORMATS } from "@nodaro/shared"
import { COLOR_LOOKS, COLOR_LOOK_CATEGORY_LABELS, COLOR_LOOK_CATEGORY_ORDER } from "@nodaro/shared"
import { ANIMALS, ANIMAL_SUBCATEGORY_LABELS, ANIMAL_SUBCATEGORY_ORDER } from "@nodaro/shared"
import { VEHICLES, VEHICLE_SUBCATEGORY_LABELS, VEHICLE_SUBCATEGORY_ORDER } from "@nodaro/shared"
import { WEAPONS, WEAPON_SUBCATEGORY_LABELS, WEAPON_SUBCATEGORY_ORDER } from "@nodaro/shared"
import { PHOTOGRAPHERS, PHOTOGRAPHER_CATEGORY_LABELS, PHOTOGRAPHER_CATEGORY_ORDER } from "@nodaro/shared"
import { AESTHETICS, AESTHETIC_CATEGORY_LABELS, AESTHETIC_CATEGORY_ORDER } from "@nodaro/shared"
import { ERAS, ERA_CATEGORY_LABELS, ERA_CATEGORY_ORDER } from "@nodaro/shared"
import { PHOTO_GENRES, PHOTO_GENRE_CATEGORY_LABELS, PHOTO_GENRE_CATEGORY_ORDER } from "@nodaro/shared"
import { BACKDROPS, BACKDROP_CATEGORY_LABELS, BACKDROP_CATEGORY_ORDER } from "@nodaro/shared"
import { HELD_PROPS, HELD_PROP_CATEGORY_LABELS, HELD_PROP_CATEGORY_ORDER } from "@nodaro/shared"
import { RENDER_QUALITIES } from "@nodaro/shared"
import { COMPOSITION_EFFECTS } from "@nodaro/shared"
import { POST_PROCESS_EFFECTS } from "@nodaro/shared"
import { ACTION_FX, ACTION_FX_CATEGORY_LABELS, ACTION_FX_CATEGORY_ORDER } from "@nodaro/shared"
import { LOOP_SUBJECTS, LOOP_SUBJECT_CATEGORY_LABELS, LOOP_SUBJECT_CATEGORY_ORDER } from "@nodaro/shared"
import { FRAMINGS } from "@nodaro/shared"
import { LIGHTINGS } from "@nodaro/shared"
import { PEOPLE } from "@nodaro/shared"
import { STYLINGS } from "@nodaro/shared"
import { TEMPORALS } from "@nodaro/shared"
import { EXPOSURE_SETTINGS } from "@nodaro/shared"

import { SettingPreview } from "@/components/editor/config-panels/setting-preview"
import { MaterialPreview } from "@/components/editor/config-panels/material-preview"
import { AtmospherePreview } from "@/components/editor/config-panels/atmosphere-preview"
import { StylePreview } from "@/components/editor/config-panels/style-preview"
import { MoodEmoji } from "@/components/editor/config-panels/mood-emoji"
import { PoseIcon } from "@/components/editor/config-panels/pose-icon"
import { CameraMotionPreview } from "@/components/editor/config-panels/camera-motion-preview"
import { LensPreview } from "@/components/editor/config-panels/lens-preview"
import { CameraFormatPreview } from "@/components/editor/config-panels/camera-format-preview"
import { ColorLookPreview } from "@/components/editor/config-panels/color-look-preview"
import { FramingPicker } from "@/components/editor/config-panels/framing-picker"
import { LightingPicker } from "@/components/editor/config-panels/lighting-picker"
import { PersonPicker } from "@/components/editor/config-panels/person-picker"
import { StylingPicker } from "@/components/editor/config-panels/styling-picker"
import { TemporalPicker } from "@/components/editor/config-panels/temporal-picker"
import { ExposureSettingsPicker } from "@/components/editor/config-panels/exposure-settings-picker"
import { ANIMAL_ICON_FOR } from "./parameter-picker-icons-animals"
import { VEHICLE_ICON_FOR } from "./parameter-picker-icons-vehicles"
import { WEAPON_ICON_FOR } from "./parameter-picker-icons-weapons"

import type { DimensionEntry } from "@/components/editor/config-panels/dimension-modal-browser"

export interface PickerCatalogEntry extends DimensionEntry {
  /** Optional group key for category headers. */
  readonly group?: string
}

interface BaseParameterPickerMeta {
  readonly nodeType: string
  readonly label: string
}

export interface SingleDimParameterPickerMeta extends BaseParameterPickerMeta {
  readonly kind: "single"
  readonly valueField: string
  readonly defaultValue: string
  readonly catalogId: I18nCatalogId
  readonly entries: ReadonlyArray<PickerCatalogEntry>
  readonly groupOrder?: ReadonlyArray<string>
  readonly groupLabels?: Readonly<Record<string, string>>
  readonly renderIcon?: (entryId: string) => ReactNode
}

/** Generic value object shape for multi-dim picker — a record of optional ids. */
export type MultiDimValue = Record<string, string | ReadonlyArray<string> | undefined>

export interface MultiDimParameterPickerMeta extends BaseParameterPickerMeta {
  readonly kind: "multi"
  /** Data fields the picker reads/writes — used to slice node.data into a value object. */
  readonly fields: ReadonlyArray<string>
  /** I18n catalog id for the picker (used to resolve labels in the modal summary chip). */
  readonly catalogId: I18nCatalogId
  /** Catalog entries — used to resolve ids into labels for the summary chip. */
  readonly catalogEntries: ReadonlyArray<{ readonly id: string; readonly label: string }>
  /** The full multi-dim picker component. */
  readonly Picker: ComponentType<{
    value: MultiDimValue
    onChange: (patch: MultiDimValue) => void
    className?: string
  }>
}

export type ParameterPickerMeta =
  | SingleDimParameterPickerMeta
  | MultiDimParameterPickerMeta

function mapCat<T extends { id: string; label: string; description: string }>(
  arr: ReadonlyArray<T>,
  groupKey?: keyof T,
): ReadonlyArray<PickerCatalogEntry> {
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

const SINGLE_PICKERS: ReadonlyArray<SingleDimParameterPickerMeta> = [
  // -------- "Look" family --------
  {
    kind: "single",
    nodeType: "setting",
    label: "Setting",
    valueField: "setting",
    defaultValue: "forest",
    catalogId: "setting",
    entries: mapCat(SETTINGS, "category"),
    groupOrder: ["indoor", "urban", "nature", "fantastical"],
    groupLabels: SETTING_CATEGORY_LABELS,
    renderIcon: (id) => <SettingPreview settingId={id} className="size-full" />,
  },
  {
    kind: "single",
    nodeType: "atmosphere",
    label: "Atmosphere",
    valueField: "atmosphere",
    defaultValue: "clear",
    catalogId: "atmosphere",
    entries: mapCat(ATMOSPHERES),
    renderIcon: (id) => <AtmospherePreview atmosphereId={id} className="size-full" />,
  },
  {
    kind: "single",
    nodeType: "style",
    label: "Style",
    valueField: "style",
    defaultValue: "cinematic",
    catalogId: "style",
    entries: mapCat(STYLES),
    renderIcon: (id) => <StylePreview styleId={id} className="size-full" />,
  },
  {
    kind: "single",
    nodeType: "color-look",
    label: "Color / Look",
    valueField: "colorLook",
    defaultValue: "warm",
    catalogId: "color-look",
    entries: mapCat(COLOR_LOOKS, "category"),
    groupOrder: COLOR_LOOK_CATEGORY_ORDER as ReadonlyArray<string>,
    groupLabels: COLOR_LOOK_CATEGORY_LABELS as Record<string, string>,
    renderIcon: (id) => <ColorLookPreview colorLookId={id} className="size-full" />,
  },
  {
    kind: "single",
    nodeType: "mood",
    label: "Mood",
    valueField: "mood",
    defaultValue: "calm",
    catalogId: "mood",
    entries: mapCat(MOODS, "category"),
    groupOrder: MOOD_CATEGORY_ORDER as ReadonlyArray<string>,
    groupLabels: MOOD_CATEGORY_LABELS,
    renderIcon: (id) => <MoodEmoji moodId={id} className="size-full" />,
  },
  {
    kind: "single",
    nodeType: "photographer",
    label: "Photographer / Artist",
    valueField: "photographer",
    defaultValue: "tim-walker",
    catalogId: "photographer",
    entries: mapCat(PHOTOGRAPHERS, "category"),
    groupOrder: PHOTOGRAPHER_CATEGORY_ORDER as ReadonlyArray<string>,
    groupLabels: PHOTOGRAPHER_CATEGORY_LABELS,
  },
  {
    kind: "single",
    nodeType: "aesthetic",
    label: "Aesthetic / Microtrend",
    valueField: "aesthetic",
    defaultValue: "y2k",
    catalogId: "aesthetic",
    entries: mapCat(AESTHETICS, "category"),
    groupOrder: AESTHETIC_CATEGORY_ORDER as ReadonlyArray<string>,
    groupLabels: AESTHETIC_CATEGORY_LABELS,
  },
  {
    kind: "single",
    nodeType: "era",
    label: "Era / Period",
    valueField: "era",
    defaultValue: "1990s-mall",
    catalogId: "era",
    entries: mapCat(ERAS, "category"),
    groupOrder: ERA_CATEGORY_ORDER as ReadonlyArray<string>,
    groupLabels: ERA_CATEGORY_LABELS,
  },
  {
    kind: "single",
    nodeType: "photo-genre",
    label: "Photo Genre",
    valueField: "photoGenre",
    defaultValue: "fashion-editorial",
    catalogId: "photo-genre",
    entries: mapCat(PHOTO_GENRES, "category"),
    groupOrder: PHOTO_GENRE_CATEGORY_ORDER as ReadonlyArray<string>,
    groupLabels: PHOTO_GENRE_CATEGORY_LABELS,
  },
  {
    kind: "single",
    nodeType: "backdrop",
    label: "Backdrop",
    valueField: "backdrop",
    defaultValue: "white-seamless",
    catalogId: "backdrop",
    entries: mapCat(BACKDROPS, "category"),
    groupOrder: BACKDROP_CATEGORY_ORDER as ReadonlyArray<string>,
    groupLabels: BACKDROP_CATEGORY_LABELS,
  },
  {
    kind: "single",
    nodeType: "render-quality",
    label: "Render Quality",
    valueField: "renderQuality",
    defaultValue: "raytracing",
    catalogId: "render-quality",
    entries: mapCat(RENDER_QUALITIES),
  },
  {
    kind: "single",
    nodeType: "composition-effects",
    label: "Composition Effect",
    valueField: "compositionEffect",
    defaultValue: "bursting-through-frame",
    catalogId: "composition-effects",
    entries: mapCat(COMPOSITION_EFFECTS),
  },
  {
    kind: "single",
    nodeType: "action-fx",
    label: "Action FX",
    valueField: "actionFx",
    defaultValue: "earthquake-tremor",
    catalogId: "action-fx",
    entries: mapCat(ACTION_FX, "category"),
    groupOrder: ACTION_FX_CATEGORY_ORDER as ReadonlyArray<string>,
    groupLabels: ACTION_FX_CATEGORY_LABELS as Record<string, string>,
  },
  {
    kind: "single",
    nodeType: "loop-subject",
    label: "Loop Subject",
    valueField: "loopSubject",
    defaultValue: "tunnel",
    catalogId: "loop-subject",
    entries: mapCat(LOOP_SUBJECTS, "category"),
    groupOrder: LOOP_SUBJECT_CATEGORY_ORDER as ReadonlyArray<string>,
    groupLabels: LOOP_SUBJECT_CATEGORY_LABELS as Record<string, string>,
  },
  {
    kind: "single",
    nodeType: "post-process-effects",
    label: "Post-Process Effect",
    valueField: "postProcess",
    defaultValue: "vignette-soft",
    catalogId: "post-process-effects",
    entries: mapCat(POST_PROCESS_EFFECTS),
  },

  // -------- "Camera" family --------
  {
    kind: "single",
    nodeType: "camera-motion",
    label: "Camera Motion",
    valueField: "cameraMotion",
    defaultValue: "static",
    catalogId: "camera-motions",
    entries: mapCat(CAMERA_MOTIONS, "category"),
    groupOrder: CAMERA_MOTION_CATEGORY_ORDER as ReadonlyArray<string>,
    groupLabels: CAMERA_MOTION_CATEGORY_LABELS,
    renderIcon: (id) => <CameraMotionPreview motionId={id} className="size-full" />,
  },
  {
    kind: "single",
    nodeType: "lens",
    label: "Lens",
    valueField: "lens",
    defaultValue: "normal-50mm",
    catalogId: "lens",
    entries: mapCat(LENSES),
    renderIcon: (id) => <LensPreview lensId={id} className="size-full" />,
  },
  {
    kind: "single",
    nodeType: "camera-format",
    label: "Camera / Film",
    valueField: "cameraFormat",
    defaultValue: "35mm-film",
    catalogId: "camera-format",
    entries: mapCat(CAMERA_FORMATS),
    renderIcon: (id) => <CameraFormatPreview cameraFormatId={id} className="size-full" />,
  },

  // -------- "Subject / Object" family --------
  {
    kind: "single",
    nodeType: "pose",
    label: "Pose",
    valueField: "pose",
    defaultValue: "standing-upright",
    catalogId: "pose",
    entries: mapCat(POSES, "category"),
    groupOrder: POSE_CATEGORY_ORDER as ReadonlyArray<string>,
    groupLabels: POSE_CATEGORY_LABELS,
    renderIcon: (id) => <PoseIcon poseId={id} className="size-full" />,
  },
  {
    kind: "single",
    nodeType: "material",
    label: "Material",
    valueField: "material",
    defaultValue: "silk",
    catalogId: "materials",
    entries: mapCat(MATERIALS, "category"),
    groupOrder: MATERIAL_CATEGORY_ORDER as ReadonlyArray<string>,
    groupLabels: MATERIAL_CATEGORY_LABELS,
    renderIcon: (id) => <MaterialPreview materialId={id} className="size-full" />,
  },
  {
    kind: "single",
    nodeType: "animal",
    label: "Animal",
    valueField: "animal",
    defaultValue: "dog-golden-retriever",
    catalogId: "animals",
    entries: mapCat(ANIMALS, "subcategory"),
    groupOrder: ANIMAL_SUBCATEGORY_ORDER as ReadonlyArray<string>,
    groupLabels: ANIMAL_SUBCATEGORY_LABELS,
    renderIcon: (id) => <span className="text-2xl">{ANIMAL_ICON_FOR(id)}</span>,
  },
  {
    kind: "single",
    nodeType: "vehicle",
    label: "Vehicle",
    valueField: "vehicle",
    defaultValue: "sedan",
    catalogId: "vehicles",
    entries: mapCat(VEHICLES, "subcategory"),
    groupOrder: VEHICLE_SUBCATEGORY_ORDER as ReadonlyArray<string>,
    groupLabels: VEHICLE_SUBCATEGORY_LABELS,
    renderIcon: (id) => <span className="text-2xl">{VEHICLE_ICON_FOR(id)}</span>,
  },
  {
    kind: "single",
    nodeType: "weapon",
    label: "Weapon",
    valueField: "weapon",
    defaultValue: "katana",
    catalogId: "weapons",
    entries: mapCat(WEAPONS, "subcategory"),
    groupOrder: WEAPON_SUBCATEGORY_ORDER as ReadonlyArray<string>,
    groupLabels: WEAPON_SUBCATEGORY_LABELS,
    renderIcon: (id) => <span className="text-2xl">{WEAPON_ICON_FOR(id)}</span>,
  },
  {
    kind: "single",
    nodeType: "held-prop",
    label: "Held Prop",
    valueField: "heldProp",
    defaultValue: "smartphone",
    catalogId: "held-prop",
    entries: mapCat(HELD_PROPS, "category"),
    groupOrder: HELD_PROP_CATEGORY_ORDER as ReadonlyArray<string>,
    groupLabels: HELD_PROP_CATEGORY_LABELS,
  },
]

// Type-erased adapter: the picker components have strict typed value objects;
// we coerce to/from the generic MultiDimValue at the registry boundary so the
// rest of the codebase can deal with one shape.
const erase = <T,>(C: ComponentType<{ value: T; onChange: (patch: Partial<T>) => void; className?: string }>) =>
  C as unknown as ComponentType<{
    value: MultiDimValue
    onChange: (patch: MultiDimValue) => void
    className?: string
  }>

const MULTI_PICKERS: ReadonlyArray<MultiDimParameterPickerMeta> = [
  {
    kind: "multi",
    nodeType: "framing",
    label: "Framing",
    fields: ["shotSize", "angle", "coverage", "composition", "vantage"],
    catalogId: "framing",
    catalogEntries: flatCat(FRAMINGS),
    Picker: erase(FramingPicker),
  },
  {
    kind: "multi",
    nodeType: "lighting",
    label: "Lighting",
    fields: ["timeOfDay", "lightingStyle", "lightingDirection"],
    catalogId: "lighting",
    catalogEntries: flatCat(LIGHTINGS),
    Picker: erase(LightingPicker),
  },
  {
    kind: "multi",
    nodeType: "person",
    label: "Person",
    fields: [
      "type", "age", "ethnicity", "build", "bodyProportions",
      "faceShape", "jawline", "eyeShape", "nose", "lips", "lipState",
      "hairColor", "hairBase", "eyebrows", "skinTone", "skinTexture",
      "eyeColor", "eyeState", "facialHair", "distinctiveFeature",
    ],
    catalogId: "person",
    catalogEntries: flatCat(PEOPLE),
    Picker: erase(PersonPicker),
  },
  {
    kind: "multi",
    nodeType: "styling",
    label: "Styling",
    fields: [
      "makeup", "eyewear", "headwear", "hairCut", "hairTreatment",
      "jewelry", "nails", "facePaint", "fabric",
    ],
    catalogId: "styling",
    catalogEntries: flatCat(STYLINGS),
    Picker: erase(StylingPicker),
  },
  {
    kind: "multi",
    nodeType: "temporal",
    label: "Temporal",
    fields: ["temporalSpeed", "temporalFreeze", "temporalDirection", "temporalShutter"],
    catalogId: "temporal",
    catalogEntries: flatCat(TEMPORALS),
    Picker: erase(TemporalPicker),
  },
  {
    kind: "multi",
    nodeType: "exposure-settings",
    label: "Exposure Settings",
    fields: ["aperture", "shutterSpeed", "isoValue"],
    catalogId: "exposure-settings",
    catalogEntries: flatCat(EXPOSURE_SETTINGS),
    Picker: erase(ExposureSettingsPicker),
  },
]

const ALL_PICKERS: ReadonlyArray<ParameterPickerMeta> = [
  ...SINGLE_PICKERS,
  ...MULTI_PICKERS,
]

const PICKER_MAP = new Map<string, ParameterPickerMeta>(
  ALL_PICKERS.map((p) => [p.nodeType, p]),
)

export function getParameterPickerMeta(nodeType: string | undefined | null): ParameterPickerMeta | undefined {
  if (!nodeType) return undefined
  return PICKER_MAP.get(nodeType)
}

export { isParameterPickerNode } from "./parameter-picker-types"

export const ALL_PARAMETER_PICKERS = ALL_PICKERS
