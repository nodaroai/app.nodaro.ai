/**
 * How the Facebook publisher reports a failure. A refused request (HTTP 4xx)
 * posted nothing, so it is a definite failure carrying Facebook's own sentence
 * for the person; only a call whose answer never came back (or a server
 * error) may have posted, and stays an unknown outcome for execute-publish.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { facebookPublisher } from "../facebook.js"
import { GraphRefusedError } from "../graph-error.js"
import { BadBodyError } from "../../providers/types.js"

/** Facebook's answer to a 2K GPT Image 2 PNG (the photo over its 10 MB limit). */
const PHOTO_TOO_LARGE = {
  error: {
    message: "Invalid parameter",
    type: "OAuthException",
    code: 100,
    error_user_title: "Can't Read Files",
    error_user_msg:
      "Your photos couldn't be uploaded. Photos should be less than 10 MB and saved as JPG, PNG, GIF, TIFF, HEIF or WebP files.",
    fbtrace_id: "trace-1",
  },
}

function answer(status: number, body: unknown): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    text: async () => text,
  } as unknown as Response
}

const PAGE = { page_id: "page-1", page_access_token: "page-token" }

function post(action: string, mediaUrl = "https://cdn.test/images/a.png") {
  return facebookPublisher.publish("user-token", { action, caption: "hi", mediaUrl }, PAGE)
}

function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => null).catch((e: unknown) => e)
}

describe("facebookPublisher", () => {
  let originalFetch: typeof fetch
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    originalFetch = global.fetch
    mockFetch = vi.fn()
    global.fetch = mockFetch as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it("posts a photo by its URL and returns the post's link", async () => {
    mockFetch.mockResolvedValueOnce(answer(200, { id: "photo-1", post_id: "page-1_post-1" }))

    const result = await post("post-image")

    expect(result).toEqual({
      success: true,
      platformPostId: "page-1_post-1",
      platformPostUrl: "https://www.facebook.com/page-1_post-1",
    })
    const [url, init] = mockFetch.mock.calls[0] as [string, { body: string }]
    expect(url).toBe("https://graph.facebook.com/v25.0/page-1/photos")
    expect(JSON.parse(init.body)).toEqual({ url: "https://cdn.test/images/a.png", caption: "hi", access_token: "page-token" })
  })

  it("reports a photo Facebook refuses (HTTP 400, code 100) as a definite failure in Facebook's own words", async () => {
    mockFetch.mockResolvedValueOnce(answer(400, PHOTO_TOO_LARGE))

    const err = await failureOf(post("post-image"))

    expect(err).toBeInstanceOf(BadBodyError)
    expect((err as Error).message).toBe(`Facebook photo post failed: ${PHOTO_TOO_LARGE.error.error_user_msg}`)
    expect((err as Error).message).not.toMatch(/MAY have been published/i)
    // The developer details stay on the error for the logs, out of the sentence.
    expect((err as GraphRefusedError).graph).toEqual({ status: 400, code: 100, type: "OAuthException", traceId: "trace-1" })
  })

  it("uses Graph's own message when the refusal has no sentence for the person", async () => {
    mockFetch.mockResolvedValueOnce(answer(403, { error: { message: "(#200) Permissions error", type: "OAuthException", code: 200 } }))

    const err = await failureOf(post("post-image"))

    expect(err).toBeInstanceOf(BadBodyError)
    expect((err as Error).message).toBe("Facebook photo post failed: (#200) Permissions error")
  })

  it("keeps the text of a refusal that is not JSON", async () => {
    mockFetch.mockResolvedValueOnce(answer(400, "Bad Request"))

    const err = await failureOf(post("post-image"))

    expect(err).toBeInstanceOf(BadBodyError)
    expect((err as Error).message).toBe("Facebook photo post failed: Bad Request")
  })

  it("leaves a server error (5xx) undecided: Facebook may have posted before it failed", async () => {
    mockFetch.mockResolvedValueOnce(answer(500, { error: { message: "An unknown error has occurred.", code: 1 } }))

    const err = await failureOf(post("post-image"))

    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(BadBodyError)
  })

  it("leaves a lost connection undecided: the request may have reached Facebook", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"))

    const err = await failureOf(post("post-image"))

    expect(err).toBeInstanceOf(TypeError)
    expect(err).not.toBeInstanceOf(BadBodyError)
  })

  it.each([
    ["post-text", "Facebook post failed"],
    ["post-video", "Facebook video post failed"],
    ["post-story", "Facebook story post failed"],
  ])("reports a refused %s the same way", async (action, label) => {
    mockFetch.mockResolvedValueOnce(answer(400, PHOTO_TOO_LARGE))

    const err = await failureOf(post(action, "https://cdn.test/videos/a.mp4"))

    expect(err).toBeInstanceOf(BadBodyError)
    expect((err as Error).message).toBe(`${label}: ${PHOTO_TOO_LARGE.error.error_user_msg}`)
  })
})
