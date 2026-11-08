/**
 * The smallest face with mesh lines (`faceMasking.faceMeshMinFaceHeightPct`,
 * decided 2026-11-03): Full depth's face mesh draws no lines on a face whose
 * box is smaller than this % of the frame's height (0–100; left out, the
 * engine's default, 10 %; 0 = no minimum). The Motion setting's and a
 * trend's; never the Precise setting's, which is never Full depth. What must
 * hold:
 *
 *  - nothing stored today changes meaning: a setting without it parses, sends
 *    and hashes exactly as before (the keys and bodies below were pinned
 *    before it existed: depth-model-size.test.ts's pins), and so does one that
 *    carries it where it draws nothing (the face mesh off);
 *  - any value SET (the default's 10 and 0 included) is sent on a make and a
 *    run and is part of the settings key, so changing it puts a stored clip
 *    out of date;
 *  - it reaches only an engine that declares `castSwap.faceMeshMinFaceHeightPct`
 *    (a run, the Nodaro Motion settings), and publishing never needs it: a
 *    run never draws the mesh, it cuts the stored clip.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"
import {
  engineDrawsFaceMeshMinFaceHeight,
  faceMaskingMotionSchema,
  faceMaskingRunSent,
  faceMaskingSent,
  faceMaskingWithMarksSchema,
  faceMeshMinFaceHeightSent,
  withFaceMeshMinFaceHeightFor,
  withoutMarks,
  type FaceMaskingWithMarks,
} from "../../../../lib/cast-swap-face-masking.js"
import { nodaroMotionMaskingSchema } from "../../../../lib/nodaro-motion-masking.js"
import { nodaroMotionMotionSchema } from "../../../../lib/nodaro-motion-motion.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../../lib/private-plugins/supports-registry.js"
import type { EngineEnvironment } from "../../engine-environments.js"
import { PLATFORM_CLAIM_TTL_MS, PLATFORM_SUPPORTS } from "../../engine-environments.js"
import {
  PLATFORM_UNSUPPORTED,
  cannotDrawFaceMeshMinFaceHeightMessage,
  environmentsThatCannotDrawFaceMeshMinFaceHeight,
  environmentsWhosePlatformCannotTakeFaceMeshMinFaceHeight,
  faceMeshMinFaceHeightCarried,
  faceMeshMinFaceHeightOfSetting,
  platformCannotTakeFaceMeshMinFaceHeightMessage,
  platformHoldOfFaceMeshMinFaceHeight,
} from "../../nodaro-motion-face-mesh.js"
import { composeTrendRun } from "../compose.js"
import { faceMaskBaseKey, faceMaskSettingsKey, faceMaskSettingsKeyOf, storedFaceMaskFor } from "../face-mask.js"
import { publishBlockers } from "../publish-check.js"
import { withoutUnsupportedFields } from "../run-helpers.js"
import type { TrendFaceMask, TrendPreviewClip, TrendSlot, TrendVersionData } from "../types.js"

const SRC = "https://cdn.example/trends/t1/src.mp4"
const SLOTS = [
  { key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the woman" },
  { key: "friend", kind: "person", label: { en: "Friend" }, required: false, roleName: "the man" },
] as TrendSlot[]
const box = { fromFrame: 0, toFrame: 10, leftPct: 10, topPct: 10, rightPct: 50, bottomPct: 60 }

/** Every source mode's setting, as stored before the field existed (depth-model-size.test.ts's cases). */
const CASES = {
  facesBlur: { mode: "always", threshold: 0.4 },
  facesDepth: { mode: "always", fill: "depth" },
  facesDepthOutlines: { mode: "always", fill: "depth", roleOutlines: true, marks: [{ label: { slot: "lead" }, ...box }] },
  facesBlurOutlines: { mode: "always", roleOutlines: true, marks: [{ label: { slot: "lead" }, ...box }] },
  fullDepth: { mode: "always", source: "full-depth" },
  fullDepthMesh: { mode: "always", source: "full-depth", faceMesh: true, scene: "original" },
  keepPeople: { mode: "always", source: "keep-people", marks: [{ label: "main", ...box }] },
} satisfies Record<string, FaceMaskingWithMarks>

