// ─────────────────────────────────────────────────────────────────────────────
// Backend-side aspect-ratio helpers
// ─────────────────────────────────────────────────────────────────────────────
//
// The character analog (`resolveCharacterAspectRatio` in
// `packages/shared/src/character-aspect-defaults.ts`) is a per-asset-type
// lookup with a 3-step precedence chain (explicit > node override > default).
// Locations have a single asset-type for now (atmosphere motions, 16:9) so the
// resolver collapses to "explicit, else 16:9".
//
// If/when locations grow more motion sub-types or per-location-node overrides,
// move this into `@nodaro/shared` next to the character helper so frontend can
// import it. Today it's backend-only — the location node UI doesn't surface
// aspect-ratio overrides.
// ─────────────────────────────────────────────────────────────────────────────

import { MODEL_CATALOG } from "@nodaro/shared"

import { normalizeAspectRatio } from "./mcp/normalize.js"

export interface ResolveLocationAspectRatioOptions {
  /** Caller-supplied override (winning input). */
  readonly explicit?: string | null
  /**
   * The kind of asset being generated. Only `"motions"` is wired today; future
   * asset types (e.g. atmospheric stills) would extend this union and the
   * defaults table below.
   */
  readonly assetType?: "motions"
}

/**
 * Resolve the final aspect ratio for a location generation request.
 *
 * Default: 16:9 — location atmosphere clips are cinematic establishing shots,
 * NOT vertical character motion (which defaults to 9:16). Caller overrides via
 * `explicit` win.
 */
export function resolveLocationAspectRatio(
  opts: ResolveLocationAspectRatioOptions,
): string {
  if (opts.explicit && opts.explicit.length > 0) return opts.explicit
  return "16:9"
}

/**
 * Clamp a desired aspect ratio to the nearest ratio the given model supports.
 *
 * Character/entity smart-defaults pick framing by asset type (portraits default
 * to "3:4", poses to "9:16", …) without knowing which model will run. Not every
 * model supports every ratio — Grok exposes ["1:1","16:9","9:16","3:2","2:3"]
 * and has NO "3:4", so an un-clamped "3:4" gets silently dropped/defaulted by
 * the provider. This maps the desired ratio to the catalog-nearest supported
 * one (3:4 → 2:3 for Grok), driven entirely by `MODEL_CATALOG[model].aspectRatios`
 * so it stays correct for any model/provider without a hardcoded per-model table.
 *
 * Returns the input unchanged when the model declares no `aspectRatios` (it
 * takes any ratio / ignores the lever) or is unknown. Mirrors the permissive,
 * never-reject philosophy of the per-provider param routing — a value the model
 * can't honor is silently snapped, never surfaced as an error.
 */
export function clampAspectRatioToModel(
  ratio: string | undefined,
  modelId: string | undefined,
): string | undefined {
  if (!ratio) return ratio
  const supported = modelId ? MODEL_CATALOG[modelId]?.aspectRatios : undefined
  return normalizeAspectRatio(ratio, supported, ratio) ?? ratio
}
