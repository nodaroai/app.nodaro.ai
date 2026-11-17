/**
 * The large-upload lane (/v1/uploads/large/*): what each route answers and in
 * what order it checks, with storage, the probe, Redis and the database
 * replaced. The presigning itself is real in lib/__tests__/large-upload-storage.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const store = vi.hoisted(() => ({
  parts: [] as Array<{ partNumber: number; etag: string; sizeBytes: number }>,
  objectSize: 0 as number | undefined,
  redis: new Map<string, string>(),
  /** The open-upload slots, by object key (the slots module has its own tests). */
  slots: new Set<string>(),
  slotAnswer: "taken" as "taken" | "too_many_open" | "rate_limited" | "down",
}))

vi.mock("../../lib/large-upload-slots.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/large-upload-slots.js")>()),
  claimLargeUploadSlot: vi.fn(async (_user: string, key: string) => {
    if (store.slotAnswer === "down") throw new Error("redis down")
    if (store.slotAnswer === "taken") store.slots.add(key)
    return store.slotAnswer
  }),
  releaseLargeUploadSlot: vi.fn(async (_user: string, key: string) => {
    store.slots.delete(key)
  }),
}))

vi.mock("../../lib/large-upload-storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/large-upload-storage.js")>()
  return {
    ...actual,
    createLargeUpload: vi.fn(async () => {
      actual.assertLargeUploadLaneOpen()
      return "upload-1"
    }),
    presignLargeUploadParts: vi.fn(async (_key: string, _id: string, size: number, partSize: number) =>
      Array.from({ length: actual.largeUploadPartCount(size, partSize) }, (_, i) => `https://store.test/part/${i + 1}`),
    ),
    listLargeUploadParts: vi.fn(async () => store.parts),
    completeLargeUpload: vi.fn(async () => {
      actual.assertLargeUploadLaneOpen()
    }),
    largeUploadObjectSize: vi.fn(async () => store.objectSize),
    presignLargeUploadRead: vi.fn(async () => "https://store.test/read"),
    abortLargeUpload: vi.fn(async () => undefined),
  }
})
vi.mock("../../lib/large-upload-media.js", () => ({
  readStoredMedia: vi.fn(),
  storedVideoPoster: vi.fn(async () => Buffer.from("png")),
}))
vi.mock("../../lib/storage.js", () => ({
  uploadBufferToR2: vi.fn(async (_b: Buffer, key: string) => `https://cdn.test/${key}`),
  r2Url: (key: string) => `https://cdn.test/${key}`,
}))
vi.mock("../../lib/storage-delete.js", () => ({ deleteKeyRecordingFailure: vi.fn(async () => undefined) }))
vi.mock("../../lib/queue.js", () => ({
  redis: {
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes("NX") && store.redis.has(key)) return null
      store.redis.set(key, value)
      return "OK"
    }),
    get: vi.fn(async (key: string) => store.redis.get(key) ?? null),
    del: vi.fn(async (key: string) => (store.redis.delete(key) ? 1 : 0)),
  },
}))
const insertSpy = vi.hoisted(() => vi.fn())
vi.mock("../../lib/supabase.js", () => ({
  supabase: { from: vi.fn(() => ({ insert: insertSpy })) },
}))
vi.mock("../../utils/file-validation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/file-validation.js")>()),
  reserveStorageIfWithinLimit: vi.fn(async () => true),
  checkStorageQuota: vi.fn(async () => ({ allowed: true })),
}))

import { largeUploadRoutes } from "../large-upload.js"
import {
  abortLargeUpload,
  completeLargeUpload,
  createLargeUpload,
  largeUploadPartSize,
} from "../../lib/large-upload-storage.js"
import { readStoredMedia, storedVideoPoster } from "../../lib/large-upload-media.js"
import { deleteKeyRecordingFailure } from "../../lib/storage-delete.js"
import { checkStorageQuota, reserveStorageIfWithinLimit } from "../../utils/file-validation.js"
import { clearUploadPolicies, registerUploadPolicy } from "../../lib/upload-policy.js"
import { MEDIA_IMPORT_MAX_BYTES, MEDIA_IMPORT_MAX_SEC, MEDIA_TOO_LONG_MESSAGE } from "../../lib/media-import-length.js"

