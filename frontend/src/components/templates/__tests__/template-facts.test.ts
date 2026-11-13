import { describe, it, expect } from "vitest"
import {
  NEW_WINDOW_DAYS,
  POPULAR_MIN_CLONES,
  flowSteps,
  modelChipLabels,
  relatedTemplates,
  templateBadge,
} from "../template-facts"

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse("2026-09-14T12:00:00Z")
const ago = (days: number) => new Date(NOW - days * DAY).toISOString()

describe("templateBadge", () => {
  it("marks a template published inside the window as new", () => {
    expect(templateBadge({ createdAt: ago(NEW_WINDOW_DAYS - 1), cloneCount: 0 }, NOW)).toBe("new")
    expect(templateBadge({ createdAt: ago(NEW_WINDOW_DAYS + 1), cloneCount: 0 }, NOW)).toBeNull()
  })

  it("marks a template cloned often enough as popular", () => {
    expect(templateBadge({ createdAt: ago(90), cloneCount: POPULAR_MIN_CLONES }, NOW)).toBe("popular")
    expect(templateBadge({ createdAt: ago(90), cloneCount: POPULAR_MIN_CLONES - 1 }, NOW)).toBeNull()
  })

  it("prefers new over popular", () => {
    expect(templateBadge({ createdAt: ago(1), cloneCount: 500 }, NOW)).toBe("new")
  })

  it("never marks an unparseable date as new", () => {
    expect(templateBadge({ createdAt: "not a date", cloneCount: 0 }, NOW)).toBeNull()
  })
})

describe("modelChipLabels", () => {
  it("names catalogued models and passes unknown ids through", () => {
    const labels = modelChipLabels(["flux", "no-such-model"])
    expect(labels).toHaveLength(2)
    expect(labels[0]).not.toBe("flux")
    expect(labels[1]).toBe("no-such-model")
  })

  it("caps the chips and drops duplicates", () => {
    expect(modelChipLabels(["a", "a", "b", "c", "d"], 3)).toEqual(["a", "b", "c"])
  })

  it("names a model once across its text-to-image and image-to-image entries", () => {
    expect(modelChipLabels(["gpt-image-2", "gpt-image-2-i2i"])).toEqual(["GPT Image 2"])
  })

  it("keeps a parenthetical that tells models apart", () => {
    expect(modelChipLabels(["gemini-3.8-flash-video-analysis"])).toEqual(["Video Analysis (Fast)"])
  })
})

describe("flowSteps", () => {
  const node = (type: string, x: number, y = 0) => ({ id: `${type}-${x}`, type, position: { x, y } })

  it("orders the node types left to right and counts repeats", () => {
    const steps = flowSteps([node("generate-image", 900), node("upload-image", 100), node("generate-image", 950), node("llm-chat", 500)])
    expect(steps.map((s) => `${s.type}:${s.count}`)).toEqual(["upload-image:1", "llm-chat:1", "generate-image:2"])
    expect(steps[0].label).toBe("Upload Image")
  })

  it("leaves out sticky notes and groups", () => {
    const steps = flowSteps([node("sticky-note", 0), node("group", 10), node("text-prompt", 20)])
    expect(steps.map((s) => s.type)).toEqual(["text-prompt"])
  })

  it("tolerates malformed snapshot entries", () => {
    expect(flowSteps([null, 42, { type: "text-prompt" }, { position: { x: 1 } }])).toEqual([
      { type: "text-prompt", label: "Text", count: 1 },
    ])
  })
})

describe("relatedTemplates", () => {
  it("drops the template itself and caps the list", () => {
    const list = ["self", "a", "b", "c"].map((id) => ({ id }))
    expect(relatedTemplates(list, "self", 2).map((t) => t.id)).toEqual(["a", "b"])
  })
})
