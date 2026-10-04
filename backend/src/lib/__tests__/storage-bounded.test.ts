import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

// The REAL storage client (Track 0.12, decided 2026-10-04) against a local
// store that stalls: a call that gets no answer fails at the response bound,
// and a body we read that stops mid-stream fails at the body rule — instead
// of hanging forever, as both did before. The limits are shrunk so the test
// runs in seconds; the production numbers are pinned in storage-timeouts.test.ts.

const cfg = vi.hoisted(() => ({
  R2_ENDPOINT: "",
  R2_ACCOUNT_ID: "",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_REGION: "auto",
  R2_BUCKET_NAME: "bucket",
  R2_PUBLIC_URL: "https://cdn.example",
  R2_FORCE_PATH_STYLE: true,
  STORAGE_OBJECT_ACL: "",
}))
vi.mock("../config.js", () => ({ config: cfg }))
vi.mock("../../utils/file-validation.js", () => ({
  updateStorageUsage: vi.fn(), reserveStorageIfWithinLimit: vi.fn(), refundStorage: vi.fn(), getSizeLimit: vi.fn(),
}))
vi.mock("../storage-timeouts.js", async (original) => {
  const real = await original<typeof import("../storage-timeouts.js")>()
  return {
    ...real,
    boundedStorageClientConfig: () => ({ maxAttempts: 1, requestHandler: { connectionTimeout: 1_000, requestTimeout: 400, throwOnRequestTimeout: true } }),
    // A 10 B/s floor makes the 1000-byte size deadline the 5 s ceiling, so the rate rule is what trips.
    STORAGE_DOWNLOAD_LIMITS: { responseMs: 300, windowMs: 300, minBytesPerWindow: 100, floorBytesPerSec: 10, maxMs: 5_000 },
  }
})

let server: Server
let storage: typeof import("../storage.js")
let dir: string

/** Paths whose server-side socket has closed — a released connection. */
const closed = new Set<string>()
const routes: Record<string, (req: IncomingMessage, res: ServerResponse) => void> = {
  "/bucket/healthy.bin": (_req, res) => { res.writeHead(200, { "Content-Length": "5" }); res.end("hello") },
  "/bucket/stalls.bin": (_req, res) => { res.writeHead(200, { "Content-Length": "1000" }); res.write(Buffer.alloc(10)) },
  // A full-object checksum makes the SDK wrap the body (ChecksumStream):
  // destroying only the wrapper would leave this connection open.
  "/bucket/stalls-checksum.bin": (req, res) => {
    req.socket.once("close", () => closed.add("stalls-checksum.bin"))
    res.writeHead(200, { "Content-Length": "1000", "x-amz-checksum-crc32": "AAAAAA==" })
    res.write(Buffer.alloc(10))
  },
  "/bucket/silent.bin": () => { /* never answers */ },
}

beforeAll(async () => {
  server = createServer((req, res) => (routes[(req.url ?? "").split("?")[0]!] ?? ((_q, r) => { r.writeHead(404); r.end() }))(req, res))
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cfg.R2_ENDPOINT = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  storage = await import("../storage.js")
  dir = await mkdtemp(join(tmpdir(), "storage-bounded-"))
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(dir, { recursive: true, force: true })
})

describe("the storage client is bounded (Track 0.12)", () => {
  it("reads a healthy object as before", async () => {
    await storage.downloadR2ObjectToFile("healthy.bin", join(dir, "healthy.bin"))
    expect(await readFile(join(dir, "healthy.bin"), "utf8")).toBe("hello")
    expect((await storage.readR2Object("healthy.bin"))?.body.toString()).toBe("hello")
  })

  it("a body that stops mid-stream fails at the body rule, naming the limit and the key", async () => {
    await expect(storage.downloadR2ObjectToFile("stalls.bin", join(dir, "stalls.bin")))
      .rejects.toThrow(/^Download timeout: too slow — \d+ bytes in the last 0 s, under the 100 minimum: r2 object stalls\.bin$/)
  }, 10_000)

  it("a tripped body releases its connection — even behind the SDK's checksum wrapper", async () => {
    await expect(storage.downloadR2ObjectToFile("stalls-checksum.bin", join(dir, "stalls-checksum.bin"))).rejects.toThrow(/^Download timeout:/)
    const deadline = Date.now() + 2_000
    while (!closed.has("stalls-checksum.bin") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25))
    expect(closed.has("stalls-checksum.bin")).toBe(true)
  }, 10_000)

  it("readR2Object reads a stalled body as not present (its contract for any failure)", async () => {
    expect(await storage.readR2Object("stalls.bin")).toBeNull()
  }, 10_000)

  it("a call that gets no answer fails at the response bound", async () => {
    const started = Date.now()
    await expect(storage.downloadR2ObjectToFile("silent.bin", join(dir, "silent.bin"))).rejects.toMatchObject({ name: "TimeoutError" })
    expect(Date.now() - started).toBeLessThan(3_000)
    // getR2ObjectSize's contract: 0 on any error — now it returns instead of hanging.
    expect(await storage.getR2ObjectSize("silent.bin")).toBe(0)
  }, 10_000)
})
