/**
 * Edit Video Pro does not offer Seedance 2.5 Flash (held back,
 * `isEditVideoProProvider`). A direct request (the route prices through
 * `computeEditVideoProPricing`), a stored or imported node, or an MCP-written
 * node naming it is refused before anything is priced or held.
 */
import { describe, it, expect } from "vitest"
import { computeEditVideoProPricing } from "../edit-video-pro-credits.js"
import { buildPayload } from "../../../services/workflow-engine/payload-builder.js"

const REFUSAL = "seedance-2-5-flash is not offered on Edit Video Pro. Pick another Edit Video Pro model."

describe("Edit Video Pro holds back Seedance 2.5 Flash", () => {
  it("the route's pricing refuses it before pricing anything", async () => {
    await expect(computeEditVideoProPricing({ provider: "seedance-2-5-flash", spanStart: 0, spanEnd: 8 })).rejects.toThrow(REFUSAL)
  })

  it("a workflow run refuses a node naming it before any job is built", () => {
    expect(() => buildPayload({ id: "e", type: "edit-video-pro", data: { provider: "seedance-2-5-flash", spanStart: 0, spanEnd: 8 } }, "job-1", { videoUrl: "https://cdn/x.mp4" })).toThrow(REFUSAL)
  })

  it("the rest of the family still builds", () => {
    const built = buildPayload({ id: "e", type: "edit-video-pro", data: { provider: "seedance-2-5", spanStart: 0, spanEnd: 8 } }, "job-1", { videoUrl: "https://cdn/x.mp4" })
    expect(built.jobName).toBe("edit-video-pro")
  })
})
