// ─────────────────────────────────────────────────────────────────────────────
// Object aspect-ratio defaults
// ─────────────────────────────────────────────────────────────────────────────
//
// Objects are isolated subjects — product-showcase framing. Unlike characters
// (which have per-asset-type framing differences — head shots 3:4, full-body
// 9:16), objects use 1:1 square framing for every asset type by default. This
// matches the natural framing of the Object Studio's asset-card grid (square
// tiles) and avoids cropping the subject regardless of which variant axis
// (angles/materials/variations/motion) is being generated.
//
// Resolution precedence (low → high):
//   1. Per-asset-type default (this table — all 1:1 currently)
//   2. Object node's `defaultAssetAspectRatio` (user override, Phase E)
//   3. Explicit `aspectRatio` on the API request (caller wins)
// ─────────────────────────────────────────────────────────────────────────────

export const OBJECT_ASPECT_OPTIONS = ["1:1", "3:4", "16:9", "9:16", "4:3"] as const
export type ObjectAspectRatio = (typeof OBJECT_ASPECT_OPTIONS)[number]

/**
 * The asset categories with distinct natural framing. For objects, all bucket
 * defaults are currently `"1:1"`, but the per-asset-type table is kept (vs a
 * single flat constant) so future tuning (e.g., wider framing for motion clips
 * with camera-orbit moves) can be added without touching the resolver.
 */
export type ObjectAssetTypeForAspect = "angles" | "materials" | "variations" | "motion" | "custom"

export const OBJECT_ASPECT_DEFAULTS: Record<ObjectAssetTypeForAspect, ObjectAspectRatio> = {
  angles: "1:1",
  materials: "1:1",
  variations: "1:1",
  // Motion clips are 1:1 because objects rotate in place. Switch to "16:9" if
  // future motion variants pan through a scene (e.g., drone-orbit with horizon).
  motion: "1:1",
  custom: "1:1",
}

export function isObjectAspectRatio(s: string): s is ObjectAspectRatio {
  return (OBJECT_ASPECT_OPTIONS as readonly string[]).includes(s)
}

export interface ResolveObjectAspectOptions {
  /** Explicit `aspectRatio` on the request body — highest precedence. */
  readonly explicit?: string | null
  /**
   * The object node's `defaultAssetAspectRatio` — set per-canvas-node via the
   * 5-pill toggle on the object node (Phase E). Flows through the API as
   * `objectNodeAspectRatio`.
   */
  readonly nodeOverride?: string | null
  /** What's being generated. Drives the default when nothing else is set. */
  readonly assetType: ObjectAssetTypeForAspect
}

/**
 * Resolve the final aspect ratio for an object generation request.
 *
 * Precedence: explicit > node override > per-asset-type default. The two
 * "soft" inputs are tolerated as raw strings and only honored when they parse
 * to a value in OBJECT_ASPECT_OPTIONS — anything else falls through to the
 * next layer (so a stale enum value doesn't poison the generation).
 */
export function resolveObjectAspectRatio(opts: ResolveObjectAspectOptions): ObjectAspectRatio {
  if (opts.explicit && isObjectAspectRatio(opts.explicit)) {
    return opts.explicit
  }
  if (opts.nodeOverride && isObjectAspectRatio(opts.nodeOverride)) {
    return opts.nodeOverride
  }
  return OBJECT_ASPECT_DEFAULTS[opts.assetType]
}
