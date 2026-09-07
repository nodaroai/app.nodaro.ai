import {
  TEXT_TO_VIDEO_PROVIDERS,
  videoProviderFoldsLoneEndFrame,
  videoProviderRequiresImage,
} from "@nodaro/shared"

import {
  videoReferenceSupported,
  videoSupportsStartFrame,
  type DirectingMode,
} from "./model-menu"

/**
 * WHICH platform endpoint a directing run goes to — chosen from what the user
 * actually supplied, never hardcoded (owner ruling 2026-09-04, after every run
 * went to `generate-video` and staging/production answered "imageUrl is required
 * — this endpoint is the image-to-video lane").
 *
 * The two lanes, as the platform defines them:
 *   - `/v1/generate-video` is the IMAGE-TO-VIDEO lane. `prompt` is optional;
 *     `imageUrl` / `endFrameUrl` / the three reference arrays / `connectedReferences`
 *     all ride it. Without an `imageUrl` it 400s UNLESS the provider can carry a
 *     reference kind that is actually present — or a LONE end frame it folds into
 *     those references (its `hasMultimodalRef` exemption; see
 *     {@link videoProviderFoldsLoneEndFrame}).
 *   - `/v1/text-to-video` is the PROMPT-ONLY / REFERENCES lane. `prompt` is
 *     REQUIRED (`min(1)`), there is no `imageUrl` / `endFrameUrl` at all, the
 *     provider must be in `TEXT_TO_VIDEO_PROVIDERS`, and an image-required model
 *     is refused up front (`videoProviderRequiresImage` → 400 `image_required`).
 *
 * Studio assembles nothing (CLAUDE.md): with a start frame PLUS references (and
 * an end frame) the SERVER folds the frames into the references and writes the
 * "use @image_a as the opening (first) frame…" note itself. This module only
 * picks the door.
 */
export type VideoLane = "generate-video" | "text-to-video"

/** What the user supplied — the only thing the lane is derived from. */
export interface VideoLaneInputs {
  readonly provider: string
  /** A start frame will be sent (already catalog-gated by the caller). */
  readonly hasStartFrame: boolean
  /** Reference media of ANY kind will be sent (rail media, bound chips, or the
   *  References-mode still seed). */
  readonly hasRefs: boolean
  /** An end frame will be sent (already catalog-gated by the caller — the model
   *  declares the `"end-frame"` feature). Rides that lane BESIDE references
   *  (rule 2a), and opens it ALONE only where the provider folds it (rule 2b). */
  readonly hasEndFrame: boolean
  /** The run carries prompt text. */
  readonly hasPrompt: boolean
}

/**
 * The PLATFORM's own predicate for "this provider FOLDS a lone `endFrameUrl`
 * into its reference images" — the fold the `/v1/generate-video` image-required
 * gate exempts. Re-exported so the lane's callers and its drift tests read it
 * beside the rule that consumes it (rule 2b below).
 */
export { videoProviderFoldsLoneEndFrame }

/**
 * Whether the text-to-video lane will even ACCEPT this provider. Two gates, both
 * the route's own: its `provider` enum is `TEXT_TO_VIDEO_PROVIDERS` (a model
 * outside it is a zod 400 before anything else runs), and an image-required model
 * is refused with `image_required` even when it is in that enum. Catalog-derived
 * on both halves — never a hand-kept list.
 */
function textToVideoAddressable(provider: string): boolean {
  return (
    (TEXT_TO_VIDEO_PROVIDERS as ReadonlyArray<string>).includes(provider) &&
    !videoProviderRequiresImage(provider)
  )
}

