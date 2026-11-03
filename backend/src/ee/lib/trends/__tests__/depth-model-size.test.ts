/**
 * The depth model size (`faceMasking.depthModelSize`, decided 2026-11-02):
 * the admin's choice of Video Depth Anything's model size (small, base,
 * large) wherever Nodaro Motion draws depth (Full depth, Keep people, a Faces
 * hidden depth fill, role outlines' gray one too). What must hold:
 *
 *  - nothing stored today changes meaning: absent, `"large"`, an unknown
 *    value and a value where no depth is drawn (a blur fill) all send and hash
 *    exactly as today — the keys below are pinned from before the field
 *    existed (the colormap test's pins);
 *  - a chosen size changes the depth RENDER, so it moves the settings key AND
 *    the base key (unlike the colormap, which only re-colours a gray base),
 *    and role outlines do not fix it;
 *  - it is sent (a run, a make, the settings) only to an engine that lists the
 *    size in `castSwap.depthModelSizes`, and publishing needs that in every
 *    environment.
 */
import { afterEach, describe, expect, it } from "vitest"
import { VIDEO_DEPTH_MODEL_SIZES, VIDEO_MASK_RECIPE } from "@nodaro/shared/media"
import {
  depthModelSizeSent,
  engineDrawsDepthModelSize,
  faceMaskingRunSent,
  faceMaskingSchema,
  faceMaskingSent,
  faceMaskingWithMarksSchema,
  withDepthModelSizeFor,
  withResolvedZone,
  withoutMarks,
  type FaceMaskingWithMarks,
} from "../../../../lib/cast-swap-face-masking.js"
import { nodaroMotionMaskingSchema } from "../../../../lib/nodaro-motion-masking.js"
import { nodaroMotionMotionSchema } from "../../../../lib/nodaro-motion-motion.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../../lib/private-plugins/supports-registry.js"
import type { EngineEnvironment } from "../../engine-environments.js"
import { depthModelSizeOfSetting, environmentsThatCannotDrawModelSizes } from "../../nodaro-motion-depth-model-size.js"
import { composeTrendRun } from "../compose.js"
import { faceMaskBaseKey, faceMaskSettingsKey, faceMaskSettingsKeyOf, storedFaceMaskFor } from "../face-mask.js"
import { depthModelSizeNeed, publishBlockers } from "../publish-check.js"
import { withoutUnsupportedFields } from "../run-helpers.js"
import type { TrendFaceMask, TrendPreviewClip, TrendSlot, TrendVersionData } from "../types.js"

