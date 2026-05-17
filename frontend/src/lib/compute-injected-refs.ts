/**
 * Compute the full ordered list of "injected references" that will ACTUALLY be
 * sent to the provider for a consumer node (generate-image, image-to-video, …).
 *
 * Bridges three previously-hidden injection paths into one user-visible list:
 *
 *   1. WIRED RAW: any incoming-edge image ref that isn't a Character node
 *      (uploads, generated upstreams, scenes, etc.).
 *   2. WIRED CHARACTER CANONICAL: Character nodes wired to the consumer
 *      whose canonical image will be attached as a "fallback" because
 *      the user did NOT @-mention them.
 *   3. MENTION VARIANT: `@kira:1:smile` style tokens resolved against
 *      ConnectedReference variants. Each unique (slug, variant) collapses
 *      to one tile.
 *
 * Dedup rule: when the SAME character has both an @-mention AND a
 * canonical-fallback, the mention wins. The user explicitly typed the
 * variant they want; auto-attaching the canonical on top would be noise.
 *
 * Order rule (matches `buildImagePrompt`'s URL-merge order):
 *   wired raw → mentioned variants (in mention order) → canonical fallback
 *   (in connectedReferences order).
 *
 * `referenceOrder` (when provided) overrides the natural order: IDs present
 * in the array place those tiles at the front in array order; any tiles whose
 * ID is NOT in `referenceOrder` fall to the end in their natural order.
 *
 * `suppressedCanonicalCharacterIds` (when provided) drops canonical-fallback
 * tiles whose `characterSlug` is in the set — the user clicked × on the
 * canonical and doesn't want it auto-attached. The character's mention tiles
 * (if any) still appear.
 *
 * Stable-ID scheme — load-bearing because both the frontend reorder UI and
 * the backend sort logic in `prompt-builder` use the same scheme:
 *   - wired raw         → `wired:<sourceNodeId>`
 *   - mention variant   → `mention:<characterSlug>:<variantSlug|canonical>`
 *   - canonical fallback → `char-canonical:<characterSlug>`
 *
 * If both a mention AND a canonical fallback would produce the same character's
 * tile, the canonical is suppressed (mention wins). This matches the runtime
 * behavior in `resolveCharacterMentions` + `buildCanonicalFallback`.
 */

import {
  characterMentionSlug,
  findCharacterMentionTokens,
  type ConnectedReference,
  type UsageMode,
} from "@nodaro/shared"

/** Origin of a tile — drives badge color + remove behavior. */
export type InjectedRefOrigin =
  | "wired-raw"
  | "wired-character-canonical"
  | "mention-variant"
  | "canonical-fallback"

/** One rendered tile. The list is the actual API order; `imageIndex` is 1-based. */
export interface InjectedRefTile {
  /** Stable cross-process ID (see scheme in module doc). */
  readonly id: string
  /** URL that will be sent to the provider. */
  readonly url: string
  /** 1-based position in the final list — drives "Image N" labels. */
  readonly imageIndex: number
  readonly origin: InjectedRefOrigin
  readonly characterSlug?: string
  readonly characterName?: string
  readonly variantSlug?: string
  readonly variantDisplayName?: string
  /** Per-tile usage mode (`face`, `pose`, `none`, …). null = default. */
  readonly usageMode?: UsageMode | null
  /** For wired tiles: the upstream node ID that owns this URL. */
  readonly sourceNodeId?: string
  /** For mention tiles: the raw `@kira:1:smile` token literal. */
  readonly mentionToken?: string
  /** For mention tiles: optional variant description (alt text). */
  readonly description?: string
}

export interface ComputeInjectedRefsInput {
  /**
   * The same `ConnectedReference[]` the consumer node passes to
   * `buildImagePrompt`. MUST have its canonical + per-variant entries already
   * expanded (the same shape `image-configs.tsx` builds via memo).
   */
  readonly connectedReferences: readonly ConnectedReference[]
  /** Final prompt text — used to detect `@-mentions`. May be empty. */
  readonly prompt: string
  /** User-applied reorder. IDs reference the scheme above. */
  readonly referenceOrder?: readonly string[]
  /**
   * Character slugs whose canonical-fallback the user has explicitly hidden
   * via the × button. Mention tiles for the same character still appear.
   */
  readonly suppressedCanonicalCharacterIds?: readonly string[]
  /**
   * Optional map of `connectedReferences[i].id → sourceNodeId`. When provided,
   * wired-raw tiles use `wired:<sourceNodeId>` as their ID; otherwise they
   * fall back to `wired:<connectedReferences[i].id>` (which equals the node ID
   * for wired upstreams in the existing image-configs flow).
   */
  readonly sourceNodeIdById?: ReadonlyMap<string, string>
}

