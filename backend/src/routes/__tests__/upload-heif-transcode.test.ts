// @test-watches backend/src/utils/__tests__/fixtures/*.avif backend/src/utils/__tests__/fixtures/*.heic
/**
 * Every lane that stores a user's image bytes converts HEIC/HEIF/AVIF before
 * the first write (utils/heif-decode.ts): JPEG, or PNG when the picture has
 * transparency. A 10-bit AVIF is the case that matters — sharp reads its
 * header but not its pixels, so before the ffmpeg fallback it was stored as-is
 * (AVIF) or 400'd (HEIC), and every provider downstream failed on it
 * (production Cast Swap run, 2026-10-25).
 *
 * Covered: POST /v1/upload, POST /v1/upload/image, PUT /v1/upload-proxy/:token
 * (MCP prepare_image_upload), POST /v1/upload-page/:token (the handoff page and
 * in-chat widget) and the URL import (`storeImportedImageBuffer`).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { readFileSync } from "node:fs"
import sharp from "sharp"

const stored = vi.hoisted(() => ({
  puts: [] as Array<{ Key: string; Body: Buffer; ContentType: string }>,
  r2: [] as Array<{ buffer: Buffer; key: string; contentType: string }>,
}))
vi.mock("../../lib/storage.js", () => ({
  s3: { send: vi.fn(async (cmd: { input: { Key: string; Body: Buffer; ContentType: string } }) => { stored.puts.push(cmd.input) }) },
  withObjectAcl: <T>(x: T) => x,
  uploadBufferToR2: vi.fn(async (buffer: Buffer, key: string, contentType: string) => {
    stored.r2.push({ buffer, key, contentType })
    return `https://cdn.test/${key}`
  }),
}))
vi.mock("../../lib/queue.js", () => ({
  redis: { set: vi.fn(async () => "OK"), exists: vi.fn(async () => 0) },
}))
vi.mock("../../lib/supabase.js", () => ({
  supabase: { from: vi.fn(() => ({ insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: "asset-1" }, error: null }) })) })) })) },
}))
vi.mock("../../utils/file-validation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/file-validation.js")>()),
  reserveStorageIfWithinLimit: vi.fn().mockResolvedValue(true),
  checkStorageQuota: vi.fn(),
  refundStorage: vi.fn(),
}))
vi.mock("../../utils/thumbnail.js", () => ({
  processImage: vi.fn().mockResolvedValue({ thumbnail: Buffer.from("thumb"), metadata: {} }),
  processAudio: vi.fn(),
  processVideo: vi.fn(),
}))

import { signUploadToken } from "../upload-proxy.js"
import { uploadRoutes } from "../upload.js"
import { uploadProxyRoutes } from "../upload-proxy.js"
import { uploadHandoffRoutes } from "../upload-handoff.js"
import { storeImportedImageBuffer } from "../../lib/media-import.js"

const USER = "00000000-0000-4000-8000-000000000001"
const fixture = (name: string) => readFileSync(new URL(`../../utils/__tests__/fixtures/${name}`, import.meta.url))
const avif10 = fixture("10bit.avif")
const heic = fixture("hevc.heic")

function multipart(file: Buffer, filename: string, mimetype: string): { payload: Buffer; headers: Record<string, string> } {
  const boundary = "----heif-test-boundary"
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`)
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return { payload: Buffer.concat([head, file, tail]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } }
}

/** The stored bytes are a JPEG of the whole 96×64 picture. */
async function expectJpegOfFixture(body: Buffer) {
  const meta = await sharp(body).metadata()
  expect(meta.format).toBe("jpeg")
  expect([meta.width, meta.height]).toEqual([96, 64])
}

