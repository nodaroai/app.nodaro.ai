// cast-swap's declared budget: a fixed bound per run shape — a full clip, or a
// 4-second preview (`preview: true`). Its handler is a private plugin's, so the
// video worker's heartbeat reads this through the registry (`lib/job-budget.ts`).
import { describe, it, expect } from "vitest"
import {
  CAST_SWAP_FACE_CHECK_LADDER_MS,
  CAST_SWAP_FULL_BUDGET_MS,
  CAST_SWAP_LONG_CLIP_MS,
  CAST_SWAP_MASK_ALWAYS_BUDGET_MS,
  CAST_SWAP_MASK_AUTO_BUDGET_MS,
  CAST_SWAP_PRECISE_UPSCALE_MAX_WAIT_MS,
  CAST_SWAP_PRECISE_UPSCALE_WAIT_MS,
  CAST_SWAP_PREVIEW_BUDGET_MS,
  castSwapJobBudgetMs,
} from "../cast-swap-budget.js"
import { declaredJobBudgetMs } from "../../../lib/job-budget.js"
import { NODE_TIMEOUT_MS } from "../../../services/workflow-engine/types.js"

const MINUTE = 60_000
/** The masked bounds (the plugin's `maskedHeartbeatMaxMs`) plus the Precise upscale's 15 minutes (2026-11-22)
 *  plus the face check's ladder of two more 90-minute engine runs (2026-11-23). */
const LADDER = 180 * MINUTE
const ALWAYS = 165 * MINUTE + LADDER
const AUTO = 255 * MINUTE + LADDER

