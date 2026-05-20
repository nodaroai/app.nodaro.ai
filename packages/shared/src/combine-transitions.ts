/**
 * Catalog of every transition the combine-videos node supports.
 *
 * `id` is the stable identifier used in workflow JSON, Zod validation, and
 * the preview-CSS class suffix. `xfade` is the FFmpeg `xfade transition=`
 * name (or `null` for `cut`, which goes through the concat demuxer).
 *
 * The 5 original ids (`cut`, `fade`, `dissolve`, `dip-to-black`,
 * `dip-to-white`) are kept for back-compat with workflows saved before the
 * picker shipped.
 */

export type CombineTransitionGroup =
  | "fades"
  | "wipes"
  | "slides"
  | "shapes"
  | "smooth"
  | "slices"
  | "reveals"
  | "covers"
  | "effects"

export interface CombineTransition {
  readonly id: string
  readonly label: string
  /** FFmpeg `xfade transition=` name. `null` = special path (concat demuxer for cut). */
  readonly xfade: string | null
  readonly group: CombineTransitionGroup
  readonly common?: boolean
  readonly description: string
}

export const COMBINE_TRANSITIONS: readonly CombineTransition[] = [
  // ===== Fades & Dips =====
  {
    id: "cut",
    label: "Cut",
    xfade: null,
    group: "fades",
    common: true,
    description: "Hard cut — instant switch with no blend. Default, fastest.",
  },
  {
    id: "fade",
    label: "Fade",
    xfade: "fade",
    group: "fades",
    common: true,
    description: "Smooth alpha cross-fade between two clips. Classic clean blend.",
  },
  {
    id: "dissolve",
    label: "Dissolve",
    xfade: "dissolve",
    group: "fades",
    common: true,
    description: "Random-pixel dissolve. Grainy, organic feel — good for memory beats.",
  },
  {
    id: "dip-to-black",
    label: "Dip to Black",
    xfade: "fadeblack",
    group: "fades",
    common: true,
    description: "Fade through black. Use between scenes or time jumps.",
  },
  {
    id: "dip-to-white",
    label: "Dip to White",
    xfade: "fadewhite",
    group: "fades",
    common: true,
    description: "Fade through white. Bright, ethereal — flashbacks, dream beats.",
  },
  {
    id: "fadegrays",
    label: "Fade through Greys",
    xfade: "fadegrays",
    group: "fades",
    description: "Desaturates to grey at the midpoint, then re-saturates into B.",
  },

  // ===== Wipes =====
  {
    id: "wipe-left",
    label: "Wipe Left",
    xfade: "wipeleft",
    group: "wipes",
    common: true,
    description: "Hard edge sweeps from right to left, revealing the next clip.",
  },
  {
    id: "wipe-right",
    label: "Wipe Right",
    xfade: "wiperight",
    group: "wipes",
    common: true,
    description: "Hard edge sweeps from left to right.",
  },
  {
    id: "wipe-up",
    label: "Wipe Up",
    xfade: "wipeup",
    group: "wipes",
    description: "Edge sweeps from bottom to top.",
  },
  {
    id: "wipe-down",
    label: "Wipe Down",
    xfade: "wipedown",
    group: "wipes",
    description: "Edge sweeps from top to bottom.",
  },
  {
    id: "wipe-tl",
    label: "Wipe Top-Left",
    xfade: "wipetl",
    group: "wipes",
    description: "Diagonal wipe from top-left corner.",
  },
  {
    id: "wipe-tr",
    label: "Wipe Top-Right",
    xfade: "wipetr",
    group: "wipes",
    description: "Diagonal wipe from top-right corner.",
  },
  {
    id: "wipe-bl",
    label: "Wipe Bottom-Left",
    xfade: "wipebl",
    group: "wipes",
    description: "Diagonal wipe from bottom-left corner.",
  },
  {
    id: "wipe-br",
    label: "Wipe Bottom-Right",
    xfade: "wipebr",
    group: "wipes",
    description: "Diagonal wipe from bottom-right corner.",
  },

  // ===== Slides =====
  {
    id: "slide-left",
    label: "Slide Left",
    xfade: "slideleft",
    group: "slides",
    common: true,
    description: "Next clip pushes A off-screen, sliding in from the right.",
  },
  {
    id: "slide-right",
    label: "Slide Right",
    xfade: "slideright",
    group: "slides",
    common: true,
    description: "Next clip pushes A off-screen, sliding in from the left.",
  },
  {
    id: "slide-up",
    label: "Slide Up",
    xfade: "slideup",
    group: "slides",
    description: "Next clip pushes A upward off-screen.",
  },
  {
    id: "slide-down",
    label: "Slide Down",
    xfade: "slidedown",
    group: "slides",
    description: "Next clip pushes A downward off-screen.",
  },

  // ===== Smooth (gradient-edge wipes) =====
  {
    id: "smooth-left",
    label: "Smooth Left",
    xfade: "smoothleft",
    group: "smooth",
    description: "Soft-edged wipe sweeping leftward — gentler than a hard wipe.",
  },
  {
    id: "smooth-right",
    label: "Smooth Right",
    xfade: "smoothright",
    group: "smooth",
    description: "Soft-edged wipe sweeping rightward.",
  },
  {
    id: "smooth-up",
    label: "Smooth Up",
    xfade: "smoothup",
    group: "smooth",
    description: "Soft-edged wipe sweeping upward.",
  },
  {
    id: "smooth-down",
    label: "Smooth Down",
    xfade: "smoothdown",
    group: "smooth",
    description: "Soft-edged wipe sweeping downward.",
  },

  // ===== Shapes (circles, rectangles, openings) =====
  {
    id: "circle-open",
    label: "Circle Open",
    xfade: "circleopen",
    group: "shapes",
    common: true,
    description: "Circular iris opens to reveal next clip from the center.",
  },
  {
    id: "circle-close",
    label: "Circle Close",
    xfade: "circleclose",
    group: "shapes",
    description: "Circular iris closes inward over the current clip.",
  },
  {
    id: "circle-crop",
    label: "Circle Crop",
    xfade: "circlecrop",
    group: "shapes",
    description: "Circular mask crops A then expands as B.",
  },
  {
    id: "rect-crop",
    label: "Rectangle Crop",
    xfade: "rectcrop",
    group: "shapes",
    description: "Rectangular mask crops A then expands as B.",
  },
  {
    id: "horz-open",
    label: "Horizontal Open",
    xfade: "horzopen",
    group: "shapes",
    description: "Two horizontal bars split apart from the center to reveal B.",
  },
  {
    id: "horz-close",
    label: "Horizontal Close",
    xfade: "horzclose",
    group: "shapes",
    description: "Top and bottom bars meet at the center.",
  },
  {
    id: "vert-open",
    label: "Vertical Open",
    xfade: "vertopen",
    group: "shapes",
    description: "Two vertical bars split apart from the center to reveal B.",
  },
  {
    id: "vert-close",
    label: "Vertical Close",
    xfade: "vertclose",
    group: "shapes",
    description: "Left and right bars meet at the center.",
  },
  {
    id: "diag-tl",
    label: "Diagonal Top-Left",
    xfade: "diagtl",
    group: "shapes",
    description: "Diagonal slash sweep originating top-left.",
  },
  {
    id: "diag-tr",
    label: "Diagonal Top-Right",
    xfade: "diagtr",
    group: "shapes",
    description: "Diagonal slash sweep originating top-right.",
  },
  {
    id: "diag-bl",
    label: "Diagonal Bottom-Left",
    xfade: "diagbl",
    group: "shapes",
    description: "Diagonal slash sweep originating bottom-left.",
  },
  {
    id: "diag-br",
    label: "Diagonal Bottom-Right",
    xfade: "diagbr",
    group: "shapes",
    description: "Diagonal slash sweep originating bottom-right.",
  },

  // ===== Slices =====
  {
    id: "hl-slice",
    label: "Horizontal Left Slice",
    xfade: "hlslice",
    group: "slices",
    description: "Horizontal strips slice in from the left.",
  },
  {
    id: "hr-slice",
    label: "Horizontal Right Slice",
    xfade: "hrslice",
    group: "slices",
    description: "Horizontal strips slice in from the right.",
  },
  {
    id: "vu-slice",
    label: "Vertical Up Slice",
    xfade: "vuslice",
    group: "slices",
    description: "Vertical strips slice in from the bottom.",
  },
  {
    id: "vd-slice",
    label: "Vertical Down Slice",
    xfade: "vdslice",
    group: "slices",
    description: "Vertical strips slice in from the top.",
  },

  // ===== Reveals =====
  {
    id: "reveal-left",
    label: "Reveal Left",
    xfade: "revealleft",
    group: "reveals",
    description: "A slides leftward off-screen, revealing the static B underneath.",
  },
  {
    id: "reveal-right",
    label: "Reveal Right",
    xfade: "revealright",
    group: "reveals",
    description: "A slides rightward off-screen, revealing B.",
  },
  {
    id: "reveal-up",
    label: "Reveal Up",
    xfade: "revealup",
    group: "reveals",
    description: "A slides upward, revealing B.",
  },
  {
    id: "reveal-down",
    label: "Reveal Down",
    xfade: "revealdown",
    group: "reveals",
    description: "A slides downward, revealing B.",
  },

  // ===== Covers =====
  {
    id: "cover-left",
    label: "Cover Left",
    xfade: "coverleft",
    group: "covers",
    description: "B slides in from the right and covers A in place.",
  },
  {
    id: "cover-right",
    label: "Cover Right",
    xfade: "coverright",
    group: "covers",
    description: "B slides in from the left and covers A.",
  },
  {
    id: "cover-up",
    label: "Cover Up",
    xfade: "coverup",
    group: "covers",
    description: "B slides up from below and covers A.",
  },
  {
    id: "cover-down",
    label: "Cover Down",
    xfade: "coverdown",
    group: "covers",
    description: "B slides down from above and covers A.",
  },

  // ===== Effects =====
  {
    id: "pixelize",
    label: "Pixelize",
    xfade: "pixelize",
    group: "effects",
    description: "Both clips pixelate to chunky blocks at the midpoint, then sharpen into B.",
  },
  {
    id: "radial",
    label: "Radial Wipe",
    xfade: "radial",
    group: "effects",
    description: "Clock-hand sweep around the center.",
  },
  {
    id: "hblur",
    label: "Blur",
    xfade: "hblur",
    group: "effects",
    description: "Heavy horizontal blur at midpoint — dreamy speed-blur look.",
  },
  {
    id: "distance",
    label: "Distance",
    xfade: "distance",
    group: "effects",
    description: "Distance-field morph between A and B. Subtle dimensional warp.",
  },
  {
    id: "zoom-in",
    label: "Zoom In",
    xfade: "zoomin",
    group: "effects",
    description: "B zooms outward from a point in A.",
  },
  {
    id: "squeeze-h",
    label: "Squeeze Horizontal",
    xfade: "squeezeh",
    group: "effects",
    description: "A squeezes horizontally to a line, then B expands.",
  },
  {
    id: "squeeze-v",
    label: "Squeeze Vertical",
    xfade: "squeezev",
    group: "effects",
    description: "A squeezes vertically to a line, then B expands.",
  },
]

