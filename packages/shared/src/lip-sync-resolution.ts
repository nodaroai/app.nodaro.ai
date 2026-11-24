/**
 * The Lip Sync node's resolutions, per model — ONE table for the config
 * panel's dropdown and fail-safe, the quick strip's model switch, the route
 * and the workflow run (moved here from the panel, decided 2026-11-23).
 *
 * `1440p` is LTX 2.5 Fast's alone (its audio-to-video run). Every other Lip
 * Sync model resolves an off-list value exactly as before, except `1440p`:
 * the route never took it before LTX 2.5 Fast came, so for any other model it
 * is refused before anything is held — never moved to a tier above it.
 */
import { MODEL_CATALOG } from "./model-catalog.js"
import { FAL_LIP_SYNC_PROVIDERS, LIP_SYNC_PROVIDERS, REPLICATE_LIP_SYNC_PROVIDERS, VIDEO_INPUT_LIP_SYNC_PROVIDERS } from "./model-constants.js"
import { drivingAudioLipSyncResolution, isDrivingAudioLipSyncProvider } from "./driving-audio-lip-sync.js"
import { isSeedanceLipSyncProvider, seedanceLipSyncResolution } from "./seedance-lip-sync.js"
import { lipSyncLeverClearPatch, lipSyncTakesLever } from "./lip-sync-levers.js"

export type LipSyncResolution = "480p" | "720p" | "1080p" | "1440p" | "4k"

/** The resolutions the Lip Sync route's schema takes (`routes/lip-sync.ts`). */
export const LIP_SYNC_ROUTE_RESOLUTIONS = ["480p", "720p", "1080p", "1440p", "4k"] as const

/**
 * The resolution a Lip Sync run of `provider` is SENT and priced at when it is
 * asked `resolution` — the server's own rule per model: the Seedance 2 family
 * `seedanceLipSyncResolution` (its plain 8-second row), LTX 2.5 Fast
 * `drivingAudioLipSyncResolution`, a model whose catalog lists resolutions
 * (InfiniTalk, OmniHuman 1.5) the one asked when listed. Undefined for a model
 * whose run takes none from the catalog.
 */
function sentLipSyncResolution(provider: string, resolution: string): string | undefined {
  if (isSeedanceLipSyncProvider(provider)) return seedanceLipSyncResolution(provider, resolution)
  if (isDrivingAudioLipSyncProvider(provider)) return drivingAudioLipSyncResolution(provider, resolution)
  return (MODEL_CATALOG[provider]?.resolutions ?? []).includes(resolution) ? resolution : undefined
}

/** The models whose catalog says nothing the Lip Sync route sends: the node's choices from before, kept as they were. */
const KEPT_LIP_SYNC_CHOICES: readonly LipSyncResolution[] = ["480p", "720p"]

/**
 * The resolutions the node offers for `provider` and its default, or
 * undefined for a model with no resolution choice (the Replicate and fal
 * models, the video-input dubbing models, OmniHuman 2.0).
 *
 * DERIVED from what the server runs and prices (decided 2026-11-23): every
 * resolution the route takes that the model's catalog lists AND that the run
 * sends as asked (`sentLipSyncResolution` — the rule the credit id and the
 * worker read), so the menu cannot offer a tier the run moves, nor hide one it
 * renders. Default: OmniHuman 1.5's 1080p (its own), else 720p. A model whose
 * catalog lists none the route sends (Kling AI Avatar (Pro), MiniMax Hailuo 3)
 * keeps the choices it had.
 */
export function lipSyncResolutionChoices(provider: string): { values: readonly LipSyncResolution[]; def: LipSyncResolution } | undefined {
  if (REPLICATE_LIP_SYNC_PROVIDERS.has(provider as never) || FAL_LIP_SYNC_PROVIDERS.has(provider as never)) return undefined
  if (VIDEO_INPUT_LIP_SYNC_PROVIDERS.has(provider as never) || !lipSyncTakesLever(provider, "resolution")) return undefined
  const values = LIP_SYNC_ROUTE_RESOLUTIONS.filter((r) => sentLipSyncResolution(provider, r) === r) as LipSyncResolution[]
  if (values.length === 0) return { values: KEPT_LIP_SYNC_CHOICES, def: "720p" }
  const def: LipSyncResolution = provider === "omnihuman-1-5" && values.includes("1080p") ? "1080p" : values.includes("720p") ? "720p" : values[0]!
  return { values, def }
}

