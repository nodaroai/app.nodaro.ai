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
 * an engine switched off is ever stored, Nodaro Pulse included.
 */
describe("nodaro_motion_no_person", () => {
  it("is its own app_settings row", () => {
    expect(NODARO_MOTION_NO_PERSON_KEY).toBe("nodaro_motion_no_person")
  })

  it("an admin's save is strict: the current engine ids, each entry strict, off the only value of sourceClip", () => {
    for (const good of [{}, { "nodaro-prism": {} }, { "nodaro-prism": { sourceClip: false } }, { "nodaro-pulse": { sourceClip: false } }]) {
      expect(nodaroMotionNoPersonSchema.safeParse(good).success, JSON.stringify(good)).toBe(true)
    }
    for (const bad of [
      { "nodaro-prism": { sourceClip: true } },
      { "nodaro-prism": { sourceClip: null } },
      { "nodaro-prism": { sourceClip: "off" } },
      { "nodaro-prism": { sourceClip: false, extra: true } },
      { "nodaro-prism": { enginePrompt: { mode: "template" } } },
      { "motion-pro": { sourceClip: false } },
      { [CAST_SWAP_ENGINE_OF_NODARO_MOTION["nodaro-prism"]]: { sourceClip: false } },
      { "nodaro-prism": false },
      null,
    ]) {
      expect(nodaroMotionNoPersonSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it("keeps a Pulse entry that is switched off, on save and on read", () => {
    const pulse = { "nodaro-pulse": { sourceClip: false as const } }
    expect(nodaroMotionNoPersonSchema.parse(pulse)).toStrictEqual(pulse)
    expect(withoutDefaultNoPerson(pulse)).toStrictEqual(pulse)
    expect(parseNodaroMotionNoPerson(pulse)).toStrictEqual(pulse)
    expect(anyNoPersonChange(pulse)).toBe(true)
  })

  it("leaves an empty entry out of what is stored", () => {
    expect(withoutDefaultNoPerson({ "nodaro-prism": {} })).toStrictEqual({})
    expect(withoutDefaultNoPerson({ "nodaro-prism": {}, "nodaro-pulse": { sourceClip: false } })).toStrictEqual({ "nodaro-pulse": { sourceClip: false } })
    expect(withoutDefaultNoPerson(null)).toStrictEqual({})
    expect(withoutDefaultNoPerson(undefined)).toStrictEqual({})
  })

  it("hands back new objects", () => {
    const saved: NodaroMotionNoPerson = { "nodaro-prism": { sourceClip: false } }
    const kept = withoutDefaultNoPerson(saved)
    expect(kept).toStrictEqual(saved)
    expect(kept).not.toBe(saved)
    expect(kept["nodaro-prism"]).not.toBe(saved["nodaro-prism"])
  })

  it("counts a change only when an engine is switched off", () => {
    expect(anyNoPersonChange(null)).toBe(false)
    expect(anyNoPersonChange(undefined)).toBe(false)
    expect(anyNoPersonChange({})).toBe(false)
    expect(anyNoPersonChange({ "nodaro-prism": {} })).toBe(false)
    expect(anyNoPersonChange({ "nodaro-prism": { sourceClip: false } })).toBe(true)
  })

  it("answers the plugin each changed engine under its current and its earlier key, null when nothing is changed", () => {
    const prism = noPersonForPlugin({ "nodaro-prism": { sourceClip: false } })
    expect(prism).toStrictEqual({ "nodaro-prism": { sourceClip: false }, "motion-prism": { sourceClip: false }, "motion-pro": { sourceClip: false } })
    expect(prism!["nodaro-prism"]).not.toBe(prism!["motion-pro"])
    expect(noPersonForPlugin({ "nodaro-pulse": { sourceClip: false } })).toStrictEqual({ "nodaro-pulse": { sourceClip: false }, "motion-pulse": { sourceClip: false }, "motion-lite": { sourceClip: false } })
    expect(noPersonForPlugin(null)).toBeNull()
    expect(noPersonForPlugin(undefined)).toBeNull()
    expect(noPersonForPlugin({})).toBeNull()
    expect(noPersonForPlugin({ "nodaro-prism": {} })).toBeNull()
  })

  it("reads a stored row keyed by an earlier id as the current one, the current key winning", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionNoPerson({ "motion-pro": { sourceClip: false } }, warn)).toStrictEqual({ "nodaro-prism": { sourceClip: false } })
    expect(parseNodaroMotionNoPerson({ "motion-lite": { sourceClip: false } }, warn)).toStrictEqual({ "nodaro-pulse": { sourceClip: false } })
    expect(parseNodaroMotionNoPerson({ "motion-pro": { sourceClip: false }, "nodaro-prism": {} }, warn)).toStrictEqual({})
    expect(warn).not.toHaveBeenCalled()
  })

  it("reads a stored row tolerantly: a bad entry is dropped with a warning and the good one kept", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionNoPerson({ "nodaro-prism": { sourceClip: true }, "nodaro-pulse": { sourceClip: false } }, warn)).toStrictEqual({ "nodaro-pulse": { sourceClip: false } })
    expect(warn).toHaveBeenCalledOnce()
    warn.mockClear()
    // A key it does not know (a newer build's) is read past, with a warning: the entry is kept.
    expect(parseNodaroMotionNoPerson({ "nodaro-prism": { sourceClip: false, extra: 1 } }, warn)).toStrictEqual({ "nodaro-prism": { sourceClip: false } })
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
