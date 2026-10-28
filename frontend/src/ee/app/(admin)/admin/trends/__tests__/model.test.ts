/**
 * The trend editor's form model: face masking and the pre prompt.
 *
 * - A draft's `faceMasking` and `prePrompt` come back from the form exactly
 *   as they were saved (absent stays absent: no defaults are written in).
 * - The bounds are the server's own (`@nodaro/shared`), so Save is off before a 400.
 * - A publish blocker for an engine without face masking reads as a sentence.
 */
import { describe, expect, it } from "vitest"
import type { AdminTrendData, AdminTrendFaceMasking, AdminTrendPreviewClip } from "@/lib/api"
import {
  CAST_SWAP_FACE_MASKING_BOUNDS,
  CAST_SWAP_FACE_MASKING_DEFAULTS,
  getMaxVideoPromptChars,
  TREND_PROMPT_LIMITS,
} from "@nodaro/shared/models"
import { hasOwnPreviewPrompts as ruleHasOwn, klingEngineText, trendPromptBudget, withPromptsFor } from "@nodaro/render-rules"
import {
  describeBlocker,
  engineOfForm,
  FACE_MASKING_BOUNDS,
  FACE_MASKING_DEFAULTS,
  formIssues,
  fromForm,
  imagesSentAtMost,
  maxImagesFor,
  MAX_PRE_PROMPT,
  MAX_TREND_PROMPT,
  hasOwnPreviewPrompts,
  previewClipStatus,
  previewPromptBudget,
  promptBudget,
  shownChips,
  TREND_DETAILS_MAX,
  toForm,
  withChipShown,
  withKind,
  withPreviewPrompts,
} from "../model"

function draft(over: Partial<AdminTrendData> = {}): AdminTrendData {
  return {
    name: { en: "Office dance" },
    source: { videoUrl: "https://cdn.test/src.mp4", durationSec: 12 },
    previewStart: 2,
    slots: [{ key: "lead", label: { en: "Lead" }, kind: "person", required: true, roleName: "the woman" }],
    references: [],
    trendPrompt: "Keep the shake.",
    examples: [],
    ...over,
  }
}

const FULL: AdminTrendFaceMasking = {
  mode: "auto",
  target: "face",
  fill: "blur",
  minFaceHeightPct: 10,
  maxFaceHeightPct: 60,
  zone: { leftPct: 5, bottomPct: 49 },
  blurStrengthPct: 2.5,
  threshold: 0.4,
}

/** What a save sends for `draft()`: everything but the examples and the server-owned preview clip. */
function savedOf(d: AdminTrendData): Omit<AdminTrendData, "examples" | "previewClip"> {
  const out: Partial<AdminTrendData> = { ...d }
  delete out.examples
  delete out.previewClip
  return out as Omit<AdminTrendData, "examples" | "previewClip">
}

