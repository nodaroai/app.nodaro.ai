/**
 * Content Recipe + Content Ideas through the backend engine — the pieces the
 * app owns (the cloud plugin owns the model calls):
 *
 *   - Content Ideas FOLDS every recipe wired into `recipes` (per-edge fan-in:
 *     its `field-brand` wire is a field, not a recipe), and is never itself
 *     fanned out;
 *   - Choose Best still folds every wire (the predicate moved to @nodaro/shared);
 *   - Content Recipe's `link` wire carries a Video URL node's PAGE link, never
 *     the downloaded file;
 *   - the node after Content Ideas runs once per idea (FAN_OUT_EACH_TYPES);
 *   - buildPayload enqueues the plugin's job names with the plugin's payload
 *     shape and the right credit id;
 *   - a skipped / "Run from here" node hydrates from saved data.
 */

import { describe, it, expect } from "vitest"
import { resolveNodeInputs, getListFanOutForNode } from "../input-resolver.js"
import { buildPayload } from "../payload-builder.js"
import { extractSavedNodeOutput, getPrimaryOutput } from "../output-extractor.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState, ResolvedInputs } from "../types.js"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}

function edge(
  source: string,
  target: string,
  sourceHandle: string | null = null,
  targetHandle: string | null = null,
  data?: Record<string, unknown>,
): SimpleEdge {
  return { id: `e-${source}-${target}-${targetHandle ?? "x"}`, source, target, sourceHandle, targetHandle, data }
}

const RECIPE_A = "CONTENT RECIPE: A\nFormat: pov"
const RECIPE_B = "CONTENT RECIPE: B\nFormat: listicle"

describe("Content Ideas — folds its recipes, reads its brand as a field", () => {
  it("folds the recipes of several Content Recipe nodes into one run", () => {
    const ideas = node("I", "content-ideas")
    const all = [node("R1", "content-recipe"), node("R2", "content-recipe"), ideas]
    const edges = [edge("R1", "I", "text", "recipes"), edge("R2", "I", "json", "recipes")]
    const states: Record<string, NodeExecutionState> = {
      R1: { status: "completed", output: { text: RECIPE_A } },
      R2: { status: "completed", output: { json: { version: 1, topic: "B" }, text: RECIPE_B } },
    }
    const inputs = resolveNodeInputs(ideas, edges, states, all)
    expect(inputs.inputs).toEqual([RECIPE_A, JSON.stringify({ version: 1, topic: "B" })])
  })

  it("folds every run of a recipe node that ran once per post", () => {
    const ideas = node("I", "content-ideas")
    const all = [node("R", "content-recipe"), ideas]
    const states: Record<string, NodeExecutionState> = {
      R: { status: "completed", output: { text: RECIPE_A, listResults: [RECIPE_A, RECIPE_B] } },
    }
    const inputs = resolveNodeInputs(ideas, [edge("R", "I", "text", "recipes")], states, all)
    expect(inputs.inputs).toEqual([RECIPE_A, RECIPE_B])
  })

  it("the field-brand wire is NOT a recipe; an unhandled wire IS", () => {
    const ideas = node("I", "content-ideas")
    const all = [node("R", "content-recipe"), node("B", "text-prompt", { text: "We sell matcha." }), node("R2", "content-recipe"), ideas]
    const edges = [edge("R", "I", "text", "recipes"), edge("B", "I", "text", "field-brand"), edge("R2", "I", "text", null)]
    const states: Record<string, NodeExecutionState> = {
      R: { status: "completed", output: { text: RECIPE_A } },
      B: { status: "completed", output: { text: "We sell matcha." } },
      R2: { status: "completed", output: { text: RECIPE_B } },
    }
    const inputs = resolveNodeInputs(ideas, edges, states, all)
    expect(inputs.inputs).toEqual([RECIPE_A, RECIPE_B])
  })

  it("is never fanned out itself, even by a multi-item upstream", () => {
    const ideas = node("I", "content-ideas")
    const all = [node("R", "content-recipe"), ideas]
    const states: Record<string, NodeExecutionState> = {
      R: { status: "completed", output: { listResults: [RECIPE_A, RECIPE_B] } },
    }
    expect(getListFanOutForNode(ideas, [edge("R", "I", "text", "recipes")], states, all)).toBeUndefined()
  })

  it("Choose Best still folds every wire, whatever its handle", () => {
    const reduce = node("C", "reduce", { strategyId: "concat" })
    const all = [node("A", "text-prompt"), node("B", "text-prompt"), reduce]
    const edges = [edge("A", "C", "text", "in"), edge("B", "C", "text", "field-anything")]
    const states: Record<string, NodeExecutionState> = {
      A: { status: "completed", output: { text: "a" } },
      B: { status: "completed", output: { text: "b" } },
    }
    expect(resolveNodeInputs(reduce, edges, states, all).inputs).toEqual(["a", "b"])
  })
})

