/**
 * POST /v1/upload takes a Speaker Frames track file up to the track-set cap
 * (64 MiB) — decided 2026-10-10: a connected self-host re-hosts track files
 * through the relay upload with a 64 MiB limit for this file type only; other
 * uploads stay at 50 MB. "This file type" is a JSON upload that names the
 * `speaker-tracks` purpose AND is a face-track set; anything else keeps its
 * category's limit. Storage and the database are replaced; the route,
 * multipart parsing and validation are real.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { SPEAKER_TRACKS_MAX_BYTES } from "@nodaro/shared"

const stored = vi.hoisted(() => ({ puts: [] as Array<{ Key: string; ContentType: string }> }))
vi.mock("../../lib/storage.js", () => ({
  s3: { send: vi.fn(async (cmd: { input: { Key: string; ContentType: string } }) => { stored.puts.push({ Key: cmd.input.Key, ContentType: cmd.input.ContentType }) }) },
  withObjectAcl: <T>(x: T) => x,
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

import { uploadRoutes } from "../upload.js"

const USER = "00000000-0000-4000-8000-000000000001"
const MB = 1024 * 1024

/** A face-track set of about `bytes` (a padded note keeps it cheap to build). */
function trackSet(bytes: number): Buffer {
  const set = {
    version: 1,
    sampleFps: 2,
    detector: { id: "yunet" },
    sources: [{ sourceId: "camA", clock: "source", frame: { w: 960, h: 540 }, sampledSpans: [{ startMs: 0, endMs: 1000 }], tracks: [{ id: "camA/t1", boxes: [{ ms: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.3 }] }] }],
    note: "",
  }
  const base = Buffer.byteLength(JSON.stringify(set))
  return Buffer.from(JSON.stringify({ ...set, note: "x".repeat(Math.max(0, bytes - base)) }))
}

function multipart(file: Buffer, fields: Record<string, string> = {}) {
  const boundary = "----tracks-test-boundary"
  const parts = Object.entries(fields).map(([k, v]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="tracks.json"\r\nContent-Type: application/json\r\n\r\n`)
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return { payload: Buffer.concat([...parts, head, file, tail]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } }
}

describe("POST /v1/upload — a face-track file up to the track-set cap", () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = Fastify({ logger: false, bodyLimit: 200 * MB })
    app.addHook("preHandler", async (req) => { req.userId = USER })
    await app.register(uploadRoutes)
    await app.ready()
  })
  afterAll(async () => { await app.close() })
  beforeEach(() => { stored.puts.length = 0 })

  const post = (file: Buffer, fields?: Record<string, string>) => app.inject({ method: "POST", url: "/v1/upload", ...multipart(file, fields) })

  it("takes a track file over 50 MB when it names its purpose", async () => {
    const res = await post(trackSet(55 * MB), { purpose: "speaker-tracks" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ category: "data", mimeType: "application/json" })
    expect(stored.puts).toHaveLength(1)
  }, 60_000)

  it("keeps every other JSON upload at 50 MB: no purpose named", async () => {
    const res = await post(trackSet(55 * MB))
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/File too large .* Maximum for data: 50/)
    expect(stored.puts).toHaveLength(0)
  }, 60_000)

  it("keeps a JSON file that is not a face-track set at 50 MB, whatever purpose it names", async () => {
    const other = Buffer.from(JSON.stringify({ note: "x".repeat(55 * MB) }))
    const res = await post(other, { purpose: "speaker-tracks" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/File too large/)
  }, 60_000)

  it("refuses a track file over the track-set cap", async () => {
    const res = await post(trackSet(SPEAKER_TRACKS_MAX_BYTES + 1024), { purpose: "speaker-tracks" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/File too large/)
  }, 60_000)

  it("takes a small track file as before", async () => {
    const res = await post(trackSet(4 * 1024), { purpose: "speaker-tracks" })
    expect(res.statusCode).toBe(200)
  })
})
