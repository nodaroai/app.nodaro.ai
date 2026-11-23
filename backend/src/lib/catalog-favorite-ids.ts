/**
 * Which picker options can be favorited, and the ONE spelling each is stored
 * under (`catalog_favorites`, migration 688).
 *
 * The catalogs are code, not rows, so a favorite carries no foreign key: the
 * API validates both ids here, against the same catalogs it serves.
 *
 *  - Every picker catalog `/v1/picker-catalogs` and `/v1/catalogs` serve —
 *    the pack-composed set (`getRegisteredPickerCatalogs`), so a deployment's
 *    vendored packs count — keyed by its `catalogId` (`style`, `color-look`,
 *    `camera-motions`, `music-genre`, `instrumentation`, `voice-delivery`,
 *    `person`, `framing`, ...). Its node type is accepted as another spelling
 *    (`camera-motion` → `camera-motions`) and stored as the catalogId.
 *  - Catalogs served elsewhere, by their own ids (`EXTRA_CATALOGS`): the shot
 *    shapes (`shot-shapes`, the blueprints `list_shot_shapes` serves) and the
 *    Style Gallery looks (`style-presets`, the film director's looks).
 *
 * An option id: a single catalog's own option is its id (`watercolor`). An
 * option of a catalog's per-field dimension (every option of a multi-field
 * catalog — Person, Framing, the music pickers — and a single catalog's
 * secondary fields, a transition's duration) is `<field>:<id>`
 * (`genre:jazz`), because the same id can sit in two fields (`auto`). A bare
 * id is accepted when it names exactly one option and stored in that form.
 */
import { getRegisteredPickerCatalogs, type PickerCatalog } from "@nodaro/prompts/picker-catalogs"
import { STYLE_PRESETS } from "@nodaro/prompts/presets"
import { BLUEPRINT_IDS } from "../services/shot-sequence/blueprint-params.js"

/** A catalog served outside the picker catalogs: its id and its options. */
interface ExtraCatalog {
  readonly id: string
  readonly options: () => ReadonlyArray<{ readonly id: string; readonly label: string }>
}

/** Title-cases a slug for a label (`kinetic-type-beats` → `Kinetic Type Beats`). */
function slugLabel(id: string): string {
  return id
    .split("-")
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ")
}

/** The catalogs favorited by their own ids that are not picker catalogs. Data-driven: one row per catalog. */
export const EXTRA_CATALOGS: readonly ExtraCatalog[] = [
  { id: "shot-shapes", options: () => BLUEPRINT_IDS.map((id) => ({ id, label: slugLabel(id) })) },
  { id: "style-presets", options: () => STYLE_PRESETS.map((p) => ({ id: p.id, label: p.label })) },
]

/** A favorite as stored: the catalog's id and the option's canonical id. */
export interface CatalogFavoriteKey {
  readonly catalog: string
  readonly optionId: string
  /** The option's label, for a list to render with no second lookup. */
  readonly label: string
}

export type CatalogKeyResult =
  | { readonly ok: true; readonly key: CatalogFavoriteKey }
  | { readonly ok: false; readonly reason: "unknown_catalog" | "unknown_option" | "ambiguous_option"; readonly message: string }

/** Every catalog id a favorite may name, picker catalogs first. */
export function favoritableCatalogIds(): string[] {
  return [...getRegisteredPickerCatalogs().map((c) => c.catalogId), ...EXTRA_CATALOGS.map((c) => c.id)]
}

function findPickerCatalog(id: string): PickerCatalog | undefined {
  const all = getRegisteredPickerCatalogs()
  return all.find((c) => c.catalogId === id) ?? all.find((c) => c.nodeType === id)
}

function resolvePickerOption(c: PickerCatalog, raw: string): CatalogKeyResult {
  const dims = c.dimensions ?? []
  const sep = raw.indexOf(":")
  if (sep > 0) {
    const field = raw.slice(0, sep)
    const id = raw.slice(sep + 1)
    // `<valueField>:<id>` names a single catalog's own option: stored bare.
    if (field === c.valueField) {
      const own = (c.options ?? []).find((o) => o.id === id)
      if (own) return { ok: true, key: { catalog: c.catalogId, optionId: own.id, label: own.label } }
    }
    const option = dims.find((d) => d.field === field)?.options.find((o) => o.id === id)
    if (option) return { ok: true, key: { catalog: c.catalogId, optionId: `${field}:${option.id}`, label: option.label } }
  }
  const own = (c.options ?? []).find((o) => o.id === raw)
  if (own) return { ok: true, key: { catalog: c.catalogId, optionId: own.id, label: own.label } }
  const matches = dims.flatMap((d) => d.options.filter((o) => o.id === raw).map((o) => ({ field: d.field, option: o })))
  if (matches.length === 1) {
    const { field, option } = matches[0]!
    return { ok: true, key: { catalog: c.catalogId, optionId: `${field}:${option.id}`, label: option.label } }
  }
  if (matches.length > 1) {
    return {
      ok: false,
      reason: "ambiguous_option",
      message: `"${raw}" is an option of more than one field of ${c.catalogId} (${matches.map((m) => m.field).join(", ")}): send it as <field>:<id>`,
    }
  }
  return { ok: false, reason: "unknown_option", message: `${c.catalogId} has no option "${raw}"` }
}

/**
 * The stored form of `catalog` + `optionId`, or why it is refused. Pure: reads
 * the catalogs in memory, never the database.
 */
export function resolveCatalogFavorite(catalog: string, optionId: string): CatalogKeyResult {
  const picker = findPickerCatalog(catalog)
  if (picker) return resolvePickerOption(picker, optionId)
  const extra = EXTRA_CATALOGS.find((c) => c.id === catalog)
  if (extra) {
    const option = extra.options().find((o) => o.id === optionId)
    return option
      ? { ok: true, key: { catalog: extra.id, optionId: option.id, label: option.label } }
      : { ok: false, reason: "unknown_option", message: `${extra.id} has no option "${optionId}"` }
  }
  return { ok: false, reason: "unknown_catalog", message: `Unknown catalog "${catalog}"` }
}

/** A catalog id's stored form (`camera-motion` → `camera-motions`), or null when no catalog has it. */
export function canonicalCatalogId(catalog: string): string | null {
  const picker = findPickerCatalog(catalog)
  if (picker) return picker.catalogId
  return EXTRA_CATALOGS.some((c) => c.id === catalog) ? catalog : null
}

/** The label of a stored option, or null when its catalog no longer has it. */
export function catalogOptionLabel(catalog: string, optionId: string): string | null {
  const resolved = resolveCatalogFavorite(catalog, optionId)
  return resolved.ok ? resolved.key.label : null
}
