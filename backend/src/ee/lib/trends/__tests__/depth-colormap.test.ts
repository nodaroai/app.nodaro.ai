/**
 * The depth colormap (`faceMasking.depthColormap`, decided 2026-11-01): the
 * admin's choice of the depth map's colors wherever Nodaro Motion draws depth
 * (Full depth, Keep people, a Faces hidden depth fill). What must hold:
 *
 *  - nothing stored today changes meaning: absent, a value equal to the
 *    source's default, a value where no depth is drawn (a blur fill) and one
 *    under role outlines (which draw a depth fill gray) all validate, send
 *    and hash exactly as today — the keys below are pinned from before the
 *    field existed;
 *  - a chosen map changes the settings key; the base key follows the depth
 *    RENDER (gray once a map is chosen: a faces depth fill's base is then
 *    role outlines' gray one; Keep people and Full depth render gray anyway);
 *  - it is sent (a run, a make, the settings) only to an engine that lists the
 *    map in `castSwap.depthColormaps`, and publishing needs that in every
 *    environment.
 */
import { afterEach, describe, expect, it } from "vitest"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"
import {
  FACE_MASKING_DEPTH_COLORMAPS,
  depthColormapOf,
  depthColormapSent,
  engineDrawsDepthColormap,
  faceMaskingRunSent,
  faceMaskingSchema,
  faceMaskingSent,
  faceMaskingWithMarksSchema,
  withDepthColormapFor,
  withoutMarks,
  type FaceMaskingWithMarks,
} from "../../../../lib/cast-swap-face-masking.js"
import { nodaroMotionMaskingSchema } from "../../../../lib/nodaro-motion-masking.js"
import { nodaroMotionMotionSchema } from "../../../../lib/nodaro-motion-motion.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../../lib/private-plugins/supports-registry.js"
import type { EngineEnvironment } from "../../engine-environments.js"
import { environmentsThatCannotDrawColormaps } from "../../nodaro-motion-depth-colormap.js"
import { composeTrendRun } from "../compose.js"
import { faceMaskBaseKey, faceMaskSettingsKey, faceMaskSettingsKeyOf, storedFaceMaskFor } from "../face-mask.js"
import { depthColormapNeed, publishBlockers } from "../publish-check.js"
import { withoutUnsupportedFields } from "../run-helpers.js"
import type { TrendFaceMask, TrendPreviewClip, TrendSlot, TrendVersionData } from "../types.js"