/** The keys of `CASES`, computed on the platform BEFORE the depth colormap (and so this field) existed: they must never move. */
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
/** What a make (`faceMaskingSent`) and a run (`faceMaskingRunSent`) were sent of `CASES` before the field existed. */
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
/** A setting with the field, as a row that never went through the schema could hold it. */
const raw = (m: FaceMaskingWithMarks, faceMeshMinFaceHeightPct: number): FaceMaskingWithMarks => ({ ...m, faceMeshMinFaceHeightPct })
const MESH = CASES.fullDepthMesh

describe("the setting", () => {
  it("takes 0–100 on a Full depth setting: a trend's and the Motion setting's", () => {
    for (const faceMeshMinFaceHeightPct of [0, 10, 12.5, 100]) {
      const m = { ...MESH, faceMeshMinFaceHeightPct }
      const trend = faceMaskingWithMarksSchema.safeParse(m)
      expect(trend.success, String(faceMeshMinFaceHeightPct)).toBe(true)
      expect(trend.data, String(faceMeshMinFaceHeightPct)).toEqual(m)
      const motion = nodaroMotionMotionSchema.safeParse({ "motion-prism": { masking: m } })
      expect(motion.success, String(faceMeshMinFaceHeightPct)).toBe(true)
      expect(motion.data, String(faceMeshMinFaceHeightPct)).toEqual({ "motion-prism": { masking: m } })
    }
    // Full depth with the face mesh off keeps it (it draws nothing then: never sent nor hashed, below).
    expect(faceMaskingWithMarksSchema.safeParse({ ...CASES.fullDepth, faceMeshMinFaceHeightPct: 20 }).success).toBe(true)
    expect(faceMaskingMotionSchema.safeParse({ ...CASES.fullDepth, faceMeshMinFaceHeightPct: 20 }).success).toBe(true)
  })

  it("refuses a value outside 0–100, or not a number", () => {
    for (const v of [-1, -0.5, 100.5, 101, "10", null, Number.NaN, Number.POSITIVE_INFINITY, true]) {
      expect(faceMaskingWithMarksSchema.safeParse({ ...MESH, faceMeshMinFaceHeightPct: v }).success, String(v)).toBe(false)
      expect(nodaroMotionMotionSchema.safeParse({ "motion-pulse": { masking: { ...MESH, faceMeshMinFaceHeightPct: v } } }).success, String(v)).toBe(false)
    }
  })

  it("is Full depth's alone: refused with Faces hidden and Keep people, and on the Precise setting (always Faces hidden)", () => {
    const facesMesh = { mode: "always" as const, faceMesh: true, faceMeshMinFaceHeightPct: 20 }
    for (const m of [facesMesh, { ...CASES.facesBlur, faceMeshMinFaceHeightPct: 20 }, { ...CASES.keepPeople, faceMeshMinFaceHeightPct: 20 }]) {
      const parsed = faceMaskingWithMarksSchema.safeParse(m)
      expect(parsed.success, JSON.stringify(m)).toBe(false)
      expect(parsed.error!.issues.some((i) => i.path.join(".") === "faceMeshMinFaceHeightPct"), JSON.stringify(m)).toBe(true)
    }
    expect(faceMaskingMotionSchema.safeParse(facesMesh).success).toBe(false)
    expect(nodaroMotionMaskingSchema.safeParse({ "motion-prism": facesMesh }).success).toBe(false)
    expect(nodaroMotionMaskingSchema.safeParse({ "motion-prism": { mode: "always", fill: "none", faceMesh: true, faceMeshMinFaceHeightPct: 0 } }).success).toBe(false)
  })

  it("a setting without it parses byte for byte as before, in every schema (outputs pinned before the field existed)", () => {
    const PARSED: Record<keyof typeof CASES, string> = {
      facesBlur: '{"mode":"always","threshold":0.4}',
      facesDepth: '{"mode":"always","fill":"depth"}',
      facesDepthOutlines: '{"mode":"always","fill":"depth","marks":[{"label":{"slot":"lead"},"fromFrame":0,"toFrame":10,"leftPct":10,"topPct":10,"rightPct":50,"bottomPct":60}],"roleOutlines":true}',
      facesBlurOutlines: '{"mode":"always","marks":[{"label":{"slot":"lead"},"fromFrame":0,"toFrame":10,"leftPct":10,"topPct":10,"rightPct":50,"bottomPct":60}],"roleOutlines":true}',
      fullDepth: '{"mode":"always","source":"full-depth"}',
      fullDepthMesh: '{"mode":"always","source":"full-depth","scene":"original","faceMesh":true}',
      keepPeople: '{"mode":"always","source":"keep-people","marks":[{"label":"main","fromFrame":0,"toFrame":10,"leftPct":10,"topPct":10,"rightPct":50,"bottomPct":60}]}',
    }
    for (const [name, m] of entries) {
      const parsed = faceMaskingWithMarksSchema.safeParse(m)
      expect(parsed.success, name).toBe(true)
      expect(JSON.stringify(parsed.data), name).toBe(PARSED[name])
    }
    const motion = { "motion-prism": { masking: { mode: "always", source: "full-depth", faceMesh: true, depthBlur: 12, faceMeshParts: "mouth" } }, "motion-pulse": { promptStyle: "precise" } }
    expect(JSON.stringify(nodaroMotionMotionSchema.parse(motion))).toBe(
      '{"motion-prism":{"masking":{"mode":"always","source":"full-depth","faceMesh":true,"depthBlur":12,"faceMeshParts":"mouth"}},"motion-pulse":{"promptStyle":"precise"}}',
    )
    const precise = { "motion-prism": { mode: "always", fill: "depth", faceMesh: true, depthColormap: "magma" }, "motion-pulse": { mode: "auto" } }
    expect(JSON.stringify(nodaroMotionMaskingSchema.parse(precise))).toBe('{"motion-prism":{"mode":"always","fill":"depth","faceMesh":true,"depthColormap":"magma"},"motion-pulse":{"mode":"auto"}}')
  })

  it("is named where it applies only: on, Full depth, the face mesh on", () => {
    for (const v of [0, 10, 20, 100]) {
      expect(faceMeshMinFaceHeightSent({ ...MESH, faceMeshMinFaceHeightPct: v }), String(v)).toBe(v)
      expect(faceMeshMinFaceHeightOfSetting({ ...MESH, faceMeshMinFaceHeightPct: v }), String(v)).toBe(v)
    }
    expect(faceMeshMinFaceHeightSent(MESH)).toBeUndefined()
    expect(faceMeshMinFaceHeightSent({ ...CASES.fullDepth, faceMeshMinFaceHeightPct: 20 })).toBeUndefined()
    expect(faceMeshMinFaceHeightSent({ ...MESH, faceMesh: false, faceMeshMinFaceHeightPct: 20 })).toBeUndefined()
    expect(faceMeshMinFaceHeightSent({ ...MESH, mode: "off", faceMeshMinFaceHeightPct: 20 })).toBeUndefined()
    expect(faceMeshMinFaceHeightSent(raw({ mode: "always", faceMesh: true }, 20))).toBeUndefined()
    expect(faceMeshMinFaceHeightSent(raw({ mode: "always", source: "keep-people" }, 20))).toBeUndefined()
    expect(faceMeshMinFaceHeightSent(undefined)).toBeUndefined()
    expect(faceMeshMinFaceHeightOfSetting(undefined)).toBeUndefined()
    expect(faceMeshMinFaceHeightOfSetting({ ...CASES.fullDepth, faceMeshMinFaceHeightPct: 20 })).toBeUndefined()
  })
})

