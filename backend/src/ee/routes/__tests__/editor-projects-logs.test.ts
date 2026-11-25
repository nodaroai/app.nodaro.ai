import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify from "fastify"
import { gzipSync } from "node:zlib"
import { Readable } from "node:stream"
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3"

/**
 * What the editor-project routes log: never a storage key, a user or project
 * id, or a content hash — through the REAL private-bucket adapter
 * (ee/lib/editor-projects/bucket.ts), against a client that fails the way the
 * AWS SDK does: an exception carrying every field of the store's error body
 * (`Key`, `BucketName`, `Resource`) and `$metadata`.
 */

const sdk = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
  fail: null as null | ((command: unknown) => boolean),
  /** A GET whose body sends one chunk, then fails with an SDK-shaped error (mid-stream). */
  failMidStream: false,
}))

vi.mock("@/lib/supabase.js", async () => ({ supabase: (await import("./editor-projects-fakes.js")).fakeSupabase }))
vi.mock("@/ee/lib/editor-projects/bucket.js", async (original) => {
  const real = await original<typeof import("../../lib/editor-projects/bucket.js")>()
  /** What S3 and MinIO-style stores raise: the error body's fields copied onto the exception. */
  const sdkError = (key: string) =>
    Object.assign(new Error(`We encountered an internal error for ${key}`), {
      name: "InternalError",
      Code: "InternalError",
      Key: key,
      BucketName: "private-projects",
      Resource: `/private-projects/${key}`,
      RequestId: "req-1",
      $fault: "server",
      $metadata: { httpStatusCode: 500, requestId: "req-1", attempts: 1 },
    })
  const client = {
    send: async (command: unknown) => {
      const key = (command as { input: { Key: string } }).input.Key
      if (sdk.fail?.(command)) throw sdkError(key)
      if (command instanceof PutObjectCommand) {
        sdk.objects.set(key, Buffer.from(command.input.Body as Buffer))
        return {}
      }
      if (command instanceof HeadObjectCommand || command instanceof GetObjectCommand) {
        const body = sdk.objects.get(key)
        if (!body) throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } })
        if (command instanceof GetObjectCommand && sdk.failMidStream) {
          const broken = new Readable({ read() {} })
          broken.push(body.subarray(0, 4))
          setImmediate(() => broken.destroy(sdkError(key)))
          return { Body: broken, ContentLength: body.length }
        }
        return command instanceof HeadObjectCommand ? {} : { Body: Readable.from([body]), ContentLength: body.length }
      }
      if (command instanceof DeleteObjectCommand) {
        sdk.objects.delete(key)
        return {}
      }
      throw new Error("unexpected command")
    },
  } as unknown as S3Client
  const store = real.createEditorProjectsStore(
    { bucket: "private-projects", endpoint: "https://private", region: "auto", accessKeyId: "k", secretAccessKey: "s", forcePathStyle: false },
    "media-bucket",
    client,
  )
  return { ...real, editorProjectsStore: () => store }
})

import { db, seedProject } from "./editor-projects-fakes.js"
import { editorProjectRoutes } from "../editor-projects.js"
import { canonicalJson, contentHash } from "../../lib/editor-projects/canonical.js"

const ME = "00000000-0000-4000-8000-000000000001"
const TAB = "tab-aaaa-1111"

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  db.reset()
  sdk.objects.clear()
  sdk.fail = null
  sdk.failMidStream = false
})

