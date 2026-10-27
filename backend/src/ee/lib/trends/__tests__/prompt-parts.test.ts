/**
 * A trend's 4 s preview prompt parts (lib/trends/prompt-parts.ts) and where
 * they are held: a preview run sends the preview's own role names, reference
 * lines, pre and trend prompts, each falling back to the full run's; a full
 * run never reads them. The prompt budget and the publish check hold the
 * preview's texts too while the trend offers a preview; the face mask's
 * settings key never moves with prompt text. The composition itself is pinned
 * in compose.test.ts.
 */
import { describe, expect, it } from "vitest"
import { storedFaceMaskFor } from "../face-mask.js"
import type { EngineEnvironment } from "../../engine-environments.js"
import { faceMaskSettingsKey } from "../face-mask.js"
import { promptBudget, promptModesOf } from "../prompt-budget.js"
import { hasOwnPreviewPrompts, hasPreviewText, trendPromptParts, withPromptsFor } from "../prompt-parts.js"
import { publishBlockers } from "../publish-check.js"
import type { TrendVersionData, TrendPreviewClip } from "../types.js"

/**
 * A preview input clip current for the fixture's source at start 0, carrying
 * the matching cut of the data's current stored face mask when it has one:
 * publishing needs one (preview-clip.test.ts holds its rules).
 */
function previewClipFor(d: Pick<TrendVersionData, "source" | "faceMasking" | "faceMask">): TrendPreviewClip {
  const mask = storedFaceMaskFor(d)
  return {
    videoUrl: "https://cdn.example/trends/t1/preview.mp4", durationSec: 5, width: 240, height: 320, frames: 150, sha256: "a".repeat(64),
    sourceVideoUrl: "https://cdn.example/trends/t1/src.mp4", startSec: 0, recipe: "1", madeAt: "2026-10-27T10:00:00.000Z",
    ...(mask ? { faceMask: { url: "https://cdn.example/trends/t1/preview-mask.mp4", frames: 150, sha256: "b".repeat(64), sourceMaskUrl: mask.url } } : {}),
  }
}

