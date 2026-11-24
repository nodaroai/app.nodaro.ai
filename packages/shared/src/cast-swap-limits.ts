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
 * - `"body"`: the whole person. A face mask that takes it hides everyone in
 *   the clip, body and head (the biggest mask); a trend clip that keeps its
 *   people as they are (the rest of the frame prepared) keeps them whole. A
 *   clip made into depth as a whole takes no target.
 */
export const CAST_SWAP_FACE_MASK_TARGETS = ["face", "head", "body"] as const

export type CastSwapFaceMaskTarget = (typeof CAST_SWAP_FACE_MASK_TARGETS)[number]

/**
 * How a direct Video Remake run follows its clip (`style`, a public run
 * field): `"precise"` (the default) follows the clip exactly; `"motion"`
 * follows only the clip's movement and takes every look from the photos. A
 * trend run ignores it (its trend decides).
 */
export const CAST_SWAP_STYLES = ["precise", "motion"] as const

export type CastSwapStyle = (typeof CAST_SWAP_STYLES)[number]

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
 * Video Remake — what people see of Cast Swap. Its two engines' PUBLIC ids,
 * the only ones documented and returned (a trend's `engine`, a run record, a
 * quote): `"nodaro-prism"` (Nodaro Prism) and `"nodaro-pulse"` (Nodaro Pulse).
 *
 * `CAST_SWAP_ENGINES` stays the INTERNAL vocabulary: what a stored trend
 * version names, and what the platform sends the Cast Swap engine (which takes
 * it in every version). A public id is mapped to it at every boundary that
 * reads one (`castSwapEngineFrom`), and back at every boundary a person reads
 * (`nodaroMotionEngineOf`). The engines' earlier public ids
 * (`NODARO_MOTION_LEGACY_ENGINES`) are read the same way and never returned.
 */
export const NODARO_MOTION_ENGINES = ["nodaro-prism", "nodaro-pulse"] as const

export type NodaroMotionEngine = (typeof NODARO_MOTION_ENGINES)[number]

/**
 * The public ids the engines had before, each with the id it became:
 * `"motion-prism"` / `"motion-pulse"` (until 2026-11-17) and, before them,
 * `"motion-pro"` / `"motion-lite"` (until 2026-10-26). Still read wherever an
 * engine is read — a request, a stored run, an engine's declared engines, an
 * admin setting's keys — and never returned or documented.
 */
export const NODARO_MOTION_LEGACY_ENGINES = {
  "motion-prism": "nodaro-prism",
  "motion-pulse": "nodaro-pulse",
  "motion-pro": "nodaro-prism",
  "motion-lite": "nodaro-pulse",
} as const satisfies Record<string, NodaroMotionEngine>

export type NodaroMotionLegacyEngine = keyof typeof NODARO_MOTION_LEGACY_ENGINES

/**
 * Each public id's previous id (`"nodaro-prism"` → `"motion-prism"`): the key
 * a Cast Swap engine from before the latest rename reads an admin setting by.
 * Every earlier id, newest first, is in `NODARO_MOTION_EARLIER_ENGINES_OF`.
 */
export const NODARO_MOTION_LEGACY_ENGINE_OF = {
  "nodaro-prism": "motion-prism",
  "nodaro-pulse": "motion-pulse",
} as const satisfies Record<NodaroMotionEngine, NodaroMotionLegacyEngine>

/** Each public id's earlier ids, newest first (the inverse of `NODARO_MOTION_LEGACY_ENGINES`). */
export const NODARO_MOTION_EARLIER_ENGINES_OF = {
  "nodaro-prism": ["motion-prism", "motion-pro"],
  "nodaro-pulse": ["motion-pulse", "motion-lite"],
} as const satisfies Record<NodaroMotionEngine, readonly NodaroMotionLegacyEngine[]>

/**
 * Each public engine's name, as people read it. The earlier ids are keys too,
 * each answering the name of the engine it became, so code written against
 * them keeps reading a name (never undefined); iterate `NODARO_MOTION_ENGINES`,
 * not these keys.
 */
