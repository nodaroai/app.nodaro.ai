import type { PickerCatalog, PickerOption, PickerDimension } from "./picker-catalogs.js"
import type { LocaleId, LocaleCatalogMap } from "@nodaro/shared"
import { registerCatalogSidecars, resetCatalogSidecars } from "@nodaro/shared"
import { resolveTerm } from "./term.js"

/**
 * Every option that leaves this module carries a RESOLVED `term`, exactly like
 * the base registry's own options do.
 *
 * `PickerOption.term` is required at the type level, but a pack arrives from a
 * separately-compiled bundle that may have been built against a `@nodaro/prompts`
 * where the field did not exist yet — so at runtime a pack option can simply
 * not have one. Resolving at COMPOSITION (rather than at each read) is what
 * keeps the `/v1/catalogs` projection, the compact-hint read path and the
 * `replace`-mode packs agreeing; a pack-added value would otherwise inject its
 * full hint in full mode and NOTHING in compact.
 */
/** Pack-author input shapes: identical to the registry's own types except that
 *  `term` is OPTIONAL — a vendored pack may predate the field, and a new
 *  required field on a published input type would be a breaking change. The
 *  composition root resolves it (`withTerm`), so everything that LEAVES this
 *  module still satisfies `PickerOption` with a resolved `term`. */
export type PickerOptionInput = Omit<PickerOption, "term"> & { readonly term?: string }
export type PickerDimensionInput = Omit<PickerDimension, "options"> & { readonly options: readonly PickerOptionInput[] }
export type PickerCatalogInput = Omit<PickerCatalog, "options" | "dimensions"> & {
  readonly options?: readonly PickerOptionInput[]
  readonly dimensions?: readonly PickerDimensionInput[]
}

function withTerm(o: PickerOptionInput): PickerOption {
  return { ...o, term: resolveTerm(o) }
}

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
  readonly catalog?: PickerCatalogInput
  readonly options?: readonly PickerOptionInput[]
  readonly dimensions?: readonly PickerDimensionInput[]
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
  // Push this pack's localized sidecars into the shared app-UI localizer (G10)
  // so pack-added entries resolve in `resolveLabel`/`resolveDescription`/search.
  // One generic point covers every pack, incl. the person extend fan-out.
  registerCatalogSidecars(pack.catalogId, pack.sidecars)
}
export function getRegisteredCatalogPacks(): readonly CatalogPack[] { return packs }
export function resetCatalogPacks(): void { packs = []; version++; resetCatalogSidecars() }
export function catalogPacksVersion(): number { return version }

function cloneCatalog(c: PickerCatalogInput): PickerCatalog {
  return {
    ...c,
    options: c.options ? c.options.map(withTerm) : undefined,
    dimensions: c.dimensions
      ? c.dimensions.map((d) => ({ ...d, options: d.options.map(withTerm) }))
      : undefined,
  }
}

function applyExtend(c: PickerCatalog, pack: CatalogPack): PickerCatalog {
  if (c.kind === "single") {
    return { ...c, options: [...(c.options ?? []), ...(pack.options ?? []).map(withTerm)] }
  }
  const byField = new Map((c.dimensions ?? []).map((d) => [d.field, { ...d, options: [...d.options] }]))
  for (const dim of pack.dimensions ?? []) {
    const added = dim.options.map(withTerm)
    const existing = byField.get(dim.field)
    if (existing) existing.options = [...existing.options, ...added]
    else byField.set(dim.field, { ...dim, options: added })
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
