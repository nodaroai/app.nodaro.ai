import { describe, it, expect, vi } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { PassThrough, Readable } from "node:stream"
import {
  STORAGE_CONNECT_TIMEOUT_MS,
  STORAGE_DOWNLOAD_LIMITS,
  STORAGE_HANDLER_OPTIONS,
  STORAGE_MAX_ATTEMPTS,
  STORAGE_MAX_SOCKETS,
  STORAGE_RESPONSE_TIMEOUT_MS,
  boundedStorageClientConfig,
  guardStorageReadBody,
  storageTransferTimeoutMs,
} from "../storage-timeouts.js"

// Track 0.12 (decided 2026-10-04): the storage client's bounds — the decided
// numbers, the live client built from them, and a census that fails the build
// for a client or a write that skips them.

vi.mock("../config.js", () => ({ config: {
  R2_ENDPOINT: "http://127.0.0.1:1", R2_ACCOUNT_ID: "", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s",
  R2_REGION: "auto", R2_BUCKET_NAME: "b", R2_PUBLIC_URL: "https://cdn.example", R2_FORCE_PATH_STYLE: true, STORAGE_OBJECT_ACL: "",
} }))
vi.mock("../../utils/file-validation.js", () => ({
  updateStorageUsage: vi.fn(), reserveStorageIfWithinLimit: vi.fn(), refundStorage: vi.fn(), getSizeLimit: vi.fn(),
}))

const MB = 1024 * 1024

describe("the decided numbers (match the big-media downloads, decided 2026-10-04)", () => {
  it("connect 10 s, answer within 120 s, the warning turned into an error; 3 attempts; a 256-connection pool that warns when full", () => {
    expect(STORAGE_HANDLER_OPTIONS).toEqual({
      connectionTimeout: 10_000, requestTimeout: 120_000, throwOnRequestTimeout: true,
      socketAcquisitionWarningTimeout: 5_000,
      httpAgent: { maxSockets: 256 }, httpsAgent: { maxSockets: 256 },
    })
    expect(STORAGE_MAX_ATTEMPTS).toBe(3)
  })
  it("every client gets its own copy of the options (so its own pool)", () => {
    const a = boundedStorageClientConfig(), b = boundedStorageClientConfig()
    expect(a).toEqual(b)
    expect(a.requestHandler).not.toBe(b.requestHandler)
    expect(a.requestHandler.httpsAgent).not.toBe(b.requestHandler.httpsAgent)
  })
  it("a known-size transfer gets its size at 2 MB/s, never under 120 s", () => {
    expect(storageTransferTimeoutMs(undefined)).toBe(120_000)
    expect(storageTransferTimeoutMs(100 * MB)).toBe(120_000) // 50 s at the floor → the 120 s minimum
    expect(storageTransferTimeoutMs(1024 * MB)).toBe(512_000)
  })
  it("a body we read: the big-media rule", () => {
    expect(STORAGE_DOWNLOAD_LIMITS).toEqual({ responseMs: 120_000, windowMs: 60_000, minBytesPerWindow: 15 * MB, floorBytesPerSec: 2 * MB, maxMs: 3_600_000 })
  })
})

describe("the live storage clients are built from them", () => {
  type Handler = { configProvider: Promise<Record<string, unknown> & { httpsAgent?: { maxSockets?: number } }> }
  it("both handlers resolve to the decided bounds, with no socket timeout (a paused viewer is not a stall)", async () => {
    const { s3, viewerS3 } = await import("../storage.js")
    for (const client of [s3, viewerS3]) {
      const resolved = await (client.config.requestHandler as unknown as Handler).configProvider
      expect(resolved.connectionTimeout).toBe(STORAGE_CONNECT_TIMEOUT_MS)
      expect(resolved.requestTimeout).toBe(STORAGE_RESPONSE_TIMEOUT_MS)
      expect(resolved.throwOnRequestTimeout).toBe(true)
      expect(resolved.socketTimeout).toBeUndefined()
      expect(resolved.httpsAgent?.maxSockets).toBe(STORAGE_MAX_SOCKETS)
      expect(await (client.config.maxAttempts as () => Promise<number>)()).toBe(STORAGE_MAX_ATTEMPTS)
    }
  })
  it("viewer streams have their own client — their own pool, so they cannot starve job I/O (decided 2026-10-04)", async () => {
    const { s3, viewerS3 } = await import("../storage.js")
    expect(viewerS3).not.toBe(s3)
    expect(viewerS3.config.requestHandler).not.toBe(s3.config.requestHandler)
  })
})

