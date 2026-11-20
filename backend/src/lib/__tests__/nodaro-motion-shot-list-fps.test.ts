import { describe, expect, it, vi } from "vitest"
import {
  NODARO_MOTION_SHOT_LIST_FPS_DEFAULT,
  NODARO_MOTION_SHOT_LIST_FPS_KEY,
  NODARO_MOTION_SHOT_LIST_FPS_OPTIONS,
  engineTakesShotListFps,
  nodaroMotionShotListFpsSchema,
  parseNodaroMotionShotListFps,
  shotListFpsForPlugin,
  shotListFpsInEffect,
  withoutDefaultShotListFps,
} from "../nodaro-motion-shot-list-fps.js"

/**
 * Video Remake's shot-list frame rate (`nodaro_motion_shot_list_fps`): how
 * many frames a second the model that writes a run's shot list is shown.
 *
 * What must hold:
 *  - the rates offered run from 1 (the clip as it was read before) upwards,
 *    and the recommended default is one of them;
 *  - an admin's save is strict; the stored row is read field by field, so a
 *    value it does not know drops to the engine's default, never to 1;
 *  - the engine is answered the admin's rate, nothing while its own default
 *    decides, and 1 on a deployment that cannot serve a call with a rate.
 */
describe("the rates", () => {
  it("offers 1 first (the clip as before) and recommends 6", () => {
    expect(NODARO_MOTION_SHOT_LIST_FPS_KEY).toBe("nodaro_motion_shot_list_fps")
    expect([...NODARO_MOTION_SHOT_LIST_FPS_OPTIONS]).toEqual([1, 2, 3, 4, 6, 8, 12])
    expect(NODARO_MOTION_SHOT_LIST_FPS_DEFAULT).toBe(6)
    expect(NODARO_MOTION_SHOT_LIST_FPS_OPTIONS).toContain(NODARO_MOTION_SHOT_LIST_FPS_DEFAULT)
  })
})

describe("nodaroMotionShotListFpsSchema (what an admin saves)", () => {
  it("takes each rate offered, and no rate at all (the engine's default)", () => {
    for (const fps of NODARO_MOTION_SHOT_LIST_FPS_OPTIONS) expect(nodaroMotionShotListFpsSchema.parse({ fps })).toEqual({ fps })
    expect(nodaroMotionShotListFpsSchema.parse({})).toEqual({})
  })

  it("refuses a rate that is not offered, a value that is no number and an unknown key", () => {
    for (const value of [{ fps: 5 }, { fps: 0 }, { fps: 24 }, { fps: 6.5 }, { fps: "6" }, { fps: null }, { fps: 6, engine: "nodaro-prism" }, { rate: 6 }, 6, null]) {
      expect(nodaroMotionShotListFpsSchema.safeParse(value).success, JSON.stringify(value)).toBe(false)
    }
  })
})

describe("parseNodaroMotionShotListFps (the stored row)", () => {
  it("reads a rate offered, ignores an unknown key, and reads what is not an object as never saved", () => {
    expect(parseNodaroMotionShotListFps({ fps: 4 })).toEqual({ fps: 4 })
    expect(parseNodaroMotionShotListFps({ fps: 4, later: true })).toEqual({ fps: 4 })
    expect(parseNodaroMotionShotListFps({})).toEqual({})
    for (const value of [null, undefined, 6, "6", [6]]) expect(parseNodaroMotionShotListFps(value)).toBeNull()
  })

  it("reads a rate it does not offer as never chosen (the default, never 1), with a warning", () => {
    for (const fps of [5, 0, 24, "6", true]) {
      const warn = vi.fn()
      const parsed = parseNodaroMotionShotListFps({ fps }, warn)
      expect(parsed).toEqual({})
      expect(shotListFpsInEffect(parsed)).toBe(NODARO_MOTION_SHOT_LIST_FPS_DEFAULT)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]![0])).toContain("nodaro_motion_shot_list_fps")
    }
    const quiet = vi.fn()
    expect(parseNodaroMotionShotListFps({ fps: null }, quiet)).toEqual({})
    expect(quiet).not.toHaveBeenCalled()
  })
})

describe("the rate in effect and what is stored", () => {
  it("is the saved choice, else the recommended default", () => {
    expect(shotListFpsInEffect(null)).toBe(6)
    expect(shotListFpsInEffect(undefined)).toBe(6)
    expect(shotListFpsInEffect({})).toBe(6)
    expect(shotListFpsInEffect({ fps: 1 })).toBe(1)
    expect(shotListFpsInEffect({ fps: 12 })).toBe(12)
  })

  it("stores the rate only when an admin chose one, as a new object", () => {
    const saved = { fps: 8 as const }
    const stored = withoutDefaultShotListFps(saved)
    expect(stored).toEqual({ fps: 8 })
    expect(stored).not.toBe(saved)
    expect(withoutDefaultShotListFps({})).toEqual({})
    expect(withoutDefaultShotListFps(null)).toEqual({})
    expect(withoutDefaultShotListFps({ fps: 5 } as never)).toEqual({})
  })
})

describe("shotListFpsForPlugin (what the engine is answered)", () => {
  it("answers the admin's rate, and nothing while the engine's own default decides", () => {
    expect(shotListFpsForPlugin({ fps: 4 }, true)).toEqual({ fps: 4 })
    expect(shotListFpsForPlugin({ fps: 1 }, true)).toEqual({ fps: 1 })
    expect(shotListFpsForPlugin({}, true)).toEqual({})
    expect(shotListFpsForPlugin(null, true)).toEqual({})
  })

  it("answers 1 (the clip as before) on a deployment that cannot serve a call carrying a rate, whatever is saved", () => {
    for (const setting of [null, {}, { fps: 6 as const }, { fps: 12 as const }]) expect(shotListFpsForPlugin(setting, false)).toEqual({ fps: 1 })
  })

  it("an engine reads the row only when it declares castSwap.shotListFps", () => {
    expect(engineTakesShotListFps({ shotListFps: true })).toBe(true)
    for (const cs of [undefined, {}, { shotListFps: false }]) expect(engineTakesShotListFps(cs)).toBe(false)
  })
})