const USER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000002"
const MIB = 1024 * 1024
const SIZE = 40 * MIB // three 16 MiB parts

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  store.redis.clear()
  store.slots.clear()
  store.slotAnswer = "taken"
  store.parts = [1, 2, 3].map((n) => ({ partNumber: n, etag: `"e${n}"`, sizeBytes: n < 3 ? 16 * MIB : 8 * MIB }))
  store.objectSize = SIZE
  insertSpy.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "asset-1" }, error: null }) }) })
  vi.mocked(readStoredMedia).mockResolvedValue({
    durationSec: 600,
    metadata: { width: 1920, height: 1080, durationSeconds: 600, codec: "h264" },
  })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user"]
    if (typeof user === "string") req.userId = user
  })
  await app.register(largeUploadRoutes)
  await app.ready()
})

afterEach(async () => {
  clearUploadPolicies()
  await app.close()
})

const post = (url: string, payload: Record<string, unknown>, user: string | null = USER) =>
  app.inject({ method: "POST", url, payload, headers: user ? { "x-user": user } : {} })

async function start(body: Record<string, unknown> = {}) {
  const res = await post("/v1/uploads/large/start", { filename: "talk.mp4", mimeType: "video/mp4", sizeBytes: SIZE, ...body })
  return res
}

describe("POST /v1/uploads/large/start", () => {
  it("opens a multipart upload under uploads/videos and signs one part URL per part", async () => {
    const res = await start()
    expect(res.statusCode).toBe(200)
    const body = res.json() as { token: string; partSize: number; partUrls: string[] }
    expect(body.partSize).toBe(largeUploadPartSize(SIZE))
    expect(body.partUrls).toHaveLength(3)
    expect(typeof body.token).toBe("string")
    const [key, mime] = vi.mocked(createLargeUpload).mock.calls[0]!
    expect(key).toMatch(/^uploads\/videos\/[0-9a-f-]+\.mp4$/)
    expect(mime).toBe("video/mp4")
    // Checked, never reserved.
    expect(checkStorageQuota).toHaveBeenCalledWith(USER, SIZE)
    expect(reserveStorageIfWithinLimit).not.toHaveBeenCalled()
  })

  it("files audio under uploads/audios", async () => {
    const res = await start({ filename: "show.mp3", mimeType: "audio/mpeg" })
    expect(res.statusCode).toBe(200)
    expect(vi.mocked(createLargeUpload).mock.calls[0]![0]).toMatch(/^uploads\/audios\/[0-9a-f-]+\.mp3$/)
  })

  it("takes video and audio only", async () => {
    const res = await start({ filename: "a.png", mimeType: "image/png" })
    expect(res.statusCode).toBe(400)
    expect(createLargeUpload).not.toHaveBeenCalled()
  })

  it("a file over 500 MB is fine, up to the 10 GiB import ceiling; over it is 422 media_too_large", async () => {
    expect((await start({ sizeBytes: MEDIA_IMPORT_MAX_BYTES })).statusCode).toBe(200)
    const over = await start({ sizeBytes: MEDIA_IMPORT_MAX_BYTES + 1 })
    expect(over.statusCode).toBe(422)
    expect(over.json().error.code).toBe("media_too_large")
    expect(createLargeUpload).toHaveBeenCalledTimes(1)
  })

  it("takes an open-upload slot under the object's key", async () => {
    await start()
    const key = vi.mocked(createLargeUpload).mock.calls[0]![0]
    expect([...store.slots]).toEqual([key])
  })

  it("429 too_many_open_uploads past 3 open uploads, and nothing is opened", async () => {
    store.slotAnswer = "too_many_open"
    const res = await start()
    expect(res.statusCode).toBe(429)
    expect(res.json().error.code).toBe("too_many_open_uploads")
    expect(createLargeUpload).not.toHaveBeenCalled()
  })

  it("429 rate_limited past 20 starts an hour", async () => {
    store.slotAnswer = "rate_limited"
    const res = await start()
    expect(res.statusCode).toBe(429)
    expect(res.json().error.code).toBe("rate_limited")
    expect(createLargeUpload).not.toHaveBeenCalled()
  })

  it("fails closed when the count cannot be read: 503, nothing opened", async () => {
    store.slotAnswer = "down"
    const res = await start()
    expect(res.statusCode).toBe(503)
    expect(createLargeUpload).not.toHaveBeenCalled()
  })

  it("gives the slot back when the upload could not be opened", async () => {
    vi.mocked(createLargeUpload).mockRejectedValueOnce(new Error("storage down"))
    const res = await start()
    expect(res.statusCode).toBe(500)
    expect(store.slots.size).toBe(0)
  })

  it("401 without an account", async () => {
    const res = await post("/v1/uploads/large/start", { filename: "a.mp4", mimeType: "video/mp4", sizeBytes: SIZE }, null)
    expect(res.statusCode).toBe(401)
  })

  it("413 storage_limit_exceeded in /v1/upload's shape when the file would not fit", async () => {
    vi.mocked(checkStorageQuota).mockResolvedValueOnce({
      allowed: false, error: "Storage quota exceeded", usedBytes: 9, quotaBytes: 10, remainingBytes: 1, tier: "free",
    })
    const res = await start()
    expect(res.statusCode).toBe(413)
    expect(res.json()).toEqual({
      error: { code: "storage_limit_exceeded", message: "Storage quota exceeded", usedBytes: 9, quotaBytes: 10, remainingBytes: 1, tier: "free" },
    })
    expect(createLargeUpload).not.toHaveBeenCalled()
  })

  it("409 large_upload_unavailable while an upload policy is registered — the bytes would never pass it", async () => {
    registerUploadPolicy({ id: "moderation", check: () => ({ allow: true }) })
    const res = await start()
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("large_upload_unavailable")
    expect(createLargeUpload).not.toHaveBeenCalled()
  })
})

