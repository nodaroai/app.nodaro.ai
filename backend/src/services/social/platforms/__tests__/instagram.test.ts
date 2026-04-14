import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { instagramPublisher } from "../instagram.js"

type MockFetch = ReturnType<typeof vi.fn>

function okJson(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function badResponse(status: number, message: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error: message }),
    text: async () => message,
  } as unknown as Response
}

describe("instagramPublisher.post-carousel", () => {
  let originalFetch: typeof fetch
  let mockFetch: MockFetch

  beforeEach(() => {
    originalFetch = global.fetch
    mockFetch = vi.fn()
    global.fetch = mockFetch as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it("rejects carousel with fewer than 2 items", async () => {
    await expect(
      instagramPublisher.publish("tok", {
        action: "post-carousel",
        mediaItems: [{ type: "photo", url: "https://example.com/1.png" }],
      }, { instagram_user_id: "ig123" }),
    ).rejects.toThrow(/2-10 items/)
  })

  it("rejects carousel with more than 10 items", async () => {
    const items = Array.from({ length: 11 }, (_, i) => ({
      type: "photo" as const,
      url: `https://example.com/${i}.png`,
    }))
    await expect(
      instagramPublisher.publish("tok", {
        action: "post-carousel",
        mediaItems: items,
      }, { instagram_user_id: "ig123" }),
    ).rejects.toThrow(/2-10 items/)
  })

  it("rejects mixed-type carousel", async () => {
    await expect(
      instagramPublisher.publish("tok", {
        action: "post-carousel",
        mediaItems: [
          { type: "photo", url: "https://example.com/1.png" },
          { type: "video", url: "https://example.com/2.mp4" },
        ],
      }, { instagram_user_id: "ig123" }),
    ).rejects.toThrow(/mix photos and videos/)
  })

  it("creates child containers, parent carousel, publishes, and returns post info", async () => {
    // Step 1: three child container creations
    mockFetch.mockResolvedValueOnce(okJson({ id: "child1" }))
    mockFetch.mockResolvedValueOnce(okJson({ id: "child2" }))
    mockFetch.mockResolvedValueOnce(okJson({ id: "child3" }))
    // Step 3: parent carousel container
    mockFetch.mockResolvedValueOnce(okJson({ id: "parent_xyz" }))
    // Wait-for-parent poll: FINISHED immediately
    mockFetch.mockResolvedValueOnce(okJson({ status_code: "FINISHED" }))
    // Step 4: publish
    mockFetch.mockResolvedValueOnce(okJson({ id: "post_999" }))
    // Shortcode lookup
    mockFetch.mockResolvedValueOnce(okJson({ shortcode: "ABC123" }))

    const result = await instagramPublisher.publish("tok", {
      action: "post-carousel",
      caption: "three photos",
      mediaItems: [
        { type: "photo", url: "https://example.com/1.png" },
        { type: "photo", url: "https://example.com/2.png" },
        { type: "photo", url: "https://example.com/3.png" },
      ],
    }, { instagram_user_id: "ig123" })

    expect(result.success).toBe(true)
    expect(result.platformPostId).toBe("post_999")
    expect(result.platformPostUrl).toBe("https://www.instagram.com/p/ABC123/")

    // Verify child container POST bodies — each has is_carousel_item=true
    for (let i = 0; i < 3; i++) {
      const [url, init] = mockFetch.mock.calls[i]
      expect(url).toBe("https://graph.facebook.com/v25.0/ig123/media")
      const body = JSON.parse((init as RequestInit).body as string)
      expect(body.is_carousel_item).toBe(true)
      expect(body.image_url).toBe(`https://example.com/${i + 1}.png`)
      expect(body.caption).toBeUndefined()
    }

    // Verify parent carousel body has children list and caption
    const [parentUrl, parentInit] = mockFetch.mock.calls[3]
    expect(parentUrl).toBe("https://graph.facebook.com/v25.0/ig123/media")
    const parentBody = JSON.parse((parentInit as RequestInit).body as string)
    expect(parentBody.media_type).toBe("CAROUSEL")
    expect(parentBody.children).toEqual(["child1", "child2", "child3"])
    expect(parentBody.caption).toBe("three photos")

    // Verify publish call
    const [publishUrl, publishInit] = mockFetch.mock.calls[5]
    expect(publishUrl).toBe("https://graph.facebook.com/v25.0/ig123/media_publish")
    const publishBody = JSON.parse((publishInit as RequestInit).body as string)
    expect(publishBody.creation_id).toBe("parent_xyz")
  })

  it("sets media_type=VIDEO on child containers for video carousels and waits for each", async () => {
    // Two child containers
    mockFetch.mockResolvedValueOnce(okJson({ id: "vchild1" }))
    mockFetch.mockResolvedValueOnce(okJson({ id: "vchild2" }))
    // Each video child waits for FINISHED (2 polls)
    mockFetch.mockResolvedValueOnce(okJson({ status_code: "FINISHED" }))
    mockFetch.mockResolvedValueOnce(okJson({ status_code: "FINISHED" }))
    // Parent carousel + parent wait + publish + shortcode
    mockFetch.mockResolvedValueOnce(okJson({ id: "vparent" }))
    mockFetch.mockResolvedValueOnce(okJson({ status_code: "FINISHED" }))
    mockFetch.mockResolvedValueOnce(okJson({ id: "vpost" }))
    mockFetch.mockResolvedValueOnce(okJson({ shortcode: "VID42" }))

    const result = await instagramPublisher.publish("tok", {
      action: "post-carousel",
      mediaItems: [
        { type: "video", url: "https://example.com/1.mp4" },
        { type: "video", url: "https://example.com/2.mp4" },
      ],
    }, { instagram_user_id: "ig123" })

    expect(result.success).toBe(true)
    // First child body has media_type=VIDEO and video_url
    const firstChildBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(firstChildBody.media_type).toBe("VIDEO")
    expect(firstChildBody.video_url).toBe("https://example.com/1.mp4")
    expect(firstChildBody.image_url).toBeUndefined()
  })

  it("throws when Meta rejects a child container creation", async () => {
    // Both children fetched in parallel; first fails, second would succeed
    // but Promise.all rejects on the first error.
    mockFetch.mockResolvedValueOnce(badResponse(400, "Invalid image URL"))
    mockFetch.mockResolvedValueOnce(okJson({ id: "child2" }))

    await expect(
      instagramPublisher.publish("tok", {
        action: "post-carousel",
        mediaItems: [
          { type: "photo", url: "https://example.com/1.png" },
          { type: "photo", url: "https://example.com/2.png" },
        ],
      }, { instagram_user_id: "ig123" }),
    ).rejects.toThrow(/item container creation failed/)
  })
})
