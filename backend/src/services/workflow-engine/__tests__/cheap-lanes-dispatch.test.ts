/**
 * A run kept to the cheap lanes (`OrchestratorContext.cheapLanesOnly`) says so
 * to the LLM routes it calls — on the body, and only to the routes whose Zod
 * takes the field (a route that does not may be strict, and a 400 mid-run
 * would be worse than a fallback). Every other run's body is byte-identical.
 */
import { describe, it, expect } from "vitest"
import { CHEAP_LANES_BODY_NODES, SYNC_HTTP_NODES, withCheapLanesOnly } from "../node-executor.js"

describe("withCheapLanesOnly", () => {
  const body = { systemPrompt: "s", userInput: "u", userId: "owner-1" }

  it("adds the flag to an LLM route's body when the run is kept to the cheap lanes — a copy, the built body untouched", () => {
    const out = withCheapLanesOnly("llm-chat", body, { cheapLanesOnly: true })
    expect(out).toEqual({ ...body, cheapLanesOnly: true })
    expect(body).not.toHaveProperty("cheapLanesOnly")
  })

  it("a run not kept to the cheap lanes sends the body as built — the same object", () => {
    expect(withCheapLanesOnly("llm-chat", body, {})).toBe(body)
    expect(withCheapLanesOnly("llm-chat", body, { cheapLanesOnly: false })).toBe(body)
  })

  it("a route whose Zod does not take the field never sees it", () => {
    expect(withCheapLanesOnly("web-scrape", body, { cheapLanesOnly: true })).toBe(body)
    expect(withCheapLanesOnly("describe-to-picker", body, { cheapLanesOnly: true })).toBe(body)
  })

  it("the routes that take it are sync-HTTP LLM nodes: Generate Text, AI Writer, Image to Text", () => {
    expect([...CHEAP_LANES_BODY_NODES].sort()).toEqual(["ai-writer", "image-to-text", "llm-chat"])
    for (const type of CHEAP_LANES_BODY_NODES) expect(SYNC_HTTP_NODES.has(type), type).toBe(true)
  })
})
