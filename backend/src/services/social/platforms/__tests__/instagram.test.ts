import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { instagramPublisher } from "../instagram.js"
import { BadBodyError, NotPublishedError } from "../../providers/types.js"

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

/** Meta's real 9007 envelope — the failure this whole flow exists to survive. */
function mediaNotReadyResponse(): Response {
  const body = JSON.stringify({
    error: {
      message: "The media is not ready for publishing, please try again later",
      type: "OAuthException",
      code: 9007,
      error_subcode: 2207027,
    },
  })
  return {
    ok: false,
    status: 400,
    json: async () => JSON.parse(body),
    text: async () => body,
  } as unknown as Response
}

const IMAGE_REQUEST = {
  action: "post-image",
  caption: "hello",
  mediaUrl: "https://example.com/a.png",
} as const

function publishImage() {
  return instagramPublisher.publish("tok", { ...IMAGE_REQUEST }, { instagram_user_id: "ig123" })
}

function callsTo(mockFetch: MockFetch, suffix: string) {
  return mockFetch.mock.calls.filter(([url]) => String(url).includes(suffix))
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
    // Step 2: each child is polled to FINISHED — photos included
    mockFetch.mockResolvedValueOnce(okJson({ status_code: "FINISHED" }))
    mockFetch.mockResolvedValueOnce(okJson({ status_code: "FINISHED" }))
    mockFetch.mockResolvedValueOnce(okJson({ status_code: "FINISHED" }))
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

    // Every child container is polled before the parent references it.
    expect(callsTo(mockFetch, "fields=status_code")).toHaveLength(4) // 3 children + parent
    for (const childId of ["child1", "child2", "child3"]) {
      expect(callsTo(mockFetch, `/${childId}?fields=status_code`)).toHaveLength(1)
    }

    // Verify parent carousel body has children list and caption
    const [parentUrl, parentInit] = mockFetch.mock.calls[6]
    expect(parentUrl).toBe("https://graph.facebook.com/v25.0/ig123/media")
    const parentBody = JSON.parse((parentInit as RequestInit).body as string)
    expect(parentBody.media_type).toBe("CAROUSEL")
    expect(parentBody.children).toEqual(["child1", "child2", "child3"])
    expect(parentBody.caption).toBe("three photos")

    // Verify publish call
    const [publishUrl, publishInit] = mockFetch.mock.calls[8]
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

  it("polls video child containers with the same per-child contract", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ id: "vc1" }))
    mockFetch.mockResolvedValueOnce(okJson({ id: "vc2" }))
    mockFetch.mockResolvedValueOnce(okJson({ status_code: "FINISHED" }))
    mockFetch.mockResolvedValueOnce(okJson({ status_code: "FINISHED" }))
    mockFetch.mockResolvedValueOnce(okJson({ id: "vparent" }))
    mockFetch.mockResolvedValueOnce(okJson({ status_code: "FINISHED" }))
    mockFetch.mockResolvedValueOnce(okJson({ id: "vpost" }))
    mockFetch.mockResolvedValueOnce(okJson({ shortcode: "V1" }))

    await instagramPublisher.publish("tok", {
      action: "post-carousel",
      mediaItems: [
        { type: "video", url: "https://example.com/1.mp4" },
        { type: "video", url: "https://example.com/2.mp4" },
      ],
    }, { instagram_user_id: "ig123" })

    expect(callsTo(mockFetch, "fields=status_code")).toHaveLength(3)
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

/**
 * Regression suite for error 9007 ("Media ID is not available" / "The media is
 * not ready for publishing"): containers ingest asynchronously, so publishing
 * one immediately fails — and used to be reported as "MAY have been published".
 */
