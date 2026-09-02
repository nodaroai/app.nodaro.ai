import type { PickerCatalog, PickerOption } from "./picker-catalogs.js"
import { catalogPacksVersion, hasCatalogPacksFor } from "./catalog-packs.js"

/**
 * THE RESOLVER-SIDE HALF OF CATALOG CURATION.
 *
 * Every per-catalog module builds an index from its own base constant at load
 * (`settingById = new Map(SETTINGS…)`) and its `getSetting(id)` reads that. A
 * deployment's catalog packs compose a DIFFERENT catalog — entries removed,
 * some rewritten at the same id — and until this module existed nothing on
 * the resolve path read it. So on a curated deployment a denied id still
 * turned into its full stock prompt text at run time, and a rewritten entry
 * injected the stock wording instead of the curated one. The curation was
 * real in `/v1/catalogs` and invisible in every generated prompt.
 *
 * `overlayEntry` sits inside each getter, between the base lookup and the
 * return:
 *   - no pack targets the catalog  → the base entry, untouched. This is the
 *     mainline path and it is byte-identical by construction; a deployment
 *     that curates nothing pays one Set probe per lookup.
 *   - a pack targets it, id absent  → undefined. Denied means denied on the
 *     prompt path too, not only in the picker.
 *   - a pack targets it, id present → the base entry with the composed
 *     option's label / description / promptHint / term / category on top,
 *     so a rewrite reaches the prompt. Fields the composed option does not
 *     carry (typed extras a specific builder reads) survive from the base.
 *   - pack-ADDED id (no base entry)  → the composed option itself.
 *
 * LATE-BOUND RESOLVER, ON PURPOSE. The catalog modules cannot import
 * `getPickerCatalog`: picker-catalogs.ts imports every one of them to build
 * `PICKER_CATALOGS` at module scope, and a module-scope cycle is a TDZ error
 * under some load orders. picker-catalogs.ts instead installs its resolver
 * here when IT loads (`setComposedCatalogResolver`), and this module imports
 * only the pack registry, which imports nothing of the catalogs.
 *
 * FAIL CLOSED. If a pack targets a catalog and the resolver is somehow not
 * installed, every lookup on that catalog throws rather than silently
 * returning the base entry — a curated deployment answering with stock text
 * is the failure this whole module exists to prevent.
 *
 * SCOPE BOUNDARY, on purpose: the transition / character-fx TIMING dimensions
 * (position start/middle/end, duration, intensity) are structural knobs the
 * catalogs expose for thin clients, not content — no curation removes "end".
 * Their composers index total clause records by construction, and threading
 * the overlay through that would trade a guaranteed-total prompt for a hole
 * nothing needs. They stay uncurated; the wall still checks their ids.
 */

type Resolver = (catalogIdOrNodeType: string) => PickerCatalog | undefined
let resolver: Resolver | null = null

/** Installed by picker-catalogs.ts at load. */
export function setComposedCatalogResolver(fn: Resolver): void {
  resolver = fn
}

let memo: { v: number; byCatalog: Map<string, ReadonlyMap<string, PickerOption>> } | null = null

/** id → composed option for one catalog, memoized on the pack version. */
export function composedOptionIndex(catalogId: string): ReadonlyMap<string, PickerOption> {
  const v = catalogPacksVersion()
  if (!memo || memo.v !== v) memo = { v, byCatalog: new Map() }
  const hit = memo.byCatalog.get(catalogId)
  if (hit) return hit
  if (!resolver) {
    throw new Error(
      `[catalog-overlay] catalog "${catalogId}" is curated by a pack but the composed-catalog resolver is not installed — refusing to resolve against the stock catalog`,
    )
  }
  const cat = resolver(catalogId)
  const index = new Map<string, PickerOption>()
  if (cat) {
    for (const o of cat.options ?? []) index.set(o.id, o)
    for (const d of cat.dimensions ?? []) for (const o of d.options) if (!index.has(o.id)) index.set(o.id, o)
  }
  memo.byCatalog.set(catalogId, index)
  return index
}

/**
 * Overlay the composed catalog on a base lookup. See the module doc for the
 * four outcomes. `T` is the module's own entry type; the composed option's
 * common fields are spread over it, so callers keep their typed result.
 */
export function overlayEntry<T extends { readonly id: string }>(
  catalogId: string,
  id: string,
  base: T | undefined,
): T | undefined {
  if (!hasCatalogPacksFor(catalogId)) return base
  const opt = composedOptionIndex(catalogId).get(id)
  if (!opt) return undefined
  if (!base) return opt as unknown as T
  return {
    ...base,
    label: opt.label,
    promptHint: opt.promptHint,
    term: opt.term,
    ...(opt.description !== undefined ? { description: opt.description } : {}),
    ...(opt.category !== undefined ? { category: opt.category } : {}),
  }
}

/**
 * Membership only — for id-carrying fields whose entries live outside this
 * package (the animal / vehicle / weapon / furniture catalogs resolve through
 * `@nodaro/shared`, which cannot depend on this package). The dispatcher asks
 * this before calling those getters.
 */
export function composedHas(catalogId: string, id: string): boolean {
  if (!hasCatalogPacksFor(catalogId)) return true
  return composedOptionIndex(catalogId).has(id)
}

/** The composed option, or undefined — for callers that render from it directly. */
export function composedOption(catalogId: string, id: string): PickerOption | undefined {
  if (!hasCatalogPacksFor(catalogId)) return undefined
  return composedOptionIndex(catalogId).get(id)
}

/**
 * A base entry LIST filtered to ids the composed catalog offers and relabelled
 * where a pack rewrote an entry — the list-shaped twin of `overlayEntry`, for
 * anything that renders a whole catalog (pickers, dropdowns, studio browsers).
 * Returns the base array BY IDENTITY when no pack targets the catalog, so
 * memo deps and equality checks on mainline are unchanged. Pack-ADDED entries
 * are not surfaced here: the caller's typed entry shape may carry fields a
 * PickerOption cannot supply.
 */
export function curateEntries<T extends { readonly id: string; readonly label: string }>(
  catalogId: string,
  base: readonly T[],
): readonly T[] {
  if (!hasCatalogPacksFor(catalogId)) return base
  const index = composedOptionIndex(catalogId)
  const out: T[] = []
  for (const e of base) {
    const opt = index.get(e.id)
    if (!opt) continue
    out.push({
      ...e,
      label: opt.label,
      ...(opt.description !== undefined ? { description: opt.description } : {}),
      ...("promptHint" in e && opt.promptHint !== undefined ? { promptHint: opt.promptHint } : {}),
    })
  }
  return out
}
