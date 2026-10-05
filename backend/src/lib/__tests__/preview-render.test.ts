import { describe, it, expect } from "vitest"
import { isPreviewRender } from "../preview-render.js"

describe("isPreviewRender — an Apply EDL render at proxy quality", () => {
  it("is a preview only for apply-edl at exactly \"proxy\"", () => {
    expect(isPreviewRender("apply-edl", "proxy")).toBe(true)
    expect(isPreviewRender("apply-edl", "final")).toBe(false)
    expect(isPreviewRender("apply-edl", undefined)).toBe(false)
    expect(isPreviewRender("combine-videos", "proxy")).toBe(false)
    expect(isPreviewRender(undefined, "proxy")).toBe(false)
  })
})
