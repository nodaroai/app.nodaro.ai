import type { PickerCatalog, PickerOption, PickerDimension } from "./picker-catalogs.js"
import type { LocaleId, LocaleCatalogMap } from "@nodaro/shared"

export type CatalogPackMode = "replace" | "extend" | "deny"

/**
 * A vendored curation pack applied at the picker-catalog composition root.
 * `replace` swaps a full vendored copy; `extend` appends options (single-dim)
 * or merges dimensions by field (multi-dim); `deny` removes entry ids from the
 * copy. Packs target EXISTING catalog ids only — a new catalog id is out of
 * Phase-0 scope (it drags the 5-registry parameter-picker checklist).
 *
 * DEFERRED (do not build here): a `CatalogPolicy` (tags / deny-by-tag /
 * override) plugs in downstream of this compose, at `getRegisteredPickerCatalogs`.
 */
export interface CatalogPack {
  readonly id: string
  readonly catalogId: string
  readonly mode: CatalogPackMode
  readonly catalog?: PickerCatalog
  readonly options?: readonly PickerOption[]
  readonly dimensions?: readonly PickerDimension[]
  readonly denyIds?: readonly string[]
  /** Localized strings for this pack's added option ids, keyed by locale → id. */
  readonly sidecars?: Partial<Record<LocaleId, LocaleCatalogMap>>
  /** Locales deliberately not translated for this pack (reported, never failed). */
  readonly exemptSidecarLocales?: readonly LocaleId[]
}

let packs: CatalogPack[] = []
let version = 0

export function registerCatalogPack(pack: CatalogPack): void {
  if (packs.some((p) => p.id === pack.id)) throw new Error(`duplicate catalog pack id "${pack.id}"`)
  packs = [...packs, pack]
  version++
}
export function getRegisteredCatalogPacks(): readonly CatalogPack[] { return packs }
export function resetCatalogPacks(): void { packs = []; version++ }
export function catalogPacksVersion(): number { return version }

function cloneCatalog(c: PickerCatalog): PickerCatalog {
  return {
    ...c,
    options: c.options ? c.options.map((o) => ({ ...o })) : undefined,
    dimensions: c.dimensions
      ? c.dimensions.map((d) => ({ ...d, options: d.options.map((o) => ({ ...o })) }))
      : undefined,
  }
}

function applyExtend(c: PickerCatalog, pack: CatalogPack): PickerCatalog {
  if (c.kind === "single") {
    return { ...c, options: [...(c.options ?? []), ...(pack.options ?? []).map((o) => ({ ...o }))] }
  }
  const byField = new Map((c.dimensions ?? []).map((d) => [d.field, { ...d, options: [...d.options] }]))
  for (const dim of pack.dimensions ?? []) {
    const existing = byField.get(dim.field)
    if (existing) existing.options = [...existing.options, ...dim.options]
    else byField.set(dim.field, { ...dim, options: [...dim.options] })
  }
  const dims = [...byField.values()]
  return { ...c, dimensions: dims, fields: dims.map((d) => d.field) }
}

function applyDeny(c: PickerCatalog, denyIds: readonly string[]): PickerCatalog {
  const deny = new Set(denyIds)
  if (c.kind === "single") return { ...c, options: (c.options ?? []).filter((o) => !deny.has(o.id)) }
  return { ...c, dimensions: (c.dimensions ?? []).map((d) => ({ ...d, options: d.options.filter((o) => !deny.has(o.id)) })) }
}

export function composePickerCatalogs(
  base: readonly PickerCatalog[],
  activePacks: readonly CatalogPack[],
): readonly PickerCatalog[] {
  const known = new Set(base.map((c) => c.catalogId))
  for (const pack of activePacks) {
    if (!known.has(pack.catalogId)) throw new Error(`catalog pack "${pack.id}" targets unknown catalog id "${pack.catalogId}"`)
  }
  return base.map((c) => {
    let out = cloneCatalog(c)
    for (const pack of activePacks) {
      if (pack.catalogId !== c.catalogId) continue
      if (pack.mode === "replace" && pack.catalog) out = cloneCatalog(pack.catalog)
      else if (pack.mode === "extend") out = applyExtend(out, pack)
      else if (pack.mode === "deny") out = applyDeny(out, pack.denyIds ?? [])
    }
    return out
  })
}