export const NODARO_MOTION_ENGINE_NAMES = {
  "nodaro-prism": "Nodaro Prism",
  "nodaro-pulse": "Nodaro Pulse",
  "motion-prism": "Nodaro Prism",
  "motion-pulse": "Nodaro Pulse",
  "motion-pro": "Nodaro Prism",
  "motion-lite": "Nodaro Pulse",
} as const satisfies Record<NodaroMotionEngine | NodaroMotionLegacyEngine, string>

/**
 * The internal engine each public id runs on (and the inverse, below). The
 * earlier ids are keys too, as in `NODARO_MOTION_ENGINE_NAMES`.
 */
export const CAST_SWAP_ENGINE_OF_NODARO_MOTION = {
  "nodaro-prism": "seedance-2-5",
  "nodaro-pulse": "kling-4",
  "motion-prism": "seedance-2-5",
  "motion-pulse": "kling-4",
  "motion-pro": "seedance-2-5",
  "motion-lite": "kling-4",
} as const satisfies Record<NodaroMotionEngine | NodaroMotionLegacyEngine, CastSwapEngine>

/** The public id of each internal engine. */
export const NODARO_MOTION_ENGINE_OF_CAST_SWAP = {
  "seedance-2-5": "nodaro-prism",
  "kling-4": "nodaro-pulse",
} as const satisfies Record<CastSwapEngine, NodaroMotionEngine>

/** The public id of an internal engine. */
export function nodaroMotionEngineOf(engine: CastSwapEngine): NodaroMotionEngine {
  return NODARO_MOTION_ENGINE_OF_CAST_SWAP[engine]
}

/** The name people read for an internal engine ("Nodaro Prism" / "Nodaro Pulse"). */
export function nodaroMotionEngineName(engine: CastSwapEngine): string {
  return NODARO_MOTION_ENGINE_NAMES[nodaroMotionEngineOf(engine)]
}

/**
 * The internal engine a value names, in any vocabulary: a public id
 * (`"nodaro-prism"`, `"nodaro-pulse"`), an earlier public id
 * (`NODARO_MOTION_LEGACY_ENGINES`) or an internal one (`"seedance-2-5"`,
 * `"kling-4"`), the last ones still accepted from older clients, older
 * engines and stored data. Undefined for anything else.
 */
export function castSwapEngineFrom(value: unknown): CastSwapEngine | undefined {
  if (typeof value !== "string") return undefined
  // Its keys are the current and the earlier public ids.
  if (Object.hasOwn(CAST_SWAP_ENGINE_OF_NODARO_MOTION, value)) {
    return CAST_SWAP_ENGINE_OF_NODARO_MOTION[value as NodaroMotionEngine | NodaroMotionLegacyEngine]
  }
  return (CAST_SWAP_ENGINES as readonly string[]).includes(value) ? (value as CastSwapEngine) : undefined
}

/** The public id a value names, in any vocabulary (`castSwapEngineFrom`); undefined for anything else. */
export function nodaroMotionEngineFrom(value: unknown): NodaroMotionEngine | undefined {
  const engine = castSwapEngineFrom(value)
  return engine ? nodaroMotionEngineOf(engine) : undefined
}

/**
 * Every engine id a request may name: the public ids, then the earlier public
 * ids and the internal ones (still accepted, never documented).
 */
export const CAST_SWAP_ENGINE_IDS_ACCEPTED = [
  ...NODARO_MOTION_ENGINES,
  "motion-prism",
  "motion-pulse",
  "motion-pro",
  "motion-lite",
  ...CAST_SWAP_ENGINES,
] as const satisfies readonly (NodaroMotionEngine | NodaroMotionLegacyEngine | CastSwapEngine)[]

/**
 * Video Remake's FLASH CHOICES (2026-11-22): each engine's faster, lower-cost
 * model offered as a choice of its own beside the engine, picked per run and
 * priced at that model's own rate — `"nodaro-prism-flash"` (Nodaro Prism Flash, a
 * Nodaro Prism run) and `"nodaro-pulse-flash"` (Nodaro Pulse Flash, a Nodaro Pulse
 * run). A deployment offers each only while its admin's "Offer Flash" is on
 * for the engine (`GET /v1/video-remake/style-choice` answers `flash`); a
 * request naming one anywhere else is refused 409 `flash_not_offered`.
 *
 * A choice, NOT an engine: never a key of a per-engine map (those stay keyed
 * by `NODARO_MOTION_ENGINES`), and `castSwapEngineFrom` does not read it (a
 * reader that only knows the two engines must not silently run Flash as the
 * engine). Read with `videoRemakeFlashEngineFrom` / `nodaroMotionEngineOfFlash`.
 */
