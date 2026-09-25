/**
 * `downloadFile`'s limits against a REAL local HTTP server and real streams.
 * Only the SSRF guard is replaced (it refuses a loopback server by design) by
 * plain `fetch` honouring the same signal and overall timer; everything else —
 * the response deadline, the size-scaled body deadline, the stall guard, the
 * abort reasons — runs as in production, at small test limits.
 *
 * Track 0.19: one flat 120 s used to cover the response AND the body, so a big
 * file on a live connection (a 3-hour camera original) could never arrive.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { AddressInfo } from "node:net"
import { gzipSync } from "node:zlib"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

vi.mock("../../../lib/safe-fetch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/safe-fetch.js")>()),
  safeFetch: (url: string, init: { timeoutMs?: number; signal?: AbortSignal; headers?: Record<string, string> }) => {
    const signals = [init.signal, init.timeoutMs ? AbortSignal.timeout(init.timeoutMs) : undefined].filter(Boolean) as AbortSignal[]
    return fetch(url, { signal: AbortSignal.any(signals), headers: init.headers })
  },
}))

const { downloadFile, downloadBodyDeadlineMs } = await import("../ffmpeg-utils.js")

// Test limits: respond within 300 ms; every 600 ms window must deliver ≥ 128 B;
// a known-size body is assumed to arrive at ≥ 1 kB/s; nothing lasts past 3 s;
// at most 1 MB on disk.
const LIMITS = { responseMs: 300, windowMs: 600, minBytesPerWindow: 128, floorBytesPerSec: 1024, maxMs: 3_000, maxBytes: 1024 * 1024 }
const CHUNK = Buffer.alloc(64, 7)

type Route = (res: ServerResponse, req: IncomingMessage) => void
const routes = new Map<string, Route>()
let server: Server
let base = ""
let errorClosedAt = 0
// When the server saw a route's socket close (0 = not yet).
const closedAt = new Map<string, number>()
const trackClose = (route: string, res: ServerResponse) => {
  closedAt.set(route, 0)
  res.on("close", () => closedAt.set(route, Date.now()))
}
let dir = ""

/** Write `count` chunks, one every `everyMs`, then end. */
function trickle(res: ServerResponse, count: number, everyMs: number, contentLength?: number) {
  res.writeHead(200, contentLength ? { "content-length": String(contentLength) } : {})
  let sent = 0
  const t = setInterval(() => {
    if (res.destroyed) return clearInterval(t)
    res.write(CHUNK)
    if (++sent === count) { clearInterval(t); res.end() }
  }, everyMs)
}

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "download-limits-"))
  server = createServer((req, res) => routes.get(req.url ?? "")?.(res, req))
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  // 20 chunks, one per 100 ms (384 B per window): 2 s of body — well past the
  // response limit — and above the minimum rate. No length (unknown size →
  // only the rate and the overall ceiling apply).
  routes.set("/steady", (res) => trickle(res, 20, 100))
  // Two chunks, then silence: a dead transfer.
  routes.set("/stalls", (res) => { res.writeHead(200); res.write(CHUNK); setTimeout(() => res.write(CHUNK), 50) })
  // Never silent — 16 B every 150 ms, 64 B per window — but under the minimum
  // rate: a drip-feed that a "no data for N s" check would let run to the
  // overall ceiling (a hostile URL holding a worker).
  routes.set("/drip", (res) => {
    res.writeHead(200)
    const t = setInterval(() => (res.destroyed ? clearInterval(t) : res.write(Buffer.alloc(16, 1))), 150)
  })
  // Announces 512 B (0.5 s at the floor), then trickles above the minimum rate
  // for 0.8 s: over its size-scaled deadline though never too slow per window.
  routes.set("/slow-for-its-size", (res) => trickle(res, 8, 100, 512))
  // 2 MB, fast: over the 1 MB cap.
  routes.set("/huge", (res) => { res.writeHead(200); for (let i = 0; i < 32; i++) res.write(Buffer.alloc(64 * 1024, 3)); res.end() })
  // Never answers.
  routes.set("/silent", () => {})
  // Hostile: gzips whatever it was asked for, and drips it. 16 B of gzip
  // every 150 ms is under the minimum on the wire, but gzip of zeros runs
  // ~1000:1 — decoded, it would clear the rate floor forever.
  routes.set("/gzip-drip", (res) => {
    trackClose("/gzip-drip", res)
    res.writeHead(200, { "content-encoding": "gzip" })
    const body = gzipSync(Buffer.alloc(1024 * 1024))
    let at = 0
    const t = setInterval(() => {
      if (res.destroyed || at >= body.length) return clearInterval(t)
      res.write(body.subarray(at, (at += 16)))
    }, 150)
  })
  // Well-behaved: compresses only when the client says it accepts gzip.
  routes.set("/negotiates", (res, req) => {
    const raw = Buffer.alloc(4096, 5)
    if (/gzip/.test(String(req.headers["accept-encoding"] ?? ""))) {
      res.writeHead(200, { "content-encoding": "gzip" })
      res.end(gzipSync(raw))
    } else {
      res.writeHead(200, { "content-length": String(raw.length) })
      res.end(raw)
    }
  })
  // Under the minimum rate (16 B per 150 ms, 64 B per window) but done in
  // 1.05 s: the flat default bound delivers it, so the grace must too.
  routes.set("/slow-short", (res) => {
    res.writeHead(200)
    let sent = 0
    const t = setInterval(() => {
      if (res.destroyed) return clearInterval(t)
      res.write(Buffer.alloc(16, 2))
      if (++sent === 7) { clearInterval(t); res.end() }
    }, 150)
  })
  // Says it is 2 MB (over the 1 MB cap), sends 64 B, then holds the socket.
  routes.set("/announced-too-big", (res) => {
    trackClose("/announced-too-big", res)
    res.writeHead(200, { "content-length": String(2 * 1024 * 1024) })
    res.write(CHUNK)
  })
  // Never stalls, never says its size, never ends: only the overall ceiling stops it.
  routes.set("/forever", (res) => trickle(res, 1_000, 100))
  // A 500 whose body keeps coming — its connection must be released at once.
  routes.set("/error-trickle", (res) => {
    errorClosedAt = 0
    res.on("close", () => { errorClosedAt = Date.now() })
    res.writeHead(500)
    const t = setInterval(() => (res.destroyed ? clearInterval(t) : res.write(CHUNK)), 100)
  })
})
afterAll(async () => {
  server.closeAllConnections?.()
  await new Promise<void>((r) => server.close(() => r()))
  await fs.rm(dir, { recursive: true, force: true })
})

