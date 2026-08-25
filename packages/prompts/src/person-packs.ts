import {
  PEOPLE,
  PERSON_DIMENSION_ORDER,
  PERSON_DIMENSION_LABELS,
  PERSON_FIELD_BY_DIMENSION,
  type Person,
} from "./person.js"
import { registerCatalogPack } from "./catalog-packs.js"
import type { PickerDimension, PickerOption } from "./picker-catalogs.js"

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
}

export function resetPersonPacks(): void {
  personPacks = []
  version++
}
export function personPacksVersion(): number {
  return version
}

export function getRegisteredPeople(): readonly RegisteredPersonEntry[] {
  return personPacks.length === 0 ? PEOPLE : [...PEOPLE, ...personPacks.flatMap((p) => p.entries)]
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
