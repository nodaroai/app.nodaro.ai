/**
 * Cast Swap's input limits, and what a trend built on it may put in its
 * prompts. One definition read by the server (which enforces them) and by
 * every screen that edits them (which holds Save before a refusal), so the two
 * cannot drift apart.
 */

/** The longest `postPrompt` Cast Swap takes. */
export const CAST_SWAP_POST_PROMPT_MAX = 4000

/**
 * A trend's prompt limits.
 *
 * - `trendPromptMax` / `prePromptMax`: the longest prompt a trend version may
 *   store.
 * - `detailsMax`: the longest details a user may add to a run. They follow the
 *   trend prompt in Cast Swap's `postPrompt`, after a blank line, so a new
 *   trend prompt is held to `CAST_SWAP_POST_PROMPT_MAX − 2 − detailsMax`.
 * - `engineTextReserve`: the room kept for the text Cast Swap writes around a
 *   trend's prompts in the prompt it builds, at its longest (a block for each
 *   of the 13 roles a run allows with 200-character role names, five
 *   500-character reference lines, the keep, mask and edit lines and the
 *   header: about 16,100 characters, rounded up so a small wording change does
 *   not need this moved). The pre prompt, the trend prompt and the details
 *   share what is left of Seedance 2.5's prompt cap.
 */
export const TREND_PROMPT_LIMITS = {
  trendPromptMax: 3000,
  prePromptMax: 3000,
  detailsMax: 1000,
  engineTextReserve: 17_000,
} as const

/** Cast Swap's `faceMasking` bounds, each `[min, max]` inclusive. */
export const CAST_SWAP_FACE_MASKING_BOUNDS = {
  /** `minFaceHeightPct` and `maxFaceHeightPct`, % of the frame's height (max 0 = no limit). */
  faceHeightPct: [0, 100],
  /** Each `zone` margin, % of the frame. */
  zonePct: [0, 49],
  /** % of the frame's width. */
  blurStrengthPct: [0.1, 5],
  threshold: [0.05, 0.95],
} as const satisfies Record<string, readonly [number, number]>

/** What Cast Swap uses for a `faceMasking` setting left out. */
export const CAST_SWAP_FACE_MASKING_DEFAULTS = {
  /** What covers a masked face: a blur (`"depth"`, a depth-color view of it, is the other fill). */
  fill: "blur",
  minFaceHeightPct: 15,
  maxFaceHeightPct: 0,
  /**
   * The frame margins when `zone` is left out: a face centred in the outer 10 %
   * at the left or right is not masked (people walking in at the edge). An
   * explicit `zone: null`, or all four margins 0, means no margins.
   */
  zone: { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 },
  /** A margin left out of a `zone` that is given. */
  zonePct: 0,
  blurStrengthPct: 2,
  threshold: 0.5,
} as const
