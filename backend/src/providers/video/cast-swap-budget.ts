/**
 * Cast Swap's job budget — a PURE leaf (imports nothing), like
 * `silence-detect-budget.ts`.
 *
 * Its handler is a PRIVATE PLUGIN handler, which cannot carry
 * `livenessBudgetMs` (core-only), so the video worker's dispatch falls back to
 * `declaredJobBudgetMs("cast-swap", job.data)` (`lib/job-budget.ts`) for the
 * pre-task heartbeat. A full clip runs a provider video edit that can approach
 * the 90-minute default on its own, so it declares a fixed, larger bound; a
 * preview (`preview: true`, a few seconds of the clip) declares a short one.
 *
 * The payload does not carry the clip's length, so both bounds are fixed per
 * run shape. A payload that is not an object, or whose `preview` is anything
 * but `true`, reads as a full run — the larger bound is the safe side.
 *
 * Face masking (`faceMasking.mode`, absent = "off") adds child jobs: "always"
 * masks the clip first (mask, optional depth, composite), "auto" may also run a
 * second provider edit after a refusal. A masked run — preview or not — takes
 * the masking bound, which matches the plugin's extended heartbeat. A
 * `faceMasking` or `mode` that is not one of the known values reads as "off".
 * The mode is read from `faceMasking` (the queue payload) or, when that key is
 * absent, `__faceMasking` (a trend run's saved `input_data`, which the row
 * readers — `lib/execution-budget.ts`, `cancel-inflight-jobs.ts` — pass in).
 *
 * A run that may be a depth reference — a direct Motion run (`style:
 * "motion"`) or a trend run whose clip is prepared as full depth
 * (`faceMasking.source: "full-depth"`, read like the mode) — takes the "auto"
 * bound: the SAFE UPPER BOUND, not always the plugin's own. Which one the
 * plugin uses is decided from settings this row does not carry: a direct
 * Motion run left on its Precise masking is no depth reference at all; a
 * depth reference with one video (a description or no scene) keeps itself
 * live for the "always" bound; only one that sends the original as a second
 * video (which may retry once after a refusal: mask, then edit again) for the
 * "auto" one (the plugin's handler.ts, `maskedHeartbeatMaxMs(twoVideos ?
 * "auto" : "always")`). Any other `style` reads as Precise, and any other
 * `source` as its mode: unchanged.
 *
 * The masked bounds must match the cast-swap plugin's `maskedHeartbeatMaxMs`
 * (handler.ts: 90 + 60 min for "always", + 90 more for "auto", + 180 for the
 * face check's ladder of two more engine runs), plus the Precise upscale's wait.
 *
 * 2026-11-22, the Precise upscale: a Precise run (masked or not) may send its
 * take to Topaz video upscale after the edit (`castSwap.preciseUpscale`). The
 * engine sizes that step's wait from the run's own output (its gigapixels ×
 * 150 s, plus 5 minutes, at most 45 minutes, a 4k target stepped down to
 * 1080p past that) and records it: queued as `preciseUpscaleWaitMs`, stored
 * as `input_data.__castSwapUpscaleWaitMs`. The engine waits in 1-minute
 * slices and grows its heartbeat by that wait rounded UP to whole minutes, or
 * by its 45-minute cap when the step is set (a target) but no wait is
 * recorded. Every bound that can carry the step adds the same:
 *  - a recorded wait, rounded up to whole minutes, at most 45 minutes;
 *  - else, for a run that names a target (the queued `preciseUpscale`, the
 *    stored `__castSwapPreciseUpscale`), the 45-minute cap;
 *  - else nothing on the full-clip and preview bounds (a Full Quality's too),
 *    which a run without the step keeps exactly; and on the masked bounds the
 *    flat `CAST_SWAP_PRECISE_UPSCALE_WAIT_MS` (15 min), kept from before the
 *    engine recorded a wait.
 *
 * Decided 2026-11-25 and 2026-11-27, a long clip: a source over 30 s (at most
 * 2 minutes) that the engine runs in parts and joins, behind its switch. The
 * route records the part plan on the queue payload (`longClip`) and hidden in
 * the stored input (`__longClip`, read when `longClip` is absent, as
 * `__faceMasking` is): `{ v: 1, sourceSec, videoSec, fps, byFrame, parts:
 * [{ startFrame, frames }, …] }`, at least two contiguous parts. Such a job
 * takes the bound its run shape takes today, plus `CAST_SWAP_LONG_CLIP_MS`:
 *  - the plan over the whole clip before the parts: the role preparation (one
 *    prep deadline, the engine's `PREP_WAIT_MS`, 10 min) and the shot list of
 *    the whole source (one LLM step, `LLM_STEP_WAIT_MS`, 6 min);
 *  - the parts: they run at once (at most 5 of 29.7 s for 2 minutes), each an
 *    ordinary run beating for itself, so the slowest part is the bound the run
 *    shape already takes, never one per part;
 *  - the join of the takes (`LONG_CLIP_JOIN_MS`, 15 min);
 *  - the one upscale of the joined take: its wait is the one the route
 *    recorded from the whole picture's length (`preciseUpscaleWaitMs`, at most
 *    45 min), already added above; the final fit is in the run shape's bound,
 *    as for a single run.
 * The 31 minutes are the engine's own addition to its keep-alive for a long
 * clip (handler.ts `longMs`), flat up to 2 minutes and 5 parts, so the plan's
 * length and part count gate the addition and do not scale it. A preview, or
 * a plan that is not one the engine would make (not an object, another `v`,
 * fewer than two parts, parts that do not follow on), adds nothing: every
 * other job keeps its bound exactly.
 */

