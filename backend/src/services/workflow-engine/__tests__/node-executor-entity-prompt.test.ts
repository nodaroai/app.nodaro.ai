/**
 * node-executor — extractUserPromptTemplate must read the user-typed prompt for
 * entity nodes (character / face / object / location / creature) from
 * `description` first, then `prompt`. This is the raw, UNRESOLVED template that
 * the orchestrator lands in `jobs.input_data.userPrompt` so server-side runs
 * match single-node Run.
 *
 * Guards the entity `case` group: a new entity node type (creature) must be a
 * member of that switch group or its user prompt silently falls through to
 * `undefined`.
 */

import { describe, it, expect } from "vitest"
import { extractUserPromptTemplate } from "../node-executor.js"
import type { SimpleNode } from "../types.js"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}

describe("extractUserPromptTemplate — entity nodes", () => {
  for (const type of ["character", "face", "object", "location", "creature"]) {
    it(`prefers description over prompt for ${type}`, () => {
      const n = node("n1", type, { description: "a desc", prompt: "a prompt" })
      expect(extractUserPromptTemplate(n)).toBe("a desc")
    })

    it(`falls back to prompt when description is empty for ${type}`, () => {
      const n = node("n1", type, { description: "  ", prompt: "the prompt" })
      expect(extractUserPromptTemplate(n)).toBe("the prompt")
    })
  }
})
