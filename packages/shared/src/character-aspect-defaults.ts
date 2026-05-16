// ─────────────────────────────────────────────────────────────────────────────
// Character aspect-ratio defaults
// ─────────────────────────────────────────────────────────────────────────────
//
// Characters are vertical subjects — the historical 16:9 default produced wide,
// crop-unfriendly portraits. The per-asset-type table below picks the ratio
// that fits each asset's natural framing:
//
//   - Portrait / canonical head shot           → 3:4
//   - Expressions (head-and-shoulders)         → 1:1
//   - Poses (full-body)                        → 9:16
//   - Head angles                              → 3:4
//   - Body angles (full-body)                  → 9:16
//   - Lighting variations (full-body context)  → 3:4
//   - Motions (vertical clip, full-body i2v)   → 9:16
//
// Resolution precedence (low → high):
//   1. Per-asset-type default (this table)
//   2. Character node's `defaultAssetAspectRatio` (user override on the canvas
//      node — flows in as `characterNodeAspectRatio` in the request body)
//   3. Explicit `aspectRatio` on the API request (caller wins)
//
// The character node's `defaultAssetAspectRatio` toggle (1:1 / 3:4 / 16:9 /
// 9:16) drives BOTH the canvas thumbnail crop AND this override slot.
// ─────────────────────────────────────────────────────────────────────────────

export const CHARACTER_ASPECT_OPTIONS = ["1:1", "3:4", "16:9", "9:16"] as const
export type CharacterAspectRatio = (typeof CHARACTER_ASPECT_OPTIONS)[number]

/**
 * The asset categories with distinct natural framing. Aliases:
 *   - `angles` is the legacy single-surface key (now head-and-shoulders by
 *     default). Use `headAngles` for clarity in new code.
 *   - `bodyAngles` is the new full-body column added in migration 118.
 */
export type CharacterAssetTypeForAspect =
  | "portrait"
  | "expressions"
  | "poses"
  | "angles"
  | "headAngles"
  | "bodyAngles"
  | "lighting"
  | "motions"

export const CHARACTER_ASPECT_DEFAULTS: Record<
  CharacterAssetTypeForAspect,
  CharacterAspectRatio
> = {
  portrait: "3:4",
  // Legacy `angles` was head angles — keep its default aligned with `headAngles`.
  angles: "3:4",
  headAngles: "3:4",
  // Full-body framings:
  poses: "9:16",
  bodyAngles: "9:16",
  motions: "9:16",
  // Expressions are head-and-shoulders — square framing matches the existing
  // expression card grid and avoids cutting off forehead/chin.
  expressions: "1:1",
  // Lighting variations are framed like portraits (3:4) — they're full-body in
  // the prompt but the user usually wants to see the lighting on the face.
  lighting: "3:4",
}

export function isCharacterAspectRatio(s: string): s is CharacterAspectRatio {
  return (CHARACTER_ASPECT_OPTIONS as readonly string[]).includes(s)
}

export interface ResolveCharacterAspectOptions {
  /** Explicit `aspectRatio` on the request body — highest precedence. */
  readonly explicit?: string | null
  /**
   * The character node's `defaultAssetAspectRatio` — set per-canvas-node via
   * the 4-pill toggle on the character node. Flows through the API as
   * `characterNodeAspectRatio`.
   */
  readonly nodeOverride?: string | null
  /** What's being generated. Drives the default when nothing else is set. */
  readonly assetType: CharacterAssetTypeForAspect
}

/**
 * Resolve the final aspect ratio for a character generation request.
 *
 * Precedence: explicit > node override > per-asset-type default. The two
 * "soft" inputs are tolerated as raw strings and only honored when they
 * parse to a value in `CHARACTER_ASPECT_OPTIONS` — anything else falls
 * through to the next layer (so a stale enum value doesn't poison the
 * generation).
 */
export function resolveCharacterAspectRatio(
  opts: ResolveCharacterAspectOptions,
): CharacterAspectRatio {
  if (opts.explicit && isCharacterAspectRatio(opts.explicit)) {
    return opts.explicit
  }
  if (opts.nodeOverride && isCharacterAspectRatio(opts.nodeOverride)) {
    return opts.nodeOverride
  }
  return CHARACTER_ASPECT_DEFAULTS[opts.assetType]
}