const MINUTE_MS = 60_000

/** A full clip. */
export const CAST_SWAP_FULL_BUDGET_MS = 120 * MINUTE_MS

/** A preview run (`preview: true`). */
export const CAST_SWAP_PREVIEW_BUDGET_MS = 30 * MINUTE_MS

/** The Precise upscale's allowance on a masked bound for a run that names no step and records no wait. */
export const CAST_SWAP_PRECISE_UPSCALE_WAIT_MS = 15 * MINUTE_MS

/** The most a Precise upscale wait counts for (the engine's `UPSCALE_WAIT_MAX_MS`), and the wait of a run that names a target but records none. */
export const CAST_SWAP_PRECISE_UPSCALE_MAX_WAIT_MS = 45 * MINUTE_MS

/**
 * The face check's ladder on a masked run (2026-11-23): a take in which a face
 * is still the hidden placeholder is discarded and the engine runs again, up to
 * two more engine children of at most 90 minutes each. Only a masked run takes
 * the ladder, so only the masked bounds carry it; the plugin's
 * `maskedHeartbeatMaxMs` grows by the same.
 */
export const CAST_SWAP_FACE_CHECK_LADDER_MS = 2 * 90 * MINUTE_MS

/** A run with face masking "always": the edit plus the mask jobs, and the face check's ladder (before the Precise upscale's wait). */
const MASK_ALWAYS_BASE_MS = 150 * MINUTE_MS + CAST_SWAP_FACE_CHECK_LADDER_MS

/** A run with face masking "auto": the mask jobs and a possible second edit, and the face check's ladder (before the Precise upscale's wait). */
const MASK_AUTO_BASE_MS = 240 * MINUTE_MS + CAST_SWAP_FACE_CHECK_LADDER_MS

/** A run with face masking "always", with the Precise upscale's default wait (no recorded one). */
export const CAST_SWAP_MASK_ALWAYS_BUDGET_MS = MASK_ALWAYS_BASE_MS + CAST_SWAP_PRECISE_UPSCALE_WAIT_MS

/** A run with face masking "auto", with the Precise upscale's default wait (no recorded one). */
export const CAST_SWAP_MASK_AUTO_BUDGET_MS = MASK_AUTO_BASE_MS + CAST_SWAP_PRECISE_UPSCALE_WAIT_MS

/** The face masking setting: `faceMasking`, or `__faceMasking` when `faceMasking` is absent; null when not an object. */
function faceMaskingOf(data: object): Record<string, unknown> | null {
  const { faceMasking, __faceMasking } = data as { faceMasking?: unknown; __faceMasking?: unknown }
  const masking = faceMasking !== undefined ? faceMasking : __faceMasking
  return masking && typeof masking === "object" ? (masking as Record<string, unknown>) : null
}

/** The face-masking mode when it is "always" or "auto", else `undefined`. */
function faceMaskingMode(data: object): "always" | "auto" | undefined {
  const mode = faceMaskingOf(data)?.mode
  return mode === "always" || mode === "auto" ? mode : undefined
}

/**
 * A run that may be a depth reference: a direct Motion run, a run whose clip is full depth (a trend's, or a Precise
 * run with an art style the engine makes the Flex way, which keeps its asked style), or a style-only run (a direct
 * one, made the Flex way whatever style it keeps). The "auto" bound covers each.
 */
function depthReference(data: object): boolean {
  const d = data as { style?: unknown; styleOnly?: unknown }
  return d.style === "motion" || faceMaskingOf(data)?.source === "full-depth" || typeof d.styleOnly === "string"
}

/** The Topaz targets the Precise upscale step runs at (`@nodaro/shared` `TOPAZ_VIDEO_RESOLUTIONS`; this leaf imports nothing). */
const PRECISE_UPSCALE_TARGETS: ReadonlySet<unknown> = new Set(["720p", "1080p", "4k"])

