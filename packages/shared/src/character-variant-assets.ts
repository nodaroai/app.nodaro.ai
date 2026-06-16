/**
 * Single source of truth for a character's `{name, url}[]` variant-asset buckets
 * — the image/video variants that are expandable into connected references and
 * therefore selectable in the reference picker AND `@`-mentionable in prompts.
 *
 * Historically the expansion list was hardcoded (6 copies across frontend
 * `connected-references.ts` / `connected-refs-builder.ts` / `execute-node.ts` and
 * backend `payload-builder.ts`), so when wardrobe (`outfitVariations`) and detail
 * close-ups (`detailCloseups`) were added — same `{name,url}[]` shape, written by
 * studio.nodaro.ai — they were silently dropped from the picker and `@` list.
 * Drive every expansion site off this constant so a new bucket can't drift again.
 *
 * NOT included (different shapes, handled elsewhere):
 *  - `sheets` (`ReferenceSheet[]` — composited multi-panel boards)
 *  - `referenceVideosByVariant` (`Record<variant, url[]>` — per-emotion video refs)
 */
export const CHARACTER_VARIANT_ASSET_BUCKETS = [
  "expressions",
  "poses",
  "motions",
  "angles",
  "bodyAngles",
  "lightingVariations",
  "outfitVariations",
  "detailCloseups",
] as const

export type CharacterVariantAssetBucket = (typeof CHARACTER_VARIANT_ASSET_BUCKETS)[number]

export interface CharacterVariantAssetItem {
  readonly name: string
  readonly url: string
  readonly description?: string
}

/**
 * Build the `{ bucket: items[] }` map for every variant-asset bucket from a
 * character node's data. Missing / non-array buckets coerce to `[]`. One helper
 * for all six expansion sites so the bucket set is defined exactly once.
 */
export function characterVariantAssetArrays(
  data: Record<string, unknown> | null | undefined,
): Record<CharacterVariantAssetBucket, readonly CharacterVariantAssetItem[]> {
  const out = {} as Record<CharacterVariantAssetBucket, readonly CharacterVariantAssetItem[]>
  for (const bucket of CHARACTER_VARIANT_ASSET_BUCKETS) {
    const value = data?.[bucket]
    out[bucket] = Array.isArray(value) ? (value as readonly CharacterVariantAssetItem[]) : []
  }
  return out
}

/**
 * Map a character's composite reference `sheets` (ReferenceSheet[] — a different
 * shape, with a composite board `url` + `type`/`skin`) into mentionable
 * `{name,url}` items so they too can be picked / `@`-mentioned. Each sheet → one
 * item named `"<type> <skin>"` (e.g. "turnaround studio"). Drops url-less sheets.
 */
export function characterSheetRefItems(sheets: unknown): CharacterVariantAssetItem[] {
  if (!Array.isArray(sheets)) return []
  return sheets.flatMap((s) => {
    const sheet = s as { url?: unknown; type?: unknown; skin?: unknown }
    if (!sheet || typeof sheet.url !== "string" || !sheet.url) return []
    const type = typeof sheet.type === "string" && sheet.type ? sheet.type : "sheet"
    const skin = typeof sheet.skin === "string" && sheet.skin ? ` ${sheet.skin}` : ""
    return [{ name: `${type}${skin}`, url: sheet.url }]
  })
}

/**
 * The COMPLETE set of mentionable character asset arrays: the `{name,url}[]`
 * variant buckets + a derived `sheets` bucket. This is what the connected-
 * reference / `@`-mention expansion sites iterate, so every studio-produced
 * asset (variants AND composite sheets) surfaces in the picker and `@` list.
 */
export function characterMentionableAssetArrays(
  data: Record<string, unknown> | null | undefined,
): Record<string, readonly CharacterVariantAssetItem[]> {
  return {
    ...characterVariantAssetArrays(data),
    sheets: characterSheetRefItems(data?.sheets),
  }
}
