/**
 * The base video's box on the canvas — what the stage's base drag, the
 * panel's Base video card and the layers writer all start an edit from, so a
 * drag and a field edit move the base from the same place. Pure.
 *
 * A base box needs an output aspect (`base_box_needs_aspect`), and a stack
 * places the base itself (`layout_conflicts_base_box`): neither has a box to
 * edit. Otherwise the base sits in, in order: the stored base box (an explicit
 * one wins over an edge layout's), the edge layout's own box, else where
 * Video fit puts it — the whole frame, `cover` or `contain`.
 */
import {
  VIDEO_OVERLAY_BOX_FIELDS,
  expandVideoOverlayLayout,
  isVideoOverlayLayoutId,
  isVideoOverlayOutputAspect,
  videoOverlayLayoutPlacesBase,
  type VideoOverlayBox,
  type VideoOverlayBoxInput,
} from "@nodaro/shared/video"

/** What the base's box is read from. */
export interface VideoOverlayBaseFields {
  readonly outputAspect?: string | null
  readonly layout?: string | null
  readonly baseBox?: VideoOverlayBoxInput | null
  readonly baseFit?: string | null
}

/** Video fit's placement as a box: the whole frame, scaled to fit (`contain`) or filling it (`cover`, the default). */
export function videoOverlayFitBaseBox(baseFit: unknown): VideoOverlayBox {
  return { anchor: "center", x: 0, y: 0, width: 100, height: 100, fit: baseFit === "contain" ? "contain" : "cover" }
}

/**
 * `box` with the box fields the patch names written in. A `height` named as
 * `null` / `undefined` is removed (the base follows its own aspect); any other
 * field named empty keeps its value — a box keeps its anchor and width. Never
 * mutates.
 */
export function videoOverlayBaseBoxAfter(box: VideoOverlayBox, patch: VideoOverlayBoxInput): VideoOverlayBox {
  const out: Record<string, unknown> = { ...box }
  for (const f of VIDEO_OVERLAY_BOX_FIELDS) {
    if (!Object.hasOwn(patch, f)) continue
    const v = patch[f]
    if (v != null) out[f] = v
    else if (f === "height") delete out[f]
  }
  return out as unknown as VideoOverlayBox
}

/** The base's box as an edit starts from it, or undefined when there is none to edit (no output aspect; a stack places the base). */
export function videoOverlayEffectiveBaseBox(data: VideoOverlayBaseFields): VideoOverlayBox | undefined {
  if (!isVideoOverlayOutputAspect(data.outputAspect)) return undefined
  if (isVideoOverlayLayoutId(data.layout) && videoOverlayLayoutPlacesBase(data.layout)) return undefined
  const fit = videoOverlayFitBaseBox(data.baseFit)
  const written = expandVideoOverlayLayout({ layout: data.layout, baseBox: data.baseBox ?? undefined }).baseBox
  if (written == null || typeof written !== "object" || Array.isArray(written)) return fit
  // The written box as it is (no height = the base's own aspect); a partial one
  // (written as JSON; the validator refuses it) is completed from Video fit's, so an edit makes it whole.
  const own = Object.fromEntries(VIDEO_OVERLAY_BOX_FIELDS.flatMap((f) => (written[f] != null ? [[f, written[f]]] : [])))
  const { height: _byFit, ...frame } = fit
  return { ...frame, ...own } as VideoOverlayBox
}
