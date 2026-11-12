/**
 * The sizes the Motion Transfer panel offers, shows and snaps to, from the
 * catalog entry of the model each option runs and the shared size rule the
 * server sends and charges by (`motionTransferResolution`, decided
 * 2026-11-12) — never a list kept here.
 */
import { motionTransferModelOf } from "@nodaro/render-rules"
import { motionTransferResolution } from "@nodaro/shared/credits"
import { MODEL_CATALOG, defaultResolutionFor } from "@nodaro/shared/model-catalog"

/**
 * The size a Motion Transfer run that names none is filled in with: the
 * route's schema default and the workflow build's fill (and every price the
 * editor quotes for an unset node).
 */
const UNSET_SIZE = "720p"

/** The sizes a Motion Transfer option offers: its model's catalog sizes. */
export function motionTransferSizes(provider: string): readonly string[] {
  return MODEL_CATALOG[motionTransferModelOf(provider)]?.resolutions ?? []
}

/**
 * The size a node's run is sent and priced at, for the panel to show: an unset
 * size is the run's fill, and a size the model does not have is the one it
 * runs at (Wan Animate's 1080p as 720p).
 */
export function motionTransferShownSize(provider: string, resolution: string | undefined): string {
  return motionTransferResolution(provider, resolution || UNSET_SIZE).resolution
}

/**
 * Where a stored size moves when the option changes and the new model does not
 * offer it: the size the server would run it at when the model offers that
 * (Wan Animate's 1080p → 720p), else the model's declared default, else its
 * first size. Undefined when nothing moves (unset, or offered).
 */
export function motionTransferSnap(provider: string, resolution: string | undefined): string | undefined {
  if (!resolution) return undefined
  const offered = motionTransferSizes(provider)
  if (offered.length === 0 || offered.includes(resolution)) return undefined
  const runs = motionTransferResolution(provider, resolution).resolution
  if (offered.includes(runs)) return runs
  const declared = defaultResolutionFor(motionTransferModelOf(provider))
  return declared !== undefined && offered.includes(declared) ? declared : offered[0]
}
