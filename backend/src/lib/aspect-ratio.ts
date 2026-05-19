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
