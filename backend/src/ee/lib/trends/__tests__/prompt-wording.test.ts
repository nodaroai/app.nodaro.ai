/**
 * A trend's Flex prompt wording (`promptWording`: "current" | "new"). What
 * must hold:
 *
 *  - the schema takes both wordings (stored as given, absent stays absent)
 *    and refuses any other value;
 *  - a run says "new" only for a trend on it whose prompt style is Flexible —
 *    a Precise trend, and every trend on "current" or none, sends exactly the
 *    body of before;
 *  - the key is stripped for an engine whose `castSwap.promptWordings` does
 *    not list "new" (an older engine's strict schema may refuse it);
 *  - the engine's prompt parts are asked with it the same way;
 *  - publishing holds back a Flexible trend on "new" from an environment
 *    whose engine does not list it.
 */
import { afterEach, describe, expect, it } from "vitest"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../../lib/private-plugins/supports-registry.js"
import type { EngineEnvironment } from "../../engine-environments.js"
import { forLoadedEngine } from "../../cast-swap-prompt-parts.js"
import { composeTrendRun } from "../compose.js"
import { faceMaskSettingsKey, storedFaceMaskFor } from "../face-mask.js"
import { promptPartsRequestFor } from "../prompt-parts-store.js"
import { trendPromptWordingSent } from "../prompt-style.js"
import { PROMPT_WORDING_NEED, publishBlockers } from "../publish-check.js"
import { withoutUnsupportedFields } from "../run-helpers.js"
import { trendVersionDataSchema } from "../schemas.js"
import type { TrendFaceMask, TrendVersionData, TrendPreviewClip } from "../types.js"

const SRC = "https://cdn.example/trends/t1/src.mp4"
/**
 * A preview input clip current for the fixture's source at start 0, carrying
 * the matching cut of the data's current stored face mask when it has one:
 * publishing needs one (preview-clip.test.ts holds its rules).
 */
function previewClipFor(d: Pick<TrendVersionData, "source" | "faceMasking" | "faceMask" | "slots">): TrendPreviewClip {
  const mask = storedFaceMaskFor(d)
  return {
    videoUrl: "https://cdn.example/trends/t1/preview.mp4", durationSec: 5, width: 240, height: 320, frames: 150, sha256: "a".repeat(64),
    sourceVideoUrl: SRC, startSec: 0, recipe: "2", madeAt: "2026-10-27T10:00:00.000Z",
    ...(mask ? { faceMask: { url: "https://cdn.example/trends/t1/preview-mask.mp4", frames: 150, sha256: "b".repeat(64), sourceMaskUrl: mask.url } } : {}),
  }
}
const FACES = { mode: "always" as const, threshold: 0.4 }
const FULL = { mode: "always" as const, source: "full-depth" as const }
const KEEP = { mode: "always" as const, source: "keep-people" as const }

