import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

/**
 * Relocated from the app's generate-text-parity suite when the editor moved
 * into this package: the @-mention variable dropdown must keep classifying
 * the Generate Text node (llm-chat) under the "Text" group.
 */
describe("variable-suggestion-list TYPE_CATEGORY parity", () => {
  it("maps 'llm-chat' → 'Text'", () => {
    const src = readFileSync(join(__dirname, "..", "variable-suggestion-list.tsx"), "utf8")
    expect(src).toMatch(/"llm-chat"\s*:\s*"Text"/)
  })
})