/** The wait the engine recorded for the step (queued `preciseUpscaleWaitMs`, else stored `__castSwapUpscaleWaitMs`), at most the cap; undefined when neither is a positive number. */
function recordedUpscaleWaitMs(data: object): number | undefined {
  const d = data as { preciseUpscaleWaitMs?: unknown; __castSwapUpscaleWaitMs?: unknown }
  const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0
  const wait = positive(d.preciseUpscaleWaitMs) ? d.preciseUpscaleWaitMs : positive(d.__castSwapUpscaleWaitMs) ? d.__castSwapUpscaleWaitMs : undefined
  // The engine's own rounding: whole 1-minute slices, rounded up.
  return wait === undefined ? undefined : Math.min(Math.ceil(wait / MINUTE_MS) * MINUTE_MS, CAST_SWAP_PRECISE_UPSCALE_MAX_WAIT_MS)
}

/** Whether the run names a Topaz target for the step: its queued `preciseUpscale`, or its stored `__castSwapPreciseUpscale`. */
function namesUpscaleTarget(data: object): boolean {
  const d = data as { preciseUpscale?: unknown; __castSwapPreciseUpscale?: unknown }
  return PRECISE_UPSCALE_TARGETS.has(d.preciseUpscale) || PRECISE_UPSCALE_TARGETS.has(d.__castSwapPreciseUpscale)
}

/** The step's wait for a run that carries it (a recorded wait, else the cap for a named target); undefined for one that does not. */
function carriedUpscaleWaitMs(data: object): number | undefined {
  const recorded = recordedUpscaleWaitMs(data)
  if (recorded !== undefined) return recorded
  return namesUpscaleTarget(data) ? CAST_SWAP_PRECISE_UPSCALE_MAX_WAIT_MS : undefined
}

/** The step's wait on a masked bound, which always allows for it: the carried wait, else the flat default. */
const upscaleWaitMs = (data: object): number => carriedUpscaleWaitMs(data) ?? CAST_SWAP_PRECISE_UPSCALE_WAIT_MS

/** A long clip's plan over the whole source: the role preparation (10 min) and the whole source's shot list (one LLM step, 6 min). */
const LONG_CLIP_PLAN_MS = 10 * MINUTE_MS + 6 * MINUTE_MS

/** A long clip's join of its parts' takes (the engine's `LONG_CLIP_JOIN_MS`). */
const LONG_CLIP_JOIN_MS = 15 * MINUTE_MS

/** What a long clip's job adds to its run shape's bound: the plan before the parts and the join after them (31 min). */
export const CAST_SWAP_LONG_CLIP_MS = LONG_CLIP_PLAN_MS + LONG_CLIP_JOIN_MS

/**
 * Whether the job carries a long clip's plan (`longClip`, else `__longClip`) the engine would make (its
 * `parseLongClipPlan`): version 1, positive lengths and rate, and at least two parts, each starting where the
 * one before it ends. A preview never runs in parts.
 */
function carriesLongClip(data: object): boolean {
  const d = data as { longClip?: unknown; __longClip?: unknown; preview?: unknown }
  if (d.preview === true) return false
  const plan = d.longClip !== undefined ? d.longClip : d.__longClip
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return false
  const { v, sourceSec, videoSec, fps, byFrame, parts } = plan as Record<string, unknown>
  const positive = (n: unknown): boolean => typeof n === "number" && Number.isFinite(n) && n > 0
  if (v !== 1 || !positive(sourceSec) || !positive(videoSec) || !positive(fps) || typeof byFrame !== "boolean") return false
  if (!Array.isArray(parts) || parts.length < 2) return false
  let next = 0
  for (const part of parts as unknown[]) {
    if (!part || typeof part !== "object") return false
    const { startFrame, frames } = part as Record<string, unknown>
    if (startFrame !== next || typeof frames !== "number" || !Number.isInteger(frames) || frames < 1) return false
    next += frames
  }
  return true
}

/** The bound of one cast-swap job before a long clip's addition (see `castSwapJobBudgetMs`). */
function runShapeBudgetMs(data: object): number {
  const mode = faceMaskingMode(data)
  if (mode === "auto" || depthReference(data)) return MASK_AUTO_BASE_MS + upscaleWaitMs(data)
  if (mode === "always") return MASK_ALWAYS_BASE_MS + upscaleWaitMs(data)
  const base = (data as { preview?: unknown }).preview === true ? CAST_SWAP_PREVIEW_BUDGET_MS : CAST_SWAP_FULL_BUDGET_MS
  return base + (carriedUpscaleWaitMs(data) ?? 0)
}

/** The budget of one cast-swap job: the "auto" bound when face masking is
 *  "auto" or the run is a depth reference, then "always" (each plus the
 *  upscale's recorded wait, else its default); otherwise the preview bound
 *  only when `data.preview === true`, else the full-clip bound, either one
 *  plus the upscale's wait only when the run carries that step. A long clip
 *  (its part plan, `longClip` / `__longClip`) adds `CAST_SWAP_LONG_CLIP_MS`. */
export function castSwapJobBudgetMs(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return CAST_SWAP_FULL_BUDGET_MS
  return runShapeBudgetMs(data) + (carriesLongClip(data) ? CAST_SWAP_LONG_CLIP_MS : 0)
}
