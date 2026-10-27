/**
 * A trend's stored face mask (lib/trends/face-mask.ts): what ties it to what
 * it was made from, when it is out of date, and what a run sends of it. The
 * routes that make, approve and clear one are pinned in
 * routes/__tests__/admin-trends.test.ts.
 */
import { describe, expect, it } from "vitest"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"
import { withResolvedZone } from "../../../../lib/cast-swap-face-masking.js"
import type { EngineEnvironment } from "../../engine-environments.js"
import {
  faceMaskBaseKey,
  faceMaskBaseStats,
  faceMaskHasErasedMarks,
  faceMaskMarksMatch,
  faceMaskSettingsKey,
  faceMaskSettingsKeyOf,
  faceMaskState,
  faceMaskStats,
  pendingFaceMaskJob,
  reusableFaceMaskBase,
  storedFaceMaskFor,
} from "../face-mask.js"
import { publishBlockers } from "../publish-check.js"
import type { TrendFaceMask, TrendVersionData, TrendPreviewClip } from "../types.js"

const SRC = "https://cdn.example/trends/t1/src.mp4"
/**
 * A preview input clip current for the fixture's source at start 0, carrying
 * the matching cut of the data's current stored face mask when it has one:
 * publishing needs one (preview-clip.test.ts holds its rules).
 */
function previewClipFor(d: Pick<TrendVersionData, "source" | "faceMasking" | "faceMask">): TrendPreviewClip {
  const mask = storedFaceMaskFor(d)
  return {
    videoUrl: "https://cdn.example/trends/t1/preview.mp4", durationSec: 5, width: 240, height: 320, frames: 150, sha256: "a".repeat(64),
    sourceVideoUrl: SRC, startSec: 0, recipe: "1", madeAt: "2026-10-27T10:00:00.000Z",
    ...(mask ? { faceMask: { url: "https://cdn.example/trends/t1/preview-mask.mp4", frames: 150, sha256: "b".repeat(64), sourceMaskUrl: mask.url } } : {}),
  }
}
const MASKING = { mode: "always" as const, threshold: 0.4 }

