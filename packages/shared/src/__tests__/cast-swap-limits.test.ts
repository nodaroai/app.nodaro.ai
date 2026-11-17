/**
 * Cast Swap's input limits and a trend's prompt limits: the server enforces
 * them and the admin screen holds Save on them, both from here. Pinned, so a
 * change is a decision (the engine's own schema has to move with it).
 */
import { describe, expect, it } from "vitest"
import {
  CAST_SWAP_FACE_MASKING_BOUNDS,
  CAST_SWAP_FACE_MASKING_DEFAULTS,
  CAST_SWAP_FACE_MASK_TARGETS,
  CAST_SWAP_STYLES,
  CAST_SWAP_ENGINE_WHEN_OMITTED,
  CAST_SWAP_ENGINES,
  CAST_SWAP_POST_PROMPT_MAX,
  CAST_SWAP_RESOLUTIONS_BY_ENGINE,
  TREND_PROMPT_LIMITS,
  castSwapEngineHasDraft,
  CAST_SWAP_KLING_LENGTHS,
  CAST_SWAP_KLING_LENGTH_WHEN_OMITTED,
  CAST_SWAP_KLING_MAX_IMAGES,
  CAST_SWAP_ENGINE_IDS_ACCEPTED,
  CAST_SWAP_ENGINE_OF_NODARO_MOTION,
  NODARO_MOTION_ENGINES,
  NODARO_MOTION_ENGINE_NAMES,
  NODARO_MOTION_ENGINE_OF_CAST_SWAP,
  NODARO_MOTION_LEGACY_ENGINES,
  NODARO_MOTION_LEGACY_ENGINE_OF,
  NODARO_MOTION_EARLIER_ENGINES_OF,
  nodaroMotionEngineFrom,
  castSwapEngineFrom,
  nodaroMotionEngineName,
  nodaroMotionEngineOf,
} from "../cast-swap-limits.js"