describe("what the editor-project routes log", () => {
  it("never a storage key, a user or project id, or a hash — even when storage fails with a full SDK exception", async () => {
    const lines: string[] = []
    const app = Fastify({ logger: { level: "trace", stream: { write: (line: string) => void lines.push(line) } } })
    app.addHook("preHandler", async (req) => {
      req.userId = ME
    })
    await app.register(editorProjectRoutes)
    await app.ready()
    const p = seedProject({ user_id: ME, holder_id: TAB, holder_seen_at: new Date().toISOString() })
    const hashes: string[] = []
    const put = (value: unknown) => {
      const text = canonicalJson(value)
      const hash = contentHash(text)
      hashes.push(hash)
      return app.inject({
        method: "PUT", url: `/v1/editor-projects/${p.id}/file`, payload: gzipSync(text),
        headers: { "content-type": "application/gzip", "x-holder": TAB, "x-content-hash": hash },
      })
    }
    expect((await put({ v: 1 })).statusCode).toBe(200)
    const keys = [p.blob_key!]

    // A failed delete of the replaced file, a failed write, a failed read, a failed head.
    sdk.fail = (c) => c instanceof DeleteObjectCommand
    expect((await put({ v: 2 })).statusCode).toBe(200)
    keys.push(p.blob_key!)
    sdk.fail = (c) => c instanceof PutObjectCommand
    expect((await put({ v: 3 })).statusCode).toBe(500)
    sdk.fail = (c) => c instanceof GetObjectCommand
    expect((await app.inject({ method: "GET", url: `/v1/editor-projects/${p.id}/file` })).statusCode).toBe(500)
    sdk.fail = (c) => c instanceof HeadObjectCommand
    expect((await put({ v: 2 })).statusCode).toBe(500)
    // A read that fails mid-stream, while the reply is being sent.
    sdk.fail = null
    sdk.failMidStream = true
    const lineCount = lines.length
    const midStream: string[] = []
    await app.inject({ method: "GET", url: `/v1/editor-projects/${p.id}/file` }).catch(() => undefined)
    sdk.failMidStream = false
    expect(lines.length).toBeGreaterThan(lineCount)
    midStream.push(...lines.slice(lineCount))
    // A database failure too.
    sdk.fail = null
    db.saveError = { code: "XX000", message: "the database failed" }
    expect((await put({ v: 4 })).statusCode).toBe(500)
    await app.close()
    // The mid-stream failure reached the log, as the sanitized error only.
    expect(midStream.some((l) => l.includes("StorageOperationError") && l.includes('"operation":"stream"'))).toBe(true)

    const appLines = lines.filter((l) => !l.includes('"msg":"incoming request"') && !l.includes('"msg":"request completed"'))
    expect(appLines.some((l) => l.includes("StorageOperationError"))).toBe(true)
    expect(appLines.some((l) => l.includes("file delete failed"))).toBe(true)
    for (const line of appLines) {
      expect(line).not.toContain(`editor-projects/${ME}`)
      expect(line).not.toContain("private-projects")
      expect(line).not.toContain(p.id)
      expect(line).not.toContain(ME)
      for (const key of keys) expect(line).not.toContain(key)
      for (const hash of hashes) expect(line).not.toContain(hash)
    }
  })

  it("never a key, an id or a hash when versions fail: a cut after a save, an unreadable version, a failed thinning", async () => {
    const lines: string[] = []
    const app = Fastify({ logger: { level: "trace", stream: { write: (line: string) => void lines.push(line) } } })
    app.addHook("preHandler", async (req) => {
      req.userId = ME
    })
    await app.register(editorProjectRoutes)
    await app.ready()
    const p = seedProject({ user_id: ME, holder_id: TAB, holder_seen_at: new Date().toISOString() })
    const hashes: string[] = []
    const put = (value: unknown, headers: Record<string, string> = {}) => {
      const text = canonicalJson(value)
      const hash = contentHash(text)
      hashes.push(hash)
      return app.inject({
        method: "PUT", url: `/v1/editor-projects/${p.id}/file`, payload: gzipSync(text),
        headers: { "content-type": "application/gzip", "x-holder": TAB, "x-content-hash": hash, ...headers },
      })
    }
    // A user's cuts are counted per minute (30): the clock moves on with each cut.
    vi.useFakeTimers({ toFake: ["Date"] })
    const cut = async () => {
      const res = await app.inject({ method: "POST", url: `/v1/editor-projects/${p.id}/versions`, payload: { label: "Edit", author: "you", holder: TAB } })
      vi.setSystemTime(Date.now() + 2_100)
      return res
    }
    const isVersionPut = (c: unknown) => c instanceof PutObjectCommand && /\/v-[0-9a-f-]{36}\.json\.gz$/.test((c as PutObjectCommand).input.Key ?? "")

    // A save whose version cut fails at storage: the save stands, the failure is logged.
    sdk.fail = isVersionPut
    const saved = await put({ v: 1 }, { "x-cut-version": "Rough cut" })
    expect(saved.statusCode).toBe(200)
    expect(saved.json()).toEqual({ revision: 1, saved: true })
    sdk.fail = null
    // A version, then its file corrupted: version_unreadable.
    expect((await cut()).json()).toEqual({ number: 1 })
    const versionKey = db.versions[0]!.blob_key
    sdk.objects.set(versionKey, gzipSync('{"v":9}'))
    const unreadable = await app.inject({ method: "GET", url: `/v1/editor-projects/${p.id}/file?version=1` })
    expect(unreadable.json()).toEqual({ error: "version_unreadable" })
    // 50 versions, then a cut whose thinning cannot delete the oldest file, and one whose row delete fails.
    for (let i = 2; i <= 50; i++) {
      expect((await put({ v: i })).statusCode).toBe(200)
      expect((await cut()).statusCode).toBe(200)
    }
    const keys = [...sdk.objects.keys()]
    sdk.fail = (c) => c instanceof DeleteObjectCommand && /\/v-/.test((c as DeleteObjectCommand).input.Key ?? "")
    expect((await put({ v: 51 })).statusCode).toBe(200)
    expect((await cut()).json()).toEqual({ number: 51 })
    sdk.fail = null
    db.versionDeleteError = { code: "08006", message: `connection lost while deleting ${versionKey}` }
    expect((await put({ v: 52 })).statusCode).toBe(200)
    expect((await cut()).json()).toEqual({ number: 52 })
    db.versionDeleteError = null
    // An insert refused by a check: the database's text quotes the failing row.
    expect((await put({ v: 53 })).statusCode).toBe(200)
    db.versionInsertError = Object.assign(
      { code: "23514", message: `new row for relation "editor_project_versions" violates check constraint` },
      { details: `Failing row contains (${p.id}, 53, Edit, you, full, null, ${hashes[hashes.length - 1]}, 10, ${versionKey}).` },
    )
    expect((await cut()).statusCode).toBe(500)
    // And one whose outcome is unknown, the same way.
    db.versionInsertError = { code: "08006", message: `connection lost inserting ${versionKey} for ${p.id}` }
    expect((await cut()).statusCode).toBe(500)
    await app.close()

    const appLines = lines.filter((l) => !l.includes('"msg":"incoming request"') && !l.includes('"msg":"request completed"'))
    expect(appLines.some((l) => l.includes("was not cut; the save stands"))).toBe(true)
    expect(appLines.some((l) => l.includes("version_unreadable"))).toBe(true)
    expect(appLines.some((l) => l.includes("file delete failed"))).toBe(true)
    expect(appLines.some((l) => l.includes("thinning versions failed") && l.includes('"code":"08006"'))).toBe(true)
    expect(appLines.some((l) => l.includes("version insert failed (23514)"))).toBe(true)
    for (const line of appLines) {
      expect(line).not.toContain(`editor-projects/${ME}`)
      expect(line).not.toContain("private-projects")
      expect(line).not.toContain(p.id)
      expect(line).not.toContain(ME)
      expect(line).not.toContain("connection lost")
      expect(line).not.toContain("Failing row")
      for (const key of keys) expect(line).not.toContain(key)
      for (const hash of hashes) expect(line).not.toContain(hash)
    }
  })
})