describe("face masking and the pre prompt in the form", () => {
  it("round-trips a draft with neither, leaving both out", () => {
    const out = fromForm(toForm(draft()))
    expect(out).toEqual(savedOf(draft()))
    expect(out).not.toHaveProperty("faceMasking")
    expect(out).not.toHaveProperty("prePrompt")
  })

  it("round-trips the full masking setting and the pre prompt exactly", () => {
    const d = draft({ faceMasking: FULL, prePrompt: "Open on the stage." })
    const out = fromForm(toForm(d))
    expect(out.faceMasking).toEqual(FULL)
    expect(out.prePrompt).toBe("Open on the stage.")
    // The form holds its own copy: editing it never changes the loaded draft.
    const form = toForm(d)
    form.faceMasking!.zone!.leftPct = 20
    expect(d.faceMasking!.zone!.leftPct).toBe(5)
  })

  it("keeps the target as chosen (face or head), and leaves it out when it is left out", () => {
    for (const target of ["face", "head"] as const) {
      expect(fromForm(toForm(draft({ faceMasking: { mode: "auto", target } }))).faceMasking).toEqual({ mode: "auto", target })
    }
    expect(fromForm(toForm(draft({ faceMasking: { mode: "auto" } }))).faceMasking).not.toHaveProperty("target")
  })

  it("keeps a setting with only a mode as only a mode, and an 'off' setting as it is", () => {
    expect(fromForm(toForm(draft({ faceMasking: { mode: "always" } }))).faceMasking).toEqual({ mode: "always" })
    expect(fromForm(toForm(draft({ faceMasking: { mode: "off", fill: "depth" } }))).faceMasking).toEqual({ mode: "off", fill: "depth" })
  })

  it("drops empty values: a blank pre prompt, an empty zone, cleared numbers", () => {
    const form = toForm(draft())
    form.prePrompt = "   "
    form.faceMasking = { mode: "always", zone: {}, threshold: undefined }
    const out = fromForm(form)
    expect(out).not.toHaveProperty("prePrompt")
    expect(out.faceMasking).toEqual({ mode: "always" })
  })

  it("mirrors the server's bounds", () => {
    const issues = (fm: Partial<AdminTrendFaceMasking>, prePrompt = "") => {
      const form = toForm(draft())
      form.faceMasking = { mode: "always", ...fm }
      form.prePrompt = prePrompt
      return formIssues(form)
    }
    expect(issues({})).toEqual([])
    expect(issues(FULL)).toEqual([])
    expect(issues({}, "a".repeat(3001))).toEqual(["Pre prompt: at most 3000 characters."])
    for (const bad of [
      { minFaceHeightPct: 101 },
      { maxFaceHeightPct: -1 },
      { zone: { topPct: 50 } },
      { fill: "blur" as const, blurStrengthPct: 0 },
      { fill: "blur" as const, blurStrengthPct: 6 },
      { threshold: 0.01 },
      { threshold: 1 },
      { minFaceHeightPct: 30, maxFaceHeightPct: 20 },
      { maxFaceHeightPct: 10 },
    ]) {
      expect(issues(bad).length, JSON.stringify(bad)).toBe(1)
    }
    expect(issues({ minFaceHeightPct: 30, maxFaceHeightPct: 0 })).toEqual([])
  })

  it("a blur strength under the depth fill is neither checked nor saved; under blur (or no fill = blur) it is", () => {
    const depth = toForm(draft())
    depth.faceMasking = { mode: "always", fill: "depth", blurStrengthPct: 9 }
    expect(formIssues(depth)).toEqual([])
    expect(fromForm(depth).faceMasking).toEqual({ mode: "always", fill: "depth" })
    for (const fill of ["blur", undefined] as const) {
      const form = toForm(draft())
      form.faceMasking = { mode: "always", ...(fill ? { fill } : {}), blurStrengthPct: 3 }
      expect(formIssues(form), String(fill)).toEqual([])
      expect(fromForm(form).faceMasking, String(fill)).toEqual({ mode: "always", ...(fill ? { fill } : {}), blurStrengthPct: 3 })
      form.faceMasking = { ...form.faceMasking, blurStrengthPct: 9 }
      expect(formIssues(form), String(fill)).toEqual(["Face masking: the blur strength is 0.1–5 %."])
    }
  })

  it("saves a null zone (no margins) as null, and an empty zone as left out (the default margins)", () => {
    const form = toForm(draft())
    form.faceMasking = { mode: "always", zone: null }
    expect(fromForm(form).faceMasking).toEqual({ mode: "always", zone: null })
    expect(formIssues(form)).toEqual([])
    form.faceMasking = { mode: "always", zone: {} }
    expect(fromForm(form).faceMasking).toEqual({ mode: "always" })
    form.faceMasking = { mode: "always", zone: { leftPct: 0, rightPct: 0, topPct: 0, bottomPct: 0 } }
    expect(fromForm(form).faceMasking).toEqual({ mode: "always", zone: { leftPct: 0, rightPct: 0, topPct: 0, bottomPct: 0 } })
  })

  it("pins the default zone the editor shows: 10 % left and right", () => {
    expect(FACE_MASKING_DEFAULTS.zone).toEqual({ leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 })
  })

  it("lists the engine's problems with the trend's engine prompt changes", () => {
    expect(
      describeBlocker({
        code: "prompt_parts_invalid",
        problems: [
          { part: "keep", code: "part_not_used", message: "The keep part is not used in this mode." },
          { code: "prompt_too_long", message: "The prompt is too long.", mode: "preview" },
        ],
      }),
    ).toBe(
      "The engine prompt changes no longer fit this trend: keep: The keep part is not used in this mode. 4 s preview: The prompt is too long. Change or reset them (4. Prompts → Engine prompt).",
    )
  })

  it("describes an engine without Kling 4", () => {
    expect(describeBlocker({ code: "engine_unsupported", env: "production", need: "kling-4" })).toBe("production: Nodaro Motion Pulse (Kling 4) not supported yet")
  })

  it("describes an engine without face masking", () => {
    expect(describeBlocker({ code: "engine_unsupported", env: "production", need: "faceMasking" })).toBe(
      "production: face masking not supported yet",
    )
    expect(describeBlocker({ code: "engine_unsupported", env: "staging", need: "trendPrePrompt" })).toBe(
      "staging: pre prompts not supported yet",
    )
    expect(describeBlocker({ code: "engine_unsupported", env: "production", need: "faceMaskTarget:face" })).toBe(
      "production: face-only masks not supported yet",
    )
  })

  it("reads its limits from @nodaro/shared, where the server reads them", () => {
    expect(FACE_MASKING_BOUNDS).toBe(CAST_SWAP_FACE_MASKING_BOUNDS)
    expect(FACE_MASKING_DEFAULTS).toBe(CAST_SWAP_FACE_MASKING_DEFAULTS)
    expect(MAX_TREND_PROMPT).toBe(TREND_PROMPT_LIMITS.trendPromptMax)
    expect(MAX_PRE_PROMPT).toBe(TREND_PROMPT_LIMITS.prePromptMax)
    expect(TREND_DETAILS_MAX).toBe(TREND_PROMPT_LIMITS.detailsMax)
  })

  it("keeps room for the user's details, as the server's publish check does", () => {
    const b = promptBudget({ prePrompt: "", trendPrompt: "" })
    // The engine's post prompt field (4000) less the details (1000) and the blank line before them.
    expect(b.trendPromptMax).toBe(2998)
    // Seedance 2.5's prompt cap less the engine's own text (17000), the details and the blank line.
    expect(b.promptsMax).toBe(getMaxVideoPromptChars("seedance-2-5") - 17_000 - 2 - 1000)
    expect(b.room).toBe(2998)
    expect(promptBudget({ prePrompt: "p".repeat(3000), trendPrompt: "t".repeat(998) }).room).toBe(2000)
  })

  it("holds Save for a trend prompt that leaves no room for the details", () => {
    const issues = (trendPrompt: string) => formIssues({ ...toForm(draft()), trendPrompt })
    expect(issues("t".repeat(2998))).toEqual([])
    expect(issues("t".repeat(2999))).toEqual([
      "Trend prompt: at most 2998 characters, to leave room for the user's details (up to 1000).",
    ])
    expect(issues("t".repeat(3001))).toEqual(["Trend prompt: at most 3000 characters."])
  })
})