describe("upload lanes — HEIC/HEIF/AVIF are converted before they are stored", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    // app.ts raises maxParamLength for the same ~330-char signed tokens.
    app = Fastify({ logger: false, routerOptions: { maxParamLength: 2048 } })
    app.addHook("preHandler", async (req) => { req.userId = USER })
    await app.register(uploadRoutes)
    await app.register(uploadProxyRoutes)
    await app.register(uploadHandoffRoutes)
    await app.ready()
  })
  afterAll(async () => { await app.close() })
  beforeEach(() => {
    stored.puts.length = 0
    stored.r2.length = 0
  })

  it.each([
    ["a 10-bit AVIF", avif10, "face.avif", "image/avif"],
    ["a HEIC", heic, "IMG_0001.heic", "image/heic"],
  ])("POST /v1/upload stores %s as a JPEG (.jpg, image/jpeg)", async (_label, file, name, mime) => {
    const { payload, headers } = multipart(file, name, mime)
    const res = await app.inject({ method: "POST", url: "/v1/upload", payload, headers })
    expect(res.statusCode).toBe(200)
    const put = stored.puts.find((p) => p.ContentType.startsWith("image/"))!
    expect(put.ContentType).toBe("image/jpeg")
    expect(put.Key).toMatch(/\.jpg$/)
    await expectJpegOfFixture(put.Body)
    expect(res.json().data.mimeType).toBe("image/jpeg")
  })

  it("POST /v1/upload/image stores a 10-bit AVIF as a JPEG", async () => {
    const { payload, headers } = multipart(avif10, "face.avif", "image/avif")
    const res = await app.inject({ method: "POST", url: "/v1/upload/image", payload, headers })
    expect(res.statusCode).toBe(200)
    const put = stored.puts[0]!
    expect(put.ContentType).toBe("image/jpeg")
    expect(put.Key).toMatch(/\.jpg$/)
    await expectJpegOfFixture(put.Body)
  })

  it("the proxy PUT keeps the promised key and serves the converted type", async () => {
    const token = signUploadToken({ userId: USER, key: "uploads/image/u/abc.avif", mime: "image/avif", exp: Date.now() + 60_000, purpose: "proxy" })
    const res = await app.inject({ method: "PUT", url: `/v1/upload-proxy/${token}`, payload: avif10, headers: { "content-type": "image/avif" } })
    expect(res.statusCode).toBe(200)
    const put = stored.puts[0]!
    expect(put.Key).toBe("uploads/image/u/abc.avif") // the URL the caller already holds
    expect(put.ContentType).toBe("image/jpeg")
    await expectJpegOfFixture(put.Body)
    expect(res.json().bytes).toBe(put.Body.length)
  })

  it("the handoff page keeps the predetermined key and serves the converted type", async () => {
    const token = signUploadToken({ userId: USER, key: "uploads/handoff/image/u/abc", mime: "", exp: Date.now() + 60_000, purpose: "handoff", kind: "image" })
    const { payload, headers } = multipart(avif10, "face.avif", "image/avif")
    const res = await app.inject({ method: "POST", url: `/v1/upload-page/${token}`, payload, headers })
    expect(res.statusCode).toBe(200)
    const put = stored.puts[0]!
    expect(put.Key).toBe("uploads/handoff/image/u/abc")
    expect(put.ContentType).toBe("image/jpeg")
    await expectJpegOfFixture(put.Body)
  })

  it("a URL import stores a 10-bit AVIF as a .jpg JPEG", async () => {
    const result = await storeImportedImageBuffer({ userId: USER, body: avif10, uploadSource: "url_import" })
    expect(result.ok).toBe(true)
    const main = stored.r2.find((u) => !u.key.includes("_thumb"))!
    expect(main.contentType).toBe("image/jpeg")
    expect(main.key).toMatch(/\.jpg$/)
    await expectJpegOfFixture(main.buffer)
  })

  it("a PNG is stored exactly as sent (no conversion)", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).png().toBuffer()
    const { payload, headers } = multipart(png, "a.png", "image/png")
    const res = await app.inject({ method: "POST", url: "/v1/upload", payload, headers })
    expect(res.statusCode).toBe(200)
    const put = stored.puts.find((p) => p.ContentType.startsWith("image/"))!
    expect(put.ContentType).toBe("image/png")
    expect(put.Body.equals(png)).toBe(true)
  })
})
