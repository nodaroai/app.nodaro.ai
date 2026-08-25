import {
  PEOPLE,
  PERSON_DIMENSION_ORDER,
  PERSON_DIMENSION_LABELS,
  PERSON_FIELD_BY_DIMENSION,
  type Person,
} from "./person.js"
import { registerCatalogPack, getRegisteredCatalogPacks } from "./catalog-packs.js"
import type { PickerDimension, PickerOption } from "./picker-catalogs.js"
import { setRegisteredPersonPackFields } from "@nodaro/shared"

/**
 * A person-pack entry. Pack dimensions are new keys OUTSIDE the closed
 * `PersonDimension` union, so `dimension` is widened to `string`.
 */
export type RegisteredPersonEntry = Omit<Person, "dimension"> & { dimension: string }

export interface PersonPack {
  readonly id: string
  readonly entries: readonly RegisteredPersonEntry[]
  // Pack dimensions are single-select in Phase 0: the selection limit still
  // comes from `getPersonDimensionLimit`, which only knows the base
  // `PersonDimension` union (a pack key resolves to 1), so a per-dimension
  // `maxSelected` would be silently ignored. Omitted rather than accepted-and-
  // dropped; add it here AND in the limit lookup together when multi-select
  // pack dimensions are wired.
  readonly dimensions?: readonly { dimension: string; field: string; label: string }[]
  readonly sidecars?: Parameters<typeof registerCatalogPack>[0]["sidecars"]
  readonly exemptSidecarLocales?: Parameters<typeof registerCatalogPack>[0]["exemptSidecarLocales"]
}

let personPacks: PersonPack[] = []
let version = 0

/**
 * Push the aggregate of every registered person pack's dimension data-field
 * names into `@nodaro/shared`'s content-free registry, so
 * `getParameterValue(data, "person")` resolves a pack dimension in the
 * `{PersonLabel}` field-mapping fallback (G4). shared never imports prompts —
 * the field list is pushed in here. Empty aggregate ⇒ mainline identity.
 */
function syncPersonPackFields(): void {
  setRegisteredPersonPackFields(
    personPacks.flatMap((p) => (p.dimensions ?? []).map((d) => d.field)),
  )
}

export function registerPersonPack(pack: PersonPack): void {
  if (personPacks.some((p) => p.id === pack.id)) throw new Error(`duplicate person pack id "${pack.id}"`)
  personPacks = [...personPacks, pack]
  version++
  // Fan out to the generic catalog seam so enumeration/projection/localization
  // reflect the person pack too. Build one PickerDimension per new field.
  const dimByKey = new Map((pack.dimensions ?? []).map((d) => [d.dimension, d]))
  const byField = new Map<string, { field: string; label: string; options: PickerOption[] }>()
  for (const e of pack.entries) {
    const dim = dimByKey.get(e.dimension)
    if (!dim) throw new Error(`person pack "${pack.id}" entry "${e.id}" references undeclared dimension "${e.dimension}"`)
    const opt: PickerOption = {
      id: e.id,
      label: e.label,
      description: e.description,
      category: e.group,
      promptHint: e.promptHint,
    }
    const existing = byField.get(dim.field)
    if (existing) existing.options.push(opt)
    else byField.set(dim.field, { field: dim.field, label: dim.label, options: [opt] })
  }
  registerCatalogPack({
    id: pack.id,
    catalogId: "person",
    mode: "extend",
    dimensions: [...byField.values()] as PickerDimension[],
    sidecars: pack.sidecars,
    exemptSidecarLocales: pack.exemptSidecarLocales,
  })
  syncPersonPackFields()
}

export function resetPersonPacks(): void {
  personPacks = []
  version++
  syncPersonPackFields()
}
export function personPacksVersion(): number {
  return version
}

/** Reverse of the registered dimension→field map, for reconstructing entries
 *  from a projected (field-keyed) catalog pack back into Person shape. */
function dimensionByField(): Readonly<Record<string, string>> {
  const out: Record<string, string> = {}
  const map = getRegisteredPersonFieldByDimension()
  for (const dim of Object.keys(map)) out[map[dim]] = dim
  return out
}