describe("the chips a slot shows to people", () => {
  const lead = (over: Record<string, unknown> = {}) =>
    ({ key: "lead", label: { en: "Lead" }, kind: "person", required: true, roleName: "the woman", ...over }) as AdminTrendData["slots"][number]

  it("round-trips a slot with none listed (all shown) and one that hides some or all", () => {
    for (const slot of [lead(), lead({ chips: ["outfit"] }), lead({ chips: [] })]) {
      const d = draft({ slots: [slot] })
      expect(fromForm(toForm(d))).toEqual(savedOf(d))
    }
  })

  it("lists the shown chips in the kind's order; all shown again is none listed", () => {
    const [form] = toForm(draft({ slots: [lead()] })).slots
    const hidden = withChipShown(form!, "hair", false)
    expect(shownChips(hidden)).toEqual(["body", "outfit"])
    const none = withChipShown(withChipShown(hidden, "body", false), "outfit", false)
    expect(none.chips).toEqual([])
    const back = withChipShown(withChipShown(hidden, "outfit", true), "hair", true)
    expect(shownChips(back)).toEqual(["body", "outfit", "hair"])
    expect(back).not.toHaveProperty("chips")
  })

  it("a slot that lists every chip of its kind saves as none listed", () => {
    const d = draft({ slots: [lead({ chips: ["hair", "body", "outfit"] })] })
    expect(fromForm(toForm(d)).slots[0]).not.toHaveProperty("chips")
  })

  it("a kind change shows every chip of the new kind; a location saves no chips", () => {
    const [form] = toForm(draft({ slots: [lead({ chips: ["outfit"] })] })).slots
    expect(withKind(form!, "pet")).not.toHaveProperty("chips")
    const place = withKind(form!, "location")
    expect(fromForm({ ...toForm(draft()), slots: [place] }).slots[0]).not.toHaveProperty("chips")
  })
})

