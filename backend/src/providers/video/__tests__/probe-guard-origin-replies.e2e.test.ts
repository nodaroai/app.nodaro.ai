// @test-reads-none sockets only, and the clip it renders into its own temp dir
/**
 * The probe guard's proxy never takes the process down, whatever an origin
 * answers. It forwards a plain-http hop's reply to ffprobe; a reply that does
 * not conform to HTTP/1.1 (a control character in a header value or in the
 * status text, a status code outside 100–999, a connection reset mid-body) must
 * end only that one connection, so the probe fails with the normal "cannot be
 * read" error — never an uncaught exception or an unhandled rejection, which
 * the API and the workers answer by exiting.
 *
 * A local origin (the loopback stands in for a public host) answers each
 * reply below as raw bytes, to the proxy directly and to the real ffprobe.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import http from "node:http"
import net from "node:net"
import { isPrivateOrReservedIP } from "@nodaro/shared/workflow"
import { openProbeEgress, probeNetwork, ProbeSourceBlockedError } from "../probe-guard.js"
import { probeVideoSource } from "../ffmpeg-utils.js"
import { proxyAuthorization, renderClip } from "./probe-media-server.js"

const clip = renderClip("video", 2)
const head = (statusLine: string, headers: readonly string[] = []) =>
  Buffer.from(`${statusLine}\r\n${[...headers, "Content-Type: video/mp4", `Content-Length: ${clip.length}`].join("\r\n")}\r\n\r\n`, "latin1")

/** What the origin answers, by path. Each is written as raw bytes, so nothing on the origin side normalises it. */
const REPLIES: Record<string, (socket: net.Socket) => void> = {
  "an invalid header value": (s) => s.end(Buffer.concat([head("HTTP/1.1 200 OK", ["X-Note: a\x01b"]), clip])),
  "an invalid status text": (s) => s.end(Buffer.concat([head("HTTP/1.1 200 O\x01K"), clip])),
  "status 0": (s) => s.end(Buffer.concat([head("HTTP/1.1 000 Zero"), clip])),
  "status 1000": (s) => s.end(Buffer.concat([head("HTTP/1.1 1000 Big"), clip])),
  "a status under 100": (s) => s.end(Buffer.concat([head("HTTP/1.1 099 Low"), clip])),
  // A protocol switch the proxy never takes: the request ends with neither a response nor an error.
  "a 101 Switching Protocols reply": (s) => s.end("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n"),
  "a connection reset mid-body": (s) => {
    s.write(Buffer.concat([head("HTTP/1.1 200 OK"), clip.subarray(0, Math.floor(clip.length / 2))]))
    setTimeout(() => s.resetAndDestroy(), 20)
  },
}
const GOOD = "a conforming reply"

const slug = (label: string) => `/${label.replace(/\W+/g, "-")}.mp4`
const byPath = new Map<string, (socket: net.Socket) => void>([
  ...Object.entries(REPLIES).map(([label, reply]) => [slug(label), reply] as const),
  [slug(GOOD), (s: net.Socket) => s.end(Buffer.concat([head("HTTP/1.1 200 OK"), clip]))],
])

let origin: net.Server
let port: number
const at = (label: string) => `http://origin.test:${port}${slug(label)}`

beforeAll(async () => {
  // Reads the request line, then answers that path's reply (one reply per connection).
  origin = net.createServer((socket) => {
    socket.on("error", () => socket.destroy())
    let buffered = ""
    let answered = false
    socket.on("data", (chunk: Buffer) => {
      if (answered) return
      buffered += chunk.toString("latin1")
      if (!buffered.includes("\r\n\r\n")) return
      answered = true
      const path = buffered.split(" ")[1] ?? ""
      const reply = byPath.get(path)
      if (reply) reply(socket)
      else socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
    })
  })
  await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve))
  port = (origin.address() as net.AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => origin.close(() => resolve()))
})

const escaped = vi.fn()
beforeEach(() => {
  vi.spyOn(probeNetwork, "lookup").mockResolvedValue([{ address: "127.0.0.1", family: 4 }])
  vi.spyOn(probeNetwork, "isRefusedAddress").mockImplementation((ip) => ip !== "127.0.0.1" && isPrivateOrReservedIP(ip))
  escaped.mockReset()
  process.on("uncaughtException", escaped)
  process.on("unhandledRejection", escaped)
})

afterEach(async () => {
  // A late throw from a listener would land here, after the probe settled.
  await new Promise((resolve) => setTimeout(resolve, 100))
  process.off("uncaughtException", escaped)
  process.off("unhandledRejection", escaped)
  vi.restoreAllMocks()
  expect(escaped, "an error escaped the proxy to the process").not.toHaveBeenCalled()
})

/** One GET through the proxy: its status and body, or the error the connection ended with. */
function getThrough(proxy: string, url: string): Promise<{ status?: number; bytes: number; error?: string }> {
  const p = new URL(proxy)
  return new Promise((resolve) => {
    const req = http.request({ host: p.hostname, port: Number(p.port), path: url, headers: { host: new URL(url).host, connection: "close", "proxy-authorization": proxyAuthorization(proxy) } })
    req.on("response", (res) => {
      let bytes = 0
      res.on("data", (c: Buffer) => (bytes += c.length))
      res.on("end", () => resolve({ status: res.statusCode, bytes }))
      res.on("error", (e) => resolve({ status: res.statusCode, bytes, error: e.message }))
    })
    req.on("error", (e) => resolve({ bytes: 0, error: e.message }))
    req.end()
  })
}

describe("an origin's non-conforming reply ends only its own connection", () => {
  it.each(Object.keys(REPLIES))("%s: the proxy drops that connection, and serves the next request as usual", async (label) => {
    const egress = await openProbeEgress()
    try {
      const bad = await getThrough(egress.env.http_proxy!, at(label))
      // Never forwarded whole: the connection ends in an error, or the body comes up short.
      expect(bad.error !== undefined || bad.bytes < clip.length).toBe(true)
      // The same proxy still works: the failure was that connection's alone.
      expect(await getThrough(egress.env.http_proxy!, at(GOOD))).toEqual({ status: 200, bytes: clip.length })
      expect(egress.refusal()).toBeUndefined()
    } finally {
      await egress.close()
    }
  })

  it.each(Object.keys(REPLIES))("%s: the probe fails with the normal unreadable error, at once (never left to its watchdog)", async (label) => {
    const started = Date.now()
    const err = await probeVideoSource(at(label)).then(() => undefined, (e: unknown) => e)
    expect(Date.now() - started).toBeLessThan(4_000)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(ProbeSourceBlockedError)
    expect((err as Error).message).toMatch(/^ffprobe failed/)
  })

  it("a conforming reply is read", async () => {
    await expect(probeVideoSource(at(GOOD))).resolves.toMatchObject({ width: 64, height: 48 })
  })
})