function data(over: Partial<TrendVersionData> = {}): TrendVersionData {
  return withClip({
    name: { en: "Dance" },
    // A complete source: publishing also needs its display copy (source_display_missing).
    source: {
      videoUrl: SRC,
      durationSec: 12,
      display: { videoUrl: "https://cdn.example/display.mp4", posterUrl: "https://cdn.example/poster.png", width: 240, height: 320, durationSec: 12 },
    },
    previewStart: 0,
    slots: [{ key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the woman" }],
    references: [],
    examples: [{ videoUrl: "https://cdn.example/ex.mp4", width: 720, height: 1280, durationSec: 12, sourceJobId: "j", slots: { lead: ["https://cdn.example/l.png"] } }],
    faceMasking: MASKING,
    ...over,
  })
}

/** `d` with a preview input clip current for it (its mask's cut when it has a current mask). */
const withClip = (d: TrendVersionData): TrendVersionData => ({ ...d, previewClip: previewClipFor(d) })

function mask(over: Partial<TrendFaceMask> = {}): TrendFaceMask {
  return {
    url: "https://cdn.example/trends/t1/mask.mp4",
    frames: 360,
    recipe: { core: VIDEO_MASK_RECIPE, plugin: "1" },
    settingsKey: faceMaskSettingsKey(data())!,
    jobId: "job-1",
    stats: { shots: 2, heldFrames: 0, coverage: 0.02, droppedRegions: 0 },
    approvedAt: "2026-10-25T10:00:00.000Z",
    approvedBy: "admin",
    ...over,
  }
}

const ALL = {
  roleKinds: ["person"] as Array<"person">,
  fixedReferences: true,
  fullQuality: true,
  resolutions: ["480p", "720p", "1080p"] as Array<"480p" | "720p" | "1080p">,
  trendRun: true,
  faceMasking: true,
  storedFaceMask: true,
  faceMaskRecipe: "1",
}
const env = (name: string, castSwap: Record<string, unknown> = ALL): EngineEnvironment => ({
  env: name,
  pluginBuildId: "b",
  supports: { castSwap: castSwap as never },
  updatedAt: "2026-10-25T00:00:00Z",
})
const ENVS = [env("staging"), env("production")]
const REQUIRED = ["staging", "production"]

describe("faceMaskSettingsKey", () => {
  it("is the same for the setting as stored and as a run sends it (zone resolved), whatever the key order", () => {
    const key = faceMaskSettingsKeyOf(SRC, MASKING)
    expect(faceMaskSettingsKeyOf(SRC, withResolvedZone(MASKING))).toBe(key)
    expect(faceMaskSettingsKeyOf(SRC, { threshold: 0.4, mode: "always" })).toBe(key)
    expect(faceMaskSettingsKey(data())).toBe(key)
  })

  it("changes with the source clip and with any setting that changes the mask", () => {
    const key = faceMaskSettingsKeyOf(SRC, MASKING)
    expect(faceMaskSettingsKeyOf("https://cdn.example/other.mp4", MASKING)).not.toBe(key)
    expect(faceMaskSettingsKeyOf(SRC, { ...MASKING, threshold: 0.5 })).not.toBe(key)
    expect(faceMaskSettingsKeyOf(SRC, { ...MASKING, fill: "depth" })).not.toBe(key)
    // No margins is not the default margins.
    expect(faceMaskSettingsKeyOf(SRC, { ...MASKING, zone: null })).not.toBe(key)
  })

  it("leaves the mode out: always and auto mask the same clip", () => {
    const key = faceMaskSettingsKeyOf(SRC, MASKING)
    expect(faceMaskSettingsKeyOf(SRC, { ...MASKING, mode: "auto" })).toBe(key)
    expect(key.startsWith("v2:")).toBe(true)
  })

  it("hashes as before the target existed when the masks cover heads (left out or named), so approved masks stay valid", () => {
    // Pinned literals: the keys of every mask approved before `target` (all heads). A change here
    // makes every approved mask out of date; that is a decision, never a refactor.
    const PINNED = "v2:30fe1719eed0a90b8414b6daa6687eec33939a17d106d8bdd5ec2b1b278f8e07"
    expect(faceMaskSettingsKeyOf(SRC, MASKING)).toBe(PINNED)
    expect(faceMaskSettingsKeyOf(SRC, { ...MASKING, target: "head" })).toBe(PINNED)
    expect(faceMaskSettingsKeyOf(SRC, withResolvedZone({ ...MASKING, target: "head" }))).toBe(PINNED)
    const NO_MARGINS = "v2:b2684dd62a46298a370db5b03d244da8a6e5c246e98727217377415a3886dfc5"
    expect(faceMaskSettingsKeyOf(SRC, { mode: "auto", fill: "depth", zone: null })).toBe(NO_MARGINS)
    expect(faceMaskSettingsKeyOf(SRC, { mode: "auto", fill: "depth", zone: null, target: "head" })).toBe(NO_MARGINS)
  })

  it("changes between face and head: a mask of heads is out of date for a trend that masks faces, and back", () => {
    const head = faceMaskSettingsKeyOf(SRC, MASKING)
    const face = faceMaskSettingsKeyOf(SRC, { ...MASKING, target: "face" })
    expect(face).not.toBe(head)
    expect(face.startsWith("v2:")).toBe(true)
    expect(faceMaskSettingsKeyOf(SRC, { ...MASKING, mode: "auto", target: "face" })).toBe(face)
    expect(faceMaskState(data({ faceMask: mask(), faceMasking: { ...MASKING, target: "face" } }), ENVS, REQUIRED).reasons).toEqual([{ why: "settings" }])
    expect(faceMaskState(data({ faceMask: mask(), faceMasking: { ...MASKING, target: "head" } }), ENVS, REQUIRED).status).toBe("approved")
  })

  it("is null with no source clip or no masking", () => {
    expect(faceMaskSettingsKey(data({ source: null }))).toBeNull()
    expect(faceMaskSettingsKey(data({ faceMasking: { mode: "off" } }))).toBeNull()
    expect(faceMaskSettingsKey(data({ faceMasking: undefined }))).toBeNull()
  })
})

describe("faceMaskState", () => {
  it("none, approved, and out of date for each reason", () => {
    expect(faceMaskState(data(), ENVS, REQUIRED)).toEqual({ status: "none", reasons: [] })
    expect(faceMaskState(data({ faceMask: mask() }), ENVS, REQUIRED)).toEqual({ status: "approved", reasons: [] })
    expect(faceMaskState(data({ faceMask: mask(), faceMasking: { ...MASKING, threshold: 0.6 } }), ENVS, REQUIRED).reasons).toEqual([{ why: "settings" }])
    expect(faceMaskState(data({ faceMask: mask(), source: { videoUrl: "https://cdn.example/new.mp4", durationSec: 10 } }), ENVS, REQUIRED).reasons).toEqual([
      { why: "settings" },
    ])
    expect(faceMaskState(data({ faceMask: mask({ recipe: { core: null, plugin: "1" } }) }), ENVS, REQUIRED).reasons).toEqual([{ why: "core_recipe" }])
    expect(faceMaskState(data({ faceMask: mask() }), [env("staging"), env("production", { ...ALL, faceMaskRecipe: "2" })], REQUIRED)).toEqual({
      status: "out_of_date",
      reasons: [{ why: "plugin_recipe", env: "production" }],
    })
  })

  it("leaves the engine recipes unchecked when the environments are unknown, or an environment cannot hold a stored mask", () => {
    expect(faceMaskState(data({ faceMask: mask() }), null, REQUIRED).status).toBe("approved")
    const states = faceMaskState(data({ faceMask: mask() }), [env("production", { ...ALL, storedFaceMask: false, faceMaskRecipe: "9" })], REQUIRED)
    expect(states.status).toBe("approved")
  })
})

describe("storedFaceMaskFor", () => {
  it("sends the mask only while it was made from these settings", () => {
    expect(storedFaceMaskFor(data({ faceMask: mask() }))).toEqual({ url: mask().url, frames: 360 })
    expect(storedFaceMaskFor(data({ faceMask: mask(), faceMasking: { ...MASKING, fill: "depth" } }))).toBeUndefined()
    expect(storedFaceMaskFor(data({ faceMask: mask(), faceMasking: { mode: "off" } }))).toBeUndefined()
    expect(storedFaceMaskFor(data())).toBeUndefined()
  })
})

describe("pendingFaceMaskJob", () => {
  it("is the job being made, current while the draft's settings are the ones it was started for", () => {
    const job = { jobId: "j", settingsKey: faceMaskSettingsKey(data())!, startedAt: "2026-10-25T09:00:00.000Z" }
    expect(pendingFaceMaskJob(data())).toBeNull()
    expect(pendingFaceMaskJob(data({ faceMaskJob: job }))).toEqual({ jobId: "j", startedAt: job.startedAt, current: true })
    expect(pendingFaceMaskJob(data({ faceMaskJob: job, faceMasking: { ...MASKING, mode: "auto" } }))?.current).toBe(true)
    expect(pendingFaceMaskJob(data({ faceMaskJob: job, faceMasking: { ...MASKING, threshold: 0.6 } }))?.current).toBe(false)
    expect(pendingFaceMaskJob(data({ faceMaskJob: job, faceMasking: { mode: "off" } }))?.current).toBe(false)
  })
})

describe("faceMaskStats", () => {
  it("is a number for each stat, 0 where the engine left one out or sent nonsense", () => {
    expect(faceMaskStats({ shots: 3, heldFrames: 4, coverage: 0.5, droppedRegions: 2 })).toEqual({ shots: 3, heldFrames: 4, coverage: 0.5, droppedRegions: 2 })
    expect(faceMaskStats({ shots: "3", heldFrames: -1 })).toEqual({ shots: 0, heldFrames: 0, coverage: 0, droppedRegions: 0 })
    expect(faceMaskStats(undefined)).toEqual({ shots: 0, heldFrames: 0, coverage: 0, droppedRegions: 0 })
  })

  it("carries erasedRegions only when the engine reports it", () => {
    expect(faceMaskStats({ shots: 1, heldFrames: 0, coverage: 0.1, droppedRegions: 0, erasedRegions: 7 })).toEqual({
      shots: 1, heldFrames: 0, coverage: 0.1, droppedRegions: 0, erasedRegions: 7,
    })
    expect(faceMaskStats({ erasedRegions: "x" })).toMatchObject({ erasedRegions: 0 })
  })

  it("faceMaskBaseStats: the raw mask's four stats, or undefined when the engine sent none", () => {
    expect(faceMaskBaseStats({ shots: 1, heldFrames: 2, coverage: 0.3, droppedRegions: 4, erasedRegions: 9 })).toEqual({ shots: 1, heldFrames: 2, coverage: 0.3, droppedRegions: 4 })
    expect(faceMaskBaseStats(undefined)).toBeUndefined()
    expect(faceMaskBaseStats([1])).toBeUndefined()
  })
})

const MARK = { label: "erased" as const, fromFrame: 0, toFrame: 359, leftPct: 60, topPct: 10, rightPct: 90, bottomPct: 50 }
const MARK2 = { label: "erased" as const, fromFrame: 30, toFrame: 60, leftPct: 0, topPct: 0, rightPct: 20, bottomPct: 20 }

describe("marks", () => {
  it("hash exactly as before marks existed when there are none (absent or empty): every approved mask stays up to date", () => {
    // The pinned pre-marks keys (see the target test above): a change here outdates every approved mask.
    const PINNED = "v2:30fe1719eed0a90b8414b6daa6687eec33939a17d106d8bdd5ec2b1b278f8e07"
    expect(faceMaskSettingsKeyOf(SRC, { ...MASKING, marks: [] })).toBe(PINNED)
    expect(faceMaskSettingsKeyOf(SRC, { ...MASKING, target: "head", marks: [] })).toBe(PINNED)
    const NO_MARGINS = "v2:b2684dd62a46298a370db5b03d244da8a6e5c246e98727217377415a3886dfc5"
    expect(faceMaskSettingsKeyOf(SRC, { mode: "auto", fill: "depth", zone: null, marks: [] })).toBe(NO_MARGINS)
    expect(faceMaskState(data({ faceMask: mask(), faceMasking: { ...MASKING, marks: [] } }), ENVS, REQUIRED).status).toBe("approved")
  })

  it("change the key when there are some, in any order the same; the base key is the key without them", () => {
    const plain = faceMaskSettingsKeyOf(SRC, MASKING)
    const one = faceMaskSettingsKeyOf(SRC, { ...MASKING, marks: [MARK] })
    expect(one).not.toBe(plain)
    expect(one.startsWith("v2:")).toBe(true)
    expect(faceMaskSettingsKeyOf(SRC, { ...MASKING, marks: [MARK, MARK2] })).toBe(faceMaskSettingsKeyOf(SRC, { ...MASKING, marks: [MARK2, MARK] }))
    expect(faceMaskSettingsKeyOf(SRC, { ...MASKING, marks: [{ ...MARK, toFrame: 358 }] })).not.toBe(one)
    const marked = data({ faceMasking: { ...MASKING, marks: [MARK] } })
    expect(faceMaskSettingsKey(marked)).toBe(one)
    expect(faceMaskBaseKey(marked)).toBe(plain)
    expect(faceMaskBaseKey(data())).toBe(plain)
    expect(faceMaskBaseKey(data({ source: null }))).toBeNull()
    expect(faceMaskHasErasedMarks(marked)).toBe(true)
    expect(faceMaskHasErasedMarks(data({ faceMasking: { ...MASKING, marks: [] } }))).toBe(false)
    expect(faceMaskHasErasedMarks(data({ faceMasking: { mode: "off", marks: [MARK] } }))).toBe(false)
    // An approved mask without the marks is out of date once they are added.
    expect(faceMaskState({ ...marked, faceMask: mask() }, ENVS, REQUIRED).reasons).toEqual([{ why: "settings" }])
    expect(storedFaceMaskFor({ ...marked, faceMask: mask() })).toBeUndefined()
  })

  it("slot marks never touch the base: a draft with slot marks alone keys, bases and approves exactly as one with none", () => {
    const SLOT_MARK = { ...MARK, label: { slot: "friend" } }
    const PINNED = "v2:30fe1719eed0a90b8414b6daa6687eec33939a17d106d8bdd5ec2b1b278f8e07"
    expect(faceMaskSettingsKeyOf(SRC, { ...MASKING, marks: [SLOT_MARK] })).toBe(PINNED)
    expect(faceMaskSettingsKeyOf(SRC, { ...MASKING, marks: [SLOT_MARK, MARK] })).toBe(faceMaskSettingsKeyOf(SRC, { ...MASKING, marks: [MARK] }))
    const slotOnly = data({ faceMasking: { ...MASKING, marks: [SLOT_MARK] } })
    expect(faceMaskHasErasedMarks(slotOnly)).toBe(false)
    expect(faceMaskState({ ...slotOnly, faceMask: mask() }, ENVS, REQUIRED).status).toBe("approved")
    expect(storedFaceMaskFor({ ...slotOnly, faceMask: mask() })).toEqual({ url: mask().url, frames: 360 })
  })

  it("faceMaskMarksMatch: the job's recorded marks are the draft's, in any order (absent = none)", () => {
    expect(faceMaskMarksMatch(undefined, [])).toBe(true)
    expect(faceMaskMarksMatch([], [])).toBe(true)
    expect(faceMaskMarksMatch([MARK2, MARK], [MARK, MARK2])).toBe(true)
    // An engine that dropped the marks recorded none.
    expect(faceMaskMarksMatch(undefined, [MARK])).toBe(false)
    expect(faceMaskMarksMatch([MARK], [])).toBe(false)
    expect(faceMaskMarksMatch([{ ...MARK, leftPct: 61 }], [MARK])).toBe(false)
    expect(faceMaskMarksMatch("nonsense", [])).toBe(false)
  })
})

describe("reusableFaceMaskBase", () => {
  const base = (over: Partial<TrendFaceMask> = {}) =>
    mask({ rawMaskUrl: "https://cdn.example/trends/t1/raw.mp4", baseKey: faceMaskBaseKey(data())!, ...over })
  const marked = (faceMask: TrendFaceMask, masking: TrendVersionData["faceMasking"] = { ...MASKING, marks: [MARK] }) =>
    data({ faceMasking: masking, faceMask })

  it("is the approved mask's raw mask with its core recipe and the raw mask's stats, so the engine records them again", () => {
    const baseStats = { shots: 2, heldFrames: 1, coverage: 0.05, droppedRegions: 3 }
    expect(reusableFaceMaskBase(marked(base({ baseStats, stats: { ...baseStats, coverage: 0.02, erasedRegions: 4 } })), "1")).toEqual({
      maskUrl: "https://cdn.example/trends/t1/raw.mp4",
      recipe: VIDEO_MASK_RECIPE,
      stats: baseStats,
    })
    // Marks taken away again: the same base.
    expect(reusableFaceMaskBase(marked(base(), MASKING), "1")?.maskUrl).toBe("https://cdn.example/trends/t1/raw.mp4")
  })

  it("without baseStats (approved before them): its own stats stand in when nothing was erased, else it is no base", () => {
    const plain = { shots: 2, heldFrames: 1, coverage: 0.05, droppedRegions: 3 }
    expect(reusableFaceMaskBase(marked(base({ stats: plain })), "1")?.stats).toEqual(plain)
    expect(reusableFaceMaskBase(marked(base({ stats: { ...plain, erasedRegions: 0 } })), "1")?.stats).toEqual(plain)
    // Its coverage is the erased mask's, not the raw one's: a whole make instead.
    expect(reusableFaceMaskBase(marked(base({ stats: { ...plain, erasedRegions: 2 } })), "1")).toBeUndefined()
  })

  it("adds the depth view for a depth fill, and is none without one", () => {
    const depth = { ...MASKING, fill: "depth" as const, marks: [MARK] }
    const baseKey = faceMaskBaseKey(data({ faceMasking: depth }))!
    expect(reusableFaceMaskBase(marked(base({ baseKey, depthUrl: "https://cdn.example/d.mp4" }), depth), "1")).toMatchObject({
      maskUrl: "https://cdn.example/trends/t1/raw.mp4",
      depthUrl: "https://cdn.example/d.mp4",
    })
    expect(reusableFaceMaskBase(marked(base({ baseKey }), depth), "1")).toBeUndefined()
    // A blur fill never sends a depth view, even one kept.
    expect(reusableFaceMaskBase(marked(base({ depthUrl: "https://cdn.example/d.mp4" })), "1")).not.toHaveProperty("depthUrl")
  })

  it("is none for a mask without a raw mask, made from other base settings, or by another masking", () => {
    expect(reusableFaceMaskBase(marked(mask()), "1")).toBeUndefined()
    expect(reusableFaceMaskBase(marked(base({ baseKey: "v2:other" })), "1")).toBeUndefined()
    expect(reusableFaceMaskBase(marked(base(), { ...MASKING, threshold: 0.6, marks: [MARK] }), "1")).toBeUndefined()
    expect(reusableFaceMaskBase(marked(base({ recipe: { core: null, plugin: "1" } })), "1")).toBeUndefined()
    expect(reusableFaceMaskBase(marked(base()), "2")).toBeUndefined()
    expect(reusableFaceMaskBase(marked(base()), undefined)).toBeUndefined()
    expect(reusableFaceMaskBase(data({ faceMasking: { mode: "off" }, faceMask: base() }), "1")).toBeUndefined()
  })
})

describe("publishBlockers — a masked trend", () => {
  it("needs an approved, up-to-date mask and engines that take one", () => {
    expect(publishBlockers(data({ faceMask: mask() }), ENVS, REQUIRED)).toEqual([])
    expect(publishBlockers(data(), ENVS, REQUIRED)).toEqual([{ code: "face_mask_missing", message: expect.any(String) }])
    expect(publishBlockers(data({ faceMask: mask({ recipe: { core: "old", plugin: "1" } }) }), ENVS, REQUIRED)).toEqual([
      { code: "face_mask_out_of_date", why: "core_recipe", message: expect.any(String) },
    ])
    expect(publishBlockers(data({ faceMask: mask() }), [env("staging"), env("production", { ...ALL, storedFaceMask: undefined })], REQUIRED)).toEqual([
      { code: "engine_unsupported", env: "production", need: "storedFaceMask" },
    ])
  })

  it("needs every environment's engine to mask the face alone when the trend's masks cover the face only", () => {
    const FACE = { ...MASKING, target: "face" as const }
    const faceMask = mask({ settingsKey: faceMaskSettingsKey(data({ faceMasking: FACE }))! })
    const FACE_ENGINE = { ...ALL, faceMaskTargets: ["face", "head"] }
    expect(publishBlockers(data({ faceMasking: FACE, faceMask }), [env("staging", FACE_ENGINE), env("production", FACE_ENGINE)], REQUIRED)).toEqual([])
    // An engine that declares no targets masks heads (it strips the target): held back.
    expect(publishBlockers(data({ faceMasking: FACE, faceMask }), [env("staging", FACE_ENGINE), env("production")], REQUIRED)).toEqual([
      { code: "engine_unsupported", env: "production", need: "faceMaskTarget:face" },
    ])
    expect(publishBlockers(data({ faceMasking: FACE, faceMask }), [env("staging", FACE_ENGINE), env("production", { ...ALL, faceMaskTargets: ["head"] })], REQUIRED)).toEqual([
      { code: "engine_unsupported", env: "production", need: "faceMaskTarget:face" },
    ])
  })

  it("needs no target of a head trend (the default, named or not), nor of a trend that does not mask", () => {
    expect(publishBlockers(data({ faceMasking: { ...MASKING, target: "head" }, faceMask: mask() }), ENVS, REQUIRED)).toEqual([])
    expect(publishBlockers(data({ faceMasking: { mode: "off", target: "face" } }), ENVS, REQUIRED)).toEqual([])
  })

  it("needs no mask when the trend does not mask", () => {
    expect(publishBlockers(data({ faceMasking: { mode: "off" } }), ENVS, REQUIRED)).toEqual([])
  })
})

describe("publishBlockers — a Nodaro Motion Pulse trend, whatever ids the engine declares", () => {
  const PULSE = { faceMasking: { mode: "off" as const }, engine: "kling-4" as const }
  it.each([
    ["0.397.0", ["motion-pro", "motion-lite", "seedance-2-5", "kling-4"]],
    ["new ids only", ["motion-prism", "motion-pulse"]],
  ] as const)("publishes on engines that declare %s", (_gen, engines) => {
    const e = { ...ALL, engines, engineAliases: true }
    expect(publishBlockers(data(PULSE), [env("staging", e), env("production", e)], REQUIRED)).toEqual([])
  })

  it("is held back where the engine declares no Pulse", () => {
    const prismOnly = { ...ALL, engines: ["motion-prism"] }
    expect(publishBlockers(data(PULSE), [env("staging", prismOnly), env("production")], REQUIRED)).toEqual([
      { code: "engine_unsupported", env: "staging", need: "kling-4" },
      { code: "engine_unsupported", env: "production", need: "kling-4" },
    ])
  })
})
