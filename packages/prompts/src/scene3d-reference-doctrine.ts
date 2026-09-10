/**
 * Scene3D layout-reference doctrine — what to tell a video model when a
 * Scene3D render (the clay MP4 from 3D Render Pro or from Render Video over a
 * 3D scene, or a still pulled from one) is attached as a reference.
 *
 * Two rules, both measured on a real scene (2026-09-10 greybox-to-video
 * experiment, `seedance-2-mini`, one variable per run):
 *
 *   1. NEVER send a layout reference without a scoping line. A reference is a
 *      style anchor as strongly as it is a composition anchor: unscoped, a
 *      greybox in gives a greybox out (run A). One sentence naming what the
 *      reference is FOR and what to IGNORE converts the output (run C).
 *   2. EVERY figure that must be photoreal needs its own character reference.
 *      Photoreal treatment is granted PER REFERENCED SUBJECT, not globally: a
 *      figure with no reference of its own falls back to matching the only
 *      reference that depicts it — the greybox (runs D → E). One layout
 *      reference plus one character per figure, with two slots left over for a
 *      location or style plate, is the budget that converts every figure.
 *
 * This module owns the WORDING. It is content, so it lives here (FSL) and not
 * in `@nodaro/shared`. The platform (`backend/…/scene3d-reference-scoping.ts`)
 * owns the graph walk that decides WHICH reference is a Scene3D render and what
 * it carries; it only ever asks this module for the words.
 *
 * The scoping line is a RAIL CAPTION. The platform already renders one caption
 * per video reference as `@video_N: <caption>.` (`renderReferenceCaptionLines`,
 * the same seat an API caller fills through `referenceVideoCaptions[N]`), so
 * the text built here carries NO leading binding and NO trailing full stop —
 * the renderer supplies both. `renderScene3DLayoutScopingLine` reproduces the
 * rendered form for anything that must quote the line exactly as the model
 * sees it (the Seedance A/B harness, the docs).
 *
 * The line never names the target look ("photoreal", "anime"): that is the
 * prompt's and the other references' job — rule 2 is what actually buys
 * photoreal figures.
 */

/** What a Scene3D layout reference carries: one frame, or the rendered clip. */
export type Scene3DLayoutReferenceCarrier = "still" | "clip"

export interface Scene3DLayoutScopingSpec {
  /** One frame (`still`) or the rendered clip (`clip`). */
  readonly carries: Scene3DLayoutReferenceCarrier
  /** Shot count in the composition the reference was rendered from, when
   *  known. More than one shot adds the cut points to what the reference is
   *  for. Ignored for a still, which is one frame of one shot. */
  readonly shots?: number
  /** Whether the clip includes a camera move. A still never does. */
  readonly includesCameraMotion?: boolean
}

/**
 * The phrase every scoping line opens with. It is the idempotence key
 * (`hasScene3DLayoutScopingLine`) — a re-run over a prompt that already
 * carries the line for a binding must not add a second one — and it is what an
 * A/B log greps for. Never reword it without migrating the re-run check.
 */
export const SCENE3D_LAYOUT_SCOPING_MARKER = "LAYOUT reference only"

/**
 * What the reference is FOR — the composition properties that survive a change
 * of look. Geometry properties, deliberately: the experiment's correction to
 * the pipeline doc is that what a layout reference must carry is unambiguous
 * spatial layout, which is a property of geometry, not shading.
 */
export const SCENE3D_LAYOUT_SCOPING_FOR = {
  /** Always: where the subjects are and what is in front of what. */
  layout: "its subject positions and blocking",
  occlusion: "its foreground occlusion",
  framing: "its framing",
  cameraAngle: "its camera angle",
  /** Clips only. */
  cameraMotion: "its camera motion",
  timing: "its timing",
  /** Clips with more than one shot. */
  cuts: (shots: number) => `its ${shots} shots and where they cut`,
} as const

/**
 * What to IGNORE — everything the clay render looks like. Named explicitly,
 * one property at a time, because the model has no other way to know that the
 * grey slabs are placeholders and not the target set dressing.
 */
export const SCENE3D_LAYOUT_SCOPING_IGNORE =
  "Ignore its untextured grey clay placeholder look, its flat placeholder colours, its materials, its lighting and its empty background; none of that is the target look"

