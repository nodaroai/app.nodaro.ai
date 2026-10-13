import { describe, expect, it } from "vitest"
import { ugcClipSavedList } from "../index.js"

describe("ugcClipSavedList: what a list read takes from a UGC Clip", () => {
  const takes = [{ url: "https://cdn.example/new.mp4" }, { url: "https://cdn.example/old.mp4" }]
  it("its last batch, in clip order, when it holds one", () => {
    expect(ugcClipSavedList({ __listResults: ["https://cdn.example/1.mp4", "", "https://cdn.example/2.mp4"], generatedResults: takes })).toEqual(["https://cdn.example/1.mp4", "https://cdn.example/2.mp4"])
  })
  it("else exactly the take it shows: the active result, else its video — never the earlier takes", () => {
    expect(ugcClipSavedList({ generatedResults: takes })).toEqual(["https://cdn.example/new.mp4"])
    expect(ugcClipSavedList({ generatedResults: takes, activeResultIndex: 1 })).toEqual(["https://cdn.example/old.mp4"])
    expect(ugcClipSavedList({ generatedVideoUrl: "https://cdn.example/v.mp4" })).toEqual(["https://cdn.example/v.mp4"])
  })
  it("nothing when it holds no take", () => {
    expect(ugcClipSavedList({})).toBeUndefined()
    expect(ugcClipSavedList(undefined)).toBeUndefined()
    expect(ugcClipSavedList({ __listResults: [], generatedResults: [] })).toBeUndefined()
  })
})