describe("the model (engine) in the form", () => {
  it("round-trips a draft with no engine as none (Seedance 2.5), so loading it is no change", () => {
    const form = toForm(draft())
    expect(form.engine).toBeUndefined()
    expect(engineOfForm(form)).toBe("seedance-2-5")
    expect(fromForm(form)).not.toHaveProperty("engine")
  })

  it("holds a Kling 4 form to Kling 4's cap less its own engine text, as the server does", () => {
    const form = toForm(draft({ engine: "kling-4" }))
    const want = getMaxVideoPromptChars("kling-4") - klingEngineText({ slots: form.slots, references: form.references }) - 2 - TREND_DETAILS_MAX
    expect(promptBudget(form).promptsMax).toBe(want)
    expect(promptBudget(toForm(draft())).promptsMax).toBe(getMaxVideoPromptChars("seedance-2-5") - TREND_PROMPT_LIMITS.engineTextReserve - 2 - TREND_DETAILS_MAX)
  })

  it("caps a Kling 4 form at 10 images, Seedance at 30", () => {
    expect(maxImagesFor(toForm(draft({ engine: "kling-4" })))).toBe(10)
    expect(maxImagesFor(toForm(draft()))).toBe(30)
    const five = Array.from({ length: 5 }, (_, i) => ({ key: `s${i}`, label: { en: "S" }, kind: "person" as const, required: true, roleName: "r" }))
    expect(imagesSentAtMost(toForm(draft({ engine: "kling-4", slots: five })))).toBe(5)
    expect(imagesSentAtMost(toForm(draft({ slots: five })))).toBe(15)
    const references = [{ images: ["https://x/1.png", "https://x/2.png", "https://x/3.png"], line: "l" }, { images: ["https://x/4.png", "https://x/5.png", "https://x/6.png"], line: "l" }]
    expect(formIssues(toForm(draft({ engine: "kling-4", slots: five, references })))).toContain(
      "11 images: at most 10 on Nodaro Motion Pulse (Kling 4) (1 prepared picture per person, pet or product slot, 3 per location, plus the reference pictures).",
    )
  })

  it("keeps klingLength on a Kling 4 draft, and out of a Seedance one", () => {
    expect(fromForm(toForm(draft({ engine: "kling-4", klingLength: "cut-start" })))).toMatchObject({ engine: "kling-4", klingLength: "cut-start" })
    expect(fromForm({ ...toForm(draft({ engine: "kling-4", klingLength: "cut-start" })), engine: "seedance-2-5" })).not.toHaveProperty("klingLength")
  })

  it("keeps pulseAudio on a Kling 4 draft, out of a Seedance one, and leaves it absent when none is set", () => {
    expect(fromForm(toForm(draft({ engine: "kling-4", pulseAudio: "generated" })))).toMatchObject({ engine: "kling-4", pulseAudio: "generated" })
    expect(fromForm({ ...toForm(draft({ engine: "kling-4", pulseAudio: "generated" })), engine: "seedance-2-5" })).not.toHaveProperty("pulseAudio")
    expect(fromForm(toForm(draft({ engine: "kling-4" })))).not.toHaveProperty("pulseAudio")
  })

  it("keeps prismReferenceAudio's non-full resolutions on a Prism draft (named or not), out of a Kling 4 one, and leaves it absent when every one is full", () => {
    const mixed = { "480p": "full", "720p": "none", "1080p": "voice" } as const
    const sent = { "720p": "none", "1080p": "voice" }
    expect(fromForm(toForm(draft({ prismReferenceAudio: mixed }))).prismReferenceAudio).toEqual(sent)
    expect(fromForm(toForm(draft({ engine: "seedance-2-5", prismReferenceAudio: mixed })))).toMatchObject({ engine: "seedance-2-5", prismReferenceAudio: sent })
    expect(fromForm({ ...toForm(draft({ prismReferenceAudio: mixed })), engine: "kling-4" })).not.toHaveProperty("prismReferenceAudio")
    for (const full of [{}, { "480p": "full", "720p": "full", "1080p": "full" } as const, "full" as const]) {
      expect(fromForm(toForm(draft({ prismReferenceAudio: full }))), JSON.stringify(full)).not.toHaveProperty("prismReferenceAudio")
    }
    expect(fromForm(toForm(draft({})))).not.toHaveProperty("prismReferenceAudio")
  })

  it("reads a plain prismReferenceAudio saved before the per-resolution setting as that mode at every resolution", () => {
    for (const mode of ["voice", "none"] as const) {
      expect(toForm(draft({ prismReferenceAudio: mode })).prismReferenceAudio).toEqual({ "480p": mode, "720p": mode, "1080p": mode })
      expect(fromForm(toForm(draft({ prismReferenceAudio: mode }))).prismReferenceAudio).toEqual({ "480p": mode, "720p": mode, "1080p": mode })
    }
    expect(toForm(draft({ prismReferenceAudio: "full" })).prismReferenceAudio).toEqual({ "480p": "full", "720p": "full", "1080p": "full" })
  })


  it("round-trips a chosen engine exactly", () => {
    for (const engine of ["seedance-2-5", "kling-4"] as const) {
      expect(fromForm(toForm(draft({ engine })))).toEqual(savedOf(draft({ engine })))
      expect(engineOfForm(toForm(draft({ engine })))).toBe(engine)
    }
  })
})