/** All valid transition ids, sorted in catalog order. Use this for Zod enums. */
export const COMBINE_TRANSITION_IDS: readonly string[] = COMBINE_TRANSITIONS.map((t) => t.id)

/** Ordered list of group tab keys. `common` is a virtual tab, prepended in UI. */
export const COMBINE_TRANSITION_GROUP_ORDER: readonly CombineTransitionGroup[] = [
  "fades",
  "wipes",
  "slides",
  "smooth",
  "shapes",
  "slices",
  "reveals",
  "covers",
  "effects",
]

export const COMBINE_TRANSITION_GROUP_LABELS: Record<CombineTransitionGroup, string> = {
  fades: "Fades & Dips",
  wipes: "Wipes",
  slides: "Slides",
  smooth: "Smooth",
  shapes: "Shapes",
  slices: "Slices",
  reveals: "Reveals",
  covers: "Covers",
  effects: "Effects",
}

const TRANSITIONS_BY_ID: ReadonlyMap<string, CombineTransition> = new Map(
  COMBINE_TRANSITIONS.map((t) => [t.id, t]),
)

export function getCombineTransition(id: string): CombineTransition | undefined {
  return TRANSITIONS_BY_ID.get(id)
}

/**
 * Resolve the FFmpeg `xfade transition=` name for a given transition id.
 * Returns `null` for `cut` (handled via the concat demuxer instead of xfade).
 * Throws for unknown ids — callers validate input via Zod first.
 */
export function resolveXfadeName(id: string): string | null {
  const entry = TRANSITIONS_BY_ID.get(id)
  if (!entry) {
    throw new Error(`Unknown combine-videos transition: ${id}`)
  }
  return entry.xfade
}
