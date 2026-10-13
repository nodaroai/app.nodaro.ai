import { afterEach, describe, it, expect } from "vitest"
import { RUN_CONTINUATION_CODES, UGC_PICK_FIRST_MESSAGE } from "@nodaro/shared"
import { translate } from "@/lib/i18n"
import { useLocaleStore } from "@/lib/locale-store"
import { executionErrorText } from "../execution-error-text"

describe("executionErrorText", () => {
  afterEach(() => useLocaleStore.getState().setLocale("en"))

  it("shows the preview refusals' stable codes as their copy", () => {
    expect(executionErrorText("preview_review_required")).toBe(
      "This workflow stops for a review: its render is set to Preview, and only a run started in the Nodaro editor or on an app's own page can stop for one. Open it there to run it, or set the render to Final (or send a Final quality override for it).",
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

  it("shows the server's refusal of a run with a UGC Creator still to pick as the editor's own words", () => {
    expect(executionErrorText(UGC_PICK_FIRST_MESSAGE)).toBe(UGC_PICK_FIRST_MESSAGE)
    useLocaleStore.getState().setLocale("he")
    expect(executionErrorText(UGC_PICK_FIRST_MESSAGE)).toBe(translate("he", "run.ugcPickFirst"))
  })

  it("passes any other message through, and nothing as null", () => {
    expect(executionErrorText("Node execution failed: x")).toBe("Node execution failed: x")
    expect(executionErrorText(null)).toBeNull()
    expect(executionErrorText("")).toBeNull()
  })
})
