import { describe, expect, expectTypeOf, it, vi } from "vitest"
import { CAST_SWAP_ENGINE_OF_NODARO_MOTION } from "@nodaro/shared/models"
import {
  NODARO_MOTION_NO_PERSON_KEY,
  anyNoPersonChange,
  engineTakesNoPersonSourceClip,
  noPersonForPlugin,
  nodaroMotionNoPersonSchema,
  parseNodaroMotionNoPerson,
  withoutDefaultNoPerson,
  type NodaroMotionNoPerson,
  type NodaroMotionNoPersonEntry,
} from "../nodaro-motion-no-person.js"
import type { PluginNodaroMotionNoPerson } from "../private-plugins/types.js"
import type { ByEngineForPlugin } from "../nodaro-motion-engine-keys.js"

/**
 * `nodaro_motion_no_person` (pure): whether a direct Precise run with no
 * pictured person sends its source clip, per engine. On is the default: only
 * an engine switched off is ever stored, Nodaro Motion Pulse included.
 */
describe("nodaro_motion_no_person", () => {
  it("is its own app_settings row", () => {
    expect(NODARO_MOTION_NO_PERSON_KEY).toBe("nodaro_motion_no_person")
  })

  it("an admin's save is strict: the current engine ids, each entry strict, off the only value of sourceClip", () => {
    for (const good of [{}, { "motion-prism": {} }, { "motion-prism": { sourceClip: false } }, { "motion-pulse": { sourceClip: false } }]) {
      expect(nodaroMotionNoPersonSchema.safeParse(good).success, JSON.stringify(good)).toBe(true)
    }
    for (const bad of [
      { "motion-prism": { sourceClip: true } },
      { "motion-prism": { sourceClip: null } },
      { "motion-prism": { sourceClip: "off" } },
      { "motion-prism": { sourceClip: false, extra: true } },
      { "motion-prism": { enginePrompt: { mode: "template" } } },
      { "motion-pro": { sourceClip: false } },
      { [CAST_SWAP_ENGINE_OF_NODARO_MOTION["motion-prism"]]: { sourceClip: false } },
      { "motion-prism": false },
      null,
    ]) {
      expect(nodaroMotionNoPersonSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it("keeps a Pulse entry that is switched off, on save and on read", () => {
    const pulse = { "motion-pulse": { sourceClip: false as const } }
    expect(nodaroMotionNoPersonSchema.parse(pulse)).toStrictEqual(pulse)
    expect(withoutDefaultNoPerson(pulse)).toStrictEqual(pulse)
    expect(parseNodaroMotionNoPerson(pulse)).toStrictEqual(pulse)
    expect(anyNoPersonChange(pulse)).toBe(true)
  })

  it("leaves an empty entry out of what is stored", () => {
    expect(withoutDefaultNoPerson({ "motion-prism": {} })).toStrictEqual({})
    expect(withoutDefaultNoPerson({ "motion-prism": {}, "motion-pulse": { sourceClip: false } })).toStrictEqual({ "motion-pulse": { sourceClip: false } })
    expect(withoutDefaultNoPerson(null)).toStrictEqual({})
    expect(withoutDefaultNoPerson(undefined)).toStrictEqual({})
  })

  it("hands back new objects", () => {
    const saved: NodaroMotionNoPerson = { "motion-prism": { sourceClip: false } }
    const kept = withoutDefaultNoPerson(saved)
    expect(kept).toStrictEqual(saved)
    expect(kept).not.toBe(saved)
    expect(kept["motion-prism"]).not.toBe(saved["motion-prism"])
  })

  it("counts a change only when an engine is switched off", () => {
    expect(anyNoPersonChange(null)).toBe(false)
    expect(anyNoPersonChange(undefined)).toBe(false)
    expect(anyNoPersonChange({})).toBe(false)
    expect(anyNoPersonChange({ "motion-prism": {} })).toBe(false)
    expect(anyNoPersonChange({ "motion-prism": { sourceClip: false } })).toBe(true)
  })

  it("answers the plugin each changed engine under its current and its earlier key, null when nothing is changed", () => {
    const prism = noPersonForPlugin({ "motion-prism": { sourceClip: false } })
    expect(prism).toStrictEqual({ "motion-prism": { sourceClip: false }, "motion-pro": { sourceClip: false } })
    expect(prism!["motion-prism"]).not.toBe(prism!["motion-pro"])
    expect(noPersonForPlugin({ "motion-pulse": { sourceClip: false } })).toStrictEqual({ "motion-pulse": { sourceClip: false }, "motion-lite": { sourceClip: false } })
    expect(noPersonForPlugin(null)).toBeNull()
    expect(noPersonForPlugin(undefined)).toBeNull()
    expect(noPersonForPlugin({})).toBeNull()
    expect(noPersonForPlugin({ "motion-prism": {} })).toBeNull()
  })

  it("reads a stored row keyed by an earlier id as the current one, the current key winning", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionNoPerson({ "motion-pro": { sourceClip: false } }, warn)).toStrictEqual({ "motion-prism": { sourceClip: false } })
    expect(parseNodaroMotionNoPerson({ "motion-lite": { sourceClip: false } }, warn)).toStrictEqual({ "motion-pulse": { sourceClip: false } })
    expect(parseNodaroMotionNoPerson({ "motion-pro": { sourceClip: false }, "motion-prism": {} }, warn)).toStrictEqual({})
    expect(warn).not.toHaveBeenCalled()
  })

  it("reads a stored row tolerantly: a bad entry is dropped with a warning and the good one kept", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionNoPerson({ "motion-prism": { sourceClip: true }, "motion-pulse": { sourceClip: false } }, warn)).toStrictEqual({ "motion-pulse": { sourceClip: false } })
    expect(warn).toHaveBeenCalledOnce()
    warn.mockClear()
    expect(parseNodaroMotionNoPerson({ "motion-prism": { sourceClip: false, extra: 1 } }, warn)).toStrictEqual({})
    expect(warn).toHaveBeenCalledOnce()
  })

  it("reads not an object as never saved", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionNoPerson(undefined, warn)).toBeNull()
    expect(parseNodaroMotionNoPerson(null, warn)).toBeNull()
    expect(warn).not.toHaveBeenCalled()
    expect(parseNodaroMotionNoPerson("off", warn)).toBeNull()
    expect(parseNodaroMotionNoPerson([], warn)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it("an engine takes the setting only when it declares castSwap.noPersonSourceClip", () => {
    expect(engineTakesNoPersonSourceClip(undefined)).toBe(false)
    expect(engineTakesNoPersonSourceClip({})).toBe(false)
    expect(engineTakesNoPersonSourceClip({ noPersonSourceClip: false })).toBe(false)
    expect(engineTakesNoPersonSourceClip({ noPersonSourceClip: true })).toBe(true)
  })

  it("what the host answers is the plugin's PluginNodaroMotionNoPerson", () => {
    expectTypeOf<ByEngineForPlugin<NodaroMotionNoPersonEntry>>().toExtend<PluginNodaroMotionNoPerson>()
  })
})
