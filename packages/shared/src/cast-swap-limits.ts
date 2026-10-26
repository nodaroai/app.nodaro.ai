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

/**
 * What a Cast Swap face mask covers (`faceMasking.target`):
 *
 * - `"head"` (the default): the whole head, hair included, and people seen
 *   from behind or turned away, with a bigger mask.
 * - `"face"`: the face only; the hair, and a person turned away, stay visible.
 */
export const CAST_SWAP_FACE_MASK_TARGETS = ["face", "head"] as const

export type CastSwapFaceMaskTarget = (typeof CAST_SWAP_FACE_MASK_TARGETS)[number]

/** What Cast Swap uses for a `faceMasking` setting left out. */
export const CAST_SWAP_FACE_MASKING_DEFAULTS = {
  /** What a mask covers: the whole head (`CAST_SWAP_FACE_MASK_TARGETS`). */
  target: "head",
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

/**
 * The video engines Cast Swap runs on. A run or estimate that leaves `engine`
 * out runs on `CAST_SWAP_ENGINE_WHEN_OMITTED`, so callers that predate the
 * choice keep what they had.
 */
export const CAST_SWAP_ENGINES = ["seedance-2-5", "kling-4"] as const

export type CastSwapEngine = (typeof CAST_SWAP_ENGINES)[number]

/** The engine of a run, estimate or trend that names none. */
export const CAST_SWAP_ENGINE_WHEN_OMITTED: CastSwapEngine = "seedance-2-5"

/**
 * Nodaro Motion — what people see of Cast Swap. Its two engines' PUBLIC ids,
 * the only ones documented and returned (a trend's `engine`, a run record, a
 * quote): `"motion-pro"` (Nodaro Motion Pro) and `"motion-lite"` (Nodaro
 * Motion Lite).
 *
 * `CAST_SWAP_ENGINES` stays the INTERNAL vocabulary: what a stored trend
 * version names, and what the platform sends the Cast Swap engine (which takes
 * both). A public id is mapped to it at every boundary that reads one
 * (`castSwapEngineFrom`), and back at every boundary a person reads
 * (`nodaroMotionEngineOf`).
 */
export const NODARO_MOTION_ENGINES = ["motion-pro", "motion-lite"] as const

export type NodaroMotionEngine = (typeof NODARO_MOTION_ENGINES)[number]

/** Each public engine's name, as people read it. */
export const NODARO_MOTION_ENGINE_NAMES = {
  "motion-pro": "Nodaro Motion Pro",
  "motion-lite": "Nodaro Motion Lite",
} as const satisfies Record<NodaroMotionEngine, string>

/** The internal engine each public id runs on (and the inverse, below). */
export const CAST_SWAP_ENGINE_OF_NODARO_MOTION = {
  "motion-pro": "seedance-2-5",
  "motion-lite": "kling-4",
} as const satisfies Record<NodaroMotionEngine, CastSwapEngine>

/** The public id of each internal engine. */
export const NODARO_MOTION_ENGINE_OF_CAST_SWAP = {
  "seedance-2-5": "motion-pro",
  "kling-4": "motion-lite",
} as const satisfies Record<CastSwapEngine, NodaroMotionEngine>

/** The public id of an internal engine. */
export function nodaroMotionEngineOf(engine: CastSwapEngine): NodaroMotionEngine {
  return NODARO_MOTION_ENGINE_OF_CAST_SWAP[engine]
}

/** The name people read for an internal engine ("Nodaro Motion Pro" / "Nodaro Motion Lite"). */
export function nodaroMotionEngineName(engine: CastSwapEngine): string {
  return NODARO_MOTION_ENGINE_NAMES[nodaroMotionEngineOf(engine)]
}

/**
 * The internal engine a value names, in either vocabulary: a public id
 * (`"motion-pro"`, `"motion-lite"`) or an internal one (`"seedance-2-5"`,
 * `"kling-4"`, still accepted from older clients and stored data). Undefined
 * for anything else.
 */
export function castSwapEngineFrom(value: unknown): CastSwapEngine | undefined {
  if (typeof value !== "string") return undefined
  if (Object.hasOwn(CAST_SWAP_ENGINE_OF_NODARO_MOTION, value)) {
    return CAST_SWAP_ENGINE_OF_NODARO_MOTION[value as NodaroMotionEngine]
  }
  return (CAST_SWAP_ENGINES as readonly string[]).includes(value) ? (value as CastSwapEngine) : undefined
}

/** Every engine id a request may name: the public ids, then the internal ones (still accepted, never documented). */
export const CAST_SWAP_ENGINE_IDS_ACCEPTED = [...NODARO_MOTION_ENGINES, ...CAST_SWAP_ENGINES] as const

/**
 * The resolutions each engine renders, the default first. Seedance 2.5's 480p
 * is its draft (`draft` is 480p only); Kling 4 has no draft and no 480p.
 */
export const CAST_SWAP_RESOLUTIONS_BY_ENGINE = {
  "seedance-2-5": ["480p", "720p", "1080p"],
  "kling-4": ["720p", "1080p"],
} as const satisfies Record<CastSwapEngine, readonly ("480p" | "720p" | "1080p")[]>

/** Whether an engine renders drafts (Seedance 2.5's 480p draft; Kling 4 has none). */
export function castSwapEngineHasDraft(engine: CastSwapEngine): boolean {
  return engine === "seedance-2-5"
}

/**
 * Where a Kling 4 run cuts the clip to whole seconds (Kling renders whole
 * seconds, and asked for more than the clip it stretches the motion; Seedance
 * 2.5 ignores it): `"cut-end"` (the default) drops the fraction of a second at
 * the clip's end, `"cut-start"` at its start.
 */
export const CAST_SWAP_KLING_LENGTHS = ["cut-end", "cut-start"] as const

export type CastSwapKlingLength = (typeof CAST_SWAP_KLING_LENGTHS)[number]

/** The `klingLength` of a run or trend that names none. */
export const CAST_SWAP_KLING_LENGTH_WHEN_OMITTED: CastSwapKlingLength = "cut-end"

/**
 * The most images one Kling 4 Cast Swap run sends, across every role and fixed
 * reference (a role with prepared references counts its one prepared
 * picture). Over it the route answers `too_many_images`.
 */
export const CAST_SWAP_KLING_MAX_IMAGES = 10
