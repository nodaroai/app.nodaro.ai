import { describe, it, expect } from "vitest"
import { buildGalleryWidget } from "../gallery.js"

describe("gallery widget", () => {
  it("renders grid + pagination", () => {
    const html = buildGalleryWidget({
      items: [
        {
          jobId: "j-1",
          kind: "image",
          prompt: "knight",
          model: "flux",
          thumbnailUrl: "https://x.com/a.png",
          assetUrl: "https://x.com/a.png",
          createdAt: "2026-04-29",
          favorited: false,
        },
        {
          jobId: "j-2",
          kind: "video",
          prompt: "dog",
          model: "veo3",
          thumbnailUrl: "https://x.com/b.png",
          assetUrl: "https://x.com/b.mp4",
          createdAt: "2026-04-29",
          favorited: true,
        },
      ],
      nextCursor: null,
      totalCount: 2,
    })
    expect(html).toContain("grid.className = 'grid'")
    expect(html).toContain("pagination.className = 'pagination'")
    expect(html).toMatchSnapshot()
  })

  it("contains no innerHTML in runtime JS", () => {
    const html = buildGalleryWidget({ items: [], nextCursor: null, totalCount: 0 })
    const scriptBlocks = html.match(/<script>[\s\S]*?<\/script>/g) ?? []
    for (const block of scriptBlocks) {
      expect(block).not.toMatch(/\.innerHTML\s*=/)
    }
  })
})
