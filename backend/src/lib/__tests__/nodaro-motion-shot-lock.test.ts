import { describe, expect, it, vi } from "vitest"
import { getStyle } from "@nodaro/prompts/pickers"
import {
  NODARO_MOTION_SHOT_LOCK_CUSTOM_STYLE,
  NODARO_MOTION_SHOT_LOCK_KEY,
  NODARO_MOTION_SHOT_LOCK_RUN_TYPES,
  anyShotLockOn,
  engineTakesShotLock,
  engineTakesShotLockRunTypes,
  nodaroMotionShotLockSchema,
  parseNodaroMotionShotLock,
  shotLockAsEngineReads,
  shotLockForPlugin,
  shotLockMayBeOn,
  shotLockNeedsRunTypes,
  shotLockRunTypesOf,
  shotLockShownOn,
  shotLocksOn,
  type NodaroMotionShotLock,
} from "../nodaro-motion-shot-lock.js"

/** One engine's ordinary switch, as the tests from before run types read it. */
const shotLockOf = (setting: NodaroMotionShotLock | null | undefined, engine: "nodaro-prism" | "nodaro-pulse") => (shotLockRunTypesOf(setting, engine).ordinary ? "on" : "off")

/**
 * `nodaro_motion_shot_lock`: per Video Remake engine, whether a direct run's
 * prompt on an ordinary clip carries the shot lock's line.
 *
 * What must hold:
 *  - off everywhere until an admin turns an engine on: no deployment default;
 *  - "off" is the same as left out, and is never stored or answered;
 *  - the engine is answered each engine that is on under its current and its
 *    earlier keys, or null when none is.
 */
