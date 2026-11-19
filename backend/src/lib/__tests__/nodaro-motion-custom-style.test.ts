import { afterEach, describe, expect, it, vi } from "vitest"
import {
  CUSTOM_STYLE_INSTRUCTIONS_STORED_MAX_CHARS,
  CUSTOM_STYLE_MODEL_MAX_CHARS,
  NODARO_MOTION_CUSTOM_STYLE_KEY,
  customStyleEnabled,
  customStyleForPlugin,
  engineTakesCustomStyle,
  nodaroMotionCustomStyleSchema,
  parseNodaroMotionCustomStyle,
  withoutDefaultCustomStyle,
} from "../nodaro-motion-custom-style.js"
import { customStyleOfferedByDefault } from "../nodaro-motion-custom-style-default.js"
import { __resetSurfaceProfileCacheForTests, surfaceGateOpen } from "../surface-profile.js"

/**
 * `nodaro_motion_custom_style`: whether this deployment offers Video Remake's
 * custom style (the style in the person's own words), and the admin's own
 * instructions and model for the engine's two LLM steps.
 *
 * What must hold:
 *  - `enabled` is the admin's choice only once one was made; without one the
 *    deployment's default decides (on for Nodaro's own deployment, off under
 *    a white-label surface profile), and a saved choice wins either way;
 *  - the engine is always answered an object whose `enabled` is resolved;
 *  - the stored row is read field by field: one bad field drops alone.
 */
describe("nodaro_motion_custom_style", () => {
  it("is the app_settings row nodaro_motion_custom_style", () => {
    expect(NODARO_MOTION_CUSTOM_STYLE_KEY).toBe("nodaro_motion_custom_style")
  })

  it("an admin's save is strict: the switch and the two steps, nothing else", () => {
    for (const good of [{}, { enabled: true }, { enabled: false }, { medium: {} }, { medium: { instructions: "Read the words.", model: "some-model" }, describe: { model: "another-model" } }]) {
      expect(nodaroMotionCustomStyleSchema.safeParse(good).success, JSON.stringify(good)).toBe(true)
    }
    for (const bad of [
      { enabled: "true" },
      { enabled: null },
      { engine: "nodaro-prism" },
      { medium: "Read the words." },
      { medium: { instructions: 1 } },
      { medium: { prompt: "x" } },
      { describe: { model: ["a"] } },
      { medium: { instructions: "x".repeat(CUSTOM_STYLE_INSTRUCTIONS_STORED_MAX_CHARS + 1) } },
      { describe: { model: "m".repeat(CUSTOM_STYLE_MODEL_MAX_CHARS + 1) } },
      true,
      null,
      [],
    ]) {
      expect(nodaroMotionCustomStyleSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it("stores the switch only when an admin chose a value, and a step only when it holds something", () => {
    expect(withoutDefaultCustomStyle(null)).toEqual({})
    expect(withoutDefaultCustomStyle({})).toEqual({})
    expect(withoutDefaultCustomStyle({ enabled: false })).toEqual({ enabled: false })
    expect(withoutDefaultCustomStyle({ enabled: true, medium: {}, describe: { instructions: "   ", model: " " } })).toEqual({ enabled: true })
    expect(withoutDefaultCustomStyle({ medium: { instructions: " Read the words.\n", model: " some-model " }, describe: { model: "another-model" } })).toEqual({
      // The instructions as written, the model trimmed.
      medium: { instructions: " Read the words.\n", model: "some-model" },
      describe: { model: "another-model" },
    })
  })

  it("reads the stored row field by field: a bad field drops alone, with a warning", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionCustomStyle(null, warn)).toBeNull()
    expect(parseNodaroMotionCustomStyle("on", warn)).toBeNull()
    expect(parseNodaroMotionCustomStyle([], warn)).toBeNull()
    expect(parseNodaroMotionCustomStyle({}, warn)).toEqual({})
    expect(warn).not.toHaveBeenCalled()
    // A key this build does not know is ignored; nothing else is dropped for it.
    expect(parseNodaroMotionCustomStyle({ enabled: false, later: { a: 1 }, medium: { model: "some-model", later: true } }, warn)).toEqual({ enabled: false, medium: { model: "some-model" } })
    expect(warn).not.toHaveBeenCalled()
    expect(
      parseNodaroMotionCustomStyle({ enabled: "yes", medium: "text", describe: { instructions: 7, model: "another-model" } }, warn),
    ).toEqual({ describe: { model: "another-model" } })
    expect(warn).toHaveBeenCalledTimes(3)
    for (const [msg] of warn.mock.calls) expect(msg).toContain(NODARO_MOTION_CUSTOM_STYLE_KEY)
  })

  it("resolves the switch: the admin's saved choice, else the deployment's default", () => {
    for (const setting of [null, undefined, {}, { medium: { model: "some-model" } }]) {
      expect(customStyleEnabled(setting, true), JSON.stringify(setting)).toBe(true)
      expect(customStyleEnabled(setting, false), JSON.stringify(setting)).toBe(false)
    }
    expect(customStyleEnabled({ enabled: true }, false)).toBe(true)
    expect(customStyleEnabled({ enabled: false }, true)).toBe(false)
  })

  it("answers the engine an object every time, `enabled` resolved, the admin's steps as stored, in new objects", () => {
    expect(customStyleForPlugin(null, true)).toStrictEqual({ enabled: true })
    expect(customStyleForPlugin(null, false)).toStrictEqual({ enabled: false })
    expect(customStyleForPlugin({ enabled: true }, false)).toStrictEqual({ enabled: true })
    const saved = { enabled: false, medium: { instructions: "Read the words." }, describe: { model: "another-model" } }
    const got = customStyleForPlugin(saved, true)
    expect(got).toStrictEqual({ enabled: false, medium: { instructions: "Read the words." }, describe: { model: "another-model" } })
    expect(got.medium).not.toBe(saved.medium)
  })

  it("an engine takes a custom style only when it declares castSwap.customStyle", () => {
    expect(engineTakesCustomStyle({ customStyle: true })).toBe(true)
    for (const cs of [undefined, {}, { customStyle: false }]) expect(engineTakesCustomStyle(cs), JSON.stringify(cs)).toBe(false)
  })
})

describe("the deployment's default for a custom style", () => {
  const REAL_ENV = process.env.NODARO_SURFACE_PROFILE
  function configure(profile: unknown | undefined): void {
    if (profile === undefined) delete process.env.NODARO_SURFACE_PROFILE
    else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
    __resetSurfaceProfileCacheForTests()
  }
  afterEach(() => {
    if (REAL_ENV === undefined) delete process.env.NODARO_SURFACE_PROFILE
    else process.env.NODARO_SURFACE_PROFILE = REAL_ENV
    __resetSurfaceProfileCacheForTests()
  })

  it("is on for Nodaro's own deployment (no profile, or one that keeps the platform's header)", () => {
    configure(undefined)
    expect(customStyleOfferedByDefault()).toBe(true)
    configure({ header: "default" })
    expect(customStyleOfferedByDefault()).toBe(true)
    configure({ brand: { productName: "Acme" } })
    expect(customStyleOfferedByDefault()).toBe(true)
  })

  it("is off under a white-label surface profile", () => {
    // The profile is read only where the edition takes one (this suite's does).
    expect(surfaceGateOpen()).toBe(true)
    configure({ header: "white-label" })
    expect(customStyleOfferedByDefault()).toBe(false)
  })
})
