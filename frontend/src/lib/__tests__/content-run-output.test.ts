/**
 * The finished-run mapping for Content Recipe / Content Ideas, and the
 * single-node reload recovery that must reuse it (reconcile-completed-jobs).
 */
import { describe, it, expect } from "vitest"
import { contentRunResultPatch, isContentNodeType } from "../content-run-output"
import { buildCompletedResultPatch } from "../reconcile-completed-jobs"

const RECIPE = { version: 1, topic: "matcha", format: { label: "pov", confidence: 0.8 } }

describe("contentRunResultPatch — content-recipe", () => {
  it("writes the recipe object, its text and the run's notes", () => {
    const patch = contentRunResultPatch("content-recipe", {
      json: RECIPE,
      text: "CONTENT RECIPE: matcha",
      model: "gemini-3.6-flash",
      warnings: ["Read the first of 3 posts.", 7, " "],
    })
    expect(patch).toEqual({
      executionStatus: "completed",
      generatedJson: RECIPE,
      generatedText: "CONTENT RECIPE: matcha",
      runWarnings: ["Read the first of 3 posts."],
    })
  })

  it("an array is not a recipe; no notes means none on the node", () => {
    const patch = contentRunResultPatch("content-recipe", { json: [RECIPE], text: "CONTENT RECIPE: x" })
    expect(patch?.generatedJson).toBeUndefined()
    expect(patch?.runWarnings).toBeUndefined()
  })

  it("an output with neither a recipe nor text paints nothing", () => {
    expect(contentRunResultPatch("content-recipe", { model: "m" })).toBeNull()
    expect(contentRunResultPatch("content-recipe", null)).toBeNull()
  })
})

describe("contentRunResultPatch — content-ideas", () => {
  it("writes the ideas and one brief per idea — never the list fields that clone a node", () => {
    const patch = contentRunResultPatch("content-ideas", {
      json: [{ title: "one" }, { title: "two" }],
      text: "CONTENT IDEAS (2)",
      listResults: ["IDEA 1 of 2: one", "", "IDEA 2 of 2: two"],
    })
    expect(patch).toEqual({
      executionStatus: "completed",
      generatedJson: [{ title: "one" }, { title: "two" }],
      ideaBriefs: ["IDEA 1 of 2: one", "IDEA 2 of 2: two"],
      generatedText: "CONTENT IDEAS (2)",
      runWarnings: undefined,
    })
    expect(patch).not.toHaveProperty("__listResults")
    expect(patch).not.toHaveProperty("generatedResults")
  })

  it("with no digest, the text is the briefs joined", () => {
    const patch = contentRunResultPatch("content-ideas", { json: [], listResults: ["a", "b"] })
    expect(patch?.generatedText).toBe("a\n\nb")
  })

  it("an output with no ideas paints nothing", () => {
    expect(contentRunResultPatch("content-ideas", { text: "x" })).toBeNull()
  })
})

describe("isContentNodeType", () => {
  it("names exactly the two nodes", () => {
    expect(isContentNodeType("content-recipe")).toBe(true)
    expect(isContentNodeType("content-ideas")).toBe(true)
    expect(isContentNodeType("video-analysis")).toBe(false)
    expect(isContentNodeType(undefined)).toBe(false)
  })
})

describe("reload recovery of a single-node run reuses the same mapping", () => {
  it("content-ideas", () => {
    const output = { json: [{ title: "one" }], text: "CONTENT IDEAS (1)", listResults: ["IDEA 1 of 1: one"] }
    expect(buildCompletedResultPatch("content-ideas", output, "job-1", "2026-10-02T00:00:00Z")).toEqual(
      contentRunResultPatch("content-ideas", output),
    )
  })

  it("content-recipe", () => {
    const output = { json: RECIPE, text: "CONTENT RECIPE: matcha" }
    expect(buildCompletedResultPatch("content-recipe", output, "job-1", "2026-10-02T00:00:00Z")).toEqual(
      contentRunResultPatch("content-recipe", output),
    )
  })
})