describe("cast-swap job budget", () => {
  it("budget is 120 min, 30 min for a preview", () => {
    expect(CAST_SWAP_FULL_BUDGET_MS).toBe(120 * MINUTE)
    expect(CAST_SWAP_PREVIEW_BUDGET_MS).toBe(30 * MINUTE)
    expect(castSwapJobBudgetMs({ videoUrl: "https://x.test/clip.mp4" })).toBe(120 * MINUTE)
    expect(castSwapJobBudgetMs({ preview: false })).toBe(120 * MINUTE)
    expect(castSwapJobBudgetMs({ preview: true, previewStart: 3 })).toBe(30 * MINUTE)
  })

  it("only `preview === true` is a preview; a non-object payload reads as a full run", () => {
    expect(castSwapJobBudgetMs({ preview: "true" })).toBe(120 * MINUTE)
    expect(castSwapJobBudgetMs({ preview: 1 })).toBe(120 * MINUTE)
    expect(castSwapJobBudgetMs(null)).toBe(120 * MINUTE)
    expect(castSwapJobBudgetMs(undefined)).toBe(120 * MINUTE)
    expect(castSwapJobBudgetMs("cast-swap")).toBe(120 * MINUTE)
  })

  it("face masking off or absent leaves the budget exactly as it was", () => {
    expect(castSwapJobBudgetMs({ faceMasking: { mode: "off" } })).toBe(120 * MINUTE)
    expect(castSwapJobBudgetMs({ faceMasking: { mode: "off" }, preview: true })).toBe(30 * MINUTE)
    expect(castSwapJobBudgetMs({ videoUrl: "https://x.test/clip.mp4" })).toBe(120 * MINUTE)
    expect(castSwapJobBudgetMs({ preview: true })).toBe(30 * MINUTE)
  })

  it("face masking \"always\" is 345 min, \"auto\" 435 min (each with the Precise upscale's 15 and the face check's ladder of 180)", () => {
    expect(CAST_SWAP_MASK_ALWAYS_BUDGET_MS).toBe(ALWAYS)
    expect(CAST_SWAP_MASK_AUTO_BUDGET_MS).toBe(AUTO)
    expect(castSwapJobBudgetMs({ faceMasking: { mode: "always" } })).toBe(ALWAYS)
    expect(castSwapJobBudgetMs({ faceMasking: { mode: "auto", padding: 0.2 } })).toBe(AUTO)
  })

  it("a masked preview takes the masking bound — its mask jobs and retry child run all the same", () => {
    expect(castSwapJobBudgetMs({ preview: true, faceMasking: { mode: "always" } })).toBe(ALWAYS)
    expect(castSwapJobBudgetMs({ preview: true, faceMasking: { mode: "auto" } })).toBe(AUTO)
  })

  it("an unreadable faceMasking reads as off", () => {
    for (const faceMasking of [null, "always", "auto", 1, true, [], {}, { mode: "ALWAYS" }, { mode: 1 }, { mode: null }, { mode: "sometimes" }]) {
      expect(castSwapJobBudgetMs({ faceMasking })).toBe(120 * MINUTE)
      expect(castSwapJobBudgetMs({ faceMasking, preview: true })).toBe(30 * MINUTE)
    }
  })

  it("a trend run's saved input_data (`__faceMasking`) is read when `faceMasking` is absent", () => {
    expect(castSwapJobBudgetMs({ __faceMasking: { mode: "always" } })).toBe(ALWAYS)
    expect(castSwapJobBudgetMs({ __faceMasking: { mode: "auto" }, preview: true })).toBe(AUTO)
    expect(castSwapJobBudgetMs({ __faceMasking: { mode: "off" } })).toBe(120 * MINUTE)
    expect(castSwapJobBudgetMs({ __faceMasking: "auto", preview: true })).toBe(30 * MINUTE)
    // `faceMasking` present wins, even when it reads as off.
    expect(castSwapJobBudgetMs({ faceMasking: { mode: "off" }, __faceMasking: { mode: "auto" } })).toBe(120 * MINUTE)
    expect(castSwapJobBudgetMs({ faceMasking: { mode: "always" }, __faceMasking: { mode: "auto" } })).toBe(ALWAYS)
    expect(declaredJobBudgetMs("cast-swap", { __faceMasking: { mode: "auto" } })).toBe(AUTO)
  })

  it("a depth-reference run takes the \"auto\" bound — it may edit again after a refusal (mask, then a second edit)", () => {
    // A direct Motion run.
    expect(castSwapJobBudgetMs({ style: "motion" })).toBe(AUTO)
    expect(castSwapJobBudgetMs({ style: "motion", preview: true })).toBe(AUTO)
    expect(declaredJobBudgetMs("cast-swap", { style: "motion" })).toBe(AUTO)
    expect(castSwapJobBudgetMs({ style: "motion", faceMasking: { mode: "always" } })).toBe(AUTO)
    // A Precise run with an art style that the route makes the Flex way keeps its style: its Full depth (or, on the
    // original path, its style-only mark) gives it the Flex run's bound, as `style: "motion"` gave it before.
    expect(castSwapJobBudgetMs({ faceMasking: { mode: "always", source: "full-depth" } })).toBe(AUTO)
    expect(castSwapJobBudgetMs({ styleOnly: "original", promptStyle: "flexible" })).toBe(castSwapJobBudgetMs({ style: "motion", styleOnly: "original" }))
    expect(castSwapJobBudgetMs({ styleOnly: "original" })).toBe(AUTO)
    // A full-depth trend run: the queue payload, and its saved input_data.
    expect(castSwapJobBudgetMs({ faceMasking: { mode: "always", source: "full-depth" } })).toBe(AUTO)
    expect(castSwapJobBudgetMs({ __faceMasking: { mode: "always", source: "full-depth" }, preview: true })).toBe(AUTO)
    expect(declaredJobBudgetMs("cast-swap-full-quality", { __faceMasking: { mode: "always", source: "full-depth" } })).toBe(AUTO)
  })

  it("a faces or keep-people trend run keeps its mode's bound", () => {
    for (const source of ["faces", "keep-people", undefined, "FULL-DEPTH", 1]) {
      expect(castSwapJobBudgetMs({ faceMasking: { mode: "always", source } })).toBe(ALWAYS)
      expect(castSwapJobBudgetMs({ __faceMasking: { mode: "always", source } })).toBe(ALWAYS)
    }
    // `faceMasking` present wins over the saved one.
    expect(castSwapJobBudgetMs({ faceMasking: { mode: "always" }, __faceMasking: { mode: "always", source: "full-depth" } })).toBe(ALWAYS)
  })

  it("Precise (or no style, or an unreadable one) leaves the budget exactly as it was", () => {
    for (const style of ["precise", undefined, "MOTION", 1, null, {}]) {
      expect(castSwapJobBudgetMs({ style })).toBe(120 * MINUTE)
      expect(castSwapJobBudgetMs({ style, preview: true })).toBe(30 * MINUTE)
      expect(castSwapJobBudgetMs({ style, faceMasking: { mode: "always" } })).toBe(ALWAYS)
      expect(castSwapJobBudgetMs({ style, faceMasking: { mode: "auto" } })).toBe(AUTO)
    }
  })

  it("the Full Quality redo and the registry read face masking too", () => {
    expect(declaredJobBudgetMs("cast-swap", { faceMasking: { mode: "always" } })).toBe(ALWAYS)
    expect(declaredJobBudgetMs("cast-swap-full-quality", { faceMasking: { mode: "auto" } })).toBe(AUTO)
  })

  it("a full clip exceeds the 90-minute default — the reason it declares one at all", () => {
    expect(CAST_SWAP_FULL_BUDGET_MS).toBeGreaterThan(NODE_TIMEOUT_MS)
  })

  it("a full clip's bound covers the default heartbeat plus the Precise upscale's wait", () => {
    expect(CAST_SWAP_PRECISE_UPSCALE_WAIT_MS).toBe(15 * MINUTE)
    expect(CAST_SWAP_FULL_BUDGET_MS).toBeGreaterThanOrEqual(NODE_TIMEOUT_MS + CAST_SWAP_PRECISE_UPSCALE_WAIT_MS)
    expect(CAST_SWAP_FACE_CHECK_LADDER_MS).toBe(LADDER)
    expect(CAST_SWAP_MASK_ALWAYS_BUDGET_MS).toBe(150 * MINUTE + LADDER + CAST_SWAP_PRECISE_UPSCALE_WAIT_MS)
    expect(CAST_SWAP_MASK_AUTO_BUDGET_MS).toBe(240 * MINUTE + LADDER + CAST_SWAP_PRECISE_UPSCALE_WAIT_MS)
  })

  it("a run naming a target but recording no wait adds the engine's 45-minute cap to the preview and full-clip bounds and the masked ones", () => {
    for (const t of ["720p", "1080p", "4k"]) {
      expect(castSwapJobBudgetMs({ preview: true, preciseUpscale: t })).toBe(75 * MINUTE)
      expect(castSwapJobBudgetMs({ preciseUpscale: t })).toBe(165 * MINUTE)
      expect(castSwapJobBudgetMs({ preview: true, __castSwapPreciseUpscale: t })).toBe(75 * MINUTE)
      expect(declaredJobBudgetMs("cast-swap-full-quality", { __castSwapPreciseUpscale: t })).toBe(165 * MINUTE)
      expect(castSwapJobBudgetMs({ preciseUpscale: t, faceMasking: { mode: "always" } })).toBe(195 * MINUTE + LADDER)
      expect(castSwapJobBudgetMs({ preciseUpscale: t, faceMasking: { mode: "auto" } })).toBe(285 * MINUTE + LADDER)
    }
  })

  it("a recorded wait (queued or stored) is rounded up to whole minutes, at most 45, on every bound", () => {
    // 21.2 minutes waits 22 one-minute slices.
    const wait = 21.2 * MINUTE
    const rounded = 22 * MINUTE
    for (const rec of [{ preciseUpscaleWaitMs: wait }, { __castSwapUpscaleWaitMs: wait }]) {
      expect(castSwapJobBudgetMs({ preview: true, preciseUpscale: "4k", ...rec })).toBe(30 * MINUTE + rounded)
      expect(castSwapJobBudgetMs({ ...rec })).toBe(120 * MINUTE + rounded)
      expect(castSwapJobBudgetMs({ faceMasking: { mode: "always" }, ...rec })).toBe(150 * MINUTE + LADDER + rounded)
      expect(castSwapJobBudgetMs({ faceMasking: { mode: "auto" }, ...rec })).toBe(240 * MINUTE + LADDER + rounded)
      expect(castSwapJobBudgetMs({ style: "motion", ...rec })).toBe(240 * MINUTE + LADDER + rounded)
      expect(declaredJobBudgetMs("cast-swap-full-quality", { __castSwapPreciseUpscale: "4k", ...rec })).toBe(120 * MINUTE + rounded)
    }
    // A whole-minute wait is kept as it is; the queued wait wins over the stored one; past the cap it counts 45 min.
    expect(castSwapJobBudgetMs({ preciseUpscaleWaitMs: 10 * MINUTE, __castSwapUpscaleWaitMs: 30 * MINUTE })).toBe(130 * MINUTE)
    expect(castSwapJobBudgetMs({ preciseUpscaleWaitMs: 90 * MINUTE })).toBe(120 * MINUTE + CAST_SWAP_PRECISE_UPSCALE_MAX_WAIT_MS)
    expect(CAST_SWAP_PRECISE_UPSCALE_MAX_WAIT_MS).toBe(45 * MINUTE)
    expect(castSwapJobBudgetMs({ faceMasking: { mode: "auto" }, __castSwapUpscaleWaitMs: 2 * 60 * MINUTE })).toBe(285 * MINUTE + LADDER)
  })

  it("a wait that is not a positive number is no recorded wait", () => {
    for (const v of [0, -5, "600000", null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(castSwapJobBudgetMs({ preciseUpscaleWaitMs: v })).toBe(120 * MINUTE)
      expect(castSwapJobBudgetMs({ preview: true, preciseUpscale: "1080p", __castSwapUpscaleWaitMs: v })).toBe(75 * MINUTE)
      expect(castSwapJobBudgetMs({ faceMasking: { mode: "always" }, preciseUpscaleWaitMs: v })).toBe(ALWAYS)
    }
  })

  it("a run without the step, or with a value that is no Topaz target, keeps the preview and full-clip bounds exactly", () => {
    for (const v of [undefined, null, "off", "8k", true, 1080, {}]) {
      expect(castSwapJobBudgetMs({ preview: true, preciseUpscale: v })).toBe(30 * MINUTE)
      expect(castSwapJobBudgetMs({ preciseUpscale: v, __castSwapPreciseUpscale: v })).toBe(120 * MINUTE)
      // A masked run keeps the flat 15 minutes.
      expect(castSwapJobBudgetMs({ preciseUpscale: v, faceMasking: { mode: "always" } })).toBe(ALWAYS)
    }
  })

  it("is registered under its job name", () => {
    expect(declaredJobBudgetMs("cast-swap", {})).toBe(120 * MINUTE)
    expect(declaredJobBudgetMs("cast-swap", { preview: true })).toBe(30 * MINUTE)
  })

  it("the Full Quality redo (`cast-swap-full-quality`) declares the same full-clip bound", () => {
    expect(declaredJobBudgetMs("cast-swap-full-quality", {})).toBe(120 * MINUTE)
    expect(declaredJobBudgetMs("cast-swap-full-quality", { fullQualityOf: "job-1" })).toBe(120 * MINUTE)
  })
})

/**
 * A long clip (decided 2026-11-25 and 2026-11-27): a source of 30 s to 2 minutes the engine runs in parts and joins,
 * its plan queued as `longClip` and stored hidden as `__longClip`. Its job takes its run shape's bound plus the plan
 * over the whole clip (10 + 6 min) and the join (15 min); the parts run at once, so one run's bound covers them.
 */
describe("cast-swap job budget: a long clip", () => {
  /** The route's plan of a 2-minute source at 24 fps: 5 parts of 24 s. */
  const PLAN = { v: 1, sourceSec: 120, videoSec: 120, fps: 24, byFrame: true, parts: [0, 1, 2, 3, 4].map((k) => ({ startFrame: k * 576, frames: 576, startSec: k * 24, sec: 24 })) }
  /** A 31 s source: 2 parts. */
  const SHORT_PLAN = { v: 1, sourceSec: 31, videoSec: 31, fps: 25, byFrame: true, parts: [{ startFrame: 0, frames: 388 }, { startFrame: 388, frames: 387 }] }

  it("adds 31 minutes: the plan over the whole clip and the join", () => {
    expect(CAST_SWAP_LONG_CLIP_MS).toBe(31 * MINUTE)
  })

  it("adds them to the bound its run shape takes, the slowest part being one run's bound whatever the part count", () => {
    for (const plan of [PLAN, SHORT_PLAN]) {
      expect(castSwapJobBudgetMs({ longClip: plan })).toBe(151 * MINUTE)
      expect(castSwapJobBudgetMs({ longClip: plan, faceMasking: { mode: "always" } })).toBe(ALWAYS + 31 * MINUTE)
      expect(castSwapJobBudgetMs({ longClip: plan, faceMasking: { mode: "auto" } })).toBe(AUTO + 31 * MINUTE)
    }
  })

  it("keeps the one upscale of the joined take: the wait the route recorded, else the cap for a named target", () => {
    expect(castSwapJobBudgetMs({ longClip: PLAN, preciseUpscale: "4k", preciseUpscaleWaitMs: 44 * MINUTE + 1 })).toBe((120 + 45 + 31) * MINUTE)
    expect(castSwapJobBudgetMs({ longClip: PLAN, preciseUpscale: "1080p" })).toBe((120 + 45 + 31) * MINUTE)
    expect(castSwapJobBudgetMs({ __longClip: PLAN, __castSwapPreciseUpscale: "1080p", __castSwapUpscaleWaitMs: 20 * MINUTE })).toBe((120 + 20 + 31) * MINUTE)
  })

  it("reads the stored plan (`__longClip`) when the queued one is absent, as a row reader passes input_data", () => {
    expect(castSwapJobBudgetMs({ __longClip: PLAN })).toBe(151 * MINUTE)
    expect(declaredJobBudgetMs("cast-swap", { __longClip: PLAN, faceMasking: { mode: "always" } })).toBe(ALWAYS + 31 * MINUTE)
    expect(declaredJobBudgetMs("cast-swap", { longClip: PLAN })).toBe(151 * MINUTE)
  })

  it("a preview or a plan the engine would not make adds nothing: the bound is exactly today's", () => {
    expect(castSwapJobBudgetMs({ longClip: PLAN, preview: true })).toBe(30 * MINUTE)
    const broken: unknown[] = [
      null,
      "plan",
      [],
      {},
      { ...PLAN, v: 2 },
      { ...PLAN, sourceSec: 0 },
      { ...PLAN, videoSec: "120" },
      { ...PLAN, fps: Number.NaN },
      { ...PLAN, byFrame: "yes" },
      { ...PLAN, parts: PLAN.parts.slice(0, 1) },
      { ...PLAN, parts: "5" },
      { ...PLAN, parts: [PLAN.parts[0], { startFrame: 600, frames: 576 }] },
      { ...PLAN, parts: [PLAN.parts[0], { startFrame: 576, frames: 0 }] },
      { ...PLAN, parts: [PLAN.parts[0], null] },
    ]
    for (const plan of broken) {
      expect(castSwapJobBudgetMs({ longClip: plan }), JSON.stringify(plan)).toBe(120 * MINUTE)
      expect(castSwapJobBudgetMs({ __longClip: plan, faceMasking: { mode: "always" } }), JSON.stringify(plan)).toBe(ALWAYS)
    }
    // A queued key that is present decides, as `faceMasking` does over `__faceMasking`.
    expect(castSwapJobBudgetMs({ longClip: null, __longClip: PLAN })).toBe(120 * MINUTE)
  })
})