/**
 * The lane for these inputs, or `null` when the platform would accept no run at
 * all (the CTA's disabled state — the button and the submit read this one
 * function, so they cannot disagree).
 *
 * 1. A START FRAME is the image-to-video lane, full stop: it's the only lane with
 *    an `imageUrl`. Any references and the end frame ride along and the server
 *    folds them.
 * 2. An END FRAME with no start frame, in two halves — the gate differs because
 *    what admits the frame-less run differs:
 *    a. BESIDE references it is that lane too — the owner's "refs + start/end
 *       frame → references WITH the frames" (2026-09-04). Only that lane has an
 *       `endFrameUrl` field, and the REFERENCES are what the route's exemption
 *       reads (`hasMultimodalRef`), so any reference-capable model qualifies.
 *    b. ALONE it is that lane only where the provider FOLDS a lone last frame
 *       ({@link videoProviderFoldsLoneEndFrame}) — the exemption is keyed to the
 *       fold, never to "carries image references": veo3 / veo3.1 / veo3_lite /
 *       kling-3-omni take an end frame AND references and still do NOT fold, so a
 *       frame-only body is an `image_required` 400 there. Elsewhere the frame
 *       buys no lane and the run lands where it would have landed without one.
 * 3. REFERENCES with neither frame prefer the text-to-video lane — but only when
 *    that lane would take the provider AND the run has the prompt it requires.
 *    Otherwise they stay on `generate-video`, whose prompt is optional. A model
 *    that carries no references at all has no lane here.
 * 4. NEITHER is a prompt-only run: the text-to-video lane, with actual text.
 */
export function chooseVideoLane(inputs: VideoLaneInputs): VideoLane | null {
  const { provider, hasStartFrame, hasRefs, hasEndFrame, hasPrompt } = inputs
  if (hasStartFrame) return "generate-video"
  if (hasEndFrame && hasRefs && videoReferenceSupported(provider)) {
    return "generate-video"
  }
  if (hasEndFrame && !hasRefs && videoProviderFoldsLoneEndFrame(provider)) {
    return "generate-video"
  }
  if (hasRefs) {
    if (textToVideoAddressable(provider) && hasPrompt) return "text-to-video"
    return videoReferenceSupported(provider) ? "generate-video" : null
  }
  return textToVideoAddressable(provider) && hasPrompt ? "text-to-video" : null
}

/** The SHOT's half of {@link VideoLaneInputs}, per Directing input mode. */
export interface DirectingLaneShotArgs {
  readonly mode: DirectingMode
  readonly provider: string
  /** The shot's EXPLICIT start frame ("Set as start frame" — sticky). */
  readonly startFrame?: string | null
  /** The shot's active still — the implicit animate source in the frames modes,
   *  and the References-mode reference SEED. */
  readonly stillUrl?: string | null
  /** Whether the shot carries directing reference media on its rail. */
  readonly hasRailReferences: boolean
}

/**
 * The shot's contribution as a CTA needs it — booleans only, so the shell can
 * hand it to the composer without leaking media URLs into a presentational prop.
 */
export interface DirectingLaneShotSummary {
  readonly hasStartFrame: boolean
  readonly hasRefs: boolean
}

/** What the selected shot contributes to the lane decision. */
export interface DirectingLaneShot {
  /** The start frame this mode will actually SEND (undefined = none) — the
   *  submit passes exactly this as `imageUrl`. */
  readonly startFrameUrl: string | undefined
  /** Reference media rides from the SHOT (its rail, or the References-mode still
   *  seed). The caller ORs in the channels only it can see — the composer's bound
   *  `@`-chips. */
  readonly hasRefs: boolean
}

/**
 * What the selected shot contributes to the lane decision in the chosen input
 * mode — the ONE derivation the submit and the Animate CTA share, so the button
 * and the run can never disagree about which lane is open.
 *
 * - Frames modes animate from the explicit start frame, else the still (the
 *   catalog gate is `videoSupportsStartFrame`); they send no references.
 * - References mode sends ONLY an EXPLICIT start frame (CLAUDE.md: start/end
 *   frames are explicit and sticky) — the still stays the reference seed it is,
 *   which is what `hasRefs` reports when no explicit frame displaces it.
 * - Text mode contributes nothing: a pure prompt run even when the shot has a
 *   still.
 */
export function directingLaneShotInputs(
  args: DirectingLaneShotArgs,
): DirectingLaneShot {
  const { mode, provider, startFrame, stillUrl, hasRailReferences } = args
  if (mode === "text") return { startFrameUrl: undefined, hasRefs: false }
  const startCapable = videoSupportsStartFrame(provider)
  if (mode === "references") {
    const startFrameUrl = startCapable && startFrame ? startFrame : undefined
    return {
      startFrameUrl,
      // The still seeds the run as its one reference image when no explicit
      // start frame displaces it and nothing else is attached.
      hasRefs: hasRailReferences || (!startFrameUrl && !!(startFrame ?? stillUrl)),
    }
  }
  const source = startFrame ?? stillUrl
  return {
    startFrameUrl: startCapable && source ? source : undefined,
    hasRefs: false,
  }
}
