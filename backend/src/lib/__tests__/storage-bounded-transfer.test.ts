import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest"
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { Readable } from "node:stream"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { storageTransferOptions } from "../storage-timeouts.js"

// Track 0.12's guarantees that a stall test cannot show, on the REAL storage
// client with its REAL retry count (storage-bounded.test.ts pins one attempt):
//  - a PUT whose answer comes after the flat response bound survives when it is
//    given its size-scaled budget — the response comes AFTER the body, so
//    `requestTimeout` is a total timer for a write, and only the per-call
//    option (`storageTransferOptions`) keeps a slow upload alive;
//  - a body that trickles in above the floor is read to its end — the handler's
//    timers are cleared at the headers, so only the body rule bounds it;
//  - a stalled call is retried (3 attempts, then it gives up) and a stream
//    body is never replayed.
// Only the SOURCE constants are shrunk, so the production formulas run: a 400 ms
// answer bound, and 1000 B/s as the floor a transfer is budgeted at.

vi.mock("../../providers/video/ffmpeg-timeouts.js", async (original) => ({
  ...(await original<typeof import("../../providers/video/ffmpeg-timeouts.js")>()),
  DOWNLOAD_TIMEOUT_MS: 400,
  DOWNLOAD_RATE_WINDOW_MS: 300,
  DOWNLOAD_MIN_BYTES_PER_WINDOW: 100,
  DOWNLOAD_FLOOR_BYTES_PER_SEC: 1_000,
  DOWNLOAD_MAX_MS: 5_000,
}))

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

let server: Server
let storage: typeof import("../storage.js")
let dir: string

const hits: Record<string, number> = {}
const ANSWER_AFTER_MS = 900 // longer than the 400 ms flat bound, shorter than a 3000-byte budget (3 s)
const TRICKLE_BYTES = 2_000

const routes: Record<string, (req: IncomingMessage, res: ServerResponse, hit: number) => void> = {
  // Takes the whole body, then answers late: the shape of a slow upload.
  "/bucket/slow-put.bin": (req, res) => {
    req.resume()
    req.on("end", () => setTimeout(() => { res.writeHead(200); res.end() }, ANSWER_AFTER_MS))
  },
  "/bucket/slow-stream.bin": (req, res) => {
    req.resume()
    req.on("end", () => { res.writeHead(200); res.end() })
  },
  "/bucket/silent-stream.bin": () => { /* never answers */ },
  // 2400 bytes at 1600 B/s: 1.5 s in all — nearly four times the 400 ms flat bound — but above the 1000 B/s floor.
  "/bucket/trickle.bin": (_req, res) => {
    res.writeHead(200, { "Content-Length": "2400" })
    let sent = 0
    const timer = setInterval(() => {
      res.write(Buffer.alloc(40, 7))
      sent += 40
      if (sent >= 2400) { clearInterval(timer); res.end() }
    }, 25)
    res.on("close", () => clearInterval(timer))
  },
  // The first call is never answered; the second is.
  "/bucket/flaky.bin": (_req, res, hit) => { if (hit >= 2) { res.writeHead(200, { "Content-Length": "5" }); res.end() } },
  "/bucket/dead.bin": () => { /* never answers */ },
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0]!
    hits[path] = (hits[path] ?? 0) + 1
    ;(routes[path] ?? ((_q, r) => { r.writeHead(404); r.end() }))(req, res, hits[path]!)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cfg.R2_ENDPOINT = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  storage = await import("../storage.js")
  dir = await mkdtemp(join(tmpdir(), "storage-transfer-"))
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(dir, { recursive: true, force: true })
})
beforeEach(() => { for (const k of Object.keys(hits)) delete hits[k] })

/** A body that arrives in `chunks` pieces, one every `everyMs` — slow, but moving. */
function trickle(chunks: number, size: number, everyMs: number): Readable {
  let n = 0
  return new Readable({
    read() {
      setTimeout(() => { this.push(++n > chunks ? null : Buffer.alloc(size, 1)) }, everyMs)
    },
  })
}

const putCommand = (key: string, body: Buffer | Readable, length: number) =>
  new PutObjectCommand({ Bucket: "bucket", Key: key, Body: body, ContentLength: length })

describe("a slow but progressing transfer survives (Track 0.12)", () => {
  it("an upload answered after the flat bound finishes with its size-scaled budget, and dies without it", async () => {
    const buffer = Buffer.alloc(3_000, 1)
    // uploadBufferToR2 hands the SDK its per-call budget (3000 B at 1000 B/s = 3 s).
    await expect(storage.uploadBufferToR2(buffer, "slow-put.bin", "application/octet-stream")).resolves.toContain("slow-put.bin")
    expect(hits["/bucket/slow-put.bin"]).toBe(1)

    // The same PUT on the flat default: the client gives up (and retries) before the answer.
    hits["/bucket/slow-put.bin"] = 0
    await expect(storage.s3.send(putCommand("slow-put.bin", buffer, buffer.length))).rejects.toMatchObject({ name: "TimeoutError" })
    expect(hits["/bucket/slow-put.bin"]).toBe(3)
  }, 15_000)

  it("a stream upload that trickles above the floor finishes with the budget, and dies on the flat bound without it", async () => {
    // 2000 B in 1.25 s: three times the flat bound, well inside its 2 s budget.
    await expect(storage.s3.send(
      putCommand("slow-stream.bin", trickle(50, 40, 25), TRICKLE_BYTES), storageTransferOptions(TRICKLE_BYTES),
    )).resolves.toBeDefined()
    expect(hits["/bucket/slow-stream.bin"]).toBe(1)

    hits["/bucket/slow-stream.bin"] = 0
    await expect(storage.s3.send(putCommand("slow-stream.bin", trickle(50, 40, 25), TRICKLE_BYTES)))
      .rejects.toMatchObject({ name: "TimeoutError" })
  }, 15_000)

  it("a body that trickles in above the floor is read to its end, past the flat bound", async () => {
    const started = Date.now()
    await storage.downloadR2ObjectToFile("trickle.bin", join(dir, "trickle.bin"))
    expect(Date.now() - started).toBeGreaterThan(1_200) // three flat bounds: the handler bound is not on the body
    expect((await readFile(join(dir, "trickle.bin"))).length).toBe(2400)
    expect(hits["/bucket/trickle.bin"]).toBe(1)
  }, 15_000)
})

describe("retries on the real client (Track 0.12)", () => {
  it("a call whose first attempt stalls is retried and succeeds", async () => {
    expect(await storage.getR2ObjectSize("flaky.bin")).toBe(5)
    expect(hits["/bucket/flaky.bin"]).toBe(2)
  }, 15_000)

  it("a store that never answers is tried three times, then the call fails", async () => {
    expect(await storage.getR2ObjectSize("dead.bin")).toBe(0)
    expect(hits["/bucket/dead.bin"]).toBe(3)
  }, 15_000)

  it("a stream body is never replayed — one attempt, then the timeout", async () => {
    await expect(storage.s3.send(putCommand("silent-stream.bin", trickle(3, 10, 10), 30)))
      .rejects.toBeDefined()
    expect(hits["/bucket/silent-stream.bin"]).toBe(1)
  }, 15_000)
})
