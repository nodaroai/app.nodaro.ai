/**
 * `downloadFile`'s DEFAULT path (no big-media limits) against a REAL local
 * HTTP server and real streams, at small test limits. Only the SSRF guard is
 * replaced (it refuses a loopback server by design) by plain `fetch` honouring
 * the same signal and backstop timer.
 *
 * The flat 120 s used to reach the response only: the signal went to the
 * fetch, not to the stream writing the body, and once garbage collection had
 * run a trickling body kept arriving past the limit. The limit is now real for
 * the body, and sized so a slow-but-steady file still arrives.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { AddressInfo } from "node:net"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { setFlagsFromString } from "node:v8"
import { runInNewContext } from "node:vm"

/** When set, `safeFetch` answers with this instead of fetching. */
const stub = vi.hoisted(() => ({ respond: undefined as undefined | (() => Response) }))

vi.mock("../../../lib/safe-fetch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/safe-fetch.js")>()),
  safeFetch: (url: string, init: { timeoutMs?: number; signal?: AbortSignal; headers?: Record<string, string> }) => {
    if (stub.respond) return Promise.resolve(stub.respond())
    const signals = [init.signal, init.timeoutMs ? AbortSignal.timeout(init.timeoutMs) : undefined].filter(Boolean) as AbortSignal[]
    return fetch(url, { signal: AbortSignal.any(signals), headers: init.headers })
  },
}))

// Test limits: respond within 400 ms and nothing judged before then; every
// 400 ms window after it must deliver ≥ 128 B; a known size arrives at
// ≥ 1 kB/s; nothing lasts past 4 s.
vi.mock("../ffmpeg-timeouts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ffmpeg-timeouts.js")>()),
  DOWNLOAD_TIMEOUT_MS: 400,
  DEFAULT_DOWNLOAD_RATE_WINDOW_MS: 400,
  DEFAULT_DOWNLOAD_MIN_BYTES_PER_WINDOW: 128,
  DEFAULT_DOWNLOAD_FLOOR_BYTES_PER_SEC: 1024,
  DEFAULT_DOWNLOAD_MAX_MS: 4_000,
}))

const { downloadFile, DEFAULT_DOWNLOAD_LIMITS } = await import("../ffmpeg-utils.js")

/** A real collector runs throughout (the reported case kept streaming only
 *  after one ran). Whether a collection strands a fetch-only abort depends on
 *  the runtime, so this cannot reproduce the old failure on demand: that the
 *  one signal reaches the body pipeline is asserted in `ffmpeg-utils.test.ts`;
 *  this file holds the limits themselves on real streams. */
setFlagsFromString("--expose-gc")
const gc = runInNewContext("gc") as () => void

const CHUNK = Buffer.alloc(64, 7)
type Route = (res: ServerResponse, req: IncomingMessage) => void
const routes = new Map<string, Route>()
let server: Server
let base = ""
let dir = ""
const closedAt = new Map<string, number>()
const trackClose = (route: string, res: ServerResponse) => {
  closedAt.set(route, 0)
  res.on("close", () => closedAt.set(route, Date.now()))
}

/** Write `count` chunks of `chunk`, one every `everyMs`, then end. */
function trickle(res: ServerResponse, count: number, everyMs: number, opts: { length?: number; chunk?: Buffer } = {}) {
  const chunk = opts.chunk ?? CHUNK
  res.writeHead(200, opts.length ? { "content-length": String(opts.length) } : {})
  let sent = 0
  const t = setInterval(() => {
    if (res.destroyed) return clearInterval(t)
    res.write(chunk)
    if (++sent === count) { clearInterval(t); res.end() }
  }, everyMs)
}

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "download-default-limits-"))
  server = createServer((req, res) => routes.get(req.url ?? "")?.(res, req))
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  // No size, 64 B per 100 ms (256 B per window) for 2 s — five times the
  // response limit, above the minimum rate: slow but steady.
  routes.set("/steady", (res) => trickle(res, 20, 100))
  // Announces 3060 B (about 3 s at the 1 kB/s floor) and sends 2 kB/s: a
  // large file that arrives steadily, well past the 400 ms grace.
  routes.set("/steady-known", (res) => trickle(res, 15, 100, { length: 15 * 204, chunk: Buffer.alloc(204, 1) }))
  // A little, then silence with the socket held open: a stalled body.
  routes.set("/stalls", (res) => {
    trackClose("/stalls", res)
    res.writeHead(200)
    res.write(CHUNK)
    setTimeout(() => { if (!res.destroyed) res.write(CHUNK) }, 50)
  })
  // Never silent but far under the minimum: 8 B every 150 ms.
  routes.set("/drip", (res) => {
    trackClose("/drip", res)
    res.writeHead(200)
    const t = setInterval(() => (res.destroyed ? clearInterval(t) : res.write(Buffer.alloc(8, 1))), 150)
  })
  // Plenty fast, never ends: only a caller's budget stops it.
  routes.set("/endless", (res) => {
    trackClose("/endless", res)
    trickle(res, 10_000, 50)
  })
})
afterAll(async () => {
  server.closeAllConnections?.()
  await new Promise<void>((r) => server.close(() => r()))
  await fs.rm(dir, { recursive: true, force: true })
})

/** Run `gc()` every 50 ms while `p` is pending. */
async function underGc<T>(p: Promise<T>): Promise<T> {
  const t = setInterval(gc, 50)
  try { return await p } finally { clearInterval(t) }
}

const timed = async (p: Promise<unknown>) => {
  const started = Date.now()
  const err = await p.then(() => undefined, (e: unknown) => e)
  return { err: err as Error | undefined, ms: Date.now() - started }
}