export const VIDEO_REMAKE_FLASH_ENGINES = ["nodaro-prism-flash", "nodaro-pulse-flash"] as const

export type VideoRemakeFlashEngine = (typeof VIDEO_REMAKE_FLASH_ENGINES)[number]

/** The name people read for each Flash choice (exactly these). */
export const VIDEO_REMAKE_FLASH_ENGINE_NAMES = {
  "nodaro-prism-flash": "Nodaro Prism Flash",
  "nodaro-pulse-flash": "Nodaro Pulse Flash",
} as const satisfies Record<VideoRemakeFlashEngine, string>

/** The engine each Flash choice is a run of. */
export const NODARO_MOTION_ENGINE_OF_FLASH = {
  "nodaro-prism-flash": "nodaro-prism",
  "nodaro-pulse-flash": "nodaro-pulse",
} as const satisfies Record<VideoRemakeFlashEngine, NodaroMotionEngine>

/** Each engine's Flash choice. */
export function videoRemakeFlashEngineOf(engine: NodaroMotionEngine): VideoRemakeFlashEngine {
  return engine === "nodaro-pulse" ? "nodaro-pulse-flash" : "nodaro-prism-flash"
}

/** The Flash choice a value names; undefined for anything else (an engine id included). */
export function videoRemakeFlashEngineFrom(value: unknown): VideoRemakeFlashEngine | undefined {
  return (VIDEO_REMAKE_FLASH_ENGINES as readonly unknown[]).includes(value) ? (value as VideoRemakeFlashEngine) : undefined
}

/**
 * The internal engine whose RUN a value names: a Flash choice's engine (a Nodaro Prism
 * Flash run is a Nodaro Prism run in every setting), else `castSwapEngineFrom`.
 * For the readers that apply an engine's settings to a run (its audio, its
 * reference audio): never for one that must refuse a Flash choice it cannot run.
 */
export function castSwapEngineOfRun(value: unknown): CastSwapEngine | undefined {
  const flash = videoRemakeFlashEngineFrom(value)
  return flash ? CAST_SWAP_ENGINE_OF_NODARO_MOTION[NODARO_MOTION_ENGINE_OF_FLASH[flash]] : castSwapEngineFrom(value)
}

/** The engine a Flash choice is a run of. */
export function nodaroMotionEngineOfFlash(choice: VideoRemakeFlashEngine): NodaroMotionEngine {
  return NODARO_MOTION_ENGINE_OF_FLASH[choice]
}

/**
 * What each Flash choice renders, the default first: Nodaro Prism Flash 480p (plain)
 * or 720p, Nodaro Pulse Flash 720p. Neither has a draft, 1080p or Full Quality;
 * Nodaro Prism Flash takes at most `VIDEO_REMAKE_FLASH_PRISM_MAX_IMAGES` pictures,
 * Nodaro Pulse Flash at most `VIDEO_REMAKE_FLASH_PULSE_MAX_SEC` seconds of output.
 */
export const VIDEO_REMAKE_FLASH_RESOLUTIONS = {
  "nodaro-prism-flash": ["480p", "720p"],
  "nodaro-pulse-flash": ["720p"],
} as const satisfies Record<VideoRemakeFlashEngine, readonly ("480p" | "720p" | "1080p")[]>

/** The most images one Nodaro Prism Flash run sends (Nodaro Prism: 30). */
export const VIDEO_REMAKE_FLASH_PRISM_MAX_IMAGES = 10

/** The longest output one Nodaro Pulse Flash run renders, whole seconds (Nodaro Pulse: 30). */
export const VIDEO_REMAKE_FLASH_PULSE_MAX_SEC = 20

/**
 * The resolutions each engine renders, the default first. Seedance 2.5's 480p
 * is plain unless a run asks for a draft (`draft` is 480p only); Kling 4 has
 * no draft and no 480p.
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
