/**
 * The card picture's fast path (card-image/service.ts): the card never waits
 * for a render. A picture not known to exist is answered null at once and its
 * render starts in the background, once however many readers ask; a known one
 * (this process's memo, or the Redis marker) is named without asking the
 * bucket; a slow Redis never holds the card; a picture already in the bucket
 * is only marked; a failed render is not retried on every hit; nothing renders
 * without storage.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const store = vi.hoisted(() => ({
  configured: true,
  objects: new Set<string>(),
  uploads: [] as Array<{ key: string; type: string; bytes: number }>,
  failUpload: false,
}))
const markers = vi.hoisted(() => ({ map: new Map<string, string>(), hang: false }))

vi.mock("../../../storage.js", () => ({
  isStorageConfigured: () => store.configured,
  r2Url: (key: string) => `https://cdn.example/${key}`,
  headR2Object: async (key: string) => ({ exists: store.objects.has(key) }),
  uploadBufferToR2: async (buf: Buffer, key: string, type: string) => {
    if (store.failUpload) throw new Error("storage down")
    store.uploads.push({ key, type, bytes: buf.length })
    store.objects.add(key)
    return `https://cdn.example/${key}`
  },
}))
vi.mock("../../../queue-connection.js", () => ({
  redis: {
    get: (k: string) => (markers.hang ? new Promise(() => {}) : Promise.resolve(markers.map.get(k) ?? null)),
    set: async (k: string, v: string) => {
      markers.map.set(k, v)
      return "OK"
    },
  },
}))
vi.mock("../sources.js", () => ({
  loadPicture: async () => ({ kind: "sound", art: null, title: "Lady's on the Loose" }),
}))

import { MARKER_READ_TIMEOUT_MS, renderedCardImage, resetCardImageStateForTests, startCardRender } from "../service.js"
import { cardImageKey, type CardPicture } from "../plan.js"

const TOKEN = "Tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-ab"
const PICTURE: CardPicture = { kind: "sound", art: null, title: "Lady's on the Loose", work: "song" }
const KEY = cardImageKey(TOKEN, PICTURE)

beforeEach(() => {
  resetCardImageStateForTests()
  store.configured = true
  store.objects.clear()
  store.uploads.length = 0
  store.failUpload = false
  markers.map.clear()
  markers.hang = false
})

describe("renderedCardImage", () => {
  it("not rendered yet: answers null at once and renders once in the background, however many ask", async () => {
    const started = Date.now()
    const answers = await Promise.all([renderedCardImage(TOKEN, PICTURE), renderedCardImage(TOKEN, PICTURE), renderedCardImage(TOKEN, PICTURE)])
    expect(answers).toEqual([null, null, null])
    expect(Date.now() - started).toBeLessThan(500)
    await expect(startCardRender(TOKEN, PICTURE)).resolves.toBe(true)
    expect(store.uploads).toEqual([{ key: KEY, type: "image/jpeg", bytes: expect.any(Number) }])
    expect(markers.map.get(`share-card:rendered:${KEY}`)).toBe("1")
    // Rendered: named, 1200 × 630 JPEG, on our storage.
    await expect(renderedCardImage(TOKEN, PICTURE)).resolves.toEqual({ url: `https://cdn.example/${KEY}`, width: 1200, height: 630, type: "image/jpeg" })
    expect(store.uploads).toHaveLength(1)
  })

  it("a picture another process rendered (the Redis marker) is named without a render", async () => {
    markers.map.set(`share-card:rendered:${KEY}`, "1")
    await expect(renderedCardImage(TOKEN, PICTURE)).resolves.toMatchObject({ url: `https://cdn.example/${KEY}` })
    expect(store.uploads).toEqual([])
  })

  it("a slow Redis never holds the card", async () => {
    markers.hang = true
    const started = Date.now()
    await expect(renderedCardImage(TOKEN, PICTURE)).resolves.toBeNull()
    expect(Date.now() - started).toBeLessThan(MARKER_READ_TIMEOUT_MS + 300)
  })

  it("a picture already in the bucket is only marked, never drawn again", async () => {
    store.objects.add(KEY)
    await expect(startCardRender(TOKEN, PICTURE)).resolves.toBe(true)
    expect(store.uploads).toEqual([])
  })

  it("a failed render is not tried again on every hit", async () => {
    store.failUpload = true
    await expect(startCardRender(TOKEN, PICTURE)).resolves.toBe(false)
    store.failUpload = false
    await expect(startCardRender(TOKEN, PICTURE)).resolves.toBe(false)
    expect(store.uploads).toEqual([])
  })

  it("an install without storage renders nothing", async () => {
    store.configured = false
    await expect(renderedCardImage(TOKEN, PICTURE)).resolves.toBeNull()
    await expect(startCardRender(TOKEN, PICTURE)).resolves.toBe(false)
    expect(store.uploads).toEqual([])
  })
})