describe("Content Ideas — the node after it runs once per idea", () => {
  it("a Generate Script wired to the ideas fans out over the briefs (each by default)", () => {
    const script = node("S", "generate-script")
    const all = [node("I", "content-ideas"), script]
    const states: Record<string, NodeExecutionState> = {
      I: { status: "completed", output: { text: "CONTENT IDEAS (2)", listResults: ["IDEA 1 of 2: one", "IDEA 2 of 2: two"] } },
    }
    const fan = getListFanOutForNode(script, [edge("I", "S", "ideas", "prompt")], states, all)
    expect(fan?.items).toEqual(["IDEA 1 of 2: one", "IDEA 2 of 2: two"])
  })
})

describe("Content Recipe — the link wire carries the post's page link", () => {
  it("reads a Video URL node's page link, never its downloaded file", () => {
    const recipe = node("R", "content-recipe")
    const link = node("V", "youtube-video", {
      youtubeUrl: "https://www.tiktok.com/@a/video/1",
      downloadedVideoUrl: "https://r2.example/videos/v.mp4",
      downloadedFromUrl: "https://www.tiktok.com/@a/video/1",
    })
    const inputs = resolveNodeInputs(recipe, [edge("V", "R", "video", "link")], {}, [link, recipe])
    expect(inputs.sourceLink).toBe("https://www.tiktok.com/@a/video/1")
    expect(inputs.videoUrl).toBeUndefined()
    expect(inputs.prompt).toBeUndefined()
  })

  it("takes a text node's text as the link", () => {
    const recipe = node("R", "content-recipe")
    const text = node("T", "text-prompt", { text: "https://x.com/a/status/1" })
    const states: Record<string, NodeExecutionState> = { T: { status: "completed", output: { text: "https://x.com/a/status/1" } } }
    const inputs = resolveNodeInputs(recipe, [edge("T", "R", "text", "link")], states, [text, recipe])
    expect(inputs.sourceLink).toBe("https://x.com/a/status/1")
  })

  it("the material on `in` — a Video Analysis — arrives as the analysis JSON", () => {
    const recipe = node("R", "content-recipe")
    const analysis = node("VA", "video-analysis")
    const json = { meta: { durationSec: 10 }, scenes: [{ startSec: 0, endSec: 10 }] }
    const states: Record<string, NodeExecutionState> = { VA: { status: "completed", output: { json } } }
    const inputs = resolveNodeInputs(recipe, [edge("VA", "R", "json", "in")], states, [analysis, recipe])
    expect(inputs.prompt).toBe(JSON.stringify(json))
  })
})

function build(type: string, data: Record<string, unknown>, resolved: ResolvedInputs) {
  return buildPayload(node("N", type, data), "job-1", resolved, "usage-1")
}