describe("Cast Swap limits", () => {
  it("pins the post prompt cap and a trend's prompt limits", () => {
    expect(CAST_SWAP_POST_PROMPT_MAX).toBe(4000)
    expect(TREND_PROMPT_LIMITS).toEqual({ trendPromptMax: 3000, prePromptMax: 3000, detailsMax: 1000, engineTextReserve: 17_000 })
  })

  it("leaves a new trend prompt 2998 characters: the post prompt less the details and the blank line", () => {
    expect(CAST_SWAP_POST_PROMPT_MAX - 2 - TREND_PROMPT_LIMITS.detailsMax).toBe(2998)
  })

  it("pins the face masking bounds, and every default sits inside them", () => {
    expect(CAST_SWAP_FACE_MASKING_BOUNDS).toEqual({
      faceHeightPct: [0, 100],
      zonePct: [0, 49],
      blurStrengthPct: [0.1, 5],
      threshold: [0.05, 0.95],
    })
    const inside = (v: number, [lo, hi]: readonly [number, number]) => v >= lo && v <= hi
    const b = CAST_SWAP_FACE_MASKING_BOUNDS
    const d = CAST_SWAP_FACE_MASKING_DEFAULTS
    expect(inside(d.minFaceHeightPct, b.faceHeightPct)).toBe(true)
    expect(inside(d.maxFaceHeightPct, b.faceHeightPct)).toBe(true)
    expect(inside(d.zonePct, b.zonePct)).toBe(true)
    for (const side of ["leftPct", "rightPct", "topPct", "bottomPct"] as const) expect(inside(d.zone[side], b.zonePct), side).toBe(true)
    expect(inside(d.blurStrengthPct, b.blurStrengthPct)).toBe(true)
    expect(inside(d.threshold, b.threshold)).toBe(true)
  })

  it("covers a masked face with a blur by default", () => {
    expect(CAST_SWAP_FACE_MASKING_DEFAULTS.fill).toBe("blur")
  })

  it("masks the face, the whole head or the whole person, the head by default", () => {
    expect(CAST_SWAP_FACE_MASK_TARGETS).toEqual(["face", "head", "body"])
    expect(CAST_SWAP_FACE_MASKING_DEFAULTS.target).toBe("head")
    expect(CAST_SWAP_FACE_MASK_TARGETS).toContain(CAST_SWAP_FACE_MASKING_DEFAULTS.target)
  })

  it("offers a direct run two styles, Precise and Motion", () => {
    expect(CAST_SWAP_STYLES).toEqual(["precise", "motion"])
  })

  it("leaves 10 % margins at the left and right when the zone is left out", () => {
    expect(CAST_SWAP_FACE_MASKING_DEFAULTS.zone).toEqual({ leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 })
  })

  it("runs on Seedance 2.5 or Kling 4, Seedance when no engine is named", () => {
    expect(CAST_SWAP_ENGINES).toEqual(["seedance-2-5", "kling-4"])
    expect(CAST_SWAP_ENGINE_WHEN_OMITTED).toBe("seedance-2-5")
  })

  it("offers Kling 4 720p and 1080p with no draft, and Seedance 2.5 its 480p draft first", () => {
    expect(CAST_SWAP_RESOLUTIONS_BY_ENGINE).toEqual({ "seedance-2-5": ["480p", "720p", "1080p"], "kling-4": ["720p", "1080p"] })
    expect(castSwapEngineHasDraft("seedance-2-5")).toBe(true)
    expect(castSwapEngineHasDraft("kling-4")).toBe(false)
  })

  it("fits a Kling 4 run's length by cutting the end, unless a trend or run says otherwise", () => {
    expect(CAST_SWAP_KLING_LENGTHS).toEqual(["cut-end", "cut-start"])
    expect(CAST_SWAP_KLING_LENGTH_WHEN_OMITTED).toBe("cut-end")
  })

  it("caps a Kling 4 run at 10 images", () => {
    expect(CAST_SWAP_KLING_MAX_IMAGES).toBe(10)
  })

  it("names the two engines Nodaro Prism and Nodaro Pulse, with public ids that map one-to-one onto the internal ones", () => {
    expect(NODARO_MOTION_ENGINES).toEqual(["nodaro-prism", "nodaro-pulse"])
    // The earlier ids are keys too, answering the engine they became (code written against them reads no undefined).
    expect(NODARO_MOTION_ENGINE_NAMES).toEqual({
      "nodaro-prism": "Nodaro Prism",
      "nodaro-pulse": "Nodaro Pulse",
      "motion-prism": "Nodaro Prism",
      "motion-pulse": "Nodaro Pulse",
      "motion-pro": "Nodaro Prism",
      "motion-lite": "Nodaro Pulse",
    })
    expect(CAST_SWAP_ENGINE_OF_NODARO_MOTION).toEqual({
      "nodaro-prism": "seedance-2-5",
      "nodaro-pulse": "kling-4",
      "motion-prism": "seedance-2-5",
      "motion-pulse": "kling-4",
      "motion-pro": "seedance-2-5",
      "motion-lite": "kling-4",
    })
    for (const [legacy, pub] of Object.entries(NODARO_MOTION_LEGACY_ENGINES)) {
      expect(NODARO_MOTION_ENGINE_NAMES[legacy as keyof typeof NODARO_MOTION_ENGINE_NAMES]).toBe(NODARO_MOTION_ENGINE_NAMES[pub])
      expect(CAST_SWAP_ENGINE_OF_NODARO_MOTION[legacy as keyof typeof CAST_SWAP_ENGINE_OF_NODARO_MOTION]).toBe(CAST_SWAP_ENGINE_OF_NODARO_MOTION[pub])
    }
    // Total and inverse both ways: every internal engine has exactly one public id.
    for (const engine of CAST_SWAP_ENGINES) {
      const pub = nodaroMotionEngineOf(engine)
      expect(CAST_SWAP_ENGINE_OF_NODARO_MOTION[pub]).toBe(engine)
      expect(NODARO_MOTION_ENGINE_OF_CAST_SWAP[engine]).toBe(pub)
    }
    for (const pub of NODARO_MOTION_ENGINES) expect(nodaroMotionEngineOf(CAST_SWAP_ENGINE_OF_NODARO_MOTION[pub])).toBe(pub)
    expect(new Set(Object.values(NODARO_MOTION_ENGINE_OF_CAST_SWAP)).size).toBe(CAST_SWAP_ENGINES.length)
    expect(nodaroMotionEngineName("seedance-2-5")).toBe("Nodaro Prism")
    expect(nodaroMotionEngineName("kling-4")).toBe("Nodaro Pulse")
  })

  it("maps every earlier public id onto the current one, and lists each current id's earlier ids newest first", () => {
    expect(NODARO_MOTION_LEGACY_ENGINES).toEqual({
      "motion-prism": "nodaro-prism",
      "motion-pulse": "nodaro-pulse",
      "motion-pro": "nodaro-prism",
      "motion-lite": "nodaro-pulse",
    })
    expect(NODARO_MOTION_LEGACY_ENGINE_OF).toEqual({ "nodaro-prism": "motion-prism", "nodaro-pulse": "motion-pulse" })
    expect(NODARO_MOTION_EARLIER_ENGINES_OF).toEqual({
      "nodaro-prism": ["motion-prism", "motion-pro"],
      "nodaro-pulse": ["motion-pulse", "motion-lite"],
    })
    // The inverse is total: every earlier id is listed under the id it became, and nowhere else.
    const listed = Object.entries(NODARO_MOTION_EARLIER_ENGINES_OF).flatMap(([pub, earlier]) => earlier.map((id) => [id, pub]))
    expect(Object.fromEntries(listed)).toEqual(NODARO_MOTION_LEGACY_ENGINES)
    for (const pub of NODARO_MOTION_ENGINES) expect(NODARO_MOTION_EARLIER_ENGINES_OF[pub][0]).toBe(NODARO_MOTION_LEGACY_ENGINE_OF[pub])
  })

  it("reads an engine named in any vocabulary, and nothing else", () => {
    expect(castSwapEngineFrom("nodaro-prism")).toBe("seedance-2-5")
    expect(castSwapEngineFrom("nodaro-pulse")).toBe("kling-4")
    expect(castSwapEngineFrom("motion-prism")).toBe("seedance-2-5")
    expect(castSwapEngineFrom("motion-pulse")).toBe("kling-4")
    expect(castSwapEngineFrom("motion-pro")).toBe("seedance-2-5")
    expect(castSwapEngineFrom("motion-lite")).toBe("kling-4")
    expect(castSwapEngineFrom("seedance-2-5")).toBe("seedance-2-5")
    expect(castSwapEngineFrom("kling-4")).toBe("kling-4")
    for (const other of ["kling-3", "Motion-Pro", "Motion-Prism", "Nodaro-Prism", "prism", "", "toString", "__proto__", undefined, null, 4, {}]) {
      expect(castSwapEngineFrom(other), String(other)).toBeUndefined()
      expect(nodaroMotionEngineFrom(other), String(other)).toBeUndefined()
    }
    expect(CAST_SWAP_ENGINE_IDS_ACCEPTED).toEqual([
      "nodaro-prism",
      "nodaro-pulse",
      "motion-prism",
      "motion-pulse",
      "motion-pro",
      "motion-lite",
      "seedance-2-5",
      "kling-4",
    ])
    for (const id of CAST_SWAP_ENGINE_IDS_ACCEPTED) expect(castSwapEngineFrom(id)).toBeDefined()
    // Every earlier id answers the current one.
    expect(nodaroMotionEngineFrom("motion-pro")).toBe("nodaro-prism")
    expect(nodaroMotionEngineFrom("motion-prism")).toBe("nodaro-prism")
    expect(nodaroMotionEngineFrom("kling-4")).toBe("nodaro-pulse")
    expect(nodaroMotionEngineFrom("motion-pulse")).toBe("nodaro-pulse")
    expect(nodaroMotionEngineFrom("nodaro-pulse")).toBe("nodaro-pulse")
  })
})
