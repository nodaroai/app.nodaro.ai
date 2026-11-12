/**
 * Video Overlay layouts — the ids, and what each one needs. A layout is a
 * named shortcut that writes the boxes (`expandVideoOverlayLayout` in
 * `video-overlay-layouts.ts`); like a placement preset, it is a TAG and the
 * boxes are the truth, except for the two stacks, whose boxes depend on the
 * sources' shapes and are resolved where those are known.
 *
 * Dependency-free on purpose: the validator in `video-overlay-validate.ts`
 * reads these, and `video-overlay-layouts.ts` imports the contract in
 * `video-overlay.ts`, so they cannot live in either without a cycle. Wire contract only — no I/O.
 */

/**
 * - `video-bottom` / `video-top`: the base whole, full width, against that edge.
 * - `stack-whole`: the base directly above the first video layer, both whole,
 *   the same width, the pair centred.
 * - `stack-filled`: the base fills the top half, the first video layer the
 *   bottom half, both cropped (`cover`).
 * - `pip`: the base fills the frame, the first video layer sits in a corner.
 */
export const VIDEO_OVERLAY_LAYOUT_IDS = ["video-bottom", "video-top", "stack-whole", "stack-filled", "pip"] as const
export type VideoOverlayLayoutId = (typeof VIDEO_OVERLAY_LAYOUT_IDS)[number]

export function isVideoOverlayLayoutId(v: unknown): v is VideoOverlayLayoutId {
  return typeof v === "string" && (VIDEO_OVERLAY_LAYOUT_IDS as readonly string[]).includes(v)
}

/** Layouts placed against the output canvas's edges or halves: every one but `pip`. */
const NEEDS_ASPECT: ReadonlySet<VideoOverlayLayoutId> = new Set(["video-bottom", "video-top", "stack-whole", "stack-filled"])
/** Layouts that place the first video layer. */
const NEEDS_VIDEO_LAYER: ReadonlySet<VideoOverlayLayoutId> = new Set(["stack-whole", "stack-filled", "pip"])
/** Layouts that place the base themselves, so take no `baseBox`. */
const PLACES_BASE: ReadonlySet<VideoOverlayLayoutId> = new Set(["stack-whole", "stack-filled"])

/** True when the layout is refused without an `outputAspect` (`layout_needs_aspect`). */
export function videoOverlayLayoutNeedsAspect(id: VideoOverlayLayoutId): boolean {
  return NEEDS_ASPECT.has(id)
}

/** True when the layout is refused without a video layer (`layout_needs_video_layer`). */
export function videoOverlayLayoutNeedsVideoLayer(id: VideoOverlayLayoutId): boolean {
  return NEEDS_VIDEO_LAYER.has(id)
}

/** True when the layout places the base itself and is refused with a `baseBox` (`layout_conflicts_base_box`): the two stacks. */
export function videoOverlayLayoutPlacesBase(id: VideoOverlayLayoutId): boolean {
  return PLACES_BASE.has(id)
}