describe("guardStorageReadBody — a body the app reads", () => {
  const read = async (stream: Readable) => { const out: Buffer[] = []; for await (const c of stream) out.push(c as Buffer); return Buffer.concat(out) }
  it("passes a healthy body through and leaves the request alone", async () => {
    const controller = new AbortController()
    const body = Readable.from([Buffer.from("he"), Buffer.from("llo")])
    expect((await read(guardStorageReadBody(body, { sizeBytes: 5, startedAt: Date.now(), label: "k", controller }))).toString()).toBe("hello")
    expect(controller.signal.aborted).toBe(false)
  })
  it("a reader that gives up early releases the source AND aborts the request (the connection)", async () => {
    const controller = new AbortController()
    const source = new PassThrough()
    const guarded = guardStorageReadBody(source, { startedAt: Date.now(), label: "k", controller })
    source.write("partial")
    const closedOnce = new Promise((resolve) => guarded.once("close", resolve))
    guarded.destroy()
    await closedOnce
    expect(source.destroyed).toBe(true)
    expect(controller.signal.aborted).toBe(true)
  })
  it("a body destroyed with an error while nobody reads it does not crash the process", async () => {
    const source = new PassThrough()
    const guarded = guardStorageReadBody(source, { startedAt: Date.now(), label: "k", controller: new AbortController() })
    const closed = new Promise((resolve) => guarded.once("close", resolve))
    source.destroy(new Error("cancelled before the read loop"))
    await closed // an uncaught 'error' would fail this run as an unhandled error
    expect(guarded.destroyed).toBe(true)
  })

  it("a tripped limit errors the stream, destroys the source and aborts the request", async () => {
    const controller = new AbortController()
    const source = new PassThrough()
    const guarded = guardStorageReadBody(source, {
      startedAt: Date.now(), label: "r2 object k", controller,
      limits: { responseMs: 10, windowMs: 20, minBytesPerWindow: 1_000, floorBytesPerSec: 1, maxMs: 5_000 },
    })
    await expect(read(guarded)).rejects.toThrow(/^Download timeout: too slow — 0 bytes in the last 0 s, under the 1000 minimum: r2 object k$/)
    expect(source.destroyed).toBe(true)
    expect(controller.signal.aborted).toBe(true)
  })
})

// --- Census -----------------------------------------------------------------

const SRC = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..")

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sources(path)
    return path.endsWith(".ts") && !path.endsWith(".test.ts") && !path.endsWith(".d.ts") ? [path] : []
  })
}

/** The text of the call whose "(" is at `open`, through its matching ")". */
function callText(src: string, open: number): string {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++
    else if (src[i] === ")" && --depth === 0) return src.slice(open, i + 1)
  }
  return src.slice(open)
}

/** Every call matching `head` in code — a match on a comment line (prose that
 *  quotes the pattern) is not a call. */
function calls(src: string, head: RegExp): string[] {
  const out: string[] = []
  for (const m of src.matchAll(head)) {
    const line = src.slice(src.lastIndexOf("\n", m.index!) + 1, m.index!).trim()
    if (line.startsWith("*") || line.startsWith("//") || line.startsWith("/*")) continue
    out.push(callText(src, m.index! + m[0].length - 1))
  }
  return out
}