describe("nodaro_motion_shot_lock", () => {
  it("is the app_settings row nodaro_motion_shot_lock", () => {
    expect(NODARO_MOTION_SHOT_LOCK_KEY).toBe("nodaro_motion_shot_lock")
  })

  it("an admin's save is strict: \"off\" or \"on\" per public engine id", () => {
    for (const good of [{}, { "nodaro-prism": "on" }, { "nodaro-prism": "off", "nodaro-pulse": "on" }]) {
      expect(nodaroMotionShotLockSchema.safeParse(good).success, JSON.stringify(good)).toBe(true)
    }
    for (const bad of [{ "nodaro-prism": true }, { "nodaro-prism": "yes" }, { "seedance-2-5": "on" }, { enabled: true }, "on", null]) {
      expect(nodaroMotionShotLockSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it("is off for every engine with nothing saved, and for an engine left out", () => {
    for (const setting of [null, undefined, {}]) {
      expect(shotLockOf(setting, "nodaro-prism"), JSON.stringify(setting)).toBe("off")
      expect(shotLockOf(setting, "nodaro-pulse"), JSON.stringify(setting)).toBe("off")
      expect(anyShotLockOn(setting)).toBe(false)
    }
    expect(shotLockOf({ "nodaro-pulse": "on" }, "nodaro-prism")).toBe("off")
    expect(shotLockOf({ "nodaro-pulse": "on" }, "nodaro-pulse")).toBe("on")
    expect(anyShotLockOn({ "nodaro-pulse": "on" })).toBe(true)
    expect(anyShotLockOn({ "nodaro-prism": "off" })).toBe(false)
  })

  it("stores only the engines that are on, in a new object", () => {
    const setting = { "nodaro-prism": "off", "nodaro-pulse": "on" } as const
    expect(shotLocksOn(setting)).toEqual({ "nodaro-pulse": "on" })
    expect(shotLocksOn(setting)).not.toBe(setting)
    expect(shotLocksOn({ "nodaro-prism": "off" })).toEqual({})
  })

  it("answers the engine each engine that is on under its current and its earlier keys, null when none is", () => {
    expect(shotLockForPlugin(null)).toBeNull()
    expect(shotLockForPlugin({})).toBeNull()
    expect(shotLockForPlugin({ "nodaro-prism": "off" })).toBeNull()
    expect(shotLockForPlugin({ "nodaro-prism": "on" })).toEqual({ "nodaro-prism": "on", "motion-prism": "on", "motion-pro": "on" })
    expect(shotLockForPlugin({ "nodaro-prism": "on", "nodaro-pulse": "on" })).toEqual({
      "nodaro-prism": "on",
      "motion-prism": "on",
      "motion-pro": "on",
      "nodaro-pulse": "on",
      "motion-pulse": "on",
      "motion-lite": "on",
    })
  })

  it("reads the stored row tolerantly: an earlier key as the current one, an invalid value dropped with a warning", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionShotLock(null, warn)).toBeNull()
    expect(parseNodaroMotionShotLock({}, warn)).toEqual({})
    expect(parseNodaroMotionShotLock({ "nodaro-prism": "on", "nodaro-pulse": "off" }, warn)).toEqual({ "nodaro-prism": "on" })
    expect(parseNodaroMotionShotLock({ "motion-pulse": "on" }, warn)).toEqual({ "nodaro-pulse": "on" })
    expect(warn).not.toHaveBeenCalled()
    expect(parseNodaroMotionShotLock({ "nodaro-prism": "always", "nodaro-pulse": "on" }, warn)).toEqual({ "nodaro-pulse": "on" })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain(NODARO_MOTION_SHOT_LOCK_KEY)
  })

  it("an engine writes the line only when it declares castSwap.shotLock", () => {
    expect(engineTakesShotLock({ shotLock: true })).toBe(true)
    for (const cs of [undefined, {}, { shotLock: false }, { previz: true }]) expect(engineTakesShotLock(cs as never), JSON.stringify(cs)).toBe(false)
  })

  /**
   * BY RUN TYPE: per engine, a switch per run type and per-style exceptions.
   *
   * What must hold:
   *  - a value from before run types means what it meant: "on" is ordinary
   *    and art style with roles, never art style alone; "off" is all off;
   *  - what says exactly that is stored as "on", so a row that never uses the
   *    run types is the row of before;
   *  - an engine that does not read run types is answered only "on" entries:
   *    an entry by run type is off there, never on by accident;
   *  - an engine that takes no art style has its ordinary switch alone.
   */
  describe("by run type", () => {
    const TYPES = NODARO_MOTION_SHOT_LOCK_RUN_TYPES

    it("a value from before run types: \"on\" is ordinary + art style with roles, never art style alone; \"off\" is all off", () => {
      expect(shotLockRunTypesOf({ "nodaro-prism": "on" }, "nodaro-prism")).toEqual({ ordinary: true, styleWithRoles: true, styleAlone: false, styles: {} })
      for (const off of [null, undefined, {}, { "nodaro-prism": "off" } as const]) {
        expect(shotLockRunTypesOf(off, "nodaro-prism")).toEqual({ ordinary: false, styleWithRoles: false, styleAlone: false, styles: {} })
      }
      // An engine that takes no art style: its ordinary switch alone.
      expect(shotLockRunTypesOf({ "nodaro-pulse": "on" }, "nodaro-pulse")).toEqual({ ordinary: true, styleWithRoles: false, styleAlone: false, styles: {} })
    })

    it("each switch is read on its own; one left out is off", () => {
      for (const on of TYPES) {
        const r = shotLockRunTypesOf({ "nodaro-prism": { [on]: "on" } }, "nodaro-prism")
        for (const t of TYPES) expect(r[t], `${on} on: ${t}`).toBe(t === on)
        const others = shotLockRunTypesOf({ "nodaro-prism": Object.fromEntries(TYPES.map((t) => [t, t === on ? "off" : "on"])) }, "nodaro-prism")
        for (const t of TYPES) expect(others[t], `${on} off: ${t}`).toBe(t !== on)
      }
    })

    it("an admin's save is strict: either shape per engine; an art-style switch or an exception on an engine that takes no art style is refused", () => {
      const good = [
        { "nodaro-prism": { ordinary: "on", styleWithRoles: "off", styleAlone: "on", styles: { cinematic: "off", custom: "on" } } },
        { "nodaro-prism": {}, "nodaro-pulse": { ordinary: "on" } },
        { "nodaro-prism": { styles: {} } },
      ]
      for (const s of good) expect(nodaroMotionShotLockSchema.safeParse(s).success, JSON.stringify(s)).toBe(true)
      const bad = [
        { "nodaro-prism": { ordinary: true } },
        { "nodaro-prism": { ordinary: "on", extra: "on" } },
        { "nodaro-prism": { styles: { cinematic: "yes" } } },
        { "nodaro-prism": { styles: { "Not An Id": "on" } } },
        { "nodaro-prism": { styles: ["cinematic"] } },
        { "nodaro-pulse": { styleAlone: "on" } },
        { "nodaro-pulse": { styleWithRoles: "off" } },
        { "nodaro-pulse": { ordinary: "on", styles: { cinematic: "on" } } },
      ]
      for (const s of bad) expect(nodaroMotionShotLockSchema.safeParse(s).success, JSON.stringify(s)).toBe(false)
    })

    it("the custom style's key is reserved: no catalog style has it", () => {
      expect(NODARO_MOTION_SHOT_LOCK_CUSTOM_STYLE).toBe("custom")
      expect(getStyle(NODARO_MOTION_SHOT_LOCK_CUSTOM_STYLE)).toBeUndefined()
    })

    it("is stored as what turns something on: \"on\" when it says exactly what \"on\" says, an entry that turns nothing on left out", () => {
      expect(shotLocksOn({ "nodaro-prism": { ordinary: "on", styleWithRoles: "on" } })).toEqual({ "nodaro-prism": "on" })
      expect(shotLocksOn({ "nodaro-prism": { ordinary: "on", styleWithRoles: "on", styleAlone: "off", styles: {} } })).toEqual({ "nodaro-prism": "on" })
      expect(shotLocksOn({ "nodaro-prism": "on" })).toEqual({ "nodaro-prism": "on" })
      expect(shotLocksOn({ "nodaro-prism": { ordinary: "on", styleWithRoles: "off", styleAlone: "on" } })).toEqual({ "nodaro-prism": { ordinary: "on", styleAlone: "on" } })
      expect(shotLocksOn({ "nodaro-prism": { ordinary: "on", styleWithRoles: "on", styles: { cinematic: "off" } } })).toEqual({
        "nodaro-prism": { ordinary: "on", styleWithRoles: "on", styles: { cinematic: "off" } },
      })
      // All switches off, one style on: that style's runs carry the line.
      expect(shotLocksOn({ "nodaro-prism": { styles: { cinematic: "on", anime: "off" } } })).toEqual({ "nodaro-prism": { styles: { cinematic: "on", anime: "off" } } })
      // Nothing on at all: an "off" exception alone turns nothing on, so nothing is stored.
      const nothingOn: NonNullable<NodaroMotionShotLock["nodaro-prism"]>[] = [{}, { ordinary: "off" }, { styles: {} }, { styles: { cinematic: "off" } }]
      for (const none of nothingOn) {
        expect(shotLocksOn({ "nodaro-prism": none }), JSON.stringify(none)).toEqual({})
        expect(anyShotLockOn({ "nodaro-prism": none })).toBe(false)
      }
      // An engine that takes no art style: "on" or nothing.
      expect(shotLocksOn({ "nodaro-pulse": { ordinary: "on" } })).toEqual({ "nodaro-pulse": "on" })
      expect(shotLocksOn({ "nodaro-pulse": { ordinary: "off" } })).toEqual({})
      const setting = { "nodaro-prism": { styleAlone: "on", styles: { cinematic: "off" } } } as const
      expect(shotLocksOn(setting)["nodaro-prism"]).not.toBe(setting["nodaro-prism"])
    })

    it("needs an engine that reads run types only when it says more than \"on\" can", () => {
      for (const plain of [null, {}, { "nodaro-prism": "on" }, { "nodaro-prism": { ordinary: "on", styleWithRoles: "on" } }, { "nodaro-pulse": { ordinary: "on" } }, { "nodaro-prism": { styles: { cinematic: "off" } } }] as const) {
        expect(shotLockNeedsRunTypes(plain), JSON.stringify(plain)).toBe(false)
      }
      for (const more of [{ "nodaro-prism": { ordinary: "on" } }, { "nodaro-prism": { styleAlone: "on" } }, { "nodaro-prism": { ordinary: "on", styleWithRoles: "on", styleAlone: "on" } }, { "nodaro-prism": { styles: { cinematic: "on" } } }, { "nodaro-prism": { ordinary: "on", styleWithRoles: "on", styles: { cinematic: "off" } } }] as const) {
        expect(shotLockNeedsRunTypes(more), JSON.stringify(more)).toBe(true)
        expect(anyShotLockOn(more)).toBe(true)
      }
    })

    it("an engine that reads run types is answered the entry as stored; one that does not, only \"on\" entries (an entry by run type is off there)", () => {
      const setting = { "nodaro-prism": { ordinary: "on", styleAlone: "on", styles: { cinematic: "off" } }, "nodaro-pulse": "on" } as const
      expect(shotLockForPlugin(setting, { shotLockRunTypes: true })).toEqual({
        "nodaro-prism": { ordinary: "on", styleAlone: "on", styles: { cinematic: "off" } },
        "motion-prism": { ordinary: "on", styleAlone: "on", styles: { cinematic: "off" } },
        "motion-pro": { ordinary: "on", styleAlone: "on", styles: { cinematic: "off" } },
        "nodaro-pulse": "on",
        "motion-pulse": "on",
        "motion-lite": "on",
      })
      for (const cs of [undefined, {}, { shotLockRunTypes: false }]) {
        expect(shotLockForPlugin(setting, cs), JSON.stringify(cs)).toEqual({ "nodaro-pulse": "on", "motion-pulse": "on", "motion-lite": "on" })
        expect(shotLockForPlugin({ "nodaro-prism": { styleAlone: "on" } }, cs)).toBeNull()
        // A value from before run types is answered to every engine, as before.
        expect(shotLockForPlugin({ "nodaro-prism": "on" }, cs)).toEqual({ "nodaro-prism": "on", "motion-prism": "on", "motion-pro": "on" })
        expect(shotLockAsEngineReads({ "nodaro-prism": { ordinary: "on", styleWithRoles: "on" } }, cs)).toEqual({ "nodaro-prism": "on" })
      }
      expect(shotLockForPlugin({ "nodaro-prism": "on" }, { shotLockRunTypes: true })).toEqual({ "nodaro-prism": "on", "motion-prism": "on", "motion-pro": "on" })
    })

    it("reads the stored row tolerantly in either shape: an invalid entry dropped with a warning, the other engine kept", () => {
      const warn = vi.fn()
      expect(parseNodaroMotionShotLock({ "motion-prism": { styleAlone: "on", styleWithRoles: "off", styles: { cinematic: "off" } }, "nodaro-pulse": "on" }, warn)).toEqual({
        "nodaro-prism": { styleAlone: "on", styles: { cinematic: "off" } },
        "nodaro-pulse": "on",
      })
      // An engine that takes no art style keeps its ordinary switch alone, whatever a hand-written row says of the rest.
      expect(parseNodaroMotionShotLock({ "nodaro-pulse": { ordinary: "on", styleAlone: "on", styles: { cinematic: "on" } } }, warn)).toEqual({ "nodaro-pulse": "on" })
      expect(parseNodaroMotionShotLock({ "nodaro-pulse": { styleAlone: "on" } }, warn)).toEqual({})
      expect(warn).not.toHaveBeenCalled()
      expect(parseNodaroMotionShotLock({ "nodaro-prism": { ordinary: "on", styleAlone: "always" }, "nodaro-pulse": "on" }, warn)).toEqual({ "nodaro-pulse": "on" })
      expect(warn).toHaveBeenCalledTimes(1)
    })

    it("a preview shows the run its tab is: Precise and Motion a run with no art style, style-only a style-only run, previz never", () => {
      const s = { "nodaro-prism": { styleWithRoles: "on", styleAlone: "on", styles: { cinematic: "on" } }, "nodaro-pulse": "on" } as const
      expect(shotLockShownOn(s, "nodaro-prism", "precise")).toBe("off")
      expect(shotLockShownOn(s, "nodaro-prism", "motion")).toBe("off")
      expect(shotLockShownOn(s, "nodaro-prism", "styleOnly")).toBe("on")
      expect(shotLockShownOn(s, "nodaro-prism", "previz")).toBe("off")
      expect(shotLockShownOn(s, "nodaro-pulse", "precise")).toBe("on")
      expect(shotLockShownOn({ "nodaro-prism": "on" }, "nodaro-prism", "motion")).toBe("on")
      expect(shotLockShownOn({ "nodaro-prism": "on" }, "nodaro-prism", "styleOnly")).toBe("off")
      expect(shotLockShownOn(null, "nodaro-prism", "precise")).toBe("off")
    })

    it("a check asks for the line whenever some run made with the entry may carry it", () => {
      const may = (entry: NodaroMotionShotLock["nodaro-prism"]) => (["precise", "motion", "styleOnly", "previz"] as const).map((k) => shotLockMayBeOn({ "nodaro-prism": entry }, "nodaro-prism", k))
      expect(may(undefined)).toEqual(["off", "off", "off", "off"])
      expect(may("on")).toEqual(["on", "on", "off", "off"])
      expect(may({ ordinary: "on" })).toEqual(["on", "on", "off", "off"])
      expect(may({ styleWithRoles: "on" })).toEqual(["on", "on", "off", "off"])
      expect(may({ styleAlone: "on" })).toEqual(["off", "off", "on", "off"])
      // A style's "on" exception reaches a run with roles and a style-only run alike.
      expect(may({ styles: { cinematic: "on" } })).toEqual(["on", "on", "on", "off"])
      expect(may({ ordinary: "on", styles: { cinematic: "off" } })).toEqual(["on", "on", "off", "off"])
    })

    it("an engine reads run types only when it declares castSwap.shotLockRunTypes", () => {
      expect(engineTakesShotLockRunTypes({ shotLockRunTypes: true })).toBe(true)
      for (const cs of [undefined, {}, { shotLockRunTypes: false }, { shotLock: true }]) expect(engineTakesShotLockRunTypes(cs as never), JSON.stringify(cs)).toBe(false)
    })
  })
})