describe("buildPayload — the plugin's job names and payloads", () => {
  it("content-recipe: material, link (wire over typed), focus, effective model → economy id", () => {
    const r = build(
      "content-recipe",
      { sourceUrl: "https://typed.example/p", focus: "  the hook  " },
      { prompt: " the material ", sourceLink: "https://www.tiktok.com/@a/video/1" },
    )
    expect(r.jobName).toBe("content-recipe")
    expect(r.modelIdentifier).toBe("content-recipe:economy")
    expect(r.payload).toMatchObject({
      jobId: "job-1",
      usageLogId: "usage-1",
      source: "the material",
      sourceUrl: "https://www.tiktok.com/@a/video/1",
      focus: "the hook",
      llmModel: "gemini-3.6-flash",
      nodeId: "N",
    })
  })

  it("content-recipe: a fan-out item wins over the wire; the typed link is the fallback; tier follows the model", () => {
    const r = build("content-recipe", { sourceUrl: "https://typed.example/p", llmModel: "claude-opus-5" }, { prompt: "wire", overridePrompt: "item" })
    expect(r.payload).toMatchObject({ source: "item", sourceUrl: "https://typed.example/p", llmModel: "claude-opus-5" })
    expect(r.modelIdentifier).toBe("content-recipe:premium")
  })

  it("content-recipe: refuses to run with no material", () => {
    expect(() => build("content-recipe", {}, {})).toThrow(/connect a Video Analysis, a post or some text/)
  })

  it("content-ideas: recipes, brand, language, count → the per-five-ideas credit id", () => {
    const r = build(
      "content-ideas",
      { brand: "  We sell matcha.  ", language: " Hebrew ", count: 7, llmModel: "claude-sonnet-4.6" },
      { inputs: [RECIPE_A, " ", RECIPE_B] },
    )
    expect(r.jobName).toBe("content-ideas")
    expect(r.modelIdentifier).toBe("content-ideas:10")
    expect(r.payload).toMatchObject({
      recipes: [RECIPE_A, RECIPE_B],
      brand: "We sell matcha.",
      language: "Hebrew",
      count: 7,
      llmModel: "claude-sonnet-4.6",
    })
  })

  it("content-ideas: default five ideas on the economy default", () => {
    const r = build("content-ideas", {}, { inputs: [RECIPE_A] })
    expect(r.modelIdentifier).toBe("content-ideas:economy")
    expect(r.payload).toMatchObject({ count: 5, llmModel: "gemini-3.6-flash" })
  })

  it("content-ideas: leans on the user's own brand unless the node turned it off", () => {
    expect(build("content-ideas", {}, { inputs: [RECIPE_A] }).payload).not.toHaveProperty("useBrandLessons")
    expect(build("content-ideas", { useBrandLessons: true }, { inputs: [RECIPE_A] }).payload).not.toHaveProperty("useBrandLessons")
    expect(build("content-ideas", { useBrandLessons: false }, { inputs: [RECIPE_A] }).payload).toMatchObject({ useBrandLessons: false })
  })

  it("content-ideas: refuses to run with no recipe", () => {
    expect(() => build("content-ideas", { brand: "x" }, { inputs: [] })).toThrow(/connect at least one Content Recipe/)
  })
})

describe("output extraction", () => {
  it("a saved Content Ideas node hydrates its briefs as the list", () => {
    const out = extractSavedNodeOutput(
      node("I", "content-ideas", { generatedJson: [{ title: "one" }], ideaBriefs: ["IDEA 1 of 1: one", ""], generatedText: "CONTENT IDEAS (1)" }),
    )
    expect(out).toEqual({ listResults: ["IDEA 1 of 1: one"], json: [{ title: "one" }], text: "CONTENT IDEAS (1)" })
    expect(extractSavedNodeOutput(node("I", "content-ideas", {}))).toBeUndefined()
  })

  it("a saved Content Recipe hydrates its object and text — never a list", () => {
    const out = extractSavedNodeOutput(node("R", "content-recipe", { generatedJson: { version: 1 }, generatedText: RECIPE_A }))
    expect(out).toEqual({ json: { version: 1 }, text: RECIPE_A })
    expect(out?.listResults).toBeUndefined()
  })

  it("primary outputs: recipe json → the object stringified, text → the recipe; ideas → the digest", () => {
    expect(getPrimaryOutput({ json: { version: 1 }, text: RECIPE_A }, "content-recipe", "json")).toBe(JSON.stringify({ version: 1 }))
    expect(getPrimaryOutput({ json: { version: 1 }, text: RECIPE_A }, "content-recipe", "text")).toBe(RECIPE_A)
    expect(getPrimaryOutput({ text: "CONTENT IDEAS (2)", listResults: ["a", "b"] }, "content-ideas", "ideas")).toBe("CONTENT IDEAS (2)")
  })
})