describe("census — no storage client or write skips the bounds", () => {
  const files = sources(SRC).map((path) => ({ label: relative(SRC, path), src: readFileSync(path, "utf8") }))

  it("every new S3Client(...) spreads boundedStorageClientConfig()", () => {
    const unbounded: string[] = []
    let clients = 0
    for (const { label, src } of files) {
      for (const call of calls(src, /new S3Client\(/g)) {
        clients++
        // storage.ts builds its two clients from one factory that spreads it.
        const viaFactory = label === "lib/storage.ts" && call === "(storageClientOptions())"
          && /function storageClientOptions\(\)[\s\S]*?\.\.\.boundedStorageClientConfig\(\)/.test(src)
        if (!call.includes("...boundedStorageClientConfig()") && !viaFactory) unbounded.push(label)
      }
    }
    expect(unbounded, "an S3Client without the storage bounds can hang forever (lib/storage-timeouts.ts)").toEqual([])
    expect(clients).toBeGreaterThanOrEqual(6)
  })

  // What the scan below cannot see, refused outright so it never has to: an
  // aliased S3Client import (`new X(` would slip past) and the aggregated
  // `S3` client. A command built in a variable before `.send(cmd)` is the one
  // shape it still misses — keep writes inline, as every site does today.
  it("no aliased S3Client import and no aggregated S3 client", () => {
    const offenders = files.filter(({ src }) =>
      /S3Client\s+as\s+\w+/.test(src) || /\bnew S3\(/.test(src) || /import\s*\{[^}]*\bS3\b[^}]*\}\s*from\s*"@aws-sdk\/client-s3"/.test(src))
    expect(offenders.map((f) => f.label)).toEqual([])
  })

  it("every GetObject the storage module sends is a guarded app read or a viewer's stream", () => {
    const src = files.find((f) => f.label === "lib/storage.ts")!.src
    const sends = calls(src, /\.send\(/g).filter((c) => c.includes("new GetObjectCommand("))
    const guardedReads = (src.match(/guardStorageReadBody\(/g) ?? []).length
    const viewerSends = (src.match(/viewerS3\.send\(/g) ?? []).length
    expect(sends.length).toBe(guardedReads + viewerSends)
    expect(viewerSends).toBe(1) // streamR2Object
  })

  it("every Scene3D private-store read the app consumes goes through readScene3DObjectForApp", () => {
    // Only the viewer's ranged stream (read.ts) and the helper itself call get().
    const allowed = new Set(["services/scene3d-artifacts/read.ts", "services/scene3d-artifacts/app-read.ts"])
    const raw = files.filter(({ label, src }) =>
      !allowed.has(label) && /Scene3DObjectStore/.test(src) && /\bstore\.get\(/.test(src))
    expect(raw.map((f) => f.label)).toEqual([])
  })

  it("every send of a PutObject or CopyObject carries a size-scaled budget (or its own total abort)", () => {
    const unscaled: string[] = []
    let writes = 0
    for (const { label, src } of files) {
      for (const call of calls(src, /\.send\(/g)) {
        if (!/new (PutObjectCommand|CopyObjectCommand)\(/.test(call)) continue
        writes++
        if (!call.includes("storageTransferOptions(") && !call.includes("AbortSignal.timeout(")) unscaled.push(label)
      }
    }
    expect(unscaled, "a write's response comes after its body — give it storageTransferOptions(bytes)").toEqual([])
    expect(writes).toBeGreaterThanOrEqual(10)
  })
})

describe("readScene3DObjectForApp — a private-store body the app reads", () => {
  it("is guarded, and its timeout error never names the private object key", async () => {
    const { readScene3DObjectForApp } = await import("../../services/scene3d-artifacts/app-read.js")
    const source = new PassThrough()
    const get = vi.fn().mockResolvedValue({ body: source, contentLength: 1_000, etag: null })
    const key = "scene3d/owner-uuid/revision-uuid/artifact.glb"
    const read = await readScene3DObjectForApp({ bucket: "private", get, delete: vi.fn() }, key, {
      limits: { responseMs: 10, windowMs: 20, minBytesPerWindow: 1_000, floorBytesPerSec: 1, maxMs: 5_000 },
    })
    expect(get).toHaveBeenCalledWith(key, undefined, { signal: expect.any(AbortSignal) })
    const err = await (async () => { try { for await (const _ of read.body) { /* stalls */ } } catch (e) { return e as Error } })()
    expect(err?.message).toMatch(/^Download timeout: too slow — .*: a private scene object$/)
    expect(err?.message).not.toContain("owner-uuid")
    expect(source.destroyed).toBe(true)
    expect((get.mock.calls[0]![2] as { signal: AbortSignal }).signal.aborted).toBe(true)
  })
})
