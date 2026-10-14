// A list-transform node (Selector, Filter List, Sort List, Deduplicate, Merge
// Lists) hands ONE value of its list downstream, and both workflow engines
// route that value into the consumer's prompt — exactly what they do for a
// List node. The canvas validators read their own producer sets, and the
// transforms were missing from them: the run path existed, and the wire that
// leads to it could not be drawn ("I can't connect Selector → Generate Image").
import { describe, it, expect } from "vitest"
import { isValidGenerateImageConnection, TEXT_PRODUCER_TYPES } from "../generate-image-handles"
import { isValidGenerateVideoConnection } from "../generate-video-handles"
import { FAN_OUT_EACH_TYPES } from "@nodaro/shared/nodes"
import { isValidWorkflowConnection } from "../connection-validation"

const LIST_TRANSFORMS = ["selector", "filter-list", "sort-list", "deduplicate", "merge-lists"] as const
const notAPicker = () => false

describe("list-transform nodes feed text inputs, like the List they transform", () => {
  it.each(LIST_TRANSFORMS)("%s → Generate Image prompt / negative", (source) => {
    expect(isValidGenerateImageConnection("prompt", source, notAPicker)).toBe(true)
    expect(isValidGenerateImageConnection("negative", source, notAPicker)).toBe(true)
  })

  it.each(LIST_TRANSFORMS)("%s → Generate Video prompt", (source) => {
    expect(isValidGenerateVideoConnection("prompt", source, notAPicker)).toBe(true)
  })

  it("the List node itself still connects — the transforms are held to the same rule, not a new one", () => {
    expect(isValidGenerateImageConnection("prompt", "list", notAPicker)).toBe(true)
  })

  it("a transform is still not an identity or a look — only the text lanes opened", () => {
    for (const source of LIST_TRANSFORMS) {
      expect(isValidGenerateImageConnection("assets", source, notAPicker)).toBe(false)
      expect(isValidGenerateImageConnection("look", source, notAPicker)).toBe(false)
    }
  })

  it("every node that fans a LIST out item by item can put an item into a prompt", () => {
    // The invariant behind the bug: FAN_OUT_EACH_TYPES (@nodaro/shared) is the
    // set both engines iterate; each item lands in the consumer's prompt unless
    // it is media. A member that the canvas refuses on a prompt handle is a run
    // path with no wire leading to it. `edit-plan` is the one exception — its
    // items are EDL objects for apply-edl, never prompt text.
    const notText = new Set(["edit-plan"])
    const refused = [...FAN_OUT_EACH_TYPES].filter(
      (t) => !notText.has(t) && !isValidGenerateImageConnection("prompt", t, notAPicker),
    )
    expect(refused).toEqual([])
  })

  it("keeps the dispatch-totality contract: a text producer is one extractNodeOutput names", () => {
    for (const source of LIST_TRANSFORMS) expect(TEXT_PRODUCER_TYPES.has(source)).toBe(true)
  })
})

describe("the wire itself — through the validator the canvas calls on drop", () => {
  const typeOf = (types: Record<string, string>) => (id: string) => types[id]

  it("Selector's Picked → Generate Image's Prompt connects (the reported case)", () => {
    expect(
      isValidWorkflowConnection(
        { source: "sel", sourceHandle: "picked", target: "img", targetHandle: "prompt" },
        typeOf({ sel: "selector", img: "generate-image" }),
      ),
    ).toBe(true)
  })

  it("so does its Rest channel, and the other transforms' single output", () => {
    expect(
      isValidWorkflowConnection(
        { source: "sel", sourceHandle: "rest", target: "img", targetHandle: "prompt" },
        typeOf({ sel: "selector", img: "generate-image" }),
      ),
    ).toBe(true)
    for (const source of ["filter-list", "sort-list", "deduplicate", "merge-lists"]) {
      expect(
        isValidWorkflowConnection(
          { source: "src", sourceHandle: "out", target: "img", targetHandle: "prompt" },
          typeOf({ src: source, img: "generate-image" }),
        ),
        source,
      ).toBe(true)
    }
  })

  it("a Selector still cannot be wired in as an identity", () => {
    expect(
      isValidWorkflowConnection(
        { source: "sel", sourceHandle: "picked", target: "img", targetHandle: "assets" },
        typeOf({ sel: "selector", img: "generate-image" }),
      ),
    ).toBe(false)
  })
})
