import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
import type { SavedPost, SocialPost } from "../../index.js"

function mockOk<T>(body: T, status = 200) {
  return Promise.resolve({ ok: true, status, json: async () => body } as unknown as Response)
}

function client(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
}

const POST: SocialPost = {
  id: "youtube:abc",
  platform: "youtube",
  url: "https://www.youtube.com/watch?v=abc",
  text: "",
  title: "Five hooks that work",
  author: { handle: "maker", name: "Maker" },
  metrics: { views: 1000 },
  media: { kind: "video" },
  hashtags: [],
  extra: {},
}

const SAVE: SavedPost = {
  id: "00000000-0000-4000-8000-0000000000aa",
  postId: POST.id,
  platform: "youtube",
  url: POST.url,
  post: POST,
  thumbnailUrl: null,
  note: "",
  tags: ["hooks"],
  source: "api",
  createdAt: "2026-10-02T10:00:00Z",
  updatedAt: "2026-10-02T10:00:00Z",
}

function call(fetchMock: ReturnType<typeof vi.fn>, n = 0) {
  const [url, init] = fetchMock.mock.calls[n] as [string, { method: string; body?: string }]
  return { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined }
}

describe("savedPosts resource", () => {
  it("list() GETs /v1/saved-posts with only the filters given", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [SAVE], nextCursor: null }))
    const out = await client(fetchMock).savedPosts.list({ platform: "youtube", tag: "hooks", limit: 10 })

    const { url, method } = call(fetchMock)
    expect(method).toBe("GET")
    expect(url).toBe("https://api.example.com/v1/saved-posts?platform=youtube&tag=hooks&limit=10")
    expect(out.data).toEqual([SAVE])
  })

  it("save() POSTs the post, note and tags", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(SAVE, 201))
    const out = await client(fetchMock).savedPosts.save({ post: POST, tags: ["hooks"] })

    const { url, method, body } = call(fetchMock)
    expect([url, method]).toEqual(["https://api.example.com/v1/saved-posts", "POST"])
    expect(body).toEqual({ post: POST, tags: ["hooks"] })
    expect(out.id).toBe(SAVE.id)
  })

  it("lookup(), update() and delete() reach their routes", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ saved: [{ postId: POST.id, id: SAVE.id }] }))
      .mockReturnValueOnce(mockOk({ ...SAVE, note: "x" }))
      .mockReturnValueOnce(mockOk({ success: true }))
    const sdk = client(fetchMock)

    expect((await sdk.savedPosts.lookup([POST.id])).saved).toHaveLength(1)
    expect(call(fetchMock, 0)).toMatchObject({ url: "https://api.example.com/v1/saved-posts/lookup", method: "POST", body: { postIds: [POST.id] } })

    expect((await sdk.savedPosts.update(SAVE.id, { note: "x" })).note).toBe("x")
    expect(call(fetchMock, 1)).toMatchObject({ url: `https://api.example.com/v1/saved-posts/${SAVE.id}`, method: "PATCH", body: { note: "x" } })

    await expect(sdk.savedPosts.delete(SAVE.id)).resolves.toBeUndefined()
    expect(call(fetchMock, 2)).toMatchObject({ url: `https://api.example.com/v1/saved-posts/${SAVE.id}`, method: "DELETE" })
  })
})
