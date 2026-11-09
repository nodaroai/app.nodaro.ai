import { getRegisteredPickerCatalogs, type PickerCatalog } from "@nodaro/prompts/picker-catalogs"
import { SUBJECT_CUSTOM_AGE_KEY } from "@nodaro/prompts/prompt-builder"
import { isModelFactoryDenied } from "../surface-deny.js"
import { getRegisteredPresetPacks, type PackPreset } from "./app-presets.js"

/**
 * The boot check on every registered preset pack (lib/presets/app-presets.ts):
 * does each preset fit THIS deployment? The overlay loader runs it once the
 * overlay's register() has returned (lib/overlay/load.ts), so the catalogs it
 * reads already carry the overlay's own catalog packs, and refuses the boot when
 * it finds anything. Returns every problem, one line each; empty = fits.
 *
 *  - MODELS: every id named in a field a run takes its model from must be one
 *    the surface profile offers (`isModelFactoryDenied`). The profile ALONE:
 *    the admin override and the admin's model switch change at run time, so
 *    judging by them would let a click in Admin stop the next restart.
 *  - PICKER IDS: every id in a field that holds picker ids must be an option of
 *    the COMPOSED catalog that field reads, base catalogs plus every registered
 *    catalog pack — so a preset cannot bring back an option the deployment's
 *    curation removed. Which fields hold picker ids is stated below field by
 *    field, never guessed from values: `"high"` or `"auto"` is a picker id in
 *    one catalog and a node's own setting elsewhere.
 *  - PICTURE: `previewUrl` absent, or an absolute https URL.
 */
export function presetPackProblems(): string[] {
  const packs = getRegisteredPresetPacks()
  if (packs.length === 0) return []
  const catalogs = getRegisteredPickerCatalogs()
  const problems: string[] = []
  for (const pack of packs) {
    for (const preset of pack.presets) {
      problems.push(...modelProblems(preset), ...pickerProblems(pack.nodeType, preset, catalogs), ...pictureProblems(preset))
    }
  }
  return problems
}

/** The fields a run takes the model it dispatches from (the credit guard and the
 *  run-time deny read the same: `provider`, a fan-out's list, an LLM's model). */
const MODEL_FIELDS = ["provider", "providers", "models", "llmModel"] as const

/**
 * Which catalog each `direction` key reads its ids from: the catalog its row's
 * renderer resolves (`DIRECTION_FIELDS`, `@nodaro/prompts` direction-registry).
 * The last five are the registry's legacy whole-catalog keys. Pinned to the
 * registry by preset-pack-check.test.ts: every key is here, and an id of the
 * named catalog renders under its key.
 */
export const DIRECTION_KEY_CATALOG: ReadonlyMap<string, string> = new Map([
  ["cameraMotion", "camera-motions"],
  ["shotSize", "framing"],
  ["angle", "framing"],
  ["coverage", "framing"],
  ["composition", "framing"],
  ["vantage", "framing"],
  ["pose", "pose"],
  ["compositionEffect", "composition-effects"],
  ["cameraFormat", "camera-format"],
  ["lens", "lens"],
  ["aperture", "exposure-settings"],
  ["shutterSpeed", "exposure-settings"],
  ["isoValue", "exposure-settings"],
  ["timeOfDay", "lighting"],
  ["lightingStyle", "lighting"],
  ["lightingDirection", "lighting"],
  ["lightingRatio", "lighting"],
  ["colorTemperature", "lighting"],
  ["colorLook", "color-look"],
  ["atmosphere", "atmosphere"],
  ["postProcess", "post-process-effects"],
  ["style", "style"],
  ["mood", "mood"],
  ["aesthetic", "aesthetic"],
  ["photoGenre", "photo-genre"],
  ["photographer", "photographer"],
  ["renderQuality", "render-quality"],
  ["setting", "setting"],
  ["era", "era"],
  ["backdrop", "backdrop"],
  ["actionFx", "action-fx"],
  ["temporalSpeed", "temporal"],
  ["temporalFreeze", "temporal"],
  ["temporalDirection", "temporal"],
  ["temporalShutter", "temporal"],
  ["transition", "transitions"],
  ["loopSubject", "loop-subject"],
  ["framingId", "framing"],
  ["framingAngleId", "framing"],
  ["lightingId", "lighting"],
  ["lensId", "lens"],
  ["cameraFormatId", "camera-format"],
])

/** The `subject` prop rows and their catalogs (`SUBJECT_FIELDS`, kind "ids"). */
const SUBJECT_IDS_CATALOG: ReadonlyMap<string, string> = new Map([
  ["heldProp", "held-prop"],
  ["material", "materials"],
  ["animal", "animals"],
])

/** The `subject` group rows: each wire key is one dimension of these catalogs
 *  (a registered person pack's dimensions included — they compose in). */