describe("downloadFile default path (real HTTP, real streams, test limits)", () => {
  it("runs at the test limits", () => {
    expect(DEFAULT_DOWNLOAD_LIMITS).toMatchObject({ responseMs: 400, windowMs: 400, minBytesPerWindow: 128, floorBytesPerSec: 1024, maxMs: 4_000 })
  })

  it("a slow-but-steady body of unknown size keeps going well past the response limit and arrives whole", async () => {
    const dest = join(dir, "steady")
    await underGc(downloadFile(`${base}/steady`, dest))
    expect((await fs.stat(dest)).size).toBe(20 * 64)
  })

  it("a large body that announces its size and arrives steadily is not cut off", async () => {
    const dest = join(dir, "steady-known")
    await underGc(downloadFile(`${base}/steady-known`, dest))
    expect((await fs.stat(dest)).size).toBe(15 * 204)
  })

  it("a body that stops arriving is ended within a window of the grace — even with garbage collection running", async () => {
    const { err, ms } = await timed(underGc(downloadFile(`${base}/stalls`, join(dir, "stalls"))))
    expect(err?.message).toMatch(/^Download timeout: too slow/)
    expect(ms).toBeLessThan(2_000)
    // The connection is released, not left streaming.
    await vi.waitFor(() => expect(closedAt.get("/stalls")).toBeGreaterThan(0), { timeout: 1_000 })
  })

  it("a drip-feed that never goes silent is ended by the minimum rate, not left to the ceiling", async () => {
    const { err, ms } = await timed(underGc(downloadFile(`${base}/drip`, join(dir, "drip"))))
    expect(err?.message).toMatch(/^Download timeout: too slow/)
    expect(ms).toBeLessThan(2_000)
    await vi.waitFor(() => expect(closedAt.get("/drip")).toBeGreaterThan(0), { timeout: 1_000 })
  })

  it("a known-size body that outlasts its size at the floor rate is ended, though it never stalls", async () => {
    // 1 kB announced: 1 s at the floor. It sends 64 B per 100 ms (above the
    // minimum rate) and would end at 1.6 s — past its time for its size.
    routes.set("/slow-for-its-size", (res) => { trackClose("/slow-for-its-size", res); trickle(res, 16, 100, { length: 1024 }) })
    const { err, ms } = await timed(underGc(downloadFile(`${base}/slow-for-its-size`, join(dir, "slow-for-its-size"))))
    expect(err?.message).toMatch(/^Download timeout: longer than 1 s for its size/)
    expect(ms).toBeLessThan(1_500)
    await vi.waitFor(() => expect(closedAt.get("/slow-for-its-size")).toBeGreaterThan(0), { timeout: 1_000 })
  })

  it("a caller's budget is a hard total over the body — the endless body stops at it, as a TimeoutError", async () => {
    const { err, ms } = await timed(underGc(downloadFile(`${base}/endless`, join(dir, "endless"), { timeoutMs: 300 })))
    expect(err?.name).toBe("TimeoutError")
    expect(err?.message).toMatch(/^Download timeout: over its 300 ms limit/)
    expect(ms).toBeLessThan(1_000)
    await vi.waitFor(() => expect(closedAt.get("/endless")).toBeGreaterThan(0), { timeout: 1_000 })
  })

  it("a body that never ends and has no size stops at the default ceiling", async () => {
    routes.set("/forever", (res) => trickle(res, 10_000, 50))
    const { err, ms } = await timed(underGc(downloadFile(`${base}/forever`, join(dir, "forever"))))
    expect(err?.message).toMatch(/^Download timeout: (over its 4 s overall ceiling|longer than 4 s for its size)/)
    expect(ms).toBeGreaterThanOrEqual(3_900)
    expect(ms).toBeLessThan(5_000)
  }, 10_000)
})

/**
 * The reported failure, made deterministic: a body the fetch's abort no longer
 * reaches (what a collected fetch-only abort amounts to). The stub ignores its
 * signal and its body never ends, so only the signal handed to the pipeline
 * can stop it — without it, these downloads would never settle.
 */
describe("a body the fetch's abort does not reach is still stopped at its limit", () => {
  const neverEnding = () => new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(64)) } }))
  const BIG = { responseMs: 300, windowMs: 300, minBytesPerWindow: 128, floorBytesPerSec: 1024, maxMs: 3_000, maxBytes: 1024 * 1024 }

  it("on the default path", async () => {
    stub.respond = neverEnding
    try {
      const { err, ms } = await timed(downloadFile("https://provider.example.org/out.mp4", join(dir, "lost-abort-default")))
      expect(err?.message).toMatch(/^Download timeout: too slow/)
      expect(ms).toBeLessThan(2_000)
    } finally { stub.respond = undefined }
  })

  it("on a caller's budget", async () => {
    stub.respond = neverEnding
    try {
      const { err, ms } = await timed(downloadFile("https://provider.example.org/out.mp4", join(dir, "lost-abort-budget"), { timeoutMs: 250 }))
      expect(err?.name).toBe("TimeoutError")
      expect(ms).toBeLessThan(1_000)
    } finally { stub.respond = undefined }
  })

  it("on the big-media path", async () => {
    stub.respond = neverEnding
    try {
      const { err, ms } = await timed(downloadFile("https://provider.example.org/out.mp4", join(dir, "lost-abort-big"), { limits: BIG }))
      expect(err?.message).toMatch(/^Download timeout: too slow/)
      expect(ms).toBeLessThan(2_000)
    } finally { stub.respond = undefined }
  })
})
