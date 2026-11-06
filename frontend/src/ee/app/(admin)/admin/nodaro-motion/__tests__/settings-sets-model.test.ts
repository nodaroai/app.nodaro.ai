import { describe, expect, it, vi, type Mock } from "vitest"
import type { MotionSettingsSet } from "@/ee/lib/nodaro-motion-settings-sets-api"
import { MOTION_SETTINGS_KEYS, type MotionSettingsBinding, type MotionSettingsBindings, type MotionSettingsKey } from "../settings-sections"
import { changedSections, exportFileName, liveMarker, loadSettings, matchesLive, needsLiveMark, pageSettings, saveChangedSections } from "../settings-sets-model"

/**
 * The stored sets over the page's section bindings: what the page holds as a
 * set, which set is live, and a loaded draft saved section by section.
 */
function bindings(live: Partial<Record<MotionSettingsKey, unknown>> = {}, draft: Partial<Record<MotionSettingsKey, unknown>> = {}) {
  const out = {} as Record<
    MotionSettingsKey,
    MotionSettingsBinding & { load: Mock<(body: unknown) => void>; reset: Mock<() => void>; save: Mock<(body: unknown) => Promise<unknown>> }
  >
  for (const k of MOTION_SETTINGS_KEYS) {
    const l = live[k] ?? { v: 0 }
    out[k] = {
      ready: true,
      live: l,
      draft: k in draft ? draft[k] : l,
      // A body as the page saves it: `extra` is dropped (a default the page leaves out).
      canon: (b) => {
        const { extra: _extra, ...rest } = b as Record<string, unknown>
        return rest
      },
      load: vi.fn<(body: unknown) => void>(),
      reset: vi.fn<() => void>(),
      save: vi.fn<(body: unknown) => Promise<unknown>>(async () => undefined),
    }
  }
  return out
}

const set = (over: Partial<MotionSettingsSet>): MotionSettingsSet => ({
  id: "s1",
  name: "One",
  settings: {},
  unreadable: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  createdBy: null,
  updatedAt: "2026-11-01T00:00:00.000Z",
  updatedBy: null,
  liveAt: null,
  ...over,
})

describe("the page as a set", () => {
  it("holds every section's draft, and names the ones that differ from live", () => {
    const b = bindings({}, { advanced: { show: true } })
    expect(Object.keys(pageSettings(b)).sort()).toEqual([...MOTION_SETTINGS_KEYS].sort())
    expect(pageSettings(b).advanced).toEqual({ show: true })
    expect(changedSections(b)).toEqual(["advanced"])
  })

  it("loads the sections a set names and puts every other one back to live", () => {
    const b = bindings()
    loadSettings(b, { advanced: { show: true } })
    expect(b.advanced.load).toHaveBeenCalledWith({ show: true })
    expect(b.masking.load).not.toHaveBeenCalled()
    expect(b.masking.reset).toHaveBeenCalled()
  })
})

describe("the live marker", () => {
  it("names a set the live settings match, compared as the page saves it; a section it leaves out does not count", () => {
    const b = bindings({ advanced: { show: true } })
    expect(matchesLive(b, { advanced: { show: true, extra: 1 } })).toBe(true)
    expect(matchesLive(b, { advanced: { show: false } })).toBe(false)
    // Naming no section matches nothing; naming one the page does not know never matches.
    expect(matchesLive(b, {})).toBe(false)
    expect(matchesLive(b, { colour: {} })).toBe(false)
    const sets = [set({ id: "a", name: "A", settings: { advanced: { show: true } } }), set({ id: "b", name: "B", settings: { advanced: { show: false } } })]
    expect(liveMarker(b, sets)).toEqual({ set: sets[0], edited: false })
  })

  it("prefers the set marked live last when several match; names the last one '<name>, edited' when none does", () => {
    const b = bindings({ advanced: { show: true } })
    const older = set({ id: "a", name: "A", settings: { advanced: { show: true } }, liveAt: "2026-11-01T00:00:00.000Z" })
    const newer = set({ id: "b", name: "B", settings: { advanced: { show: true } }, liveAt: "2026-11-02T00:00:00.000Z" })
    expect(liveMarker(b, [older, newer])?.set.id).toBe("b")
    const moved = bindings({ advanced: { show: false } })
    expect(liveMarker(moved, [older, newer])).toEqual({ set: newer, edited: true })
    expect(liveMarker(moved, [set({ settings: { advanced: { show: true } } })])).toBeNull()
  })

  it("says nothing until every section has loaded, and asks to mark only a live set not marked last", () => {
    const b = bindings({ advanced: { show: true } })
    const notReady = { ...b, masking: { ...b.masking, ready: false } } as MotionSettingsBindings
    expect(liveMarker(notReady, [set({ settings: { advanced: { show: true } } })])).toBeNull()
    const a = set({ id: "a", settings: { advanced: { show: true } } })
    const marker = liveMarker(b, [a])
    expect(needsLiveMark(marker, [a])).toBe(true)
    expect(needsLiveMark(marker, [{ ...a, liveAt: "2026-11-02T00:00:00.000Z" }])).toBe(false)
    expect(needsLiveMark({ set: a, edited: true }, [a])).toBe(false)
  })
})

describe("Save all", () => {
  it("saves only what differs, in the server's order, and saves a refused section again once the others have", async () => {
    const b = bindings({}, { "prompt-parts": { p: 1 }, masking: { m: 1 }, advanced: { show: true } })
    // The masking is refused while the old engine prompt is saved; the engine prompt then saves, and the masking with it.
    let partsSaved = false
    b.masking.save.mockImplementation(async () => {
      if (!partsSaved) throw new Error("the saved prompt no longer fits")
    })
    b["prompt-parts"].save.mockImplementation(async () => {
      partsSaved = true
    })
    const results = await saveChangedSections(b, ["prompt-wording", "masking", "advanced", "prompt-parts"])
    expect(results).toEqual([
      { key: "masking", ok: true },
      { key: "advanced", ok: true },
      { key: "prompt-parts", ok: true },
    ])
    expect(b.masking.save).toHaveBeenCalledTimes(2)
    expect(b.masking.save).toHaveBeenLastCalledWith({ m: 1 })
    expect(b.style.save).not.toHaveBeenCalled()
  })

  it("reports each section that stays refused, and never stops at the first", async () => {
    const b = bindings({}, { style: { s: 1 }, advanced: { show: true } })
    b.style.save.mockRejectedValue(new Error("The Cast Swap engine in staging cannot force a style yet."))
    const results = await saveChangedSections(b, MOTION_SETTINGS_KEYS)
    expect(results).toEqual([
      { key: "style", ok: false, message: "The Cast Swap engine in staging cannot force a style yet." },
      { key: "advanced", ok: true },
    ])
    // Tried again once, after the switch saved; nothing saved after that, so no third try.
    expect(b.style.save).toHaveBeenCalledTimes(2)
  })
})

it("names an export after the set and the day", () => {
  expect(exportFileName("Launch look: v2!", new Date("2026-11-06T10:00:00Z"))).toBe("nodaro-motion-launch-look-v2-2026-11-06.json")
  expect(exportFileName("???", new Date("2026-11-06T10:00:00Z"))).toBe("nodaro-motion-settings-2026-11-06.json")
})
