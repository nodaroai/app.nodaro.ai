import { describe, it, expect } from "vitest"
import {
  ACTION_FX,
  ACTION_FX_IDS,
  ACTION_FX_CATEGORY_LABELS,
  ACTION_FX_CATEGORY_ORDER,
  getActionFx,
  getActionFxLabel,
  getActionFxPromptHint,
  buildActionFxHints,
} from "../action-fx.js"
import type { ActionFxCategory } from "../action-fx.js"

const VALID_CATEGORIES: ReadonlyArray<ActionFxCategory> = [
  "disaster", "fire-blasts", "electric", "combat", "sci-fi", "magic",
]

describe("ACTION_FX catalog", () => {
  it("has at least 60 entries", () => {
    expect(ACTION_FX.length).toBeGreaterThanOrEqual(60)
  })

  it("every entry has all 5 fields populated and non-empty", () => {
    for (const fx of ACTION_FX) {
      expect(fx.id, `entry: ${JSON.stringify(fx)}`).toBeTruthy()
      expect(fx.label, `id: ${fx.id}`).toBeTruthy()
      expect(fx.category, `id: ${fx.id}`).toBeTruthy()
      expect(fx.description, `id: ${fx.id}`).toBeTruthy()
      expect(fx.promptHint, `id: ${fx.id}`).toBeTruthy()
      expect(fx.promptHint.length, `id: ${fx.id}`).toBeGreaterThan(20)
    }
  })

  it("every entry's category is a valid ActionFxCategory", () => {
    for (const fx of ACTION_FX) {
      expect(VALID_CATEGORIES, `id: ${fx.id}, category: ${fx.category}`).toContain(fx.category)
    }
  })

  it("all ids are unique", () => {
    const ids = ACTION_FX.map((fx) => fx.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("ACTION_FX_IDS matches catalog order", () => {
    expect(ACTION_FX_IDS).toEqual(ACTION_FX.map((fx) => fx.id))
  })

  it("ACTION_FX_CATEGORY_ORDER matches the expected order", () => {
    expect(ACTION_FX_CATEGORY_ORDER).toEqual([
      "disaster", "fire-blasts", "electric", "combat", "sci-fi", "magic",
    ])
  })

  it("ACTION_FX_CATEGORY_LABELS has a label for every category", () => {
    for (const cat of VALID_CATEGORIES) {
      expect(ACTION_FX_CATEGORY_LABELS[cat]).toBeTruthy()
    }
  })

  it("every category has at least one entry", () => {
    const categoriesPresent = new Set(ACTION_FX.map((fx) => fx.category))
    for (const cat of VALID_CATEGORIES) {
      expect(categoriesPresent, `category ${cat} has no entries`).toContain(cat)
    }
  })
})

describe("getActionFx", () => {
  it("returns the entry for a valid id", () => {
    const first = ACTION_FX[0]
    expect(getActionFx(first.id)).toEqual(first)
  })

  it("returns undefined for an unknown id", () => {
    expect(getActionFx("not-a-real-id")).toBeUndefined()
  })

  it("returns undefined for null/undefined input", () => {
    expect(getActionFx(null)).toBeUndefined()
    expect(getActionFx(undefined)).toBeUndefined()
  })
})

describe("getActionFxLabel", () => {
  it("returns the label for a valid id", () => {
    const first = ACTION_FX[0]
    expect(getActionFxLabel(first.id)).toBe(first.label)
  })

  it("returns the fallback when id is unknown and fallback provided", () => {
    expect(getActionFxLabel("nope", "Fallback Label")).toBe("Fallback Label")
  })

  it("returns titleized id when no fallback and unknown", () => {
    expect(getActionFxLabel("hello-world")).toBe("Hello World")
  })
})

describe("getActionFxPromptHint", () => {
  it("returns the promptHint for a valid id", () => {
    const first = ACTION_FX[0]
    expect(getActionFxPromptHint(first.id)).toBe(first.promptHint)
  })

  it("returns empty string for unknown id", () => {
    expect(getActionFxPromptHint("nope")).toBe("")
  })
})

describe("buildActionFxHints", () => {
  it("returns empty array for undefined", () => {
    expect(buildActionFxHints(undefined)).toEqual([])
  })

  it("returns empty array for null", () => {
    expect(buildActionFxHints(null)).toEqual([])
  })

  it("returns empty array for empty string", () => {
    expect(buildActionFxHints("")).toEqual([])
  })

  it("returns single-element array for a known string id", () => {
    const first = ACTION_FX[0]
    expect(buildActionFxHints(first.id)).toEqual([first.promptHint])
  })

  it("returns empty array for an unknown string id", () => {
    expect(buildActionFxHints("not-a-real-id")).toEqual([])
  })

  it("returns multiple promptHints in order for an array of ids", () => {
    const first = ACTION_FX[0]
    const last = ACTION_FX[ACTION_FX.length - 1]
    expect(buildActionFxHints([first.id, last.id])).toEqual([first.promptHint, last.promptHint])
  })

  it("deduplicates repeated ids before applying the cap", () => {
    const first = ACTION_FX[0]
    const second = ACTION_FX[1]
    expect(buildActionFxHints([first.id, first.id, second.id]))
      .toEqual([first.promptHint, second.promptHint])
  })

  it("caps at 2 ids (drops the rest, enforced independently of the UI cap)", () => {
    const ids = ACTION_FX.slice(0, 5).map((fx) => fx.id)
    expect(buildActionFxHints(ids)).toHaveLength(2)
  })

  it("filters out unknown ids inside an array", () => {
    const first = ACTION_FX[0]
    expect(buildActionFxHints([first.id, "not-real"])).toEqual([first.promptHint])
  })
})
