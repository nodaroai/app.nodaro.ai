import { describe, expect, it } from "vitest"
import * as editor from "virtual:media-editor"

/**
 * Tests (like every build without the shared header) resolve the media editor
 * to its stub: nothing available, and every part the real module exports is
 * there as `null`, so a named import of it never fails a build.
 */
describe("virtual:media-editor in tests", () => {
  it("is the stub: not available, every part null", () => {
    expect(editor.mediaEditorAvailable).toBe(false)
    for (const part of ["TrimPanel", "CropPanel", "RatioPicker", "htmlMediaAdapter", "defaultRange", "clampRange", "formatTime", "fullRect", "isWholeFrame"] as const) {
      expect(editor[part], part).toBeNull()
    }
  })
})