describe("the original's display copy and a slot's hint picture", () => {
  const DISPLAY = {
    videoUrl: "https://cdn.test/trends/a1/display.mp4",
    posterUrl: "https://cdn.test/trends/a1/poster.png",
    width: 720,
    height: 1280,
    durationSec: 12.04,
  }
  const withBoth = () =>
    draft({
      source: { videoUrl: "https://cdn.test/src.mp4", durationSec: 12, width: 720, height: 1280, display: DISPLAY },
      slots: [{ key: "lead", label: { en: "Lead" }, kind: "person", required: true, roleName: "the woman", hintImageUrl: "https://cdn.test/trends/a1/hint.png" }],
    })

  it("round-trips source.display and a slot's hintImageUrl exactly (a save never drops them)", () => {
    const d = withBoth()
    const out = fromForm(toForm(d))
    expect(out).toEqual(savedOf(d))
    expect(out.source?.display).toEqual(DISPLAY)
    expect(out.slots[0]?.hintImageUrl).toBe("https://cdn.test/trends/a1/hint.png")
  })

  it("saves only the display copy's own fields (the server's schema is strict)", () => {
    const form = toForm(withBoth())
    form.source = { ...form.source!, display: { ...DISPLAY, extra: "x" } as typeof DISPLAY }
    expect(fromForm(form).source?.display).toEqual(DISPLAY)
  })

  it("leaves out an empty hint picture, and a source with no display copy saves none", () => {
    const form = toForm(draft())
    form.slots = form.slots.map((s) => ({ ...s, hintImageUrl: "" }))
    const out = fromForm(form)
    expect(out.slots[0]).not.toHaveProperty("hintImageUrl")
    expect(out.source).not.toHaveProperty("display")
  })

  it("keeps the hint picture through a kind change", () => {
    const [form] = toForm(withBoth()).slots
    expect(withKind(form!, "pet").hintImageUrl).toBe("https://cdn.test/trends/a1/hint.png")
  })

  it("describes a source without its display copy, and says to upload the clip again", () => {
    expect(describeBlocker({ code: "source_display_missing" })).toBe(
      "The source clip has no display copy (the copy users see). Upload the clip again to make one.",
    )
  })
})

