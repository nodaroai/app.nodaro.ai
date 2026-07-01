/**
 * Character-asset identity: assemble an ordered, deduped multi-image reference
 * set from every identity signal already on a character row, so variant
 * generation (`generate-character-asset`) conditions on more than the single
 * frontal portrait.
 *
 * Pure logic — no DB, no I/O. The route feeds it the character row's columns;
 * the worker caps the result to the provider's `maxRefImages` capability.
 *
 ***REDACTED-OSS-SCRUB***
 */

import type { CharacterReferencePhotoKind, CharacterReferencePhoto } from "@nodaro/shared"

/**
 * The Character Studio identity-foundation reference-photo kinds. The canonical
 * 7-kind enum + `CharacterReferencePhoto` shape live in `@nodaro/shared`
 * (`CHARACTER_REFERENCE_PHOTO_KINDS`) — shared with the `generate-character` /
 * `characters` route Zod enums and the frontend's `reference-photo-routing.ts`.
 * Re-exported here under the local names this module's consumers already use.
 *
 * `preferredKind` below stays backend-only by design: it's identity RANKING
 * (which kind to prioritize for multi-image conditioning), distinct from the
 * frontend's `routePhotosForAsset` UI FILTERING (which intentionally routes
 * `lighting` → all photos where this routes it → `frontBody`). The catalog drift
 * guard in the test keeps its variant strings in sync with CHARACTER_ASSET_VARIANTS.
 */
export type ReferencePhotoKind = CharacterReferencePhotoKind
export type ReferencePhoto = CharacterReferencePhoto

export interface PriorAssetColumn {
  /** DB column name, e.g. `"expressions"`, `"body_angles"`. */
  column: string
  /** Attached asset items in JSONB append order (oldest first). */
  items: { url: string }[]
}

export interface AssembleCharacterReferenceSetInput {
  /** `characters.source_image_url` (or an explicit override) — the anchor. */
  portraitUrl: string | null
  /** Real uploaded reference photos, if any. */
  referencePhotos: ReferencePhoto[] | null | undefined
  /** Per-request real-life reference URLs, if any. */
  realLifeRefs: string[] | null | undefined
  /** Previously-attached generated assets, grouped by identity column. */
  priorAssets: PriorAssetColumn[] | null | undefined
  assetType: string
  variant: string
}

/**
 * Default per-image reference cap for entity image generation when the resolved
 * provider has no KIE model config (non-KIE / unknown provider) or the config
 * omits `maxRefImages`. Conservative so a multi-image payload can never blow past
 * a provider's real input limit.
 */
export const DEFAULT_ENTITY_REF_CAP = 4

/**
 * Identity columns whose attached assets are clean single-subject images worth
 * reusing as identity references, in assembly priority order. Deliberately
 * excludes `sheets` / `detail_closeups` (composited collages / macro crops — poor
 * single-subject conditioning) and `motions` (video).
 */
export const IDENTITY_ASSET_COLUMNS = [
  "expressions",
  "angles",
  "body_angles",
  "poses",
  "lighting_variations",
  "outfit_variations",
] as const

const HEAD_ANGLE_KIND: Record<string, ReferencePhotoKind> = {
  front: "frontFace",
  "3/4 left": "threeQuarterLeft",
  "left profile": "sideLeft",
  "right profile": "sideRight",
  "3/4 right": "threeQuarterRight",
}

/**
 * The reference-photo kind that best matches a requested asset variant.
 *
 * Precedence is by ASSET TYPE first — full-body asset types (`poses`,
 * `bodyAngles`, `lighting` all render full-body in `buildVariantPrompt`) reuse
 * the same rotation variant strings as head angles, so a variant-only lookup
 * would wrongly route e.g. `bodyAngles`+`left profile` to a head-level side shot.
 *
 *   - poses / bodyAngles / lighting → frontBody
 *   - expressions → frontFace
 *   - angles / headAngles → head-rotation map by variant
 *   - custom / unknown → frontFace (fallback)
 *
 * Never throws.
 */
export function preferredKind(assetType: string, variant: string): ReferencePhotoKind {
  switch (assetType) {
    case "poses":
    case "bodyAngles":
    case "lighting":
      return "frontBody"
    case "expressions":
      return "frontFace"
    case "angles":
    case "headAngles":
      return HEAD_ANGLE_KIND[variant] ?? "frontFace"
    default:
      return "frontFace"
  }
}

/**
 * Extract `{ url }` items from a raw JSONB character column, tolerating null /
 * non-array / malformed rows (returns `[]`).
 */
function extractItems(value: unknown): { url: string }[] {
  if (!Array.isArray(value)) return []
  const out: { url: string }[] = []
  for (const item of value) {
    if (item && typeof item === "object" && typeof (item as { url?: unknown }).url === "string") {
      out.push({ url: (item as { url: string }).url })
    }
  }
  return out
}

/**
 * Build the `priorAssets` grouping from a raw character row — one entry per
 * identity column (in `IDENTITY_ASSET_COLUMNS` order). Non-identity columns on
 * the row are ignored.
 */
export function characterPriorAssetsFromRow(row: Record<string, unknown>): PriorAssetColumn[] {
  return IDENTITY_ASSET_COLUMNS.map((column) => ({
    column,
    items: extractItems(row[column]),
  }))
}

/**
 * Assemble an ordered, deduped reference-image set. Ranking (highest first;
 * order matters — nano-banana-pro treats the first image as the primary anchor):
 *   1. canonical portrait (always first, never dropped)
 *   2. angle-matched real reference photo (`preferredKind`)
 *   3. remaining real reference photos (frontFace first)
 *   4. per-request real-life refs
 *   5. recent-first attached prior assets from identity columns
 *
 * NOT capped here — the worker caps to the provider's `maxRefImages`.
 */
export function assembleCharacterReferenceSet(
  input: AssembleCharacterReferenceSetInput,
): string[] {
  const { portraitUrl, referencePhotos, realLifeRefs, priorAssets, assetType, variant } = input
  const wanted = preferredKind(assetType, variant)

  const ordered: string[] = []
  const seen = new Set<string>()
  const push = (url: string | null | undefined): void => {
    if (!url) return
    const key = url.trim()
    if (!key || seen.has(key)) return
    seen.add(key)
    ordered.push(url)
  }

  // 1. Canonical portrait — the anchor.
  push(portraitUrl)

  const photos = referencePhotos ?? []
  // 2. Angle-matched real reference photo.
  for (const p of photos) if (p?.kind === wanted) push(p.url)
  // 3. Remaining real reference photos — frontFace first, then the rest.
  for (const p of photos) if (p?.kind === "frontFace") push(p.url)
  for (const p of photos) push(p?.url)

  // 4. Per-request real-life refs.
  for (const url of realLifeRefs ?? []) push(url)

  // 5. Recent-first attached prior assets from the identity columns.
  const byColumn = new Map<string, { url: string }[]>()
  for (const c of priorAssets ?? []) byColumn.set(c.column, c.items)
  for (const column of IDENTITY_ASSET_COLUMNS) {
    const items = byColumn.get(column)
    if (!items) continue
    for (let i = items.length - 1; i >= 0; i--) push(items[i]?.url)
  }

  return ordered
}