describe("what a make and a run are sent, and the settings key", () => {
  it("a setting without it: the keys and bodies pinned before it existed", () => {
    for (const [name, m] of entries) {
      expect(keyOf(m), name).toBe(PINNED[name].key)
      expect(baseOf(m), name).toBe(PINNED[name].base)
      expect(faceMaskingSent(withoutMarks(m)), name).toEqual(PINNED_SENT[name].sent)
      expect(faceMaskingRunSent(withoutMarks(m)), name).toEqual(PINNED_SENT[name].run)
    }
  })

  it("where it draws nothing it is the same as none: Full depth with the mesh off; Faces hidden and Keep people from a row that skipped the schema", () => {
    for (const name of ["fullDepth", "facesBlur", "facesDepth", "facesDepthOutlines", "facesBlurOutlines", "keepPeople"] as const) {
      const m = raw(CASES[name], 20)
      expect(keyOf(m), name).toBe(PINNED[name].key)
      expect(baseOf(m), name).toBe(PINNED[name].base)
      expect(faceMaskingSent(withoutMarks(m)), name).toEqual(PINNED_SENT[name].sent)
      expect(faceMaskingRunSent(withoutMarks(m)), name).toEqual(PINNED_SENT[name].run)
    }
  })

  it("on Full depth with the face mesh, any value set is sent on a make and a run, the default's 10 and 0 included", () => {
    for (const faceMeshMinFaceHeightPct of [0, 10, 20, 100]) {
      const m = { ...MESH, faceMeshMinFaceHeightPct }
      expect(faceMaskingSent(withoutMarks(m)), String(faceMeshMinFaceHeightPct)).toEqual({ ...PINNED_SENT.fullDepthMesh.sent, faceMeshMinFaceHeightPct })
      expect(faceMaskingRunSent(withoutMarks(m)), String(faceMeshMinFaceHeightPct)).toEqual({ ...PINNED_SENT.fullDepthMesh.run, faceMeshMinFaceHeightPct })
    }
  })

  it("is part of the settings key: each value set is its own stored clip, the default's 10 too; left out, the key of before", () => {
    const keys = [undefined, 0, 10, 20].map((v) => keyOf(v === undefined ? MESH : { ...MESH, faceMeshMinFaceHeightPct: v }))
    expect(keys[0]).toBe(PINNED.fullDepthMesh.key)
    expect(new Set(keys).size).toBe(4)
    // A full-depth clip has no raw mask to reuse: its base key is its settings key.
    expect(baseOf({ ...MESH, faceMeshMinFaceHeightPct: 20 })).toBe(keyOf({ ...MESH, faceMeshMinFaceHeightPct: 20 }))
  })
})