/** Where the look comes from instead. Generic on purpose (see module doc). */
export const SCENE3D_LAYOUT_SCOPING_LOOK_SOURCE = "Take the look from the prompt and from the other references"

/**
 * Build the scoping caption for one attached Scene3D reference.
 *
 * For a clip with a camera move:
 *
 *   `LAYOUT reference only — match its subject positions and blocking, its
 *   foreground occlusion, its framing, its camera angle, its camera motion and
 *   its timing. Ignore its untextured grey clay placeholder look, its flat
 *   placeholder colours, its materials, its lighting and its empty background;
 *   none of that is the target look. Take the look from the prompt and from
 *   the other references`
 *
 * A still drops the motion, timing and cut clauses: one frame carries none of
 * them, and claiming otherwise would tell the model to match motion it cannot
 * see. No trailing full stop — the rail-caption renderer adds it.
 */
export function buildScene3DLayoutScopingLine(spec: Scene3DLayoutScopingSpec): string {
  const matches: string[] = [
    SCENE3D_LAYOUT_SCOPING_FOR.layout,
    SCENE3D_LAYOUT_SCOPING_FOR.occlusion,
    SCENE3D_LAYOUT_SCOPING_FOR.framing,
    SCENE3D_LAYOUT_SCOPING_FOR.cameraAngle,
  ]
  if (spec.carries === "clip") {
    if (spec.includesCameraMotion) matches.push(SCENE3D_LAYOUT_SCOPING_FOR.cameraMotion)
    if (typeof spec.shots === "number" && Number.isFinite(spec.shots) && spec.shots > 1) {
      matches.push(SCENE3D_LAYOUT_SCOPING_FOR.cuts(Math.floor(spec.shots)))
    }
    matches.push(SCENE3D_LAYOUT_SCOPING_FOR.timing)
  }
  return `${SCENE3D_LAYOUT_SCOPING_MARKER} — match ${joinWithAnd(matches)}. ${SCENE3D_LAYOUT_SCOPING_IGNORE}. ${SCENE3D_LAYOUT_SCOPING_LOOK_SOURCE}`
}

/** `a, b and c` — the doctrine reads as one sentence, not a list. */
function joinWithAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ""
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
}

/**
 * The line exactly as the model sees it once the platform has rendered the
 * caption onto its seat: `@video_1: <caption>.` — the same shape
 * `renderReferenceCaptionLines` emits for every rail caption. Use it wherever
 * the rendered form must be quoted verbatim (the A/B harness, the docs); use
 * `buildScene3DLayoutScopingLine` for what to SEND.
 */
export function renderScene3DLayoutScopingLine(binding: string, spec: Scene3DLayoutScopingSpec): string {
  return `${binding.trim()}: ${buildScene3DLayoutScopingLine(spec)}.`
}

/**
 * True when `prompt` already carries a scoping line for `binding`. The check
 * is binding + marker, not the whole caption, so a line an author typed by hand
 * (`@video_1 is a LAYOUT reference only …`) or pasted from the docs still
 * counts as present — the rule is "one scoping line per reference", never "our
 * exact bytes". Per binding on purpose: `@video_1` scoped says nothing about
 * `@video_2`.
 */
export function hasScene3DLayoutScopingLine(prompt: string | undefined, binding: string): boolean {
  if (!prompt) return false
  const b = binding.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`${b}(?::| is an?)\\s+${SCENE3D_LAYOUT_SCOPING_MARKER}`).test(prompt)
}

/**
 * The scoping line the 2026-09-10 experiment's Seedance A/B rerun sends —
 * the clip form, camera move included — computed from the builder so the
 * fixture can never drift from what the platform sends. This is the text an
 * API caller passes as `referenceVideoCaptions[N]` for the Scene3D clip on
 * `referenceVideoUrls[N]`, and what the canvas attaches for it.
 */
export const SCENE3D_LAYOUT_REFERENCE_SCOPING_LINE = buildScene3DLayoutScopingLine({
  carries: "clip",
  includesCameraMotion: true,
})

/**
 * Every wording the platform can send, plus the rendered form of each on its
 * usual seat: `clip` on the first video-reference seat, `still` on the first
 * image-reference seat. `clipWithCuts` is a four-shot composition.
 */
