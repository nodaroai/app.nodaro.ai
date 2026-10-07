/**
 * Speaker View's settings vocabulary (C3.2, decided 2026-10-06): the ids a node
 * may carry, the limits its render holds to, and whether it may be charged for
 * at all. Pure and private — the same module is read by both engines, the
 * editor's panel and quick strip, and the badge, so none of them keeps its own
 * copy of a list.
 *
 * The renderer is the cloud plugin. This is the app's MIRROR of what it draws
 * and refuses; `speaker-view-parity.test.ts` fails the build when the two
 * disagree on a fixture the plugin generated.
 */
import {
  EDL_TARGET_ASPECTS,
  SPEAKER_EMPHASIS_STYLES,
  SPEAKER_LAYOUT_IDS,
  type EdlTargetAspect,
} from "@nodaro/shared"

/** The aspects a Speaker View render is drawn at (SV7). */
export const SPEAKER_VIEW_ASPECTS: readonly EdlTargetAspect[] = EDL_TARGET_ASPECTS
/** The aspect when neither the node nor the edit names one (SV20). */
export const SPEAKER_VIEW_DEFAULT_ASPECT: EdlTargetAspect = "16:9"

/** The node's layout setting: a layout, or `auto` (each segment follows Camera
 *  Switch's hint, else single). */
export const SPEAKER_VIEW_LAYOUT_SETTINGS: readonly string[] = ["auto", ...SPEAKER_LAYOUT_IDS]

/** The layouts that show more than one speaker at once. */
export const MULTI_SLOT_LAYOUTS: ReadonlySet<string> = new Set(["side-by-side", "stacked", "grid"])

/** The emphasis atoms a person can toggle (`none` is "all off"). */
export const SPEAKER_VIEW_EMPHASIS_ATOMS: readonly string[] = SPEAKER_EMPHASIS_STYLES.filter((s) => s !== "none")

/** The longest output of one render: 180 minutes (F4, decided 2026-09-23). */
export const SPEAKER_VIEW_MAX_OUTPUT_MS = 180 * 60_000

/** The smallest region side, as a fraction of the frame. Below it a cover crop
 *  is under 2 px and the renderer refuses it mid-render. */
export const SPEAKER_VIEW_MIN_REGION = 0.01

/** The border emphasis's colour (SV15: the `brand` input became this setting). */
export const SPEAKER_VIEW_ACCENT_PATTERN = /^#[0-9A-Fa-f]{6}$/

/** SV20's tween defaults for a fresh node. (Quality is not here: a node starts on
 *  `final`, Apply EDL's own default, in its `NODE_DEFINITIONS` entry.) */
export const SPEAKER_VIEW_DEFAULTS = Object.freeze({
  switchDurationMs: 600,
  emphasisStyle: "scale",
  emphasisDurationMs: 300,
})

/**
 * Whether Speaker View may be charged for at all. FALSE until C4 measures and
 * sets the per-minute rate (TA4: no interim price ships). Both the plugin's
 * route and this app refuse every run with `SPEAKER_VIEW_NOT_PRICED_MESSAGE`
 * before anything is reserved; C4 flips this one flag.
 */
export const SPEAKER_VIEW_PRICED = false

/** The exact words the plugin's route answers with, so the app says the same
 *  thing before it ever reaches the plugin. */
export const SPEAKER_VIEW_NOT_PRICED_MESSAGE = "Speaker View is not priced yet"

/** A run that cannot start because it holds Speaker View nodes with no price. */
export interface SpeakerViewRunRefusal {
  readonly nodeIds: readonly string[]
  readonly message: string
}

/**
 * The run-start refusal while Speaker View has no price: asked of the nodes a
 * run WILL execute, by both engines, BEFORE any node dispatches. Without it the
 * refusal fires only when the DAG reaches the Speaker View node, after every
 * paid node upstream (Transcribe, Edit Plan, Camera Switch) has run and charged
 * for a render that could never succeed. Names the nodes; `null` when the run
 * may start. Nodes marked skipped never run, so they never refuse. C4 deletes
 * this with the flag.
 */
export function speakerViewRunRefusal(
  nodes: ReadonlyArray<{ readonly id: string; readonly type?: unknown; readonly data?: unknown }>,
  /** Whether Speaker View is priced; a caller passes the flag it already
   *  imports, so a test that stands in for it stands in for this check too. */
  priced: boolean = SPEAKER_VIEW_PRICED,
): SpeakerViewRunRefusal | null {
  if (priced) return null
  const hits = nodes.filter((n) => {
    if (n.type !== "speaker-view") return false
    const data = n.data as { skipped?: unknown } | null | undefined
    return data?.skipped !== true
  })
  if (hits.length === 0) return null
  const nodeIds = hits.map((n) => n.id)
  return { nodeIds, message: `${SPEAKER_VIEW_NOT_PRICED_MESSAGE} (Speaker View node ${nodeIds.join(", ")}). The run did not start and nothing was charged.` }
}

/** Narrow any value to an aspect this renderer draws. */
export function isSpeakerViewAspect(v: unknown): v is EdlTargetAspect {
  return typeof v === "string" && (SPEAKER_VIEW_ASPECTS as readonly string[]).includes(v)
}
