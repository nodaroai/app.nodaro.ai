/**
 * The trend editor's form model: face masking and the pre prompt.
 *
 * - A draft's `faceMasking` and `prePrompt` come back from the form exactly
 *   as they were saved (absent stays absent: no defaults are written in).
 * - The bounds are the server's own (`@nodaro/shared`), so Save is off before a 400.
 * - A publish blocker for an engine without face masking reads as a sentence.
 */
import { describe, expect, it } from "vitest"
import type { AdminTrendData, AdminTrendFaceMasking } from "@/lib/api"
import {
  CAST_SWAP_FACE_MASKING_BOUNDS,
  CAST_SWAP_FACE_MASKING_DEFAULTS,
  getMaxVideoPromptChars,
  TREND_PROMPT_LIMITS,
} from "@nodaro/shared/models"
import {
  describeBlocker,
  FACE_MASKING_BOUNDS,
  FACE_MASKING_DEFAULTS,
  formIssues,
  fromForm,
  MAX_PRE_PROMPT,
  MAX_TREND_PROMPT,
  promptBudget,
  TREND_DETAILS_MAX,
  toForm,
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
  fill: "depth",
  minFaceHeightPct: 10,
  maxFaceHeightPct: 60,
  zone: { leftPct: 5, bottomPct: 49 },
  blurStrengthPct: 2.5,
  threshold: 0.4,
}

/** What a save sends for `draft()`: everything but the examples. */
function savedOf(d: AdminTrendData): Omit<AdminTrendData, "examples"> {
  const out: Partial<AdminTrendData> = { ...d }
  delete out.examples
  return out as Omit<AdminTrendData, "examples">
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
      { blurStrengthPct: 0 },
      { blurStrengthPct: 6 },
      { threshold: 0.01 },
      { threshold: 1 },
      { minFaceHeightPct: 30, maxFaceHeightPct: 20 },
      { maxFaceHeightPct: 10 },
    ]) {
      expect(issues(bad).length, JSON.stringify(bad)).toBe(1)
    }
    expect(issues({ minFaceHeightPct: 30, maxFaceHeightPct: 0 })).toEqual([])
  })

  it("describes an engine without face masking", () => {
    expect(describeBlocker({ code: "engine_unsupported", env: "production", need: "faceMasking" })).toBe(
      "production: face masking not supported yet",
    )
    expect(describeBlocker({ code: "engine_unsupported", env: "staging", need: "trendPrePrompt" })).toBe(
      "staging: pre prompts not supported yet",
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
