// ─────────────────────────────────────────────────────────────────────────────
// Entity studio aspect-ratio defaults (location / creature / object)
// ─────────────────────────────────────────────────────────────────────────────
//
// Character has its own table (`character-aspect-defaults.ts`); this is the
// equivalent for the other three entity studios. It is the SINGLE source for:
//   1. the generation request aspect sent to the provider (backend generate-*
//      routes), and
//   2. the studio card's *fallback* container ratio (frontend), shown until the
//      real media aspect is probed.
// Keeping both in one place means the framing a user sees can't drift from the
// framing that was generated.
//
// Note: the frontend additionally sizes each card to the REAL decoded media
// aspect (so a provider that returns a slightly different ratio still displays
// uncropped). These per-type values are the deterministic placeholder + the
// value requested at generation time.

export type EntityStudioKind = "location" | "creature" | "object"

/** Provider "W:H" ratio strings (same vocabulary as the character table). */
export const ENTITY_ASPECT_DEFAULTS: Record<
  EntityStudioKind,
  Record<string, string>
> = {
  // Locations are environments → landscape framing everywhere.
  location: {
    timeOfDay: "16:9",
    weather: "16:9",
    seasons: "16:9",
    angles: "16:9",
    lighting: "16:9",
    atmosphereMotions: "16:9",
  },
  // Creatures (animals): turnaround angles & condition variations read square;
  // full-body poses read taller (portrait); motion clips are vertical.
  creature: {
    angles: "1:1",
    poses: "3:4",
    variations: "1:1",
    motion: "9:16",
  },
  // Objects/props: product turnarounds, materials, and condition variants are
  // square; motion clips are vertical.
  object: {
    angles: "1:1",
    materials: "1:1",
    variations: "1:1",
    motion: "9:16",
  },
}

const RATIO_RE = /^\d+:\d+$/

/**
 * Resolve the provider aspect string for an entity asset generation.
 * Precedence: explicit > node override > per-asset-type default > "1:1".
 * The two "soft" inputs are honored only when they parse as a "W:H" ratio, so a
 * stale value falls through instead of poisoning the request.
 */
export function resolveEntityAspect(opts: {
  entity: EntityStudioKind
  assetType: string
  explicit?: string | null
  nodeOverride?: string | null
}): string {
  if (opts.explicit && RATIO_RE.test(opts.explicit)) return opts.explicit
  if (opts.nodeOverride && RATIO_RE.test(opts.nodeOverride)) return opts.nodeOverride
  return ENTITY_ASPECT_DEFAULTS[opts.entity]?.[opts.assetType] ?? "1:1"
}

/**
 * "9:16" → 0.5625 (width / height) for a CSS `aspect-ratio` fallback value.
 * Anything that isn't a "W:H" ratio (or has a zero term) → 1 (square).
 */
export function aspectRatioToNumber(ratio: string): number {
  const m = /^(\d+):(\d+)$/.exec(ratio.trim())
  if (!m) return 1
  const w = Number(m[1])
  const h = Number(m[2])
  return w > 0 && h > 0 ? w / h : 1
}
