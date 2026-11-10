import { describe, expect, it } from "vitest"

import { mergeNodeData } from "../node-data-merge"

const SENTENCE = "The model declined one of your pictures."
const WORDS = "Request blocked: The uploaded image may contain protected or restricted IP content."

/** A node that failed, with the sentence the platform wrote and the provider's own words under it. */
const failedNode = (over: Record<string, unknown> = {}) => ({
  label: "Poster",
  prompt: "a red fox in the snow",
  executionStatus: "failed",
  errorMessage: SENTENCE,
  errorDetail: WORDS,
  ...over,
})

describe("mergeNodeData", () => {
  describe("a write that says nothing about a failure", () => {
    it("is a shallow merge: the patch wins, every other key stays", () => {
      const out = mergeNodeData({ label: "Poster", prompt: "a fox", seed: 7 }, { prompt: "a wolf", steps: 30 })
      expect(out).toEqual({ label: "Poster", prompt: "a wolf", seed: 7, steps: 30 })
    })

    it("leaves a failed node's words where they are", () => {
      const out = mergeNodeData(failedNode(), { prompt: "a wolf in the snow" })
      expect(out).toEqual(failedNode({ prompt: "a wolf in the snow" }))
    })

    it("changes neither the node's data nor the patch", () => {
      const current = failedNode()
      const patch = { executionStatus: "failed", errorMessage: "Not enough credits." }
      const before = [structuredClone(current), structuredClone(patch)]
      const out = mergeNodeData(current, patch)
      expect([current, patch]).toEqual(before)
      expect(out).not.toBe(current)
    })
  })

  describe("the provider's words leave with the failure they explain", () => {
    it("another sentence drops them", () => {
      const out = mergeNodeData(failedNode(), { executionStatus: "failed", errorMessage: "Not enough credits." })
      expect(out.errorMessage).toBe("Not enough credits.")
      expect(out.errorDetail).toBeUndefined()
    })

    it("a sentence that is cleared drops them", () => {
      const out = mergeNodeData(failedNode(), { executionStatus: "running", errorMessage: undefined })
      expect(out.errorMessage).toBeUndefined()
      expect(out.errorDetail).toBeUndefined()
    })

    it("a sentence that is cleared drops them whatever the status says", () => {
      expect(mergeNodeData(failedNode(), { errorMessage: undefined }).errorDetail).toBeUndefined()
      expect(mergeNodeData(failedNode({ executionStatus: undefined }), { errorMessage: undefined, executionStatus: "idle" }).errorDetail).toBeUndefined()
    })

    it.each(["pending", "running", "completed", "idle"])(
      "a failure written over a %s node drops them, even when its sentence reads the same",
      (status) => {
        const current = failedNode({ executionStatus: status })
        // The sentence again: a new failure.
        expect(mergeNodeData(current, { executionStatus: "failed", errorMessage: SENTENCE }).errorDetail).toBeUndefined()
      },
    )
  })

  describe("the provider's words stay with the failure they explain", () => {
    it("a failure stated again on a node that already failed keeps them", () => {
      // The shared poll writes the failure whole; its caller's catch then writes the status and the sentence again.
      expect(mergeNodeData(failedNode(), { executionStatus: "failed", errorMessage: SENTENCE })).toEqual(failedNode())
      expect(mergeNodeData(failedNode(), { executionStatus: "failed" })).toEqual(failedNode())
    })

    it("a failure painted back onto a node that has no status keeps them", () => {
      // A reload: the status is not saved, the sentence and the words are.
      const reloaded = failedNode({ executionStatus: undefined })
      expect(mergeNodeData(reloaded, { executionStatus: "failed" }).errorDetail).toBe(WORDS)
      expect(mergeNodeData(reloaded, { executionStatus: "failed", errorMessage: SENTENCE }).errorDetail).toBe(WORDS)
      const { executionStatus: _unsaved, ...saved } = failedNode()
      expect(mergeNodeData(saved, { executionStatus: "failed" })).toEqual(failedNode())
    })

    it.each(["pending", "running", "completed", "idle"])(
      "a failure set alone over a %s node keeps the sentence and the words together",
      (status) => {
        // A run stopped before its node wrote anything: the status goes to "failed", nothing else.
        expect(mergeNodeData(failedNode({ executionStatus: status }), { executionStatus: "failed" })).toEqual(failedNode())
      },
    )

    it.each(["pending", "running", "completed", "idle", "failed", undefined])(
      "a status of %s written alone keeps them: only a sentence moves them",
      (status) => {
        expect(mergeNodeData(failedNode(), { executionStatus: status }).errorDetail).toBe(WORDS)
      },
    )
  })

  describe("a write that names the words is taken as written", () => {
    it("keeps the words it brings, with a new sentence and over any status", () => {
      const other = "Internal Error"
      const patch = { executionStatus: "failed", errorMessage: "The image model had a problem on its side.", errorDetail: other }
      expect(mergeNodeData(failedNode(), patch).errorDetail).toBe(other)
      expect(mergeNodeData(failedNode({ executionStatus: "running" }), patch).errorDetail).toBe(other)
    })

    it("keeps the node's words when it writes the same ones back beside another sentence", () => {
      // A write that spreads the node's whole data names every key the node has.
      const out = mergeNodeData(failedNode({ executionStatus: "running" }), { ...failedNode(), errorMessage: "Not enough credits." })
      expect(out.errorDetail).toBe(WORDS)
    })

    it("clears them when it says so", () => {
      const out = mergeNodeData(failedNode(), { executionStatus: "failed", errorMessage: SENTENCE, errorDetail: undefined })
      expect(out.errorDetail).toBeUndefined()
      expect(out.errorMessage).toBe(SENTENCE)
    })
  })

  describe("a node with no words", () => {
    it.each([
      ["no key at all", {}],
      ["a key that is empty", { errorDetail: undefined }],
      ["a null", { errorDetail: null }],
    ])("gains nothing from a new failure: %s", (_name, words) => {
      const { errorDetail: _none, ...bare } = failedNode({ executionStatus: "running" })
      const current = { ...bare, ...words }
      const out = mergeNodeData(current, { executionStatus: "failed", errorMessage: "Not enough credits." })
      expect(out).toEqual({ ...current, executionStatus: "failed", errorMessage: "Not enough credits." })
      expect(Object.keys(out)).toEqual(Object.keys(current))
    })
  })
})