describe("instagramPublisher container readiness (error 9007)", () => {
  let originalFetch: typeof fetch
  let mockFetch: MockFetch

  beforeEach(() => {
    originalFetch = global.fetch
    mockFetch = vi.fn()
    global.fetch = mockFetch as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.useRealTimers()
  })

  it("polls the IMAGE container to FINISHED before publishing", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ id: "img_1" }))
    mockFetch.mockResolvedValueOnce(okJson({ status_code: "FINISHED" }))
    mockFetch.mockResolvedValueOnce(okJson({ id: "post_img" }))
    mockFetch.mockResolvedValueOnce(okJson({ shortcode: "IMG1" }))

    const result = await publishImage()

    expect(result.platformPostId).toBe("post_img")
    // The status poll must sit BETWEEN container creation and publish — an
    // un-polled image container is precisely the 9007 bug.
    expect(String(mockFetch.mock.calls[1]![0])).toContain("/img_1?fields=status_code")
    expect(String(mockFetch.mock.calls[2]![0])).toContain("/media_publish")
  })

  it("keeps polling while the container is IN_PROGRESS", async () => {
    vi.useFakeTimers()
    mockFetch.mockResolvedValueOnce(okJson({ id: "img_2" }))
    mockFetch.mockResolvedValueOnce(okJson({ status_code: "IN_PROGRESS" }))
    mockFetch.mockResolvedValueOnce(okJson({ status_code: "IN_PROGRESS" }))
    mockFetch.mockResolvedValueOnce(okJson({ status_code: "FINISHED" }))
    mockFetch.mockResolvedValueOnce(okJson({ id: "post_2" }))
    mockFetch.mockResolvedValueOnce(okJson({ shortcode: "IMG2" }))

    const pending = publishImage()
    await vi.advanceTimersByTimeAsync(2_000 * 2 + 50)

    expect((await pending).platformPostId).toBe("post_2")
    expect(callsTo(mockFetch, "fields=status_code")).toHaveLength(3)
  })

  it.each(["ERROR", "EXPIRED"])(
    "fails with BadBodyError naming the status when the container reports %s",
    async (status) => {
      mockFetch.mockResolvedValueOnce(okJson({ id: "img_bad" }))
      mockFetch.mockResolvedValueOnce(okJson({ status_code: status }))

      const err = await publishImage().then(() => null).catch((e) => e)

      expect(err).toBeInstanceOf(BadBodyError)
      expect((err as Error).message).toContain(status)
      // Never reached media_publish.
      expect(callsTo(mockFetch, "/media_publish")).toHaveLength(0)
    },
  )

  it("retries media_publish on 9007 with the SAME creation_id, then succeeds", async () => {
    vi.useFakeTimers()
    mockFetch.mockResolvedValueOnce(okJson({ id: "cont_1" }))
    mockFetch.mockResolvedValueOnce(okJson({ status_code: "FINISHED" }))
    mockFetch.mockResolvedValueOnce(mediaNotReadyResponse())
    mockFetch.mockResolvedValueOnce(mediaNotReadyResponse())
    mockFetch.mockResolvedValueOnce(okJson({ id: "post_1" }))
    mockFetch.mockResolvedValueOnce(okJson({ shortcode: "OK1" }))

    const pending = publishImage()
    await vi.advanceTimersByTimeAsync(3_000 * 2 + 50)
    const result = await pending

    expect(result.platformPostId).toBe("post_1")
    const publishCalls = callsTo(mockFetch, "/media_publish")
    expect(publishCalls).toHaveLength(3)
    // Reusing the container id is what makes the retry duplicate-free.
    for (const [, init] of publishCalls) {
      expect(JSON.parse((init as RequestInit).body as string).creation_id).toBe("cont_1")
    }
  })

  it("gives up after 5 publish attempts and reports a DEFINITE, retryable failure", async () => {
    vi.useFakeTimers()
    mockFetch.mockResolvedValueOnce(okJson({ id: "cont_x" }))
    mockFetch.mockResolvedValueOnce(okJson({ status_code: "FINISHED" }))
    for (let i = 0; i < 5; i++) mockFetch.mockResolvedValueOnce(mediaNotReadyResponse())

    const pending = publishImage().then(() => null).catch((e) => e)
    await vi.advanceTimersByTimeAsync(3_000 * 4 + 50)
    const err = await pending

    expect(err).toBeInstanceOf(NotPublishedError)
    expect(callsTo(mockFetch, "/media_publish")).toHaveLength(5)
    expect((err as Error).message).toContain("9007")
    expect((err as Error).message).toMatch(/NOT published/)
    // The regression being locked down: this must never read as "maybe".
    expect((err as Error).message).not.toMatch(/MAY have been published/i)
  })

  it("does NOT retry a publish rejection that isn't 9007", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ id: "cont_p" }))
    mockFetch.mockResolvedValueOnce(okJson({ status_code: "FINISHED" }))
    mockFetch.mockResolvedValueOnce(
      badResponse(400, JSON.stringify({ error: { code: 100, message: "Invalid parameter" } })),
    )

    await expect(publishImage()).rejects.toThrow(/publish failed/)
    expect(callsTo(mockFetch, "/media_publish")).toHaveLength(1)
  })

  it("times out as a retryable non-publish, naming the last status", async () => {
    vi.useFakeTimers()
    mockFetch.mockResolvedValueOnce(okJson({ id: "cont_slow" }))
    mockFetch.mockResolvedValue(okJson({ status_code: "IN_PROGRESS" }))

    const pending = publishImage().then(() => null).catch((e) => e)
    // Image budget is 90s; run past it.
    await vi.advanceTimersByTimeAsync(95_000)
    const err = await pending

    expect(err).toBeInstanceOf(NotPublishedError)
    expect((err as Error).message).toContain("IN_PROGRESS")
    expect((err as Error).message).toContain("90s")
    expect(callsTo(mockFetch, "/media_publish")).toHaveLength(0)
  })

  it("tolerates transient status-poll failures (HTTP 5xx, network drop) and keeps polling", async () => {
    vi.useFakeTimers()
    mockFetch.mockResolvedValueOnce(okJson({ id: "img_t" }))
    mockFetch.mockResolvedValueOnce(badResponse(500, "transient Graph blip"))
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"))
    mockFetch.mockResolvedValueOnce(okJson({ status_code: "FINISHED" }))
    mockFetch.mockResolvedValueOnce(okJson({ id: "post_t" }))
    mockFetch.mockResolvedValueOnce(okJson({ shortcode: "T1" }))

    const pending = publishImage()
    await vi.advanceTimersByTimeAsync(2_000 * 2 + 50)

    expect((await pending).platformPostId).toBe("post_t")
  })

  it("fails fast (typed, retryable) after 3 consecutive status-poll failures", async () => {
    vi.useFakeTimers()
    mockFetch.mockResolvedValueOnce(okJson({ id: "img_p" }))
    mockFetch.mockResolvedValue(badResponse(401, "token revoked"))

    const pending = publishImage().then(() => null).catch((e) => e)
    await vi.advanceTimersByTimeAsync(2_000 * 3)
    const err = await pending

    expect(err).toBeInstanceOf(NotPublishedError)
    expect((err as Error).message).toContain("3 times in a row")
    expect(callsTo(mockFetch, "/media_publish")).toHaveLength(0)
  })

  it("reports a container-creation network failure as NotPublished, never unknown", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"))

    const err = await publishImage().then(() => null).catch((e) => e)

    expect(err).toBeInstanceOf(NotPublishedError)
    expect((err as Error).message).toContain("NOT published")
  })

  it("types container-creation rejections: 4xx definitive, 5xx retryable", async () => {
    mockFetch.mockResolvedValueOnce(badResponse(400, "Invalid image URL"))
    const err400 = await publishImage().then(() => null).catch((e) => e)
    expect(err400).toBeInstanceOf(BadBodyError)

    mockFetch.mockResolvedValueOnce(badResponse(500, "internal server error"))
    const err500 = await publishImage().then(() => null).catch((e) => e)
    expect(err500).toBeInstanceOf(NotPublishedError)
  })
})