const SRC = "https://cdn.example/trends/t1/src.mp4"
const SLOTS = [
  { key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the woman" },
  { key: "friend", kind: "person", label: { en: "Friend" }, required: false, roleName: "the man" },
] as TrendSlot[]
const box = { fromFrame: 0, toFrame: 10, leftPct: 10, topPct: 10, rightPct: 50, bottomPct: 60 }

/** Every source mode's setting, as stored before the colormap existed. */
const CASES = {
  facesBlur: { mode: "always", threshold: 0.4 },
  facesDepth: { mode: "always", fill: "depth" },
  facesDepthOutlines: { mode: "always", fill: "depth", roleOutlines: true, marks: [{ label: { slot: "lead" }, ...box }] },
  facesBlurOutlines: { mode: "always", roleOutlines: true, marks: [{ label: { slot: "lead" }, ...box }] },
  fullDepth: { mode: "always", source: "full-depth" },
  fullDepthMesh: { mode: "always", source: "full-depth", faceMesh: true, scene: "original" },
  keepPeople: { mode: "always", source: "keep-people", marks: [{ label: "main", ...box }] },
} satisfies Record<string, FaceMaskingWithMarks>

/** The keys of `CASES`, computed on the platform BEFORE the colormap existed: they must never move. */
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
/** What a make (`faceMaskingSent`) and a run (`faceMaskingRunSent`) were sent of `CASES` before the colormap existed. */
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

describe("nothing stored today changes meaning", () => {
  it("every source mode's keys are the ones pinned before the colormap existed", () => {
    for (const [name, m] of entries) {
      expect(keyOf(m), name).toBe(PINNED[name].key)
      expect(baseOf(m), name).toBe(PINNED[name].base)
    }
  })

  it("a make and a run are sent exactly what they were, with no depthColormap key", () => {
    for (const [name, m] of entries) {
      expect(faceMaskingSent(withoutMarks(m)), name).toEqual(PINNED_SENT[name].sent)
      expect(faceMaskingRunSent(withoutMarks(m)), name).toEqual(PINNED_SENT[name].run)
    }
  })

  it("a colormap that changes nothing drawn is the same as none: the default, a blur fill, under role outlines", () => {
    const same: Array<[keyof typeof CASES, FaceMaskingWithMarks]> = [
      ["facesDepth", { ...CASES.facesDepth, depthColormap: "turbo" }],
      ["fullDepth", { ...CASES.fullDepth, depthColormap: "grayscale" }],
      ["keepPeople", { ...CASES.keepPeople, depthColormap: "grayscale" }],
      ["facesBlur", { ...CASES.facesBlur, depthColormap: "inferno" }],
      ["facesBlurOutlines", { ...CASES.facesBlurOutlines, depthColormap: "inferno" }],
      ["facesDepthOutlines", { ...CASES.facesDepthOutlines, depthColormap: "inferno" }],
    ]
    for (const [name, m] of same) {
      expect(faceMaskingWithMarksSchema.safeParse(m).success, name).toBe(true)
      expect(depthColormapSent(m), name).toBeUndefined()
      expect(keyOf(m), name).toBe(PINNED[name].key)
      expect(baseOf(m), name).toBe(PINNED[name].base)
      expect(faceMaskingSent(withoutMarks(m)), name).toEqual(PINNED_SENT[name].sent)
      expect(faceMaskingRunSent(withoutMarks(m)), name).toEqual(PINNED_SENT[name].run)
    }
  })
})

describe("the setting", () => {
  it("takes the depth provider's colormaps, everywhere a face masking setting is stored", () => {
    expect(FACE_MASKING_DEPTH_COLORMAPS).toEqual(["grayscale", "turbo", "inferno", "magma", "viridis"])
    for (const depthColormap of FACE_MASKING_DEPTH_COLORMAPS) {
      expect(faceMaskingWithMarksSchema.safeParse({ ...CASES.keepPeople, depthColormap }).success, depthColormap).toBe(true)
      expect(faceMaskingSchema.safeParse({ mode: "always", fill: "depth", depthColormap }).success, depthColormap).toBe(true)
    }
    expect(nodaroMotionMaskingSchema.safeParse({ "motion-prism": { mode: "always", fill: "depth", depthColormap: "magma" } }).success).toBe(true)
    expect(nodaroMotionMotionSchema.safeParse({ "motion-pulse": { masking: { mode: "always", source: "full-depth", depthColormap: "viridis" } } }).success).toBe(true)
  })

  it("refuses a colormap the provider does not offer", () => {
    for (const depthColormap of ["jet", "rainbow", "", 3]) {
      expect(faceMaskingWithMarksSchema.safeParse({ ...CASES.fullDepth, depthColormap }).success, String(depthColormap)).toBe(false)
    }
  })

  it("draws with the source's default when left out; gray under role outlines; nothing on a blur fill", () => {
    expect(depthColormapOf(CASES.fullDepth)).toBe("grayscale")
    expect(depthColormapOf(CASES.keepPeople)).toBe("grayscale")
    expect(depthColormapOf(CASES.facesDepth)).toBe("turbo")
    expect(depthColormapOf(CASES.facesDepthOutlines)).toBe("grayscale")
    expect(depthColormapOf({ ...CASES.facesDepthOutlines, depthColormap: "inferno" })).toBe("grayscale")
    expect(depthColormapOf(CASES.facesBlur)).toBeNull()
    expect(depthColormapOf({ ...CASES.facesDepth, depthColormap: "magma" })).toBe("magma")
    expect(depthColormapOf({ ...CASES.fullDepth, depthColormap: "turbo" })).toBe("turbo")
  })
})

describe("a chosen colormap", () => {
  it("is sent on a make and a run where it changes what is drawn, every source mode", () => {
    expect(faceMaskingSent(withoutMarks({ ...CASES.facesDepth, depthColormap: "inferno" }))).toEqual({ ...PINNED_SENT.facesDepth.sent, depthColormap: "inferno" })
    expect(faceMaskingSent(withoutMarks({ ...CASES.fullDepthMesh, depthColormap: "turbo" }))).toEqual({ ...PINNED_SENT.fullDepthMesh.sent, depthColormap: "turbo" })
    expect(faceMaskingRunSent(withoutMarks({ ...CASES.fullDepthMesh, depthColormap: "turbo" }))).toEqual({ ...PINNED_SENT.fullDepthMesh.run, depthColormap: "turbo" })
    expect(faceMaskingSent(withoutMarks({ ...CASES.keepPeople, depthColormap: "magma" }))).toEqual({ ...PINNED_SENT.keepPeople.sent, depthColormap: "magma" })
    // Grayscale is a choice on a depth fill (its default is turbo).
    expect(faceMaskingSent(withoutMarks({ ...CASES.facesDepth, depthColormap: "grayscale" }))).toEqual({ ...PINNED_SENT.facesDepth.sent, depthColormap: "grayscale" })
  })

  it("is part of the settings key: each map its own stored clip", () => {
    for (const [name, m] of entries) {
      const keys = new Set(FACE_MASKING_DEPTH_COLORMAPS.map((depthColormap) => keyOf({ ...m, depthColormap })))
      const expected = depthColormapOf(m) === null || m.roleOutlines ? 1 : FACE_MASKING_DEPTH_COLORMAPS.length
      expect(keys.size, name).toBe(expected)
    }
  })

  it("keeps Keep people's and Full depth's base (their depth renders gray either way), so another map re-colours it", () => {
    for (const name of ["keepPeople", "fullDepth", "fullDepthMesh"] as const) {
      for (const depthColormap of FACE_MASKING_DEPTH_COLORMAPS) expect(baseOf({ ...CASES[name], depthColormap }), `${name} ${depthColormap}`).toBe(PINNED[name].base)
    }
  })

  it("on a faces depth fill, has role outlines' GRAY base: never today's turbo depth view, the same for every map", () => {
    const bases = new Set(["grayscale", "inferno", "magma", "viridis"].map((c) => baseOf({ ...CASES.facesDepth, depthColormap: c as never })))
    expect([...bases]).toEqual([PINNED.facesDepthOutlines.base])
    expect(PINNED.facesDepthOutlines.base).not.toBe(PINNED.facesDepth.base)
  })
})

describe("the engine", () => {
  afterEach(() => _resetPluginSupportsForTests())

  it("is sent the colormap only when it lists the map (castSwap.depthColormaps)", () => {
    const m = { ...CASES.facesDepth, depthColormap: "inferno" as const }
    expect(engineDrawsDepthColormap(undefined, "inferno")).toBe(false)
    expect(engineDrawsDepthColormap({}, "inferno")).toBe(false)
    expect(engineDrawsDepthColormap({ depthColormaps: ["grayscale"] }, "inferno")).toBe(false)
    expect(engineDrawsDepthColormap({ depthColormaps: ["grayscale", "inferno"] }, "inferno")).toBe(true)
    expect(withDepthColormapFor(m, { depthColormaps: ["inferno"] })).toEqual(m)
    for (const cs of [undefined, {}, { depthColormaps: ["magma" as const] }]) {
      expect(Object.hasOwn(withDepthColormapFor(m, cs), "depthColormap"), JSON.stringify(cs)).toBe(false)
    }
    // A default is never sent, even to an engine that lists it.
    expect(Object.hasOwn(withDepthColormapFor({ ...CASES.facesDepth, depthColormap: "turbo" }, { depthColormaps: ["turbo"] }), "depthColormap")).toBe(false)
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
  const COLORMAPS = { ...ENGINE, depthColormaps: [...FACE_MASKING_DEPTH_COLORMAPS] }

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

  it("a run carries the colormap only to an engine that lists it; else exactly today's body", () => {
    const d = trend({ ...CASES.keepPeople, depthColormap: "inferno" })
    setPluginSupports({ castSwap: COLORMAPS } as never)
    const sent = run(d)
    withoutUnsupportedFields(sent)
    expect(sent.body.faceMasking).toEqual({ ...PINNED_SENT.keepPeople.run, depthColormap: "inferno" })
    for (const castSwap of [ENGINE, { ...ENGINE, depthColormaps: ["grayscale", "turbo"] }] as Array<Record<string, unknown>>) {
      setPluginSupports({ castSwap } as never)
      const older = run(d)
      withoutUnsupportedFields(older)
      expect(older.body.faceMasking, JSON.stringify(castSwap.depthColormaps)).toEqual(PINNED_SENT.keepPeople.run)
    }
  })

  it("a run of a trend without a colormap is sent no key, whatever the engine lists", () => {
    setPluginSupports({ castSwap: COLORMAPS } as never)
    const sent = run(trend(CASES.fullDepth))
    withoutUnsupportedFields(sent)
    expect(sent.body.faceMasking).toEqual(PINNED_SENT.fullDepth.run)
  })

  const env = (name: string, castSwap: Record<string, unknown>): EngineEnvironment => ({
    env: name,
    pluginBuildId: "b",
    supports: { castSwap: castSwap as never },
    updatedAt: "2026-11-01T00:00:00Z",
  })
  const REQUIRED = ["staging", "production"]
  const needsOf = (d: TrendVersionData, envs: EngineEnvironment[]) =>
    publishBlockers(d, envs, REQUIRED).filter((b) => b.code === "engine_unsupported" && b.need?.startsWith("depthColormap:"))

  it("publishing blocks a trend whose colormap an environment's engine does not list", () => {
    const d = trend({ ...CASES.fullDepth, depthColormap: "magma" })
    expect(depthColormapNeed("magma")).toBe("depthColormap:magma")
    expect(needsOf(d, [env("staging", COLORMAPS), env("production", ENGINE)])).toEqual([{ code: "engine_unsupported", env: "production", need: "depthColormap:magma" }])
    expect(needsOf(d, [env("staging", { ...ENGINE, depthColormaps: ["inferno"] }), env("production", COLORMAPS)])).toEqual([
      { code: "engine_unsupported", env: "staging", need: "depthColormap:magma" },
    ])
    expect(needsOf(d, [env("staging", COLORMAPS), env("production", COLORMAPS)])).toEqual([])
  })

  it("publishing never needs it for a trend without one (or one that changes nothing drawn)", () => {
    for (const m of [CASES.fullDepth, CASES.facesDepth, { ...CASES.facesBlur, depthColormap: "magma" as const }, { ...CASES.facesDepthOutlines, depthColormap: "magma" as const }]) {
      expect(needsOf(trend(m), [env("staging", ENGINE), env("production", ENGINE)]), JSON.stringify(m)).toEqual([])
    }
  })

  it("Nodaro Motion's shared settings: the environments that cannot draw every map asked, a missing one included", () => {
    const envs = [env("production", COLORMAPS), env("staging", { ...ENGINE, depthColormaps: ["inferno"] })]
    expect(environmentsThatCannotDrawColormaps(envs, [])).toEqual([])
    expect(environmentsThatCannotDrawColormaps(envs, ["inferno"])).toEqual([])
    expect(environmentsThatCannotDrawColormaps(envs, ["inferno", "magma"])).toEqual(["staging"])
    expect(environmentsThatCannotDrawColormaps([env("production", COLORMAPS)], ["magma"])).toEqual(["staging"])
    expect(environmentsThatCannotDrawColormaps([], ["magma"])).toEqual(["staging", "production"])
  })
})
