import { describe, it, expect } from "vitest"
import { RUN_CONTINUATION_CODES } from "@nodaro/shared"
import { executionErrorText } from "../execution-error-text"

describe("executionErrorText", () => {
  it("shows the preview refusals' stable codes as their copy", () => {
    expect(executionErrorText("preview_review_required")).toBe(
      "This workflow stops for a review: its render is set to Preview, and only a run started in the Nodaro editor can stop for one. Open it in the editor to run it there, or set the render to Final (or send a Final quality override for it).",
    )
    expect(executionErrorText("preview_render_nested")).toMatch(/sub-workflow stops for a review/)
  })

  it("shows every continued-run refusal's stable code as its copy", () => {
    for (const code of RUN_CONTINUATION_CODES) {
      const text = executionErrorText(code)
      expect(text, code).not.toBe(code)
      expect(text, code).toMatch(/run/)
    }
    expect(executionErrorText("continuation_version_mismatch")).toMatch(/another version of this workflow/)
  })

  it("passes any other message through, and nothing as null", () => {
    expect(executionErrorText("Node execution failed: x")).toBe("Node execution failed: x")
    expect(executionErrorText(null)).toBeNull()
    expect(executionErrorText("")).toBeNull()
  })
})