describe("downloadFile limits (real HTTP, real streams)", () => {
  it("a slow but steady body keeps going well past the response limit and arrives whole", async () => {
    const dest = join(dir, "steady.bin")
    await downloadFile(`${base}/steady`, dest, { limits: LIMITS })
    expect((await fs.stat(dest)).size).toBe(20 * CHUNK.length)
  }, 10_000)

  it("a body whose bytes stop arriving is aborted as too slow within a window or two", async () => {
    const t0 = Date.now()
    await expect(downloadFile(`${base}/stalls`, join(dir, "stalls.bin"), { limits: LIMITS })).rejects.toThrow(/^Download timeout: too slow — 0 bytes in the last/)
    expect(Date.now() - t0).toBeLessThan(2_000)
  }, 10_000)

  // Review round 2 of #1656 (decided 2026-09-25): these callers take
  // user-supplied URLs, so a transfer must keep a minimum RATE, not merely
  // avoid going silent.
  it("a drip-feed that never goes silent is stopped in its first window, not at the overall ceiling", async () => {
    const t0 = Date.now()
    await expect(downloadFile(`${base}/drip`, join(dir, "drip.bin"), { limits: LIMITS })).rejects.toThrow(/^Download timeout: too slow — \d+ bytes in the last/)
    expect(Date.now() - t0).toBeLessThan(1_200)
  }, 10_000)

  it("a body past the byte cap is stopped — a fast hostile server cannot fill the disk", async () => {
    await expect(downloadFile(`${base}/huge`, join(dir, "huge.bin"), { limits: LIMITS })).rejects.toThrow(/Download exceeds/)
  }, 10_000)

  it("a known-size body that outlasts its size at the floor rate is aborted, even though it never stalls", async () => {
    await expect(downloadFile(`${base}/slow-for-its-size`, join(dir, "slow.bin"), { limits: LIMITS }))
      .rejects.toThrow(/^Download timeout: longer than .* for its size \(0 MB\)/)
  }, 10_000)

  // Review of #1656: safeFetch's own timer used to fire first, as a bare
  // "The operation was aborted due to timeout" with no URL.
  it("a body that never stalls, never ends and has no size is stopped at the overall ceiling — with its own reason", async () => {
    await expect(downloadFile(`${base}/forever`, join(dir, "forever.bin"), { limits: LIMITS }))
      .rejects.toThrow(/^Download timeout: over its 3 s overall ceiling/)
  }, 10_000)

  it("a failing response's body is cancelled at once — its connection is not held until a timer fires", async () => {
    const t0 = Date.now()
    await expect(downloadFile(`${base}/error-trickle`, join(dir, "err.bin"), { limits: LIMITS })).rejects.toThrow(/Failed to download.*500/)
    await new Promise((r) => setTimeout(r, 300))
    expect(errorClosedAt, "the server saw its socket close").toBeGreaterThan(0)
    expect(errorClosedAt - t0).toBeLessThan(1_000)
  }, 10_000)

  // Review round 3 of #1656 (decided 2026-09-25): the rate counts decoded
  // bytes, so a compressed body is refused rather than measured.
  it("a compressed body is refused at the headers — gzip cannot carry a drip-feed past the rate floor", async () => {
    const t0 = Date.now()
    await expect(downloadFile(`${base}/gzip-drip`, join(dir, "gzip.bin"), { limits: LIMITS }))
      .rejects.toThrow(/^Download refused: the server sent a compressed body \(Content-Encoding: gzip\)/)
    expect(Date.now() - t0).toBeLessThan(300)
    await new Promise((r) => setTimeout(r, 300))
    expect(closedAt.get("/gzip-drip"), "the server saw its socket close").toBeGreaterThan(0)
  }, 10_000)

  it("asks for an uncompressed body, so a well-behaved server sends one and it arrives as is", async () => {
    const dest = join(dir, "negotiated.bin")
    await downloadFile(`${base}/negotiates`, dest, { limits: LIMITS })
    expect(await fs.readFile(dest)).toEqual(Buffer.alloc(4096, 5))
  }, 10_000)

  // Review round 3 of #1656 (decided 2026-09-25): the opt-in path is never
  // stricter than the flat default bound — the rate applies after `responseMs`.
  const GRACE = { ...LIMITS, responseMs: 1_500 }
  it("a slow transfer that ends within the grace arrives whole, though every window is under the minimum", async () => {
    const dest = join(dir, "slow-short.bin")
    await downloadFile(`${base}/slow-short`, dest, { limits: GRACE })
    expect((await fs.stat(dest)).size).toBe(7 * 16)
  }, 10_000)

  it("a drip-feed still inside the grace is not judged — the first window after it stops the transfer", async () => {
    const t0 = Date.now()
    await expect(downloadFile(`${base}/drip`, join(dir, "drip-grace.bin"), { limits: GRACE }))
      .rejects.toThrow(/^Download timeout: too slow — \d+ bytes in the last/)
    const elapsed = Date.now() - t0
    expect(elapsed).toBeGreaterThanOrEqual(1_500)
    expect(elapsed).toBeLessThan(2_600)
  }, 10_000)

  it("a body announcing a size over the cap fails at the headers, and its connection is released", async () => {
    const t0 = Date.now()
    await expect(downloadFile(`${base}/announced-too-big`, join(dir, "big.bin"), { limits: LIMITS }))
      .rejects.toThrow(/^Download exceeds 1 MB/)
    expect(Date.now() - t0).toBeLessThan(300)
    await new Promise((r) => setTimeout(r, 300))
    expect(closedAt.get("/announced-too-big"), "the server saw its socket close").toBeGreaterThan(0)
  }, 10_000)

  it("the default path's byte cap also fails a body announcing a size over it at the headers", async () => {
    const t0 = Date.now()
    await expect(downloadFile(`${base}/announced-too-big`, join(dir, "big-default.bin"), { maxBytes: 1024 * 1024 }))
      .rejects.toThrow(/^Download exceeds 1 MB/)
    expect(Date.now() - t0).toBeLessThan(300)
  }, 10_000)

  it("a server that never responds is aborted at the response limit", async () => {
    const t0 = Date.now()
    await expect(downloadFile(`${base}/silent`, join(dir, "silent.bin"), { limits: LIMITS })).rejects.toThrow(/^Download timeout: no response within/)
    expect(Date.now() - t0).toBeLessThan(2_000)
  }, 10_000)
})

describe("downloadBodyDeadlineMs (production limits)", () => {
  const MB = 1024 * 1024
  it("gives a small file the 120 s minimum", () => {
    expect(downloadBodyDeadlineMs(10 * MB)).toBe(120_000)
  })
  it("scales with size at 2 MB/s: 1 GB gets 512 s", () => {
    expect(downloadBodyDeadlineMs(1024 * MB)).toBe(512_000)
  })
  it("caps at 60 minutes: a 15 GB camera original", () => {
    expect(downloadBodyDeadlineMs(15 * 1024 * MB)).toBe(60 * 60_000)
  })
  it("an unknown size gets the cap (the stall guard catches a dead one)", () => {
    expect(downloadBodyDeadlineMs(undefined)).toBe(60 * 60_000)
    expect(downloadBodyDeadlineMs(0)).toBe(60 * 60_000)
    expect(downloadBodyDeadlineMs(NaN)).toBe(60 * 60_000)
  })
})
