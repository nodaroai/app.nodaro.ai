import { describe, it, expect, afterEach, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import type { EgressCall } from "../egress.js"

// Mutable config mock; base URLs are pointed at each test's loopback server.
const cfg: Record<string, unknown> = {
  HEYGEN_API_KEY: "k",
  ELEVENLABS_API_KEY: "k",
  NODE_ENV: "test",
  ELEVENLABS_BASE_URL: "http://127.0.0.1:1",
}
vi.mock("@/lib/config.js", () => ({ config: cfg, hasCredits: () => true }))

async function loopback(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => handler(req, res))
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const { port } = server.address() as AddressInfo
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) }
}

afterEach(() => vi.resetModules())

describe("heygenFetch — the single funnel routes through the egress seam", () => {
  it("emits a heygen-provider EgressCall with a path-derived operation", async () => {
    const srv = await loopback((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ data: { ok: true } }))
    })
    vi.resetModules()
    const { setEgressDecorator, clearEgressDecorator } = await import("../egress.js")
    const { heygenFetch } = await import("../heygen/client.js")
    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c: EgressCall) => { seen.push(c); return null } })
    try {
      // heygenFetch accepts a full http(s) path verbatim — point it at the loopback.
      await heygenFetch(`${srv.base}/v2/video/generate`, { method: "POST", body: "{}" })
      expect(seen.some((c) => c.provider === "heygen" && c.operation === "heygen/v2/video/generate")).toBe(true)
    } finally {
      clearEgressDecorator()
      await srv.close()
    }
  })
})

describe("directSpeechToText — routes through the egress seam", () => {
  it("emits an elevenlabs/stt EgressCall", async () => {
    const srv = await loopback((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ text: "hello", language_code: "en", words: [] }))
    })
    cfg.ELEVENLABS_BASE_URL = srv.base
    vi.resetModules()
    const { setEgressDecorator, clearEgressDecorator } = await import("../egress.js")
    const { directSpeechToText } = await import("../elevenlabs/direct-stt.js")
    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c: EgressCall) => { seen.push(c); return null } })
    try {
      await directSpeechToText("http://x/audio.mp3")
      const stt = seen.find((c) => c.operation === "stt")
      expect(stt).toBeDefined()
      expect(stt!.provider).toBe("elevenlabs")
    } finally {
      clearEgressDecorator()
      await srv.close()
    }
  })
})
