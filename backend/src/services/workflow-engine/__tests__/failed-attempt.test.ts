/**
 * Whether a use-case node's failed attempt may be resumed: its stored settings
 * against what the node resolves to now (failed-attempt.ts). Compared setting
 * by setting, so a deploy that adds a setting does not make every older
 * attempt differ (and re-run, re-billing its paid steps), while a changed,
 * removed or non-default new setting still runs the node fresh.
 */
import { describe, expect, it } from "vitest"
import { USE_CASE_DESCRIPTORS, usecaseDescriptor, type UseCaseNodeType } from "@nodaro/render-rules"
import { attemptRanWithInputs, settingsUnchanged } from "../failed-attempt.js"

const MEDIA = "https://r2/ep.mp4"

describe("settingsUnchanged", () => {
  const defaults = { a: 1, b: "x", added: false }

  it("the same settings, keys in another order: unchanged", () => {
    expect(settingsUnchanged({ a: 1, b: "x" }, { b: "x", a: 1 }, defaults)).toBe(true)
  })

  it("a stored setting that holds another value now: changed", () => {
    expect(settingsUnchanged({ a: 1, b: "x" }, { a: 2, b: "x" }, defaults)).toBe(false)
  })

  it("a setting added since the attempt, at its default: unchanged", () => {
    expect(settingsUnchanged({ a: 1, b: "x" }, { a: 1, b: "x", added: false }, defaults)).toBe(true)
  })

  it("a setting added since the attempt, set away from its default: changed", () => {
    expect(settingsUnchanged({ a: 1, b: "x" }, { a: 1, b: "x", added: true }, defaults)).toBe(false)
  })

  it("a setting the attempt stored that no longer exists: changed (what it made with it cannot be told)", () => {
    expect(settingsUnchanged({ a: 1, b: "x", gone: 3 }, { a: 1, b: "x" }, defaults)).toBe(false)
  })

  it("nested values are compared whole, key order ignored", () => {
    expect(settingsUnchanged({ f: { aspect: "9:16", layout: "grid" } }, { f: { layout: "grid", aspect: "9:16" } }, {})).toBe(true)
    expect(settingsUnchanged({ f: { aspect: "9:16", layout: "grid" } }, { f: { aspect: "9:16", layout: "single" } }, {})).toBe(false)
  })

  it("null is a value (a framing of None), undefined is absent", () => {
    expect(settingsUnchanged({ f: null }, { f: null }, {})).toBe(true)
    expect(settingsUnchanged({ f: null, u: undefined }, { f: null }, {})).toBe(true)
    expect(settingsUnchanged({ f: null }, { f: { aspect: "9:16", layout: "grid" } }, {})).toBe(false)
  })
})

describe("attemptRanWithInputs: settings across a change of the resolver's key set", () => {
  const type: UseCaseNodeType = "tighten-episode"
  const d = usecaseDescriptor(type)
  const resolved = d.resolveSettings({}, "video") as Record<string, unknown>
  const now = (data: Record<string, unknown> = {}) => ({ mediaUrls: [MEDIA], ...data })

  it("an attempt stored before a setting existed resumes while the node leaves it at its default", () => {
    // The attempt's wrapper as an older deploy wrote it: one setting fewer.
    const { musicDuckAmount: _added, ...older } = resolved
    expect(attemptRanWithInputs(type, { mediaUrl: MEDIA, settings: older }, "video", now())).toBe(true)
  })

  it("…and runs fresh once the node sets that setting away from its default", () => {
    const { musicDuckAmount: _added, ...older } = resolved
    expect(attemptRanWithInputs(type, { mediaUrl: MEDIA, settings: older }, "video", now({ musicDuckAmount: 20 }))).toBe(false)
  })

  it("an attempt that stored a setting the resolver no longer makes runs fresh", () => {
    expect(attemptRanWithInputs(type, { mediaUrl: MEDIA, settings: { ...resolved, retired: 1 } }, "video", now())).toBe(false)
  })

  it("an attempt with no stored settings runs fresh", () => {
    expect(attemptRanWithInputs(type, { mediaUrl: MEDIA }, "video", now())).toBe(false)
    expect(attemptRanWithInputs(type, { mediaUrl: MEDIA, settings: null }, "video", now())).toBe(false)
    expect(attemptRanWithInputs(type, { mediaUrl: MEDIA, settings: [] }, "video", now())).toBe(false)
  })

  it("the same settings resume; a changed one runs fresh", () => {
    expect(attemptRanWithInputs(type, { mediaUrl: MEDIA, settings: resolved }, "video", now())).toBe(true)
    expect(attemptRanWithInputs(type, { mediaUrl: MEDIA, settings: resolved }, "video", now({ planTier: "premium" }))).toBe(false)
  })

  it("another recording runs fresh whatever the settings", () => {
    expect(attemptRanWithInputs(type, { mediaUrl: "https://r2/other.mp4", settings: resolved }, "video", now())).toBe(false)
  })
})

/**
 * The guard: every use-case type's resolver makes exactly these settings.
 *
 * A failed attempt stored before a setting existed is resumed while the node
 * holds that setting's DEFAULT (settingsUnchanged above). That is only right
 * when the default (for any values of the settings and inputs it reads) is the behaviour
 * the code had before the setting existed —
 * so a new setting, or a removed one, is a decision: make its default the old
 * behaviour (or accept that older attempts with it set run fresh), then add it
 * here and to the type's `settingKeys`.
 */
const PINNED_SETTING_KEYS: Readonly<Record<UseCaseNodeType, readonly string[]>> = {
  "tighten-episode": [
    "captionStyle",
    "captions",
    "framing",
    "instructions",
    "musicDuckAmount",
    "output",
    "planTier",
    "reviewBeforeRender",
    "styleGuide",
  ],
  "episode-chapters": ["instructions", "planTier", "styleGuide"],
}

describe("guard: the use-case resolvers' setting keys are pinned", () => {
  const types = Object.keys(USE_CASE_DESCRIPTORS) as UseCaseNodeType[]

  it("every use-case type is pinned (a new type is a decision too)", () => {
    expect(Object.keys(PINNED_SETTING_KEYS).sort()).toEqual([...types].sort())
  })

  for (const type of types) {
    for (const kind of ["audio", "video"] as const) {
      it(`${type} (${kind} recording): its resolver makes exactly the pinned settings, and they are its settingKeys`, () => {
        const keys = Object.keys(usecaseDescriptor(type).resolveSettings({}, kind)).sort()
        expect(
          keys,
          `${type}'s settings changed. A failed attempt stored without a new setting is resumed while the node holds its default, ` +
            `so that default — for any values of the settings and inputs (recording, music, intro card) it reads — must be the behaviour the code had before the setting existed. Decide that, then pin the new set here.`,
        ).toEqual([...PINNED_SETTING_KEYS[type]].sort())
        expect([...usecaseDescriptor(type).settingKeys].sort()).toEqual(keys)
      })
    }
  }
})
