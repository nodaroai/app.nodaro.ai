import { describe, it, expect } from "vitest"
import { templatePreviewKey, templatePreviewPrefix } from "../template-preview-key.js"

// A re-published cover has to reach viewers. The CDN caches every object for a
// year, immutable, with no automated purge (single-file purge exists in the
// Cloudflare dashboard/API), so the durable preview copy must move to a
// new key whenever the cover changes — and only then.
describe("templatePreviewKey", () => {
  const id = "c6f1ccf2-f637-4ed8-a313-af42be25dd36"
  const coverA = "https://cdn.example.com/images/a.png"
  const coverB = "https://cdn.example.com/images/b.png"

  it("lands every preview under templates/<id>/preview with a 12-hex stamp", () => {
    const key = templatePreviewKey(id, coverA, "png")
    expect(key).toMatch(new RegExp(`^templates/${id}/preview-[0-9a-f]{12}\\.png$`))
    expect(key.startsWith(templatePreviewPrefix(id))).toBe(true)
  })

  it("is idempotent for the same cover — re-publishing overwrites in place", () => {
    expect(templatePreviewKey(id, coverA, "png")).toBe(templatePreviewKey(id, coverA, "png"))
  })

  it("moves to a NEW key when the cover changes", () => {
    expect(templatePreviewKey(id, coverB, "png")).not.toBe(templatePreviewKey(id, coverA, "png"))
  })

  it("keeps the two templates apart even for the same cover", () => {
    const other = "0e6e4a5c-2c0e-4b58-9d2a-3f2c4d1e8a7b"
    expect(templatePreviewKey(other, coverA, "png")).not.toBe(templatePreviewKey(id, coverA, "png"))
  })

  it("keeps the extension the caller resolved (a video cover stays .mp4)", () => {
    expect(templatePreviewKey(id, "https://cdn.example.com/videos/v.mp4", "mp4")).toMatch(/\.mp4$/)
  })

  it("still recognises the legacy fixed key as durable under the shared prefix", () => {
    expect(`templates/${id}/preview.png`.startsWith(templatePreviewPrefix(id))).toBe(true)
  })
})