describe("the 4 s preview's own prompt parts in the form", () => {
  const withPreview = (over: Partial<AdminTrendData> = {}) =>
    draft({
      slots: [{ key: "lead", label: { en: "Lead" }, kind: "person", required: true, roleName: "the woman on the left", previewRoleName: "the woman" }],
      references: [{ images: ["https://cdn.test/r.png"], line: "the neon sign", previewLine: "the sign" }],
      prePrompt: "Open on the stage.",
      previewPrePrompt: "Open close.",
      previewTrendPrompt: "Keep it short.",
      ...over,
    })

  it("round-trips every preview part exactly, and a draft with none stays without them", () => {
    expect(fromForm(toForm(withPreview()))).toEqual(savedOf(withPreview()))
    const plain = fromForm(toForm(draft()))
    for (const key of ["previewPrePrompt", "previewTrendPrompt"]) expect(plain).not.toHaveProperty(key)
    expect(plain.slots[0]).not.toHaveProperty("previewRoleName")
  })

  it("an empty or blank preview part is not saved (it runs the full run's text)", () => {
    const form = toForm(withPreview())
    const cleared = fromForm({
      ...form,
      previewPrePrompt: " ",
      previewTrendPrompt: "",
      slots: form.slots.map((s) => ({ ...s, previewRoleName: "  " })),
      references: form.references.map((r) => ({ ...r, previewLine: "" })),
    })
    expect(cleared).not.toHaveProperty("previewPrePrompt")
    expect(cleared).not.toHaveProperty("previewTrendPrompt")
    expect(cleared.slots[0]).not.toHaveProperty("previewRoleName")
    expect(cleared.references[0]).toEqual({ images: ["https://cdn.test/r.png"], line: "the neon sign" })
  })

  it("keeps the preview parts when the trend stops offering a preview", () => {
    const out = fromForm({ ...toForm(withPreview()), previewStart: null })
    expect(out).toMatchObject({ previewStart: null, previewPrePrompt: "Open close.", previewTrendPrompt: "Keep it short." })
    expect(out.slots[0]!.previewRoleName).toBe("the woman")
    expect(out.references[0]!.previewLine).toBe("the sign")
  })

  it("withPreviewPrompts: the preview's own texts, else the full run's", () => {
    const p = withPreviewPrompts(toForm(withPreview({ previewTrendPrompt: "" })))
    expect([p.prePrompt, p.trendPrompt]).toEqual(["Open close.", "Keep the shake."])
    expect(p.slots[0]!.roleName).toBe("the woman")
    expect(p.references[0]!.line).toBe("the sign")
    expect(hasOwnPreviewPrompts(toForm(draft()))).toBe(false)
    expect(hasOwnPreviewPrompts(toForm(withPreview()))).toBe(true)
  })

  it("holds the preview parts to their limits, and to the budget only while a preview is offered", () => {
    const form = toForm(withPreview())
    expect(formIssues(form)).toEqual([])
    const long = { ...form, slots: form.slots.map((s) => ({ ...s, previewRoleName: "r".repeat(201) })) }
    expect(formIssues(long)).toContain("Slot 1: the role name in the 4 s preview is at most 200 characters.")
    const longLine = { ...form, references: form.references.map((r) => ({ ...r, previewLine: "l".repeat(501) })) }
    expect(formIssues(longLine)).toContain("Reference 1: the prompt line in the 4 s preview is at most 500 characters.")
    expect(formIssues({ ...form, previewPrePrompt: "p".repeat(MAX_PRE_PROMPT + 1) })).toContain(
      `Pre prompt in the 4 s preview: at most ${MAX_PRE_PROMPT} characters.`,
    )
    const over = { ...form, previewTrendPrompt: "t".repeat(promptBudget({ prePrompt: "", trendPrompt: "" }).trendPromptMax + 1) }
    expect(formIssues(over)).toEqual([
      `Trend prompt in the 4 s preview: at most ${promptBudget({ prePrompt: "", trendPrompt: "" }).trendPromptMax} characters, to leave room for the user's details (up to ${TREND_DETAILS_MAX}).`,
    ])
    // No preview offered: kept, never run, so not held to the budget.
    expect(formIssues({ ...over, previewStart: null })).toEqual([])
  })
})

describe("one name per run: a described Full depth preview sends the full role names", () => {
  // Long role names (what the stored scene description uses), short preview ones, and the preview's
  // pre and trend prompts at their longest: they fit Kling 4 beside the short names only.
  const kling = (faceMasking?: AdminTrendFaceMasking) =>
    toForm(
      draft({
        engine: "kling-4",
        slots: [
          { key: "lead", label: { en: "Lead" }, kind: "person", required: true, roleName: "r".repeat(200), previewRoleName: "her" },
          { key: "friend", label: { en: "Friend" }, kind: "person", required: false, roleName: "f".repeat(200), previewRoleName: "him" },
        ],
        trendPrompt: "t",
        previewPrePrompt: "x".repeat(MAX_PRE_PROMPT),
        previewTrendPrompt: "y".repeat(promptBudget({ prePrompt: "", trendPrompt: "" }).trendPromptMax),
        ...(faceMasking ? { faceMasking } : {}),
      }),
    )
  const previewBudgetIssues = (f: ReturnType<typeof kling>) => formIssues(f).filter((m) => m.startsWith("Pre and trend prompts in the 4 s preview"))

  it("holds the preview to the full role names while it may carry the stored description, and only then", () => {
    const faces = kling()
    expect(previewPromptBudget(faces).room).toBeGreaterThanOrEqual(0)
    expect(previewBudgetIssues(faces)).toEqual([])
    const described = kling({ mode: "always", source: "full-depth" })
    expect(previewPromptBudget(described).room).toBeLessThan(0)
    expect(previewPromptBudget(described)).toEqual(promptBudget(withPromptsFor(described, "preview", "stored")))
    expect(previewBudgetIssues(described)).toHaveLength(1)
    // Another scene sends no stored description: the preview's own names.
    expect(previewBudgetIssues(kling({ mode: "always", source: "full-depth", scene: "original" }))).toEqual([])
  })
})

