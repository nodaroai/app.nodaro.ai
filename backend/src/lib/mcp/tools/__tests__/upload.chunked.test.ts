import { describe, it, expect, vi, beforeEach } from "vitest"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool } from "./_helpers.js"

// vi.hoisted lifts these above the implicit hoisting of vi.mock() calls,
// so the mock factories can close over them safely. (Plain const defined
// here lives in the TDZ when vi.mock factories run.)
const { fakeRedisStore, s3Send } = vi.hoisted(() => ({
  fakeRedisStore: new Map<string, Map<string, string>>(),
  s3Send: vi.fn(async (_cmd: unknown) => ({})),
}))

// In-memory fake of the bits of ioredis we touch (hset/hgetall/expire/del).
// Using a Map<key, Map<field, value>> mirrors a Redis hash closely.
vi.mock("../../../queue.js", () => ({
  redis: {
    hset: vi.fn(async (key: string, fieldsOrField: unknown, value?: string) => {
      let h = fakeRedisStore.get(key)
      if (!h) {
        h = new Map()
        fakeRedisStore.set(key, h)
      }
      if (typeof fieldsOrField === "object" && fieldsOrField !== null) {
        for (const [f, v] of Object.entries(fieldsOrField as Record<string, string>)) {
          h.set(f, v)
        }
        return Object.keys(fieldsOrField as Record<string, string>).length
      }
      h.set(String(fieldsOrField), String(value ?? ""))
      return 1
    }),
    hgetall: vi.fn(async (key: string): Promise<Record<string, string>> => {
      const h = fakeRedisStore.get(key)
      return h ? Object.fromEntries(h.entries()) : {}
    }),
    expire: vi.fn(async () => 1),
    del: vi.fn(async (...keys: string[]) => {
      let n = 0
      for (const k of keys) {
        if (fakeRedisStore.delete(k)) n++
      }
      return n
    }),
  },
}))

vi.mock("../../../storage.js", () => ({
  s3: { send: (cmd: unknown) => s3Send(cmd) },
}))

const { registerUploadTools } = await import("../upload.js")

function writeSession() {
  return newSession({
    userId: "u1",
    scopes: ["assets:write"] as Scope[],
    clientName: "Claude",
  })
}

beforeEach(() => {
  fakeRedisStore.clear()
  s3Send.mockClear()
})

