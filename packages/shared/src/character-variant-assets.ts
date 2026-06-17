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

/** Legacy `selected_asset_by_variant` keys that hold boards born before the
 *  `boards` column existed (studio.nodaro.ai's reserved namespace). */
const BOARD_SHIM_KEY = "studioBoard"
const BOARD_SHIM_PREFIX = "studioBoard:"

/**
 * Resolve a character's named reference boards from BOTH the `boards` column AND
 * the LEGACY `selected_asset_by_variant` shim (`studioBoard` / `studioBoard:<name>`)
 * — mirroring studio.nodaro.ai's read (entity-boards.ts), which merges both since
 * pre-column boards still live in the shim. Column wins on duplicate name; the
 * unnamed legacy board is named "board". Drops url-less entries.
 */
export function characterBoardItems(
  data: Record<string, unknown> | null | undefined,
): CharacterVariantAssetItem[] {
  const column: CharacterVariantAssetItem[] = Array.isArray(data?.boards)
    ? (data!.boards as unknown[]).flatMap((b) => {
        const board = b as { name?: unknown; url?: unknown }
        if (!board || typeof board.url !== "string" || !board.url) return []
        return [{ name: typeof board.name === "string" && board.name ? board.name : "board", url: board.url }]
      })
    : []

  const map = (data?.selectedAssetByVariant ?? {}) as Record<string, unknown>
  const shim: CharacterVariantAssetItem[] = []
  const legacy = map[BOARD_SHIM_KEY]
  if (typeof legacy === "string" && legacy) shim.push({ name: "board", url: legacy })
  for (const [k, v] of Object.entries(map)) {
    if (k.startsWith(BOARD_SHIM_PREFIX) && typeof v === "string" && v) {
      shim.push({ name: k.slice(BOARD_SHIM_PREFIX.length) || "board", url: v })
    }
  }

  const haveNames = new Set(column.map((b) => b.name.toLowerCase()))
  return [...column, ...shim.filter((b) => !haveNames.has(b.name.toLowerCase()))]
}

/**
 * The COMPLETE set of mentionable character asset arrays: the `{name,url}[]`
 * variant buckets + derived `sheets` and `boards` buckets. This is what the
 * connected-reference / `@`-mention expansion sites iterate, so every
 * studio-produced asset (variants, composite sheets, AND boards — incl. legacy
 * shim boards) surfaces in the reference picker and `@` list.
 */
export function characterMentionableAssetArrays(
  data: Record<string, unknown> | null | undefined,
): Record<string, readonly CharacterVariantAssetItem[]> {
  return {
    ...characterVariantAssetArrays(data),
    sheets: characterSheetRefItems(data?.sheets),
    boards: characterBoardItems(data),
  }
}