const SRC = "https://cdn.example/trends/t1/src.mp4"
const SLOTS = [
  { key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the woman" },
  { key: "friend", kind: "person", label: { en: "Friend" }, required: false, roleName: "the man" },
] as TrendSlot[]
const box = { fromFrame: 0, toFrame: 10, leftPct: 10, topPct: 10, rightPct: 50, bottomPct: 60 }

/** Every source mode's setting, as stored before the depth model size existed (and the colormap). */
const CASES = {
  facesBlur: { mode: "always", threshold: 0.4 },
  facesDepth: { mode: "always", fill: "depth" },
  facesDepthOutlines: { mode: "always", fill: "depth", roleOutlines: true, marks: [{ label: { slot: "lead" }, ...box }] },
  facesBlurOutlines: { mode: "always", roleOutlines: true, marks: [{ label: { slot: "lead" }, ...box }] },
  fullDepth: { mode: "always", source: "full-depth" },
  fullDepthMesh: { mode: "always", source: "full-depth", faceMesh: true, scene: "original" },
  keepPeople: { mode: "always", source: "keep-people", marks: [{ label: "main", ...box }] },
} satisfies Record<string, FaceMaskingWithMarks>

/** The keys of `CASES`, computed on the platform BEFORE the colormap (and so the model size) existed: they must never move. */
const PINNED: Record<keyof typeof CASES, { key: string; base: string }> = {
  facesBlur: { key: "v2:30fe1719eed0a90b8414b6daa6687eec33939a17d106d8bdd5ec2b1b278f8e07", base: "v2:30fe1719eed0a90b8414b6daa6687eec33939a17d106d8bdd5ec2b1b278f8e07" },
  facesDepth: { key: "v2:caf324b4ef2b25e1e367de6f7e8c512e3738e191763933e03447633dac7bf3d4", base: "v2:caf324b4ef2b25e1e367de6f7e8c512e3738e191763933e03447633dac7bf3d4" },
  facesDepthOutlines: { key: "v2:894d5f0c3d45a1fe2d29706a5408489d50d02fbea904e52421a127557492ff46", base: "v2:25bd5d1baa060766c2f05779bac0a5c89089ab0f1689ce80112475b2ee49afdb" },
  facesBlurOutlines: { key: "v2:b3fd27e67a7edcac724b8be1cde42016fd950189256a3869bab1aeaf4068eea9", base: "v2:b122f075b6f4c385d9200fc2de9d8eb089381eaaabf589f7f564b3d34e927386" },
  fullDepth: { key: "v2:48ded63eef822ffb2e9d69abc51136f9b938b34f682fa3b1efd696559baa1748", base: "v2:48ded63eef822ffb2e9d69abc51136f9b938b34f682fa3b1efd696559baa1748" },
  fullDepthMesh: { key: "v2:d0d8947446d955c568a70ac2a43f514b192da1b7c6fe3d2a6d5878b61ce93726", base: "v2:d0d8947446d955c568a70ac2a43f514b192da1b7c6fe3d2a6d5878b61ce93726" },
  keepPeople: { key: "v2:8fc2232e71e82e0fc10ad29d2d734be7ced66aaf8aa5e2f1beefcf43f2f3c144", base: "v2:3ea73f22cd5dbed291ec845aa8cc942f179aeeeb59bbfa9348d505f70b76eb0d" },
}

const ZONE = { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 }
/** What a make (`faceMaskingSent`) and a run (`faceMaskingRunSent`) were sent of `CASES` before the colormap (and the model size) existed. */
const PINNED_SENT: Record<keyof typeof CASES, { sent: object; run: object }> = {
  facesBlur: { sent: { mode: "always", threshold: 0.4, zone: ZONE }, run: { mode: "always", threshold: 0.4, zone: ZONE } },
  facesDepth: { sent: { mode: "always", fill: "depth", zone: ZONE }, run: { mode: "always", fill: "depth", zone: ZONE } },
  facesDepthOutlines: { sent: { mode: "always", fill: "depth", zone: ZONE }, run: { mode: "always", fill: "depth", zone: ZONE } },
  facesBlurOutlines: { sent: { mode: "always", zone: ZONE }, run: { mode: "always", zone: ZONE } },
  fullDepth: { sent: { mode: "always", source: "full-depth" }, run: { mode: "always", source: "full-depth", scene: "description" } },
  fullDepthMesh: { sent: { mode: "always", source: "full-depth", faceMesh: true }, run: { mode: "always", source: "full-depth", faceMesh: true, scene: "original" } },
  keepPeople: { sent: { mode: "always", zone: ZONE, source: "keep-people", target: "body" }, run: { mode: "always", zone: ZONE, source: "keep-people", target: "body" } },
}

const keyOf = (m: FaceMaskingWithMarks) => faceMaskSettingsKeyOf(SRC, m, SLOTS)
const baseOf = (m: FaceMaskingWithMarks) => faceMaskBaseKey({ source: { videoUrl: SRC, durationSec: 12 }, faceMasking: m })
const entries = Object.entries(CASES) as Array<[keyof typeof CASES, FaceMaskingWithMarks]>
/** The cases that draw depth (every source mode but a blur fill), role outlines' gray fill included. */
const DEPTH_CASES = ["facesDepth", "facesDepthOutlines", "fullDepth", "fullDepthMesh", "keepPeople"] as const
const BLUR_CASES = ["facesBlur", "facesBlurOutlines"] as const

describe("nothing stored today changes meaning", () => {
  it("every source mode's keys are the ones pinned before the model size existed", () => {
    for (const [name, m] of entries) {
      expect(keyOf(m), name).toBe(PINNED[name].key)
      expect(baseOf(m), name).toBe(PINNED[name].base)
      expect(faceMaskingSent(withoutMarks(m)), name).toEqual(PINNED_SENT[name].sent)
      expect(faceMaskingRunSent(withoutMarks(m)), name).toEqual(PINNED_SENT[name].run)
    }
  })

  it("a size that changes no render is the same as none: large (the default), an unknown value, a blur fill", () => {
    const same: Array<[keyof typeof CASES, FaceMaskingWithMarks]> = [
      ...entries.map(([name, m]): [keyof typeof CASES, FaceMaskingWithMarks] => [name, { ...m, depthModelSize: "large" }]),
      // A row that never went through the schema (raw JSON): read as large.
      ...entries.map(([name, m]): [keyof typeof CASES, FaceMaskingWithMarks] => [name, { ...m, depthModelSize: "huge" as never }]),
      ...BLUR_CASES.flatMap((name) => (["small", "base"] as const).map((depthModelSize): [keyof typeof CASES, FaceMaskingWithMarks] => [name, { ...CASES[name], depthModelSize }])),
    ]
    for (const [name, m] of same) {
      const label = `${name} ${String(m.depthModelSize)}`
      expect(depthModelSizeSent(m), label).toBeUndefined()
      expect(keyOf(m), label).toBe(PINNED[name].key)
      expect(baseOf(m), label).toBe(PINNED[name].base)
      expect(faceMaskingSent(withoutMarks(m)), label).toEqual(PINNED_SENT[name].sent)
      expect(faceMaskingRunSent(withoutMarks(m)), label).toEqual(PINNED_SENT[name].run)
      expect(Object.hasOwn(withResolvedZone(withoutMarks(m)), "depthModelSize"), label).toBe(false)
    }
    // Large and a blur fill validate (an unknown value is the schema's to refuse, below).
    expect(faceMaskingWithMarksSchema.safeParse({ ...CASES.keepPeople, depthModelSize: "large" }).success).toBe(true)
    expect(faceMaskingWithMarksSchema.safeParse({ ...CASES.facesBlur, depthModelSize: "small" }).success).toBe(true)
  })
})

describe("the setting", () => {
  it("takes the Video Depth node's model sizes, everywhere a face masking setting is stored", () => {
    expect(VIDEO_DEPTH_MODEL_SIZES).toEqual(["small", "base", "large"])
    for (const depthModelSize of VIDEO_DEPTH_MODEL_SIZES) {
      expect(faceMaskingWithMarksSchema.safeParse({ ...CASES.keepPeople, depthModelSize }).success, depthModelSize).toBe(true)
      expect(faceMaskingWithMarksSchema.safeParse({ ...CASES.facesDepthOutlines, depthModelSize }).success, depthModelSize).toBe(true)
      expect(faceMaskingSchema.safeParse({ mode: "always", fill: "depth", depthModelSize }).success, depthModelSize).toBe(true)
    }
    expect(nodaroMotionMaskingSchema.safeParse({ "motion-prism": { mode: "always", fill: "depth", depthModelSize: "small" } }).success).toBe(true)
    expect(nodaroMotionMotionSchema.safeParse({ "motion-pulse": { masking: { mode: "always", source: "full-depth", depthModelSize: "base" } } }).success).toBe(true)
  })

  it("refuses a size the model does not come in", () => {
    for (const depthModelSize of ["huge", "Small", "", 3]) {
      expect(faceMaskingWithMarksSchema.safeParse({ ...CASES.fullDepth, depthModelSize }).success, String(depthModelSize)).toBe(false)
    }
  })

  it("a direct run's setting names it only where it changes the render, and never with the masking off", () => {
    expect(depthModelSizeOfSetting({ mode: "always", fill: "depth", depthModelSize: "small" })).toBe("small")
    expect(depthModelSizeOfSetting({ mode: "always", source: "full-depth", depthModelSize: "base" })).toBe("base")
    expect(depthModelSizeOfSetting({ mode: "off", fill: "depth", depthModelSize: "small" })).toBeUndefined()
    expect(depthModelSizeOfSetting({ mode: "always", depthModelSize: "small" })).toBeUndefined()
    expect(depthModelSizeOfSetting({ mode: "always", fill: "depth", depthModelSize: "large" })).toBeUndefined()
    expect(depthModelSizeOfSetting(undefined)).toBeUndefined()
  })
})

describe("a chosen size", () => {
  it("is sent on a make and a run wherever depth is drawn, role outlines' gray fill included", () => {
    for (const name of DEPTH_CASES) {
      for (const depthModelSize of ["small", "base"] as const) {
        const m = { ...CASES[name], depthModelSize }
        expect(depthModelSizeSent(m), name).toBe(depthModelSize)
        expect(faceMaskingSent(withoutMarks(m)), `${name} ${depthModelSize}`).toEqual({ ...PINNED_SENT[name].sent, depthModelSize })
        expect(faceMaskingRunSent(withoutMarks(m)), `${name} ${depthModelSize}`).toEqual({ ...PINNED_SENT[name].run, depthModelSize })
      }
    }
  })

  it("sits beside a colormap; under role outlines the colormap is dropped and the size kept", () => {
    expect(faceMaskingSent(withoutMarks({ ...CASES.keepPeople, depthColormap: "magma", depthModelSize: "small" }))).toEqual({
      ...PINNED_SENT.keepPeople.sent,
      depthColormap: "magma",
      depthModelSize: "small",
    })
    expect(faceMaskingSent(withoutMarks({ ...CASES.facesDepthOutlines, depthColormap: "magma", depthModelSize: "base" }))).toEqual({
      ...PINNED_SENT.facesDepthOutlines.sent,
      depthModelSize: "base",
    })
  })

  it("is part of the settings key AND the base key: each size its own stored clip and its own base", () => {
    for (const name of DEPTH_CASES) {
      const keys = new Set(VIDEO_DEPTH_MODEL_SIZES.map((depthModelSize) => keyOf({ ...CASES[name], depthModelSize })))
      const bases = new Set(VIDEO_DEPTH_MODEL_SIZES.map((depthModelSize) => baseOf({ ...CASES[name], depthModelSize })))
      expect(keys.size, name).toBe(3)
      expect(bases.size, name).toBe(3)
      expect(keyOf({ ...CASES[name], depthModelSize: "small" }), name).not.toBe(PINNED[name].key)
      expect(baseOf({ ...CASES[name], depthModelSize: "small" }), name).not.toBe(PINNED[name].base)
    }
  })

  it("a colormap still leaves the base alone: the same size, any map, one base", () => {
    for (const name of ["keepPeople", "fullDepth"] as const) {
      const bases = new Set((["grayscale", "turbo", "inferno"] as const).map((depthColormap) => baseOf({ ...CASES[name], depthModelSize: "small", depthColormap })))
      expect([...bases], name).toEqual([baseOf({ ...CASES[name], depthModelSize: "small" })])
    }
  })
})

describe("the engine", () => {
  afterEach(() => _resetPluginSupportsForTests())

  it("is sent the size only when it lists it (castSwap.depthModelSizes)", () => {
    const m = { ...CASES.facesDepth, depthModelSize: "small" as const }
    expect(engineDrawsDepthModelSize(undefined, "small")).toBe(false)
    expect(engineDrawsDepthModelSize({}, "small")).toBe(false)
    expect(engineDrawsDepthModelSize({ depthModelSizes: ["large"] }, "small")).toBe(false)
    expect(engineDrawsDepthModelSize({ depthModelSizes: ["small", "large"] }, "small")).toBe(true)
    expect(withDepthModelSizeFor(m, { depthModelSizes: ["small"] })).toEqual(m)
    for (const cs of [undefined, {}, { depthModelSizes: ["base" as const] }]) {
      expect(Object.hasOwn(withDepthModelSizeFor(m, cs), "depthModelSize"), JSON.stringify(cs)).toBe(false)
    }
    // Large is never sent, even to an engine that lists it.
    expect(Object.hasOwn(withDepthModelSizeFor({ ...CASES.facesDepth, depthModelSize: "large" }, { depthModelSizes: ["large"] }), "depthModelSize")).toBe(false)
  })

  const ENGINE = {
    roleKinds: ["person"],
    fixedReferences: true,
    fullQuality: true,
    resolutions: ["480p", "720p", "1080p"],
    trendRun: true,
    faceMasking: true,
    storedFaceMask: true,
    storedFaceMaskRequired: true,
    faceMaskRecipe: "1",
    faceMaskErase: true,
    sourceModes: ["faces", "full-depth", "keep-people"],
    faceMaskTargets: ["face", "head", "body"],
    faceMaskMarkLabels: ["erased", "main"],
    fullDepthScenes: ["description", "original", "none"],
  }
  const SIZES = { ...ENGINE, depthModelSizes: [...VIDEO_DEPTH_MODEL_SIZES] }

  function trend(faceMasking: FaceMaskingWithMarks): TrendVersionData {
    const d0: TrendVersionData = {
      name: { en: "Dance" },
      source: {
        videoUrl: SRC,
        durationSec: 12,
        display: { videoUrl: "https://cdn.example/display.mp4", posterUrl: "https://cdn.example/poster.png", width: 240, height: 320, durationSec: 12 },
      },
      previewStart: 0,
      slots: [SLOTS[0]!],
      references: [],
      examples: [{ videoUrl: "https://cdn.example/ex.mp4", width: 720, height: 1280, durationSec: 12, sourceJobId: "j", slots: { lead: ["https://cdn.example/l.png"] } }],
      faceMasking,
    }
    const faceMask: TrendFaceMask = {
      url: "https://cdn.example/trends/t1/clip.mp4",
      frames: 360,
      recipe: { core: VIDEO_MASK_RECIPE, plugin: "1" },
      settingsKey: faceMaskSettingsKey(d0)!,
      jobId: "job-1",
      stats: { shots: 1, heldFrames: 0, coverage: 1, droppedRegions: 0 },
      approvedAt: "2026-11-01T10:00:00.000Z",
      approvedBy: "admin",
    }
    const d = { ...d0, faceMask }
    const mask = storedFaceMaskFor(d)
    const previewClip: TrendPreviewClip = {
      videoUrl: "https://cdn.example/trends/t1/preview.mp4", durationSec: 5, width: 240, height: 320, frames: 150, sha256: "a".repeat(64),
      sourceVideoUrl: SRC, startSec: 0, recipe: "2", madeAt: "2026-11-01T10:00:00.000Z",
      ...(mask ? { faceMask: { url: "https://cdn.example/trends/t1/preview-mask.mp4", frames: 150, sha256: "b".repeat(64), sourceMaskUrl: mask.url } } : {}),
    }
    return { ...d, previewClip }
  }
  const run = (d: TrendVersionData) => composeTrendRun({ id: "t-1", slug: "dance", version: 1, data: d }, { slots: { lead: { images: ["https://cdn.example/me.png"] } } })

  it("a run carries the size only to an engine that lists it; else exactly today's body", () => {
    const d = trend({ ...CASES.keepPeople, depthModelSize: "small" })
    setPluginSupports({ castSwap: SIZES } as never)
    const sent = run(d)
    withoutUnsupportedFields(sent)
    expect(sent.body.faceMasking).toEqual({ ...PINNED_SENT.keepPeople.run, depthModelSize: "small" })
    for (const castSwap of [ENGINE, { ...ENGINE, depthModelSizes: ["base", "large"] }] as Array<Record<string, unknown>>) {
      setPluginSupports({ castSwap } as never)
      const older = run(d)
      withoutUnsupportedFields(older)
      expect(older.body.faceMasking, JSON.stringify(castSwap.depthModelSizes)).toEqual(PINNED_SENT.keepPeople.run)
    }
  })

  it("a run of a trend without a size (or with large) is sent no key, whatever the engine lists", () => {
    setPluginSupports({ castSwap: SIZES } as never)
    for (const m of [CASES.fullDepth, { ...CASES.fullDepth, depthModelSize: "large" as const }]) {
      const sent = run(trend(m))
      withoutUnsupportedFields(sent)
      expect(sent.body.faceMasking, JSON.stringify(m)).toEqual(PINNED_SENT.fullDepth.run)
    }
  })

  const env = (name: string, castSwap: Record<string, unknown>): EngineEnvironment => ({
    env: name,
    pluginBuildId: "b",
    supports: { castSwap: castSwap as never },
    updatedAt: "2026-11-01T00:00:00Z",
  })
  const REQUIRED = ["staging", "production"]
  const needsOf = (d: TrendVersionData, envs: EngineEnvironment[]) =>
    publishBlockers(d, envs, REQUIRED).filter((b) => b.code === "engine_unsupported" && b.need?.startsWith("depthModelSize:"))

  it("publishing blocks a trend whose size an environment's engine does not list", () => {
    const d = trend({ ...CASES.fullDepth, depthModelSize: "base" })
    expect(depthModelSizeNeed("base")).toBe("depthModelSize:base")
    expect(needsOf(d, [env("staging", SIZES), env("production", ENGINE)])).toEqual([{ code: "engine_unsupported", env: "production", need: "depthModelSize:base" }])
    expect(needsOf(d, [env("staging", { ...ENGINE, depthModelSizes: ["small"] }), env("production", SIZES)])).toEqual([
      { code: "engine_unsupported", env: "staging", need: "depthModelSize:base" },
    ])
    expect(needsOf(d, [env("staging", SIZES), env("production", SIZES)])).toEqual([])
  })

  it("publishing never needs it for a trend without one (or one that changes no render)", () => {
    for (const m of [CASES.fullDepth, CASES.facesDepth, { ...CASES.facesDepth, depthModelSize: "large" as const }, { ...CASES.facesBlur, depthModelSize: "small" as const }]) {
      expect(needsOf(trend(m), [env("staging", ENGINE), env("production", ENGINE)]), JSON.stringify(m)).toEqual([])
    }
  })

  it("Nodaro Motion's shared settings: the environments that cannot draw with every size asked, a missing one included", () => {
    const envs = [env("production", SIZES), env("staging", { ...ENGINE, depthModelSizes: ["small"] })]
    expect(environmentsThatCannotDrawModelSizes(envs, [])).toEqual([])
    expect(environmentsThatCannotDrawModelSizes(envs, ["small"])).toEqual([])
    expect(environmentsThatCannotDrawModelSizes(envs, ["small", "base"])).toEqual(["staging"])
    expect(environmentsThatCannotDrawModelSizes([env("production", SIZES)], ["base"])).toEqual(["staging"])
    expect(environmentsThatCannotDrawModelSizes([], ["base"])).toEqual(["staging", "production"])
  })
})
