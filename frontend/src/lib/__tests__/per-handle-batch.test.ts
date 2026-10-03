import { describe, it, expect } from "vitest"
import { lastBatchFields, perHandleRunFields } from "../per-handle-batch"

// Camera Switch keeps exactly its LAST per-clip batch on every lane that writes
// a run's results onto the node (decided 2026-10-04) — and no other node's list
// writes change.
describe("per-handle batch sync", () => {
  const pair = { edl: { segments: [] }, transcript: { words: [] } }
  it("a batch of clips is kept as the node's list; a single run clears an earlier batch", () => {
    expect(lastBatchFields("camera-switch", ["e0", "e1"])).toEqual({ __listResults: ["e0", "e1"], __listTotal: 2, __listCompleted: 2 })
    expect(lastBatchFields("camera-switch", undefined)).toEqual({ __listResults: undefined })
    expect(lastBatchFields("camera-switch", ["e0"])).toEqual({ __listResults: undefined })
  })
  it("a server run also paints the { edl, transcript } pair", () => {
    expect(perHandleRunFields("camera-switch", { json: pair })).toEqual({ __listResults: undefined, generatedJson: pair })
    expect(perHandleRunFields("camera-switch", { listResults: ["e0", "e1"], json: pair })).toMatchObject({ __listResults: ["e0", "e1"], generatedJson: pair })
  })
  it("leaves every other node type alone", () => {
    expect(lastBatchFields("generate-image", ["a", "b"])).toBeUndefined()
    expect(perHandleRunFields("edit-plan", { listResults: ["a", "b"], json: pair })).toBeUndefined()
  })
})