/**
 * The value the node writes for a stored resolution `provider` does not list:
 * LTX 2.5 Fast's run rule (`drivingAudioLipSyncResolution`: 1080p, as on
 * Generate Video), else the model's default (the panel's snap since before).
 * Undefined when the model takes no resolution.
 */
function snappedResolution(provider: string, resolution: unknown): LipSyncResolution | undefined {
  const choices = lipSyncResolutionChoices(provider)
  if (!choices) return undefined
  if (isDrivingAudioLipSyncProvider(provider)) return drivingAudioLipSyncResolution(provider, resolution) as LipSyncResolution
  return choices.def
}

/**
 * The patch a model switch writes on a Lip Sync node — the panel's dropdown
 * and the quick strip's alike: the levers the new model does not take
 * cleared (`lipSyncLeverClearPatch`), a resolution it does not list snapped
 * (`snappedResolution`) or cleared (no choice), and a seed cleared when
 * moving onto an audio-to-video model, whose seed means another thing than
 * the model it was set for (LatentSync's 0 is random; LTX 2.5's is a fixed
 * seed). Empty when nothing changes.
 */
export function lipSyncModelSwitchPatch(provider: string, data: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const patch: Record<string, unknown> = { ...lipSyncLeverClearPatch(provider, data) }
  const res = data.resolution
  if (typeof res === "string" && res !== "" && !("resolution" in patch)) {
    const choices = lipSyncResolutionChoices(provider)
    if (!choices) patch.resolution = undefined
    else if (!(choices.values as readonly string[]).includes(res)) patch.resolution = snappedResolution(provider, res)
  }
  if (isDrivingAudioLipSyncProvider(provider) && data.provider !== provider && data.seed !== undefined && !("seed" in patch)) patch.seed = undefined
  return patch
}

/**
 * Why a Lip Sync request at this resolution is refused, or undefined: `1440p`
 * on a model that does not list it (any but LTX 2.5 Fast). The route and the
 * workflow run refuse it before anything is held.
 */
export function lipSyncResolutionRefusal(provider: string, resolution: unknown): string | undefined {
  if (resolution !== "1440p" || isDrivingAudioLipSyncProvider(provider)) return undefined
  const label = MODEL_CATALOG[provider]?.label ?? provider
  const choices = lipSyncResolutionChoices(provider)
  return choices
    ? `${label} does not render 1440p on Lip Sync: choose ${choices.values.join(", ")}. Nothing was charged.`
    : `${label} takes no resolution on Lip Sync, and 1440p is not one it renders. Leave the resolution unset. Nothing was charged.`
}

/** Every resolution some Lip Sync model offers, in ladder order — what the discovery API and MCP list (derived). */
export function lipSyncResolutions(): readonly LipSyncResolution[] {
  const ladder: readonly LipSyncResolution[] = ["480p", "720p", "1080p", "1440p", "4k"]
  const offered = new Set(LIP_SYNC_PROVIDERS.flatMap((p) => lipSyncResolutionChoices(p)?.values ?? []))
  return ladder.filter((r) => offered.has(r))
}

/**
 * The Lip Sync models that take a resolution, grouped by their choices (the
 * default named where it is not 720p) — derived, for tool descriptions.
 */
export function lipSyncResolutionSummary(): string {
  const groups = new Map<string, string[]>()
  for (const p of LIP_SYNC_PROVIDERS) {
    const c = lipSyncResolutionChoices(p)
    if (!c) continue
    const key = c.values.join("|") + (c.def === "720p" ? "" : ` (default ${c.def})`)
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  return [...groups].map(([choices, models]) => `${models.join(", ")}: ${choices}`).join("; ")
}
