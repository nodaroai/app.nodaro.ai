import { describe, it, expect, vi } from "vitest"

vi.mock("../../../lib/storage.js", () => ({
  r2Url: (key: string) => `https://cdn.test/${key}`,
  r2KeyFromOurUrl: (url: string) =>
    url.startsWith("https://cdn.test/") ? url.slice("https://cdn.test/".length) : null,
}))

import { MediaRefError, normalizeMediaInput, resolveMediaRefs } from "../media-refs.js"

describe("scheduled-post media refs", () => {
  it("accepts explicit r2Keys", () => {
    expect(normalizeMediaInput([{ type: "photo", r2Key: "images/a.png" }])).toEqual([
      { type: "photo", r2Key: "images/a.png" },
    ])
  })

  it("converts OUR public URLs to keys", () => {
    expect(normalizeMediaInput([{ type: "video", url: "https://cdn.test/videos/v.mp4" }])).toEqual([
      { type: "video", r2Key: "videos/v.mp4" },
    ])
  })

  it("REJECTS foreign URLs — refs must outlive the schedule", () => {
    expect(() =>
      normalizeMediaInput([{ type: "photo", url: "https://presigned.example.com/x.png?sig=abc" }]),
    ).toThrow(MediaRefError)
  })

  it("rejects path traversal and empty items", () => {
    expect(() => normalizeMediaInput([{ type: "photo", r2Key: "../secrets" }])).toThrow(MediaRefError)
    expect(() => normalizeMediaInput([{ type: "photo" }])).toThrow(MediaRefError)
  })

  it("resolves refs to fresh URLs at publish time", () => {
    expect(resolveMediaRefs([{ type: "photo", r2Key: "images/a.png" }])).toEqual([
      { type: "photo", url: "https://cdn.test/images/a.png" },
    ])
  })
})