/**
 * The sync /v1/social/publish route passes `metadata.publishDeadlineMs` so the
 * publisher answers before the caller's ~300s headers ceiling (undici default
 * headersTimeout on the orchestrator's internal fetch; browsers similar). The
 * scheduled worker passes none and keeps the full budgets.
 */
describe("instagramPublisher publishDeadlineMs (sync-route budget)", () => {
  let originalFetch: typeof fetch
  let mockFetch: MockFetch

  beforeEach(() => {
    originalFetch = global.fetch
    mockFetch = vi.fn()
    global.fetch = mockFetch as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.useRealTimers()
  })

  it("clamps the container wait to the deadline instead of the full video budget", async () => {
    vi.useFakeTimers()
    mockFetch.mockResolvedValueOnce(okJson({ id: "slow_vid" }))
    mockFetch.mockResolvedValue(okJson({ status_code: "IN_PROGRESS" }))

    const pending = instagramPublisher.publish("tok", {
      action: "post-reel",
      mediaUrl: "https://example.com/v.mp4",
    }, { instagram_user_id: "ig123", publishDeadlineMs: Date.now() + 10_000 })
      .then(() => null).catch((e) => e)
    await vi.advanceTimersByTimeAsync(12_000)
    const err = await pending

    expect(err).toBeInstanceOf(NotPublishedError)
    // Clamped to the 10s deadline — NOT the 300s video budget.
    expect((err as Error).message).toContain("10s")
  })

  it("stops 9007 publish retries when the deadline would pass before the next try", async () => {
    vi.useFakeTimers()
    mockFetch.mockResolvedValueOnce(okJson({ id: "cont_d" }))
    mockFetch.mockResolvedValueOnce(okJson({ status_code: "FINISHED" }))
    mockFetch.mockResolvedValue(mediaNotReadyResponse())

    const err = await instagramPublisher.publish("tok", { ...IMAGE_REQUEST }, {
      instagram_user_id: "ig123",
      publishDeadlineMs: Date.now() + 2_000,
    }).then(() => null).catch((e) => e)

    expect(err).toBeInstanceOf(NotPublishedError)
    // One attempt, then the 3s backoff would overshoot the deadline — stop.
    expect(callsTo(mockFetch, "/media_publish")).toHaveLength(1)
    expect((err as Error).message).toContain("after 1 attempt")
  })

  it("keeps the full budgets when no deadline is passed (scheduled worker path)", async () => {
    vi.useFakeTimers()
    mockFetch.mockResolvedValueOnce(okJson({ id: "cont_w" }))
    mockFetch.mockResolvedValueOnce(okJson({ status_code: "IN_PROGRESS" }))
    mockFetch.mockResolvedValueOnce(okJson({ status_code: "FINISHED" }))
    mockFetch.mockResolvedValueOnce(okJson({ id: "post_w" }))
    mockFetch.mockResolvedValueOnce(okJson({ shortcode: "W1" }))

    const pending = publishImage()
    await vi.advanceTimersByTimeAsync(2_050)

    expect((await pending).platformPostId).toBe("post_w")
  })
})