export const SCENE3D_LAYOUT_REFERENCE_SCOPING_FIXTURE = {
  clip: SCENE3D_LAYOUT_REFERENCE_SCOPING_LINE,
  clipRendered: renderScene3DLayoutScopingLine("@video_1", { carries: "clip", includesCameraMotion: true }),
  clipWithCuts: buildScene3DLayoutScopingLine({ carries: "clip", shots: 4, includesCameraMotion: true }),
  still: buildScene3DLayoutScopingLine({ carries: "still" }),
  stillRendered: renderScene3DLayoutScopingLine("@image_1", { carries: "still" }),
} as const

// ---------------------------------------------------------------------------
// Rule 2 — one character reference per figure
// ---------------------------------------------------------------------------

/** Rule 2 in user terms. Quoted by the docs and by the warning below. */
export const SCENE3D_FIGURE_REFERENCE_RULE =
  "Every figure that must look real needs its own character reference; a figure without one takes the clay look of the layout reference. Keep two reference slots free for a location or style plate."

/** Reference slots to keep free beside the figures — a location or style plate. */
export const SCENE3D_FREE_PLATE_SLOTS = 2

export const SCENE3D_UNREFERENCED_FIGURES_WARNING_CODE = "scene3d_unreferenced_figures"

export interface Scene3DFigureReferenceCheck {
  /** Figures in the composition — `person` entities in a Scene3D v2 plan.
   *  `undefined` when the plan cannot say (a v1 plan has no entity roles), in
   *  which case there is nothing to warn about. */
  readonly figureCount: number | undefined
  /** Distinct character references attached to the same generation. */
  readonly characterReferenceCount: number
  /** The model's image-reference budget, when known. Lets the message say
   *  whether one-per-figure plus the free plate slots even fits. */
  readonly imageReferenceCap?: number
  /** Image seats the layout reference itself occupies: 0 for a clip (it rides
   *  the video rail), 1 for a still on an image seat. Default 0. */
  readonly layoutReferenceImageSeats?: number
}

export interface Scene3DUnreferencedFiguresWarning {
  readonly code: typeof SCENE3D_UNREFERENCED_FIGURES_WARNING_CODE
  readonly message: string
  readonly figureCount: number
  readonly characterReferenceCount: number
  /** Figures still without a reference of their own. */
  readonly missing: number
}

/**
 * Rule 2 as a WARNING, never a block: the run still goes out — the user may
 * want clay figures, or be drawing a comparison — but they are told, before
 * they pay to find out, that unreferenced figures will inherit the clay look.
 * Returns `undefined` when there is nothing to say: no figures, an unknown
 * count, or every figure already has a reference.
 */
export function buildScene3DUnreferencedFiguresWarning(
  check: Scene3DFigureReferenceCheck,
): Scene3DUnreferencedFiguresWarning | undefined {
  const figures = check.figureCount
  if (figures === undefined || !Number.isFinite(figures) || figures <= 0) return undefined
  const refs = Math.max(0, Math.floor(check.characterReferenceCount))
  const missing = Math.floor(figures) - refs
  if (missing <= 0) return undefined
  const figureWord = figures === 1 ? "figure" : "figures"
  const refWord = refs === 1 ? "character reference is" : "character references are"
  let message =
    `The layout reference shows ${figures} ${figureWord} but ${refs} ${refWord} attached. ` +
    `A figure without its own character reference takes the clay look of the layout reference. ` +
    `Attach one character reference per figure (${missing} more)`
  const cap = check.imageReferenceCap
  if (typeof cap === "number" && Number.isFinite(cap) && cap > 0) {
    const seats = Math.max(0, Math.floor(check.layoutReferenceImageSeats ?? 0))
    const spare = cap - seats - figures
    message += spare >= SCENE3D_FREE_PLATE_SLOTS
      ? `; this model takes ${cap} image references, which leaves ${spare} for a location or style plate.`
      : `; this model takes ${cap} image references, so one per figure plus ${SCENE3D_FREE_PLATE_SLOTS} free slots for a location or style plate does not fit — reference the figures that matter most first.`
  } else {
    message += "."
  }
  return {
    code: SCENE3D_UNREFERENCED_FIGURES_WARNING_CODE,
    message,
    figureCount: figures,
    characterReferenceCount: refs,
    missing,
  }
}