describe("the engine", () => {
  afterEach(() => _resetPluginSupportsForTests())

  it("is sent the value only when it declares castSwap.faceMeshMinFaceHeightPct, and only where it applies", () => {
    const m = { ...MESH, faceMeshMinFaceHeightPct: 20 }
    expect(engineDrawsFaceMeshMinFaceHeight(undefined)).toBe(false)
    expect(engineDrawsFaceMeshMinFaceHeight({})).toBe(false)
    expect(engineDrawsFaceMeshMinFaceHeight({ faceMeshMinFaceHeightPct: false })).toBe(false)
    expect(engineDrawsFaceMeshMinFaceHeight({ faceMeshMinFaceHeightPct: true })).toBe(true)
    expect(withFaceMeshMinFaceHeightFor(m, { faceMeshMinFaceHeightPct: true })).toEqual(m)
    for (const cs of [undefined, {}, { faceMeshMinFaceHeightPct: false }]) {
      expect(withFaceMeshMinFaceHeightFor(m, cs), JSON.stringify(cs)).toEqual(MESH)
    }
    // Where it draws nothing it is never sent, even to an engine that declares it.
    expect(withFaceMeshMinFaceHeightFor({ ...CASES.fullDepth, faceMeshMinFaceHeightPct: 20 }, { faceMeshMinFaceHeightPct: true })).toEqual(CASES.fullDepth)
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
    sourceModes: ["faces", "full-depth", "keep-people"],
    fullDepthScenes: ["description", "original", "none"],
    faceMesh: true,
  }
  const MIN_FACE = { ...ENGINE, faceMeshMinFaceHeightPct: true }

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
      approvedAt: "2026-11-03T10:00:00.000Z",
      approvedBy: "admin",
    }
    const d = { ...d0, faceMask }
    const mask = storedFaceMaskFor(d)
    const previewClip: TrendPreviewClip = {
      videoUrl: "https://cdn.example/trends/t1/preview.mp4", durationSec: 5, width: 240, height: 320, frames: 150, sha256: "a".repeat(64),
      sourceVideoUrl: SRC, startSec: 0, recipe: "2", madeAt: "2026-11-03T10:00:00.000Z",
      ...(mask ? { faceMask: { url: "https://cdn.example/trends/t1/preview-mask.mp4", frames: 150, sha256: "b".repeat(64), sourceMaskUrl: mask.url } } : {}),
    }
    return { ...d, previewClip }
  }
  const run = (d: TrendVersionData) => composeTrendRun({ id: "t-1", slug: "dance", version: 1, data: d }, { slots: { lead: { images: ["https://cdn.example/me.png"] } } })

  it("a trend run carries it only to an engine that declares it; else exactly today's body", () => {
    const d = trend({ ...MESH, faceMeshMinFaceHeightPct: 20 })
    setPluginSupports({ castSwap: MIN_FACE } as never)
    const sent = run(d)
    withoutUnsupportedFields(sent)
    expect(sent.body.faceMasking).toEqual({ ...PINNED_SENT.fullDepthMesh.run, faceMeshMinFaceHeightPct: 20 })
    // The stored clip is sent as before: it is the clip the run uses.
    expect(sent.body.storedFaceMask).toMatchObject({ url: "https://cdn.example/trends/t1/clip.mp4", required: true })
    for (const castSwap of [ENGINE, { ...ENGINE, faceMeshMinFaceHeightPct: false }] as Array<Record<string, unknown>>) {
      setPluginSupports({ castSwap } as never)
      const older = run(d)
      withoutUnsupportedFields(older)
      expect(older.body.faceMasking, JSON.stringify(castSwap.faceMeshMinFaceHeightPct)).toEqual(PINNED_SENT.fullDepthMesh.run)
    }
  })

  it("a run of a trend without it is sent no key, whatever the engine declares", () => {
    setPluginSupports({ castSwap: MIN_FACE } as never)
    const sent = run(trend(MESH))
    withoutUnsupportedFields(sent)
    expect(sent.body.faceMasking).toEqual(PINNED_SENT.fullDepthMesh.run)
  })

  const env = (name: string, castSwap: Record<string, unknown>): EngineEnvironment => ({
    env: name,
    pluginBuildId: "b",
    supports: { castSwap: castSwap as never },
    updatedAt: "2026-11-03T00:00:00Z",
  })

  it("publishing never needs it: a run never draws the mesh, so a trend with it publishes wherever one without it does", () => {
    for (const envs of [
      [env("staging", MIN_FACE), env("production", ENGINE)],
      [env("staging", ENGINE), env("production", ENGINE)],
      [env("staging", MIN_FACE), env("production", MIN_FACE)],
    ]) {
      const withIt = publishBlockers(trend({ ...MESH, faceMeshMinFaceHeightPct: 20 }), envs, ["staging", "production"])
      expect(withIt).toEqual(publishBlockers(trend(MESH), envs, ["staging", "production"]))
      expect(JSON.stringify(withIt)).not.toMatch(/faceMeshMinFaceHeight/)
    }
  })

  it("Nodaro Motion's shared settings: the environments whose engine does not declare it, a missing one included", () => {
    expect(environmentsThatCannotDrawFaceMeshMinFaceHeight([env("production", MIN_FACE), env("staging", MIN_FACE)])).toEqual([])
    expect(environmentsThatCannotDrawFaceMeshMinFaceHeight([env("production", MIN_FACE), env("staging", ENGINE)])).toEqual(["staging"])
    expect(environmentsThatCannotDrawFaceMeshMinFaceHeight([env("production", MIN_FACE)])).toEqual(["staging"])
    expect(environmentsThatCannotDrawFaceMeshMinFaceHeight([])).toEqual(["staging", "production"])
    expect(cannotDrawFaceMeshMinFaceHeightMessage(["staging"])).toBe(
      "The Cast Swap engine in staging cannot set the smallest face with mesh lines yet, and this setting is shared by every environment: empty it, or wait for the engine.",
    )
  })
})