function data(over: Partial<TrendVersionData> = {}): TrendVersionData {
  return withClip({
    name: { en: "Dance" },
    source: {
      videoUrl: "https://cdn.example/trends/t1/src.mp4",
      durationSec: 12,
      display: { videoUrl: "https://cdn.example/display.mp4", posterUrl: "https://cdn.example/poster.png", width: 240, height: 320, durationSec: 12 },
    },
    previewStart: 0,
    slots: [
      { key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the woman on the left", previewRoleName: "the woman" },
      { key: "place", kind: "location", label: { en: "Place" }, required: false, roleName: "the dance floor" },
    ],
    references: [
      { images: ["https://cdn.example/r1.png"], line: "the neon sign at the back", previewLine: "the sign" },
      { images: ["https://cdn.example/r2.png"], line: "the red car" },
    ],
    prePrompt: "FULL PRE",
    trendPrompt: "FULL TREND",
    previewPrePrompt: "PREVIEW PRE",
    previewTrendPrompt: "PREVIEW TREND",
    examples: [],
    ...over,
  })
}

/** `d` with a preview input clip current for it (its mask's cut when it has a current mask). */
const withClip = (d: TrendVersionData): TrendVersionData => ({ ...d, previewClip: previewClipFor(d) })

describe("withPromptsFor", () => {
  it("full: the version itself, preview texts never read", () => {
    const d = data()
    expect(withPromptsFor(d, "full")).toBe(d)
  })

  it("preview: each preview text in place of its full one", () => {
    const p = withPromptsFor(data(), "preview")
    expect(p.slots.map((s) => s.roleName)).toEqual(["the woman", "the dance floor"])
    expect(p.references.map((r) => r.line)).toEqual(["the sign", "the red car"])
    expect(p.prePrompt).toBe("PREVIEW PRE")
    expect(p.trendPrompt).toBe("PREVIEW TREND")
    // Everything else is untouched.
    expect(p.references.map((r) => r.images)).toEqual([["https://cdn.example/r1.png"], ["https://cdn.example/r2.png"]])
    expect(p.slots.map((s) => [s.key, s.kind, s.required])).toEqual([["lead", "person", true], ["place", "location", false]])
  })

  it("preview: an empty, blank or absent preview text falls back to the full run's", () => {
    const d = data({
      slots: [{ key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the woman on the left", previewRoleName: "  " }],
      references: [{ images: ["https://cdn.example/r1.png"], line: "the neon sign", previewLine: "" }],
      previewPrePrompt: "",
      previewTrendPrompt: undefined,
    })
    const p = withPromptsFor(d, "preview")
    expect(p.slots[0]!.roleName).toBe("the woman on the left")
    expect(p.references[0]!.line).toBe("the neon sign")
    expect(p.prePrompt).toBe("FULL PRE")
    expect(p.trendPrompt).toBe("FULL TREND")
  })

  it("preview: a preview prompt with no full one is sent on its own, and none of either stays none", () => {
    const own = withPromptsFor(data({ prePrompt: undefined, trendPrompt: undefined }), "preview")
    expect([own.prePrompt, own.trendPrompt]).toEqual(["PREVIEW PRE", "PREVIEW TREND"])
    const none = withPromptsFor(data({ prePrompt: undefined, trendPrompt: undefined, previewPrePrompt: undefined, previewTrendPrompt: undefined }), "preview")
    expect(none.prePrompt).toBeUndefined()
    expect(none.trendPrompt).toBeUndefined()
  })

  it("never changes the version it is given", () => {
    const d = data()
    const before = structuredClone(d)
    withPromptsFor(d, "preview")
    expect(d).toEqual(before)
  })

  it("hasPreviewText / hasOwnPreviewPrompts: blank is no text", () => {
    expect([hasPreviewText(undefined), hasPreviewText(""), hasPreviewText(" \n"), hasPreviewText("x")]).toEqual([false, false, false, true])
    expect(hasOwnPreviewPrompts(data())).toBe(true)
    const plain = data({
      previewPrePrompt: " ",
      previewTrendPrompt: "",
      slots: [{ key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the woman" }],
      references: [{ images: ["https://cdn.example/r1.png"], line: "the sign", previewLine: "" }],
    })
    expect(hasOwnPreviewPrompts(plain)).toBe(false)
    for (const one of [
      { previewPrePrompt: "p" },
      { previewTrendPrompt: "t" },
      { slots: [{ ...plain.slots[0]!, previewRoleName: "her" }] },
      { references: [{ ...plain.references[0]!, previewLine: "it" }] },
    ]) {
      expect(hasOwnPreviewPrompts({ ...plain, ...one } as TrendVersionData)).toBe(true)
    }
  })
})

describe("trendPromptParts (the admin's prompt view)", () => {
  it("full: the full run's texts, none from a preview", () => {
    expect(trendPromptParts(data(), "full")).toEqual({
      mode: "full",
      prePrompt: { text: "FULL PRE", fromFullRun: false },
      roles: [
        { key: "lead", label: "Lead", kind: "person", roleName: { text: "the woman on the left", fromFullRun: false } },
        { key: "place", label: "Place", kind: "location", roleName: { text: "the dance floor", fromFullRun: false } },
      ],
      references: [{ line: { text: "the neon sign at the back", fromFullRun: false } }, { line: { text: "the red car", fromFullRun: false } }],
      trendPrompt: { text: "FULL TREND", fromFullRun: false },
    })
  })

  it("preview: the preview's own texts, and the full run's where it has none, marked", () => {
    const parts = trendPromptParts(data({ previewTrendPrompt: "" }), "preview")
    expect(parts.prePrompt).toEqual({ text: "PREVIEW PRE", fromFullRun: false })
    expect(parts.roles.map((r) => r.roleName)).toEqual([
      { text: "the woman", fromFullRun: false },
      { text: "the dance floor", fromFullRun: true },
    ])
    expect(parts.references.map((r) => r.line)).toEqual([
      { text: "the sign", fromFullRun: false },
      { text: "the red car", fromFullRun: true },
    ])
    expect(parts.trendPrompt).toEqual({ text: "FULL TREND", fromFullRun: true })
  })

  it("a prompt neither run has is null", () => {
    const parts = trendPromptParts(data({ prePrompt: undefined, previewPrePrompt: undefined }), "preview")
    expect(parts.prePrompt).toBeNull()
    expect(trendPromptParts(data({ trendPrompt: undefined }), "full").trendPrompt).toBeNull()
  })

  it("matches what withPromptsFor sends, in both modes", () => {
    for (const mode of ["full", "preview"] as const) {
      const d = data({ previewTrendPrompt: "", references: [{ images: ["https://cdn.example/r.png"], line: "l", previewLine: " " }] })
      const sent = withPromptsFor(d, mode)
      const parts = trendPromptParts(d, mode)
      expect(parts.roles.map((r) => r.roleName.text)).toEqual(sent.slots.map((s) => s.roleName))
      expect(parts.references.map((r) => r.line.text)).toEqual(sent.references.map((r) => r.line))
      expect(parts.prePrompt?.text).toBe(sent.prePrompt)
      expect(parts.trendPrompt?.text).toBe(sent.trendPrompt)
    }
  })
})

describe("the prompt budget and the publish check hold the 4 s preview's texts", () => {
  const ALL = {
    roleKinds: ["person", "location"] as Array<"person" | "location">,
    fixedReferences: true,
    fullQuality: true,
    resolutions: ["480p", "720p", "1080p"] as Array<"480p" | "720p" | "1080p">,
    trendRun: true,
    trendPrePrompt: true,
  }
  const env = (name: string, castSwap: Record<string, unknown> = ALL): EngineEnvironment => ({
    env: name,
    pluginBuildId: "b",
    supports: { castSwap: castSwap as never },
    updatedAt: "2026-10-25T00:00:00Z",
  })
  const ENVS = [env("staging"), env("production")]
  const REQUIRED = ["staging", "production"]
  const tooLong = "t".repeat(promptBudget({}).trendPromptMax + 1)

  it("a valid draft with preview texts publishes", () => {
    expect(publishBlockers(data(), ENVS, REQUIRED)).toEqual([])
  })

  it("checks the preview only while the trend offers one and words a part its own way", () => {
    expect(promptModesOf(data())).toEqual(["full", "preview"])
    expect(promptModesOf(data({ previewStart: null }))).toEqual(["full"])
    const plain = data({ previewPrePrompt: undefined, previewTrendPrompt: undefined, slots: [data().slots[1]!], references: [data().references[1]!] })
    expect(promptModesOf(plain)).toEqual(["full"])
  })

  it("refuses a preview trend prompt that leaves the details no room, named as the preview's", () => {
    const blockers = publishBlockers(data({ previewTrendPrompt: tooLong }), ENVS, REQUIRED)
    expect(blockers).toEqual([{ code: "prompt_budget", message: expect.stringMatching(/^4 s preview: the trend prompt is /) }])
  })

  it("keeps a too-long preview trend prompt while the trend offers no preview (it never runs)", () => {
    expect(publishBlockers(data({ previewStart: null, previewTrendPrompt: tooLong }), ENVS, REQUIRED)).toEqual([])
  })

  it("holds a Kling 4 preview to the engine text of ITS role names and lines", () => {
    // Long preview role names and lines fill Kling 4's prompt where the full run's short ones do not.
    const slots = [
      { key: "lead", kind: "person" as const, label: { en: "Lead" }, required: true, roleName: "her", previewRoleName: "r".repeat(200) },
    ]
    const references = Array.from({ length: 2 }, (_, i) => ({ images: [`https://cdn.example/r${i}.png`], line: "it", previewLine: "l".repeat(500) }))
    const kling = data({ engine: "kling-4", slots, references, prePrompt: "p".repeat(3000), previewPrePrompt: undefined, trendPrompt: "t".repeat(2500), previewTrendPrompt: undefined })
    const KLING = { ...ALL, engines: ["seedance-2-5", "kling-4"], resolutions: ["720p", "1080p"] }
    const envs = [env("staging", KLING), env("production", KLING)]
    expect(promptBudget(kling).room).toBeGreaterThanOrEqual(0)
    expect(promptBudget(withPromptsFor(kling, "preview")).room).toBeLessThan(0)
    expect(publishBlockers(kling, envs, REQUIRED)).toEqual([
      { code: "prompt_budget", message: expect.stringMatching(/^4 s preview: the pre and trend prompts are .* on Kling 4 is /) },
    ])
  })

  it("needs trendPrePrompt for a pre prompt only the preview sends", () => {
    const noPre = { ...ALL, trendPrePrompt: false }
    const onlyPreview = data({ prePrompt: undefined })
    expect(publishBlockers(onlyPreview, [env("staging", noPre), env("production")], REQUIRED)).toEqual([
      { code: "engine_unsupported", env: "staging", need: "trendPrePrompt" },
    ])
    // With no preview offered it is never sent.
    expect(publishBlockers({ ...onlyPreview, previewStart: null }, [env("staging", noPre), env("production")], REQUIRED)).toEqual([])
  })
})

describe("the face mask's settings key", () => {
  it("never moves with prompt text, the 4 s preview's included", () => {
    const masked = data({ faceMasking: { mode: "always", threshold: 0.4 } })
    const key = faceMaskSettingsKey(masked)
    expect(key).not.toBeNull()
    const edited = data({
      faceMasking: { mode: "always", threshold: 0.4 },
      prePrompt: "another pre",
      trendPrompt: "another trend",
      previewPrePrompt: "another preview pre",
      previewTrendPrompt: "",
      slots: [{ key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "him", previewRoleName: "the man" }],
      references: [{ images: ["https://cdn.example/r1.png"], line: "x", previewLine: "y" }],
    })
    expect(faceMaskSettingsKey(edited)).toBe(key)
  })
})