describe("the 4 s preview's input clip (server-owned)", () => {
  const CLIP: AdminTrendPreviewClip = {
    videoUrl: "https://cdn.test/trends/a1/preview.mp4",
    durationSec: 5,
    width: 720,
    height: 1280,
    frames: 150,
    sha256: "ab".repeat(32),
    sourceVideoUrl: "https://cdn.test/src.mp4",
    startSec: 2,
    madeAt: "2026-10-27T10:00:00.000Z",
  }

  it("is carried on the form read-only and kept out of the PUT body (the server makes it on save)", () => {
    const d = draft({ previewClip: CLIP })
    const form = toForm(d)
    expect(form.previewClip).toEqual(CLIP)
    expect(form.previewClip).not.toBe(CLIP)
    const out = fromForm(form)
    expect(out).not.toHaveProperty("previewClip")
    expect(out).toEqual(savedOf(d))
    // Loading a draft with and without the clip saves the same body: it never makes the form dirty.
    expect(JSON.stringify(fromForm(toForm(draft())))).toBe(JSON.stringify(out))
  })

  it("previewClipStatus mirrors the server's reading from what the client knows: source URL and start", () => {
    expect(previewClipStatus(toForm(draft({ previewClip: CLIP })))).toBe("current")
    expect(previewClipStatus(toForm(draft()))).toBe("none")
    expect(previewClipStatus(toForm(draft({ previewClip: CLIP, previewStart: null })))).toBe("none")
    expect(previewClipStatus(toForm(draft({ previewClip: CLIP, source: null })))).toBe("none")
    expect(previewClipStatus({ ...toForm(draft({ previewClip: CLIP })), previewStart: 2.5 })).toBe("stale")
    const moved = toForm(draft({ previewClip: CLIP, source: { videoUrl: "https://cdn.test/src-2.mp4", durationSec: 12 } }))
    expect(previewClipStatus(moved)).toBe("stale")
    // The server's draft reads the same way (the Test panel asks about the saved draft).
    expect(previewClipStatus(draft({ previewClip: CLIP }))).toBe("current")
  })

  it("describes a missing and an out-of-date preview input clip, pointing at the save that makes it", () => {
    expect(describeBlocker({ code: "preview_clip_missing" })).toBe(
      "The 4 s preview's input clip is not prepared yet. Save the draft, or publish again, to make it (1. Source clip → Preview input).",
    )
    expect(describeBlocker({ code: "preview_clip_out_of_date", why: "start" })).toBe(
      "The 4 s preview's input clip is out of date: the preview start moved since it was cut. Save the draft, or publish again, to make it again (1. Source clip → Preview input).",
    )
    expect(describeBlocker({ code: "preview_clip_out_of_date", why: "source" })).toMatch(/the source clip changed since it was cut/)
    expect(describeBlocker({ code: "preview_clip_out_of_date", why: "face_mask" })).toMatch(/the face mask changed since it was cut/)
    expect(describeBlocker({ code: "preview_clip_out_of_date", why: "recipe" })).toMatch(/cut differently since it was made/)
    expect(describeBlocker({ code: "preview_clip_out_of_date" })).toMatch(/the draft changed since it was cut/)
  })
})

describe("the editor runs the server's rule (@nodaro/render-rules), never a copy", () => {
  it("withPreviewPrompts, hasOwnPreviewPrompts and promptBudget are the package's", () => {
    const form = toForm(draft({ previewTrendPrompt: "Short.", slots: [{ key: "lead", label: { en: "Lead" }, kind: "person", required: true, roleName: "the woman", previewRoleName: "her" }] }))
    expect(withPreviewPrompts(form)).toEqual(withPromptsFor(form, "preview"))
    expect(hasOwnPreviewPrompts).toBe(ruleHasOwn)
    expect(promptBudget({ ...form, engine: "kling-4" })).toEqual(trendPromptBudget({ ...form, engine: "kling-4" }))
  })
})