describe("upload_image_init / _chunk / _complete (chunked)", () => {
  it("end-to-end: init → 2 chunks → complete uploads to R2 and returns URL", async () => {
    const server = buildServer()
    registerUploadTools({ server, session: writeSession() })

    const initRes = await callTool(server, "upload_image_init", {
      mime_type: "image/jpeg",
    })
    expect(initRes.isError).toBeUndefined()
    const sc = initRes.structuredContent as Record<string, string>
    const uploadId = sc.upload_id
    expect(typeof uploadId).toBe("string")
    // Don't pin the host — config.R2_PUBLIC_URL is read from env and may be
    // empty or whatever the test env has. Just assert the path shape.
    expect(sc.public_url).toMatch(/\/uploads\/image\/u1\/[a-f0-9-]+\.jpg$/)

    // Two trivial chunks (raw bytes 0xAA + 0xBB), base64-encoded.
    const chunk1 = Buffer.from([0xaa, 0xaa, 0xaa]).toString("base64")
    const chunk2 = Buffer.from([0xbb, 0xbb]).toString("base64")

    const c1 = await callTool(server, "upload_image_chunk", {
      upload_id: uploadId,
      chunk_index: 1,
      data: chunk1,
    })
    expect(c1.isError).toBeUndefined()
    expect((c1.structuredContent as Record<string, number>).bytes).toBe(3)
    expect((c1.structuredContent as Record<string, number>).bytes_uploaded_total).toBe(3)

    const c2 = await callTool(server, "upload_image_chunk", {
      upload_id: uploadId,
      chunk_index: 2,
      data: chunk2,
    })
    expect(c2.isError).toBeUndefined()
    expect((c2.structuredContent as Record<string, number>).bytes_uploaded_total).toBe(5)

    const done = await callTool(server, "upload_image_complete", {
      upload_id: uploadId,
    })
    expect(done.isError).toBeUndefined()
    const doneSc = done.structuredContent as Record<string, unknown>
    expect(doneSc.bytes).toBe(5)
    expect(doneSc.mime_type).toBe("image/jpeg")
    expect(doneSc.public_url).toBe(sc.public_url)

    expect(s3Send).toHaveBeenCalledTimes(1)
    const putCmd = (s3Send.mock.calls[0] as unknown as [{ input: Record<string, unknown> }])[0]
    expect((putCmd.input.Key as string)).toMatch(/^uploads\/image\/u1\/[a-f0-9-]+\.jpg$/)
    expect((putCmd.input.Body as Buffer).length).toBe(5)
    expect(putCmd.input.ContentType).toBe("image/jpeg")
  })

  it("rejects out-of-order chunks", async () => {
    const server = buildServer()
    registerUploadTools({ server, session: writeSession() })

    const initRes = await callTool(server, "upload_image_init", {
      mime_type: "image/jpeg",
    })
    const uploadId = (initRes.structuredContent as Record<string, string>).upload_id

    // Skip chunk_index=1, send 2 first.
    const res = await callTool(server, "upload_image_chunk", {
      upload_id: uploadId,
      chunk_index: 2,
      data: Buffer.from([0x00]).toString("base64"),
    })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toMatch(/expected chunk_index=1/)
  })

  it("rejects unknown upload_id", async () => {
    const server = buildServer()
    registerUploadTools({ server, session: writeSession() })

    const res = await callTool(server, "upload_image_chunk", {
      upload_id: "00000000-0000-0000-0000-000000000000",
      chunk_index: 1,
      data: Buffer.from([0x00]).toString("base64"),
    })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toMatch(/Unknown or expired/)
  })

  it("rejects upload_id from a different user", async () => {
    // u1 inits.
    const serverA = buildServer()
    registerUploadTools({ server: serverA, session: writeSession() })
    const initRes = await callTool(serverA, "upload_image_init", {
      mime_type: "image/jpeg",
    })
    const uploadId = (initRes.structuredContent as Record<string, string>).upload_id

    // u2 tries to chunk.
    const serverB = buildServer()
    registerUploadTools({
      server: serverB,
      session: newSession({
        userId: "u2",
        scopes: ["assets:write"] as Scope[],
        clientName: "Claude",
      }),
    })
    const res = await callTool(serverB, "upload_image_chunk", {
      upload_id: uploadId,
      chunk_index: 1,
      data: Buffer.from([0x00]).toString("base64"),
    })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toMatch(/different user/)
  })

  it("rejects when chunk would exceed total-byte cap", async () => {
    const server = buildServer()
    registerUploadTools({ server, session: writeSession() })

    const initRes = await callTool(server, "upload_image_init", {
      mime_type: "image/jpeg",
    })
    const uploadId = (initRes.structuredContent as Record<string, string>).upload_id

    // Pretend we've already uploaded 100 MB (bypass the chunk path) by
    // editing the in-memory store directly. Then attempt one more chunk.
    const metaKey = `mcp:chunked:${uploadId}:meta`
    fakeRedisStore.get(metaKey)!.set("bytesUploaded", String(100 * 1024 * 1024))

    const res = await callTool(server, "upload_image_chunk", {
      upload_id: uploadId,
      chunk_index: 1,
      data: Buffer.from([0xff]).toString("base64"),
    })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toMatch(/exceed/)
  })

  it("complete with no chunks returns isError", async () => {
    const server = buildServer()
    registerUploadTools({ server, session: writeSession() })
    const initRes = await callTool(server, "upload_image_init", {
      mime_type: "image/jpeg",
    })
    const uploadId = (initRes.structuredContent as Record<string, string>).upload_id

    const res = await callTool(server, "upload_image_complete", { upload_id: uploadId })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toMatch(/No chunks/)
  })

  it("does NOT register chunked tools without assets:write scope", async () => {
    const server = buildServer()
    registerUploadTools({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["assets:read"] as Scope[],
        clientName: "Claude",
      }),
    })
    // Calling without registration should fail with the SDK's "unknown tool".
    await expect(
      callTool(server, "upload_image_init", { mime_type: "image/jpeg" }),
    ).rejects.toThrow()
  })
})