const SUBJECT_GROUP_CATALOGS = ["person", "styling"] as const

/**
 * The node types whose top-level `style` is resolved through the Style catalog
 * (the shared image prompt builder, `assembleImageInput` / `buildImagePrompt`).
 * Elsewhere a `style` is the node's own setting: a caption look, a voice
 * setting, a music description, Edit Image's free text.
 */
const STYLE_CATALOG_NODE_TYPES: ReadonlySet<string> = new Set(["generate-image", "image-to-image", "modify-image"])

/** The catalog a `subject` key reads its ids from; undefined for a key the
 *  channel does not carry (and `customAge`, a number). */
export function subjectKeyCatalog(key: string, catalogs: readonly PickerCatalog[]): string | undefined {
  if (key === SUBJECT_CUSTOM_AGE_KEY) return undefined
  const prop = SUBJECT_IDS_CATALOG.get(key)
  if (prop) return prop
  return SUBJECT_GROUP_CATALOGS.find((id) => fieldOptions(catalogs, id, key) !== undefined)
}

function modelProblems(preset: PackPreset): string[] {
  const out: string[] = []
  for (const field of MODEL_FIELDS) {
    for (const id of picks(preset.data[field])) {
      if (isModelFactoryDenied(id)) {
        out.push(`${preset.id}: data.${field} names model "${id}", which this deployment does not offer`)
      }
    }
  }
  return out
}

function pickerProblems(nodeType: string, preset: PackPreset, catalogs: readonly PickerCatalog[]): string[] {
  const out: string[] = []
  const check = (path: string, value: unknown, catalogId: string, offered: ReadonlySet<string>): void => {
    for (const id of picks(value)) {
      if (!offered.has(id)) {
        out.push(`${preset.id}: ${path} "${id}" is not an option of this deployment's "${catalogId}" catalog`)
      }
    }
  }
  const { data } = preset

  // A preset for a picker node: its own value fields, each against its own options.
  const own = catalogs.find((c) => c.nodeType === nodeType)
  if (own) {
    if (own.valueField) check(`data.${own.valueField}`, data[own.valueField], own.catalogId, idSet(own.options ?? []))
    for (const d of own.dimensions ?? []) check(`data.${d.field}`, data[d.field], own.catalogId, idSet(d.options))
  }

  if (STYLE_CATALOG_NODE_TYPES.has(nodeType)) check("data.style", data.style, "style", catalogIds(catalogs, "style"))

  if (isRecord(data.direction)) {
    for (const [key, value] of Object.entries(data.direction)) {
      const catalogId = DIRECTION_KEY_CATALOG.get(key)
      if (catalogId) check(`data.direction.${key}`, value, catalogId, catalogIds(catalogs, catalogId))
    }
  }

  if (isRecord(data.subject)) {
    for (const [key, value] of Object.entries(data.subject)) {
      const catalogId = subjectKeyCatalog(key, catalogs)
      if (!catalogId) continue
      const offered = SUBJECT_IDS_CATALOG.has(key) ? catalogIds(catalogs, catalogId) : fieldOptions(catalogs, catalogId, key)!
      check(`data.subject.${key}`, value, catalogId, offered)
    }
  }
  return out
}

function pictureProblems(preset: PackPreset): string[] {
  const url: unknown = preset.previewUrl
  if (url === undefined || url === null || (typeof url === "string" && isHttpsUrl(url))) return []
  return [`${preset.id}: previewUrl must be absent or an absolute https URL (got ${JSON.stringify(url)})`]
}

/** The ids a field picks: one id or a list; empty strings and non-strings are
 *  no pick (a run drops them too). */
function picks(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value]
  return list.filter((v): v is string => typeof v === "string" && v.length > 0)
}

function idSet(options: ReadonlyArray<{ readonly id: string }>): ReadonlySet<string> {
  return new Set(options.map((o) => o.id))
}

/** Every option of a composed catalog, across its dimensions; empty when absent. */
function catalogIds(catalogs: readonly PickerCatalog[], catalogId: string): ReadonlySet<string> {
  const c = catalogs.find((x) => x.catalogId === catalogId)
  return idSet([...(c?.options ?? []), ...(c?.dimensions ?? []).flatMap((d) => d.options)])
}

/** The options of the dimension `field` of a composed catalog, or undefined. */
function fieldOptions(catalogs: readonly PickerCatalog[], catalogId: string, field: string): ReadonlySet<string> | undefined {
  const dim = catalogs.find((x) => x.catalogId === catalogId)?.dimensions?.find((d) => d.field === field)
  return dim ? idSet(dim.options) : undefined
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function isHttpsUrl(s: string): boolean {
  try {
    return new URL(s).protocol === "https:"
  } catch {
    return false
  }
}
