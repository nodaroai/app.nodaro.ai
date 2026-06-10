import { describe, it, expect } from "vitest"
import { isPostProcessingError } from "../../../lib/post-processing-error.js"
import { compositeInpaint } from "../../../services/inpaint/composite.js"

describe("inpaint composite failure is refundable", () => {
  it("compositeInpaint throws a plain Error (NOT a PostProcessingError)", async () => {
    let thrown: unknown
    try {
      await compositeInpaint({
        baseUrl: "http://127.0.0.1:9/nope.png",
        resultUrl: "http://127.0.0.1:9/x.png",
        maskUrl: "http://127.0.0.1:9/m.png",
        jobId: "t",
      })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(Error)
    expect(isPostProcessingError(thrown)).toBe(false)
  })
})