/** Stable ID for a wired-raw ref. Exported so the consumer panel can match
 *  these IDs to the same source-node IDs in the existing `connectedMediaOrder`
 *  field (backward compat). */
export function wiredTileId(sourceNodeId: string): string {
  return `wired:${sourceNodeId}`
}

/** Stable ID for an @-mention variant tile. */
export function mentionTileId(characterSlug: string, variantSlug: string | null | undefined): string {
  return `mention:${characterSlug}:${variantSlug || "canonical"}`
}

/** Stable ID for a canonical-fallback tile (or wired-character canonical when no mention). */
export function canonicalFallbackTileId(characterSlug: string): string {
  return `char-canonical:${characterSlug}`
}

/**
 * Resolve a tile's "natural" identity:
 *   - mention: `mention:<slug>:<variant>` keyed by the @-token
 *   - canonical fallback: `char-canonical:<slug>` keyed by the character slug
 *   - wired raw: `wired:<sourceNodeId>` keyed by the upstream node
 *
 * Returns the tiles in URL-merge order (matches `buildImagePrompt`):
 *
 *   non-character wired refs (manual + wired-image/face/object/location) →
 *   mention variants (in mention order) →
 *   canonical fallback (in connectedReferences order, dedup'd against mentions)
 *
 * After natural-order assembly, applies `referenceOrder` (when non-empty) to
 * pull listed IDs to the front. Stale IDs (not in the current tile set) are
 * silently dropped.
 */
