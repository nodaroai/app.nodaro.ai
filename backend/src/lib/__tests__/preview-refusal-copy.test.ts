// @test-watches frontend/src/lib/i18n/en.ts backend/src/nodes/*/descriptor.generated.ts
/**
 * Every preview refusal names the remedy for what holds the run: a render at
 * Preview is set to Final; a use-case node with review on has its review
 * turned off (a Final quality does nothing to it). One table, read by every
 * refusal site; the render texts are the ones clients have always seen.
 */
import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { REVIEW_HOLDING_USE_CASE_TYPES } from "@nodaro/shared/nodes"
import { previewHoldKind } from "@nodaro/render-rules"
import { unitDescriptorOf } from "../unit-descriptors.js"

vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => true }))

import { previewRefusalMessage, type PreviewRefusalSituation } from "../preview-refusal-copy.js"
import { PREVIEW_REVIEW_REQUIRED_MESSAGE, previewReviewRefusal } from "../preview-review-gate.js"
import { PREVIEW_RENDER_NESTED_MESSAGE } from "../../services/workflow-engine/nested-preview-renders.js"

const SITUATIONS: PreviewRefusalSituation[] = ["headless", "nested", "componentPublish", "componentRun"]

describe("the render texts are unchanged", () => {
  it("byte for byte", () => {
    expect(previewRefusalMessage("headless", "render")).toBe(
      "This workflow stops for a review: its render is set to Preview, and only a run started in the Nodaro editor or on an app's own page can stop for one. Open it there to run it, or set the render to Final (or send a Final quality override for it).",
    )
    expect(previewRefusalMessage("nested", "render")).toBe(
      "This sub-workflow stops for a review (its render is set to Preview), and a nested workflow cannot. Set that render to Final.",
    )
    expect(previewRefusalMessage("componentPublish", "render")).toBe("A component cannot stop for a review: set its render to Final before publishing it.")
    expect(previewRefusalMessage("componentRun", "render")).toBe("A component cannot stop for a review: its render must be set to Final.")
    expect(PREVIEW_REVIEW_REQUIRED_MESSAGE).toBe(previewRefusalMessage("headless", "render"))
    expect(PREVIEW_RENDER_NESTED_MESSAGE).toBe(previewRefusalMessage("nested", "render"))
  })
})

describe("a review-on use-case node's remedy is its review, never a Final", () => {
  it.each(SITUATIONS)("%s", (situation) => {
    const review = previewRefusalMessage(situation, "review")
    expect(review).toMatch(/Review before render/)
    expect(review).not.toMatch(/Final/)
    const any = previewRefusalMessage(situation, "any")
    expect(any).toMatch(/Review before render/)
    expect(any).toMatch(/Final/)
    // Every node that has it on holds the run the same way: no node type is named.
    for (const text of [review, any]) {
      expect(text).not.toMatch(/Tighten Episode|Trailer|Chapters/)
      expect(text).toMatch(/every node (that has it on|in it must have “Review before render” off)/)
    }
    // No kind known (a bare code, an older row): the render's words, as always.
    expect(previewRefusalMessage(situation)).toBe(previewRefusalMessage(situation, "render"))
  })

  it("the copy names no node type, so every review-holding type reads it alike", () => {
    expect(REVIEW_HOLDING_USE_CASE_TYPES.size).toBeGreaterThan(0)
    for (const type of REVIEW_HOLDING_USE_CASE_TYPES) {
      const label = unitDescriptorOf(type)?.label
      expect(label, `${type} is a unit with a label`).toBeTruthy()
      for (const situation of SITUATIONS) {
        for (const kind of ["review", "any"] as const) expect(previewRefusalMessage(situation, kind), `${type} ${situation} ${kind}`).not.toContain(label)
      }
    }
  })
})

describe("the kind is the holders'", () => {
  it("renders, review-on use-case nodes, both; nothing known reads as a render", () => {
    expect(previewHoldKind(["apply-edl", "speaker-view"])).toBe("render")
    expect(previewHoldKind(["tighten-episode"])).toBe("review")
    expect(previewHoldKind(["tighten-episode", "tighten-episode"])).toBe("review")
    expect(previewHoldKind(["episode-trailer"])).toBe("review")
    expect(previewHoldKind(["apply-edl", "episode-trailer"])).toBe("any")
    // Both remedies only when both kinds actually hold.
    expect(previewHoldKind(["apply-edl", "tighten-episode"])).toBe("any")
    expect(previewHoldKind([])).toBe("render")
    expect(previewHoldKind(["upload-video"])).toBe("render")
  })
})

describe("previewReviewRefusal names the remedy of the graph it refuses", () => {
  const cut = { id: "cut", type: "apply-edl", data: { quality: "proxy" } }
  const t1 = { id: "t1", type: "tighten-episode", data: { reviewBeforeRender: true } }
  const out = { id: "out", type: "webhook-output", data: {} }
  const out2 = { id: "out2", type: "webhook-output", data: {} }
  const api = { triggerType: "api" }

  it("a render at Preview", () => {
    expect(previewReviewRefusal([cut, out], [{ source: "cut", target: "out" }], api)?.message).toBe(previewRefusalMessage("headless", "render"))
  })

  it("a review-on Tighten Episode", () => {
    expect(previewReviewRefusal([t1, out], [{ source: "t1", target: "out" }], api)?.message).toBe(previewRefusalMessage("headless", "review"))
  })

  it("both in one graph: both remedies", () => {
    const refusal = previewReviewRefusal([cut, t1, out, out2], [{ source: "cut", target: "out" }, { source: "t1", target: "out2" }], api)
    expect(refusal).toEqual({ code: "preview_review_required", message: previewRefusalMessage("headless", "any") })
  })

  it("a component's run: the nested code, the component's words", () => {
    expect(previewReviewRefusal([t1, out], [{ source: "t1", target: "out" }], api, { component: true })).toEqual({
      code: "preview_render_nested",
      message: previewRefusalMessage("componentRun", "review"),
    })
  })
})

describe("the editor's English is the server's, word for word", () => {
  // The editor's copy lives in its own bundle; read its en dictionary as text.
  const en = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../../frontend/src/lib/i18n/en.ts"), "utf8")
  const KEY: Record<"headless" | "nested", string> = { headless: "previewGate.headlessRefusal", nested: "previewGate.nestedRefusal" }
  const SUFFIX: Record<"render" | "review" | "any", string> = { render: "Render", review: "Review", any: "" }
  for (const situation of ["headless", "nested"] as const) {
    for (const kind of ["render", "review", "any"] as const) {
      it(`${situation} / ${kind}`, () => {
        expect(en).toContain(`"${KEY[situation]}${SUFFIX[kind]}": ${JSON.stringify(previewRefusalMessage(situation, kind))},`)
      })
    }
  }
})