/**
 * The platform hold (decided 2026-11-03): staging and production share one
 * database, and an environment's platform (the app itself, not its engine)
 * that predates the field refuses a setting or trend that carries it (its
 * strict schemas: a dropped Motion entry; another settings key: runs refused
 * `face_mask_required`). So each platform claims that it takes the field (its
 * claim: its own columns beside its engine's record, by its heartbeat), and a
 * value is stored only while every environment's platform says so.
 */
describe("the platform hold", () => {
  /** When every engine record here was written: its boot, two days ago (a claim's age, not this, is what counts). */
  const BOOT_AGO = 2 * 24 * 60 * 60_000
  /**
   * An environment whose engine (written at boot, `BOOT_AGO`) declares the field and, given one, whose platform
   * claimed `platform` `claimAgo` before now (now by default: a claim counts only while its own time is fresh).
   */
  const row = (name: string, platform: Record<string, unknown> | undefined, claimAgo = 0, bootAgo = BOOT_AGO): EngineEnvironment => ({
    env: name,
    pluginBuildId: "b",
    supports: { castSwap: { roleKinds: ["person"], fixedReferences: true, fullQuality: true, resolutions: ["480p"], trendRun: true, faceMeshMinFaceHeightPct: true } } as never,
    updatedAt: new Date(Date.now() - bootAgo).toISOString(),
    ...(platform ? { platformClaim: { supports: platform as never, at: new Date(Date.now() - claimAgo).toISOString() } } : {}),
  })

  it("a stale claim is no claim: one older than the TTL (a failed deploy's, a crashed app's, a rollback's) closes the hold", () => {
    const takes = { faceMeshMinFaceHeightPct: true }
    const stale = PLATFORM_CLAIM_TTL_MS + 60_000
    expect(environmentsWhosePlatformCannotTakeFaceMeshMinFaceHeight([row("production", takes, stale), row("staging", takes)])).toEqual(["production"])
    expect(environmentsWhosePlatformCannotTakeFaceMeshMinFaceHeight([row("production", takes, PLATFORM_CLAIM_TTL_MS - 60_000), row("staging", takes)])).toEqual([])
  })

  it("the claim's own time decides, never the engine record's: a boot days ago with a fresh claim opens; a boot a minute ago with a stale claim closes", () => {
    const takes = { faceMeshMinFaceHeightPct: true }
    expect(environmentsWhosePlatformCannotTakeFaceMeshMinFaceHeight([row("production", takes, 60_000, BOOT_AGO), row("staging", takes)])).toEqual([])
    expect(environmentsWhosePlatformCannotTakeFaceMeshMinFaceHeight([row("production", takes, 20 * 60_000, 60_000), row("staging", takes)])).toEqual(["production"])
  })

  it("with fake timers: a fresh claim opens the hold; once stale it closes it", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-03T12:00:00.000Z") })
    try {
      const takes = { faceMeshMinFaceHeightPct: true }
      const rows = [row("production", takes), row("staging", takes)]
      const carried = [{ ...MESH, faceMeshMinFaceHeightPct: 20 }]
      expect(await platformHoldOfFaceMeshMinFaceHeight(carried, "setting", rows)).toBeNull()
      vi.advanceTimersByTime(PLATFORM_CLAIM_TTL_MS + 1)
      expect(await platformHoldOfFaceMeshMinFaceHeight(carried, "setting", rows)).toEqual({
        code: "platform_unsupported",
        envs: ["staging", "production"],
        message: expect.stringMatching(/^The platform in staging and production does not take/),
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("this platform says it takes the field", () => {
    expect(PLATFORM_SUPPORTS).toEqual({ faceMeshMinFaceHeightPct: true, prismReferenceAudioPitch: true, faceMeshLayers: true, preciseStyleRoutePhotographic: true, preciseStyleRoutePerStyle: true })
    expect(Object.isFrozen(PLATFORM_SUPPORTS)).toBe(true)
  })

  it("the environments whose platform does not say so: an older one (no claim, or one without the field), or none recorded", () => {
    const takes = { faceMeshMinFaceHeightPct: true }
    expect(environmentsWhosePlatformCannotTakeFaceMeshMinFaceHeight([row("production", takes), row("staging", takes)])).toEqual([])
    // Its ENGINE declares the field (plugin 0.436.1 runs everywhere): the platform is what decides.
    expect(environmentsWhosePlatformCannotTakeFaceMeshMinFaceHeight([row("production", undefined), row("staging", takes)])).toEqual(["production"])
    expect(environmentsWhosePlatformCannotTakeFaceMeshMinFaceHeight([row("production", {}), row("staging", { faceMeshMinFaceHeightPct: false })])).toEqual([
      "staging",
      "production",
    ])
    expect(environmentsWhosePlatformCannotTakeFaceMeshMinFaceHeight([row("staging", takes)])).toEqual(["production"])
    expect(environmentsWhosePlatformCannotTakeFaceMeshMinFaceHeight([])).toEqual(["staging", "production"])
  })

  it("holds any value the setting carries, where it draws nothing too (an older platform refuses the key itself); never an absent one", () => {
    for (const v of [0, 10, 20]) {
      expect(faceMeshMinFaceHeightCarried({ ...MESH, faceMeshMinFaceHeightPct: v }), String(v)).toBe(true)
      expect(faceMeshMinFaceHeightCarried({ ...CASES.fullDepth, faceMeshMinFaceHeightPct: v }), String(v)).toBe(true)
    }
    for (const m of [undefined, MESH, CASES.fullDepth, CASES.facesBlur] as Array<FaceMaskingWithMarks | undefined>) {
      expect(faceMeshMinFaceHeightCarried(m), JSON.stringify(m)).toBe(false)
    }
  })

  it("its refusal names the environments, for the shared setting, a trend's save and its publish", () => {
    expect(PLATFORM_UNSUPPORTED).toBe("platform_unsupported")
    expect(platformCannotTakeFaceMeshMinFaceHeightMessage(["production"], "setting")).toBe(
      "The platform in production does not take the smallest face with mesh lines yet, and this setting is shared by every environment: empty it, or wait until production is updated.",
    )
    expect(platformCannotTakeFaceMeshMinFaceHeightMessage(["staging", "production"], "trend")).toBe(
      "The platform in staging and production does not take the smallest face with mesh lines yet, and trends are shared by every environment: empty it, or wait until staging and production are updated.",
    )
    expect(platformCannotTakeFaceMeshMinFaceHeightMessage(["production"], "publish")).toBe(
      "The platform in production does not take the smallest face with mesh lines yet, so its runs of this trend would be refused: empty it, or wait until production is updated.",
    )
  })
})
