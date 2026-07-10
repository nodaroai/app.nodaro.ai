import { characterSheetRefItems } from "@nodaro/shared"
import type { CharacterNodeData } from "@/types/nodes"

/**
 * Identity-board policy for the app-side Character Studio. Mirrors
 * studio.nodaro.ai (`MAX_ENTITY_BOARDS` / `MAX_IDENTITY_REFS` = 12) and stays
 * under the backend hard bounds (24 boards, 30 collage imageUrls).
 */
export const MAX_CHARACTER_BOARDS = 12
export const MIN_BOARD_IMAGES = 2
export const MAX_BOARD_IMAGES = 12

/** Collage params for an identity sheet — smart (no-crop) 4K, 4:3; identical
 *  to studio.nodaro.ai's `buildCollageParams`. */
export const BOARD_COLLAGE_PARAMS = {
  layout: "smart",
  resolution: "4K",
  aspectRatio: "4:3",
} as const

/** Composite credit id for the pinned 4K collage (see ee/billing/credits.ts). */
export const BOARD_CREDIT_MODEL_ID = "image-collage:4K"

/**
 * The first FREE board name for `desired` given `taken`: `desired` itself
 * when unused, else "<desired> 2", "<desired> 3", … Case-insensitive (board
 * names dedupe case-insensitively in `characterBoardItems`). Empty desired
 * falls back to "Board N". Duplicating a board never overwrites its source.
 */
export function uniqueBoardName(desired: string, taken: readonly string[]): string {
  const base = desired.trim()
  const used = new Set(taken.map((n) => n.trim().toLowerCase()))
  if (base && !used.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) {
    const candidate = base ? `${base} ${n}` : `Board ${n}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}

export interface BoardImageGroup {
  id: string
  label: string
  items: { name: string; url: string }[]
}

/**
 * All character-owned images offered as collage inputs, grouped for the
 * selection modal in a fixed order: Portrait, the variant buckets, sheets,
 * real-life reference photos. Empty groups are omitted; URLs are deduped
 * across groups (first occurrence wins) so the portrait can't appear twice.
 */
export function buildBoardImageGroups(d: CharacterNodeData): BoardImageGroup[] {
  const seen = new Set<string>()
  const groups: BoardImageGroup[] = []
  const push = (
    id: string,
    label: string,
    items: ReadonlyArray<{ name?: string; url?: string }> | undefined,
  ) => {
    const fresh = (items ?? []).flatMap((it) => {
      const url = (it.url ?? "").trim()
      if (!url || seen.has(url)) return []
      seen.add(url)
      return [{ name: it.name ?? "", url }]
    })
    if (fresh.length > 0) groups.push({ id, label, items: fresh })
  }
  push("portrait", "Portrait", d.sourceImageUrl ? [{ name: "Portrait", url: d.sourceImageUrl }] : undefined)
  push("expressions", "Expressions", d.expressions)
  push("poses", "Poses", d.poses)
  push("angles", "Angles", d.angles)
  push("bodyAngles", "Body angles", d.bodyAngles)
  push("lighting", "Lighting", d.lightingVariations)
  push("wardrobe", "Wardrobe", d.outfitVariations)
  push("closeups", "Detail close-ups", d.detailCloseups)
  push("sheets", "Reference sheets", characterSheetRefItems(d.sheets))
  push(
    "referencePhotos",
    "Reference photos",
    (d.referencePhotos ?? []).map((p, i) => ({ name: `Photo ${i + 1}`, url: p.url })),
  )
  return groups
}