/** Best-effort reconstruction of Person entries from a pack's projected
 *  (PickerDimension) list. `shortLabel`/swatches are absent in the projection
 *  and fall back at render time; the safety-critical id-set is exact. */
function personEntriesFromDims(
  dims: ReadonlyArray<{
    field: string
    options: ReadonlyArray<{
      id: string
      label: string
      description?: string
      category?: string
      promptHint: string
    }>
  }>,
): RegisteredPersonEntry[] {
  const byField = dimensionByField()
  const out: RegisteredPersonEntry[] = []
  for (const d of dims) {
    const dimension = byField[d.field] ?? d.field
    for (const o of d.options) {
      out.push({
        id: o.id,
        label: o.label,
        description: o.description ?? "",
        group: o.category,
        promptHint: o.promptHint,
        dimension,
      } as RegisteredPersonEntry)
    }
  }
  return out
}

/**
 * The registered/composed person taxonomy: base `PEOPLE` folded with every
 * `catalogId:"person"` CatalogPack in registration order (the SAME registry
 * `composePickerCatalogs` folds for `/v1/catalogs` + MCP). `extend` appends the
 * pack's full Person entries, `deny` removes `denyIds`, `replace` swaps to a
 * reconstruction of the vendored catalog. This is the single funnel the
 * picker-ui grids read, so a deploy's deny/replace curation hides base entries
 * in the picker exactly as it hides them in the catalogs projection.
 */
export function getRegisteredPeople(): readonly RegisteredPersonEntry[] {
  const personCatalogPacks = getRegisteredCatalogPacks().filter((p) => p.catalogId === "person")
  // Mainline identity on the empty path, matching every sibling getter below
  // (`extra.length === 0 ? BASE : [...]`): with no person packs registered this
  // returns the base PEOPLE reference ITSELF, not a copy — the overlay
  // boot-smoke pins "inert boot" on exactly that identity, and an
  // unconditional copy here is what broke the combined tree after two
  // separately-green merges.
  if (personCatalogPacks.length === 0) return PEOPLE
  let people: RegisteredPersonEntry[] = [...PEOPLE]
  const packsById = new Map(personPacks.map((p) => [p.id, p]))
  for (const pack of personCatalogPacks) {
    if (pack.mode === "extend") {
      // Prefer full Person entries from the source person-pack; fall back to
      // reconstructing from the projected dimensions for a direct extend pack.
      const src = packsById.get(pack.id)
      people = src
        ? [...people, ...src.entries]
        : [...people, ...personEntriesFromDims(pack.dimensions ?? [])]
    } else if (pack.mode === "deny") {
      const deny = new Set(pack.denyIds ?? [])
      people = people.filter((e) => !deny.has(e.id))
    } else if (pack.mode === "replace" && pack.catalog) {
      people = personEntriesFromDims(pack.catalog.dimensions ?? [])
    }
  }
  return people
}
export function getRegisteredPersonDimensionOrder(): readonly string[] {
  const extra = personPacks.flatMap((p) => (p.dimensions ?? []).map((d) => d.dimension))
  return extra.length === 0 ? PERSON_DIMENSION_ORDER : [...PERSON_DIMENSION_ORDER, ...extra]
}
export function getRegisteredPersonFieldByDimension(): Readonly<Record<string, string>> {
  const extra = personPacks.flatMap((p) => (p.dimensions ?? []).map((d) => [d.dimension, d.field] as const))
  return extra.length === 0 ? PERSON_FIELD_BY_DIMENSION : { ...PERSON_FIELD_BY_DIMENSION, ...Object.fromEntries(extra) }
}
export function getRegisteredPersonDimensionLabels(): Readonly<Record<string, string>> {
  const extra = personPacks.flatMap((p) => (p.dimensions ?? []).map((d) => [d.dimension, d.label] as const))
  return extra.length === 0 ? PERSON_DIMENSION_LABELS : { ...PERSON_DIMENSION_LABELS, ...Object.fromEntries(extra) }
}
