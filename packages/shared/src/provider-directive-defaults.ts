import type { ShotSpec } from "./scene-node-types.js"

/**
 * Provider-specific directive defaults. Architecture spec §5.14.
 *
 * Each video model can have side-effects the user usually wants (Seedance baking in
 * ambient music, VEO supporting loop seeds, etc.). The engine applies these defaults
 * at provider-call time, allowing them to be overridden by the Scene Director's
 * `shot_intent` field (provider-neutral) which we map below.
 *
 * Keys are canonical provider identifiers (matching VIDEO_MODEL_CAPS in
 * model-constants.ts). Non-canonical keys would silently break downstream
 * route validation + payload building.
 */
export const PROVIDER_DIRECTIVE_DEFAULTS = {
  seedance: { multishot: true, disable_internal_music: true, allow_sfx: true },
  "seedance-2": { multishot: true, disable_internal_music: true, allow_sfx: true },
  veo3: { reference_count: "auto" as const },
  "veo3.1": { reference_count: "auto" as const },
  kling: { reference_count: "auto" as const },
  "kling-3-omni": { reference_count: "auto" as const },
  "kling-turbo": { reference_count: "auto" as const },
  hailuo: {} as Record<string, never>,
  "hailuo-2.3-pro": {} as Record<string, never>,
  "hailuo-standard": {} as Record<string, never>,
  minimax: {} as Record<string, never>,
  "bytedance-lite": {} as Record<string, never>,
} as const

/**
 * Maps a Scene Director's provider-neutral shot_intent to provider-specific directives.
 * Architecture spec §5.14 mapping table.
 *
 * Unknown providers fall through to an empty object — the directive degrades to a text
 * hint in the motion_prompt (Scene Director includes it there as a fallback when
 * `needs_music_suppression: true`).
 */
export function mapShotIntentToProviderDirectives(
  provider: string,
  shotIntent: ShotSpec["shot_intent"],
): Record<string, unknown> {
  const directives: Record<string, unknown> = {
    ...(PROVIDER_DIRECTIVE_DEFAULTS[provider as keyof typeof PROVIDER_DIRECTIVE_DEFAULTS] ?? {}),
  }

  if (shotIntent.needs_multishot_reference) {
    if (provider.startsWith("seedance")) {
      directives.multishot = true
    }
    // VEO + Kling: accepts reference_images array — engine attaches the refs separately.
    // Hailuo: only 1 ref — silently ignored at engine layer.
  }

  if (shotIntent.is_loopable) {
    if (provider.startsWith("veo")) {
      directives.loop_seed = "stable"
    }
    // Other providers: no native loop_seed → degrade to motion_prompt frame-matching hint.
  }

  if (shotIntent.needs_music_suppression) {
    if (provider.startsWith("seedance")) {
      directives.disable_internal_music = true
    }
    // VEO / Kling / Hailuo don't bake in music; no directive needed.
  }

  return directives
}