function data(over: Partial<TrendVersionData> = {}, durationSec = 12): TrendVersionData {
  return withClip({
    name: { en: "Dance" },
    source: {
      videoUrl: SRC,
      durationSec,
      display: { videoUrl: "https://cdn.example/display.mp4", posterUrl: "https://cdn.example/poster.png", width: 240, height: 320, durationSec },
    },
    previewStart: 0,
    slots: [{ key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the woman" }],
    references: [],
    examples: [],
    faceMasking: FACES,
    ...over,
  })
}

/** `d` with a preview input clip current for it (its mask's cut when it has a current mask). */
const withClip = (d: TrendVersionData): TrendVersionData => ({ ...d, previewClip: previewClipFor(d) })

function withMask(d: TrendVersionData): TrendVersionData {
  const faceMask: TrendFaceMask = {
    url: "https://cdn.example/trends/t1/clip.mp4",
    frames: 360,
    recipe: { core: VIDEO_MASK_RECIPE, plugin: "1" },
    settingsKey: faceMaskSettingsKey(d)!,
    jobId: "job-1",
    stats: { shots: 1, heldFrames: 0, coverage: 1, droppedRegions: 0 },
    approvedAt: "2026-10-27T10:00:00.000Z",
    approvedBy: "admin",
  }
  return withClip({ ...d, faceMask })
}

const BASE = {
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
}
const STYLES = { ...BASE, promptStyles: ["precise", "flexible"], fullDepthScenes: ["description", "original", "none"] }
const env = (name: string, castSwap: Record<string, unknown>): EngineEnvironment => ({
  env: name,
  pluginBuildId: "b",
  supports: { castSwap: castSwap as never },
  updatedAt: "2026-10-27T00:00:00Z",
})
const REQUIRED = ["staging", "production"]
const envs = (castSwap: Record<string, unknown>) => [env("staging", castSwap), env("production", castSwap)]
const blockers = (d: TrendVersionData, castSwap: Record<string, unknown>) => publishBlockers(d, envs(castSwap), REQUIRED)

const trend = (d: TrendVersionData) => ({ id: "t-1", slug: "dance", version: 1, data: d })
const run = (d: TrendVersionData) => composeTrendRun(trend(d), { slots: { lead: { images: ["https://cdn.example/me.png"] } } })
const issues = (over: Partial<TrendVersionData>) => {
  const r = trendVersionDataSchema.safeParse(data(over))
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
}

afterEach(() => _resetPluginSupportsForTests())

const NEW_ENGINE = { ...STYLES, promptWordings: ["current", "new"] }
const FLEX_NEW = { promptStyle: "flexible" as const, promptWording: "new" as const }

describe("the schema", () => {
  it("takes either wording, stores it as given, and refuses another", () => {
    expect(issues({ promptWording: "current" })).toEqual([])
    expect(issues({ promptWording: "new" })).toEqual([])
    expect(trendVersionDataSchema.safeParse(data({ promptWording: "current" })).data).toHaveProperty("promptWording", "current")
    expect(trendVersionDataSchema.safeParse(data()).data).not.toHaveProperty("promptWording")
    for (const bad of ["New", "old", "", null, 1]) expect(issues({ promptWording: bad as never }), String(bad)).not.toEqual([])
  })

  it("is accepted on a Precise trend too (nothing reads it there)", () => {
    expect(issues({ promptStyle: "precise", promptWording: "new" })).toEqual([])
  })
})

describe("what a run says", () => {
  it("'new' only for a trend on it whose prompt style is Flexible", () => {
    expect(trendPromptWordingSent(data(FLEX_NEW))).toBe("new")
    // Full depth is Flexible by default.
    expect(trendPromptWordingSent(withMask(data({ faceMasking: FULL, promptWording: "new" })))).toBe("new")
    expect(trendPromptWordingSent(data({ promptWording: "new" }))).toBeUndefined()
    expect(trendPromptWordingSent(data({ promptStyle: "precise", promptWording: "new" }))).toBeUndefined()
    expect(trendPromptWordingSent(data({ promptStyle: "flexible", promptWording: "current" }))).toBeUndefined()
    expect(trendPromptWordingSent(data({ promptStyle: "flexible" }))).toBeUndefined()
  })

  it("sends it to an engine that lists it", () => {
    setPluginSupports({ castSwap: NEW_ENGINE as never })
    const composed = run(data(FLEX_NEW))
    expect(composed.body.promptWording).toBe("new")
    withoutUnsupportedFields(composed)
    expect(composed.body).toMatchObject({ promptStyle: "flexible", promptWording: "new" })
  })

  it("a Precise trend, or one on the current wording, sends exactly the body of before", () => {
    setPluginSupports({ castSwap: NEW_ENGINE as never })
    for (const [over, plain] of [
      [{ promptStyle: "precise", promptWording: "new" }, { promptStyle: "precise" }],
      [{ promptStyle: "flexible", promptWording: "current" }, { promptStyle: "flexible" }],
    ] as const) {
      const withWording = run(data(over))
      const without = run(data(plain))
      withoutUnsupportedFields(withWording)
      withoutUnsupportedFields(without)
      expect(withWording.body).not.toHaveProperty("promptWording")
      expect(withWording.body).toStrictEqual(without.body)
    }
  })

  it("is stripped for an engine that does not list 'new': the body of before", () => {
    for (const cs of [STYLES, { ...STYLES, promptWordings: ["current"] }]) {
      setPluginSupports({ castSwap: cs as never })
      const composed = run(data(FLEX_NEW))
      const before = run(data({ promptStyle: "flexible" }))
      withoutUnsupportedFields(composed)
      withoutUnsupportedFields(before)
      expect(composed.body).not.toHaveProperty("promptWording")
      expect(composed.body).toStrictEqual(before.body)
    }
  })

  it("never changes the stored clip", () => {
    expect(faceMaskSettingsKey(withMask(data({ faceMasking: FULL, promptWording: "new" })))).toBe(faceMaskSettingsKey(withMask(data({ faceMasking: FULL }))))
    expect(storedFaceMaskFor(withMask(data({ faceMasking: FULL, promptWording: "new" })))).toEqual(storedFaceMaskFor(withMask(data({ faceMasking: FULL }))))
  })
})

describe("the engine's prompt parts", () => {
  it("are asked with the Flexible trend's wording, 'current' included, only where the engine lists it", () => {
    const body = promptPartsRequestFor(data(FLEX_NEW))
    expect(body).toMatchObject({ promptStyle: "flexible", promptWording: "new" })
    expect(promptPartsRequestFor(data({ promptStyle: "flexible" }))).toMatchObject({ promptWording: "current" })
    expect(promptPartsRequestFor(data({ promptStyle: "flexible", promptWording: "current" }))).toMatchObject({ promptWording: "current" })
    setPluginSupports({ castSwap: STYLES as never })
    expect(forLoadedEngine(body)).not.toHaveProperty("promptWording")
    expect(forLoadedEngine(promptPartsRequestFor(data({ promptStyle: "flexible" })))).not.toHaveProperty("promptWording")
    setPluginSupports({ castSwap: NEW_ENGINE as never })
    expect(forLoadedEngine(body)).toMatchObject({ promptWording: "new" })
  })

  it("are asked as before for a Precise trend, unless it overrides a part of the new wording", () => {
    expect(promptPartsRequestFor(data({ promptStyle: "precise", promptWording: "new" }))).toEqual(promptPartsRequestFor(data({ promptStyle: "precise" })))
    expect(promptPartsRequestFor(data({ promptStyle: "precise" }))).not.toHaveProperty("promptWording")
    expect(promptPartsRequestFor(data({ promptStyle: "precise" }), { motionLock: "x" })).toMatchObject({ promptWording: "current" })
  })

  it("a Flexible trend back on 'current' with a stored new-wording override is asked so the engine lists that part", () => {
    const d = data({ promptStyle: "flexible", promptParts: { motionLock: { text: "Move as filmed.", defaultHash: "0123456789abcdef" } } })
    expect(promptPartsRequestFor(d)).toMatchObject({ promptWording: "current", overrides: { motionLock: "Move as filmed." } })
  })
})

describe("a run's new-wording overrides", () => {
  const withLock = (over: Partial<TrendVersionData> = {}) =>
    data({ promptStyle: "flexible", promptParts: { motionLock: { text: "Move as filmed.", defaultHash: "0123456789abcdef" }, avoid: { text: "-", defaultHash: "0123456789abcdef" } }, ...over })

  it("reach an engine that lists the new wording", () => {
    setPluginSupports({ castSwap: { ...NEW_ENGINE, promptParts: true } as never })
    const composed = run(withLock())
    withoutUnsupportedFields(composed)
    expect(composed.body.promptParts).toEqual({ motionLock: "Move as filmed.", avoid: "-" })
  })

  it("are dropped for an engine that does not (it may refuse a part id it does not know), the other overrides kept", () => {
    setPluginSupports({ castSwap: { ...STYLES, promptParts: true } as never })
    const composed = run(withLock())
    withoutUnsupportedFields(composed)
    expect(composed.body.promptParts).toEqual({ avoid: "-" })
    const only = run(data({ promptStyle: "flexible", promptParts: { restate: { text: "Again.", defaultHash: "0123456789abcdef" } } }))
    withoutUnsupportedFields(only)
    expect(only.body).not.toHaveProperty("promptParts")
  })
})

describe("publishing", () => {
  const wordingBlockers = (d: TrendVersionData, cs: Record<string, unknown>) => blockers(d, cs).filter((b) => b.need === PROMPT_WORDING_NEED)

  it("holds back a Flexible trend on 'new' from an environment whose engine does not list it", () => {
    expect(wordingBlockers(data(FLEX_NEW), STYLES).map((b) => b.env).sort()).toEqual(["production", "staging"])
    expect(wordingBlockers(data(FLEX_NEW), { ...STYLES, promptWordings: ["current"] })).toHaveLength(2)
    expect(wordingBlockers(data(FLEX_NEW), NEW_ENGINE)).toEqual([])
  })

  it("never for a Precise trend or the current wording", () => {
    expect(wordingBlockers(data({ promptStyle: "precise", promptWording: "new" }), STYLES)).toEqual([])
    expect(wordingBlockers(data({ promptStyle: "flexible", promptWording: "current" }), STYLES)).toEqual([])
    expect(wordingBlockers(data({ promptStyle: "flexible" }), STYLES)).toEqual([])
  })
})