async function tokenFor(user = USER): Promise<string> {
  const res = await post("/v1/uploads/large/start", { filename: "talk.mp4", mimeType: "video/mp4", sizeBytes: SIZE }, user)
  return (res.json() as { token: string }).token
}

describe("POST /v1/uploads/large/complete", () => {
  it("joins the parts with the store's own ETags, reserves the quota, records the asset and answers /v1/upload's data", async () => {
    const token = await tokenFor()
    const res = await post("/v1/uploads/large/complete", { token })
    expect(res.statusCode).toBe(200)
    const { data } = res.json() as { data: Record<string, unknown> }
    expect(data).toMatchObject({
      assetId: "asset-1",
      category: "video",
      filename: "talk.mp4",
      mimeType: "video/mp4",
      sizeBytes: SIZE,
      metadata: { width: 1920, height: 1080, durationSeconds: 600, codec: "h264" },
    })
    expect(data.url).toBe(`https://cdn.test/${data.r2Key as string}`)
    expect(data.thumbnailUrl).toBe(`https://cdn.test/${(data.r2Key as string).replace(".mp4", "_thumb.png")}`)
    expect(vi.mocked(completeLargeUpload).mock.calls[0]![2]).toEqual(store.parts)
    expect(reserveStorageIfWithinLimit).toHaveBeenCalledWith(USER, SIZE)
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      user_id: USER, type: "video", size_bytes: SIZE, r2_key: data.r2Key, upload_source: "manual_upload",
      metadata: expect.objectContaining({ thumbnail_url: data.thumbnailUrl, original_filename: "talk.mp4" }),
    }))
  })

  it("a second call answers the first one's result, and never reserves or records twice", async () => {
    const token = await tokenFor()
    const first = await post("/v1/uploads/large/complete", { token })
    const second = await post("/v1/uploads/large/complete", { token })
    expect(second.statusCode).toBe(200)
    expect(second.json()).toEqual(first.json())
    expect(reserveStorageIfWithinLimit).toHaveBeenCalledTimes(1)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(completeLargeUpload).toHaveBeenCalledTimes(1)
  })

  it("a call while another is completing the same upload is 409, and does nothing", async () => {
    const token = await tokenFor()
    let release!: () => void
    vi.mocked(readStoredMedia).mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ durationSec: 60, metadata: { width: 1, height: 1, durationSeconds: 60, codec: "h264" } })
    }))
    const first = post("/v1/uploads/large/complete", { token })
    await vi.waitFor(() => expect(readStoredMedia).toHaveBeenCalled())
    const second = await post("/v1/uploads/large/complete", { token })
    expect(second.statusCode).toBe(409)
    expect(second.json().error.code).toBe("upload_completing")
    release()
    expect((await first).statusCode).toBe(200)
    expect(reserveStorageIfWithinLimit).toHaveBeenCalledTimes(1)
  })

  it("over 30 minutes: the object is deleted and nothing is reserved or recorded (422 media_too_long)", async () => {
    vi.mocked(readStoredMedia).mockResolvedValueOnce({ durationSec: MEDIA_IMPORT_MAX_SEC + 1, metadata: { width: 1, height: 1, durationSeconds: 0, codec: "h264" } })
    const token = await tokenFor()
    const res = await post("/v1/uploads/large/complete", { token })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toEqual({ code: "media_too_long", message: MEDIA_TOO_LONG_MESSAGE })
    expect(deleteKeyRecordingFailure).toHaveBeenCalledWith(expect.stringMatching(/^uploads\/videos\//), "media")
    expect(reserveStorageIfWithinLimit).not.toHaveBeenCalled()
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it("exactly 30 minutes is accepted", async () => {
    vi.mocked(readStoredMedia).mockResolvedValueOnce({ durationSec: MEDIA_IMPORT_MAX_SEC, metadata: { width: 1, height: 1, durationSeconds: MEDIA_IMPORT_MAX_SEC, codec: "h264" } })
    const res = await post("/v1/uploads/large/complete", { token: await tokenFor() })
    expect(res.statusCode).toBe(200)
  })

  it("a file whose length cannot be read is refused and deleted (422 media_unreadable)", async () => {
    vi.mocked(readStoredMedia).mockRejectedValueOnce(new Error("moov atom not found"))
    const res = await post("/v1/uploads/large/complete", { token: await tokenFor() })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("media_unreadable")
    expect(deleteKeyRecordingFailure).toHaveBeenCalled()
  })

  it("a stored size that differs from the declared one is deleted (400 size_mismatch)", async () => {
    store.objectSize = SIZE - 1
    const res = await post("/v1/uploads/large/complete", { token: await tokenFor() })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("size_mismatch")
    expect(deleteKeyRecordingFailure).toHaveBeenCalled()
    expect(readStoredMedia).not.toHaveBeenCalled()
  })

  it("missing parts: 400 upload_incomplete, nothing joined, and the call can be made again", async () => {
    store.parts = store.parts.slice(0, 2)
    const token = await tokenFor()
    const res = await post("/v1/uploads/large/complete", { token })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("upload_incomplete")
    expect(completeLargeUpload).not.toHaveBeenCalled()
    store.parts = [1, 2, 3].map((n) => ({ partNumber: n, etag: `"e${n}"`, sizeBytes: 1 }))
    expect((await post("/v1/uploads/large/complete", { token })).statusCode).toBe(200)
  })

  it("over quota at completion: the object is deleted and the answer is /v1/upload's 413", async () => {
    vi.mocked(reserveStorageIfWithinLimit).mockResolvedValueOnce(false)
    vi.mocked(checkStorageQuota).mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({
      allowed: false, error: "Storage quota exceeded", usedBytes: 9, quotaBytes: 10, remainingBytes: 1, tier: "free",
    })
    const res = await post("/v1/uploads/large/complete", { token: await tokenFor() })
    expect(res.statusCode).toBe(413)
    expect(res.json().error).toMatchObject({ code: "storage_limit_exceeded", quotaBytes: 10 })
    expect(deleteKeyRecordingFailure).toHaveBeenCalled()
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it("a poster that cannot be made does not fail the upload", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      vi.mocked(storedVideoPoster).mockRejectedValueOnce(new Error("ffmpeg"))
      const res = await post("/v1/uploads/large/complete", { token: await tokenFor() })
      expect(res.statusCode).toBe(200)
      expect(res.json().data.thumbnailUrl).toBeNull()
    } finally {
      err.mockRestore()
    }
  })

  it("another account's token is refused (403), a bad one is 400", async () => {
    const token = await tokenFor(OTHER)
    expect((await post("/v1/uploads/large/complete", { token })).statusCode).toBe(403)
    expect((await post("/v1/uploads/large/complete", { token: "nope" })).json().error.code).toBe("invalid_token")
    expect(completeLargeUpload).not.toHaveBeenCalled()
  })

  it("a policy registered after the upload started closes it at completion: aborted, 409", async () => {
    const token = await tokenFor()
    registerUploadPolicy({ id: "moderation", check: () => ({ allow: true }) })
    const res = await post("/v1/uploads/large/complete", { token })
    expect(res.statusCode).toBe(409)
    expect(abortLargeUpload).toHaveBeenCalled()
    expect(insertSpy).not.toHaveBeenCalled()
  })
})

describe("POST /v1/uploads/large/abort", () => {
  it("aborts the caller's upload", async () => {
    const res = await post("/v1/uploads/large/abort", { token: await tokenFor() })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { aborted: true } })
    expect(abortLargeUpload).toHaveBeenCalledWith(expect.stringMatching(/^uploads\/videos\//), "upload-1")
  })

  it("is best-effort: a store error answers aborted: false", async () => {
    vi.mocked(abortLargeUpload).mockRejectedValueOnce(Object.assign(new Error("gone"), { name: "NoSuchUpload" }))
    const res = await post("/v1/uploads/large/abort", { token: await tokenFor() })
    expect(res.json()).toEqual({ data: { aborted: false } })
  })

  it("refuses another account's token", async () => {
    const res = await post("/v1/uploads/large/abort", { token: await tokenFor(OTHER) })
    expect(res.statusCode).toBe(403)
    expect(abortLargeUpload).not.toHaveBeenCalled()
  })
})

describe("large uploads — bitrate sanity and open-upload slots", () => {
  it("a big file that claims a short length is refused for its bitrate (422 media_bitrate_implausible), and deleted", async () => {
    // 40 MiB claiming 0.05 s: ~4,000 Mbit/s once the 16 MiB slack is taken off — past the 2,500 Mbit/s video ceiling.
    vi.mocked(readStoredMedia).mockResolvedValueOnce({ durationSec: 0.05, metadata: { width: 1, height: 1, durationSeconds: 0.05, codec: "h264" } })
    const res = await post("/v1/uploads/large/complete", { token: await tokenFor() })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("media_bitrate_implausible")
    expect(deleteKeyRecordingFailure).toHaveBeenCalled()
    expect(reserveStorageIfWithinLimit).not.toHaveBeenCalled()
  })

  it("a completed upload gives its slot back", async () => {
    const token = await tokenFor()
    expect(store.slots.size).toBe(1)
    expect((await post("/v1/uploads/large/complete", { token })).statusCode).toBe(200)
    expect(store.slots.size).toBe(0)
  })

  it("missing parts keep the slot (the upload is still open); a refusal that deleted the object frees it", async () => {
    store.parts = store.parts.slice(0, 1)
    const token = await tokenFor()
    expect((await post("/v1/uploads/large/complete", { token })).json().error.code).toBe("upload_incomplete")
    expect(store.slots.size).toBe(1)

    store.parts = [1, 2, 3].map((n) => ({ partNumber: n, etag: `"e${n}"`, sizeBytes: 1 }))
    vi.mocked(readStoredMedia).mockResolvedValueOnce({ durationSec: MEDIA_IMPORT_MAX_SEC + 1, metadata: { width: 1, height: 1, durationSeconds: 0, codec: "h264" } })
    expect((await post("/v1/uploads/large/complete", { token })).statusCode).toBe(422)
    expect(store.slots.size).toBe(0)
  })

  it("an abort gives its slot back", async () => {
    const token = await tokenFor()
    await post("/v1/uploads/large/abort", { token })
    expect(store.slots.size).toBe(0)
  })
})