export function computeInjectedRefs(input: ComputeInjectedRefsInput): InjectedRefTile[] {
  const { connectedReferences, prompt, referenceOrder, suppressedCanonicalCharacterIds, sourceNodeIdById } = input

  const suppressedSlugs = new Set(suppressedCanonicalCharacterIds ?? [])

  // ---- Step 1: split refs into wired-raw / character-canonical / character-variants
  // We KEEP `ConnectedReference` semantics: `wired-character` + `variantSlug` is
  // a variant entry; `wired-character` without `variantSlug` is canonical;
  // any other `source` is a wired-raw entry. Manual / extra-refs are wired-raw
  // (they have explicit URLs the user uploaded).
  const wiredRaw: ConnectedReference[] = []
  const charCanonicalBySlug = new Map<string, ConnectedReference>()
  const charVariantsBySlug = new Map<string, ConnectedReference[]>()

  for (const ref of connectedReferences) {
    if (ref.source === "wired-character" && ref.characterSlug) {
      if (ref.variantSlug) {
        const list = charVariantsBySlug.get(ref.characterSlug) ?? []
        list.push(ref)
        charVariantsBySlug.set(ref.characterSlug, list)
      } else {
        // Keep the FIRST canonical per slug; downstream maps tolerate dupes.
        if (!charCanonicalBySlug.has(ref.characterSlug)) {
          charCanonicalBySlug.set(ref.characterSlug, ref)
        }
      }
    } else if (ref.url) {
      wiredRaw.push(ref)
    }
  }

  // ---- Step 2: resolve @-mention tokens against the variant + canonical maps
  // Mirror `resolveCharacterMentions`: each mention's effective entry is the
  // (slug, variant) variant if present, else the canonical. Each unique
  // (slug, variant) collapses to ONE tile — multiple mentions of the same
  // variant don't produce duplicates (matches the URL-dedup in the backend).
  const knownSlugs = Array.from(
    new Set([
      ...charCanonicalBySlug.keys(),
      ...charVariantsBySlug.keys(),
    ]),
  )
  const mentionTiles: InjectedRefTile[] = []
  const mentionedSlugs = new Set<string>()
  const seenMentionKey = new Set<string>()

  const tokens = knownSlugs.length > 0
    ? findCharacterMentionTokens(prompt, knownSlugs)
    : []
  for (const t of tokens) {
    const key = `${t.characterSlug}:${t.variantSlug || "canonical"}`
    if (seenMentionKey.has(key)) continue
    // Pick the matched ref so we can grab the URL + variant display name.
    const match = t.variantSlug
      ? (charVariantsBySlug.get(t.characterSlug) ?? []).find((r) => r.variantSlug === t.variantSlug)
      : charCanonicalBySlug.get(t.characterSlug)
    if (!match) continue
    seenMentionKey.add(key)
    mentionedSlugs.add(t.characterSlug)
    const canonical = charCanonicalBySlug.get(t.characterSlug)
    mentionTiles.push({
      id: mentionTileId(t.characterSlug, t.variantSlug),
      url: match.url,
      imageIndex: 0, // filled later in the merge step
      origin: "mention-variant",
      characterSlug: t.characterSlug,
      characterName: canonical?.defaultName ?? match.defaultName,
      variantSlug: t.variantSlug ?? undefined,
      variantDisplayName: t.variantSlug ? match.variantDisplayName : "canonical",
      usageMode: t.usageMode ?? match.defaultUsageMode ?? null,
      mentionToken: t.token,
      description: match.variantDescription ?? match.description,
    })
  }

  // ---- Step 3: canonical fallback for any wired character NOT @-mentioned
  // and not in the suppression set. Mirrors `buildCanonicalFallback`.
  const canonicalFallbackTiles: InjectedRefTile[] = []
  for (const [slug, ref] of charCanonicalBySlug) {
    if (mentionedSlugs.has(slug)) continue
    if (suppressedSlugs.has(slug)) continue
    if (!ref.url) continue
    canonicalFallbackTiles.push({
      id: canonicalFallbackTileId(slug),
      url: ref.url,
      imageIndex: 0,
      origin: "canonical-fallback",
      characterSlug: slug,
      characterName: ref.defaultName,
      usageMode: ref.defaultUsageMode ?? null,
      sourceNodeId: sourceNodeIdById?.get(ref.id),
      description: ref.description,
    })
  }

  // ---- Step 4: wired-raw tiles. Stable IDs use the source node ID when we
  // know it; otherwise fall back to the ref's `id` (which is the upstream
  // node ID for wired upstreams in the existing image-configs flow).
  const wiredTiles: InjectedRefTile[] = wiredRaw.map((ref) => {
    const sourceNodeId = sourceNodeIdById?.get(ref.id) ?? ref.id
    return {
      id: wiredTileId(sourceNodeId),
      url: ref.url,
      imageIndex: 0,
      origin: "wired-raw",
      sourceNodeId,
      characterName: ref.defaultName,
      description: ref.description,
      usageMode: ref.defaultUsageMode ?? null,
    }
  })

  // ---- Step 5: natural order = wired raw → mentions → canonical fallback.
  // (This matches `buildImagePrompt`'s `mergedUrls` assembly order.)
  const natural: InjectedRefTile[] = [...wiredTiles, ...mentionTiles, ...canonicalFallbackTiles]

  // ---- Step 6: apply referenceOrder (when provided).
  const order = referenceOrder ?? []
  const ordered: InjectedRefTile[] = []
  const seenIds = new Set<string>()
  if (order.length > 0) {
    const byId = new Map(natural.map((t) => [t.id, t]))
    for (const id of order) {
      const tile = byId.get(id)
      if (tile && !seenIds.has(id)) {
        ordered.push(tile)
        seenIds.add(id)
      }
    }
  }
  for (const tile of natural) {
    if (!seenIds.has(tile.id)) {
      ordered.push(tile)
      seenIds.add(tile.id)
    }
  }

  // ---- Step 7: assign 1-based imageIndex.
  return ordered.map((tile, i) => ({ ...tile, imageIndex: i + 1 }))
}

/**
 * Sort a list of URLs (the assembled `referenceImageUrls` array that
 * `buildImagePrompt` produces) using a `referenceOrder` of stable IDs.
 *
 * Used in the backend / prompt-builder integration path: after the URL list
 * is assembled, we re-key each URL back to its stable ID via the same
 * compute helper, then reorder.
 *
 * This is intentionally a thin wrapper — callers compute the full tile list,
 * then read `.url` in order. Exposed as a named export so backend tests can
 * reuse the same primitive without pulling in the React UI.
 */
export function orderedUrlsFromTiles(tiles: readonly InjectedRefTile[]): string[] {
  return tiles.map((t) => t.url)
}
