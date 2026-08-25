import { describe, it, expect, afterEach, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import type { EgressCall } from "../../egress.js"

const cfg: Record<string, unknown> = {
  ELEVENLABS_API_KEY: "test-key",
  NODE_ENV: "test",
  ELEVENLABS_BASE_URL: "http://127.0.0.1:1",
}
vi.mock("@/lib/config.js", () => ({ config: cfg, hasCredits: () => true }))

async function loopback(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  const server = http.createServer((req, res) => handler(req, res))
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const { port } = server.address() as AddressInfo
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) }
}

afterEach(() => vi.resetModules())

describe("directElevenLabsTTS — routes through the egress seam", () => {
  it("carries provider elevenlabs, operation tts, and characters = text.length", async () => {
    const srv = await loopback((req, res) => {
      if (req.url?.includes("/voices/")) {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({}))
      } else {
        res.writeHead(200, { "content-type": "audio/mpeg" })
        res.end(Buffer.from([0x49, 0x44, 0x33])) // "ID3"
      }
    })
    cfg.ELEVENLABS_BASE_URL = srv.base
    vi.resetModules()

    const { setEgressDecorator, clearEgressDecorator } = await import("../../egress.js")
    const { directElevenLabsTTS } = await import("../direct-tts.js")

    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c: EgressCall) => { seen.push(c); return null } })
    try {
      // Real signature: (text, voiceId, provider?, options?, meta?).
      const text = "Hello there"
      await directElevenLabsTTS(text, "rachel", "elevenlabs-turbo", undefined, {
        modelKey: "elevenlabs-turbo",
        dimensions: { characters: text.length },
      })
      const ttsCall = seen.find((c) => c.operation === "tts")
      expect(ttsCall).toBeDefined()
      expect(ttsCall!.provider).toBe("elevenlabs")
      expect(ttsCall!.modelKey).toBe("elevenlabs-turbo")
      expect(ttsCall!.dimensions).toEqual({ characters: 11 })
    } finally {
      clearEgressDecorator()
      await srv.close()
    }
  })

  // Production path: the worker callers pass NO meta, so the funnel must DEFAULT
  // OUR key from the `provider` param (mirroring resolveModel). The test above
  // supplied the key itself — this proves production threading by construction.
  it("defaults OUR key from the provider param when NO meta is supplied", async () => {
    const srv = await loopback((req, res) => {
      if (req.url?.includes("/voices/")) {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({}))
      } else {
        res.writeHead(200, { "content-type": "audio/mpeg" })
        res.end(Buffer.from([0x49, 0x44, 0x33]))
      }
    })
    cfg.ELEVENLABS_BASE_URL = srv.base
    vi.resetModules()

    const { setEgressDecorator, clearEgressDecorator } = await import("../../egress.js")
    const { directElevenLabsTTS } = await import("../direct-tts.js")

    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c: EgressCall) => { seen.push(c); return null } })
    try {
      // v3 provider, NO meta → key defaults to "elevenlabs-v3"
      await directElevenLabsTTS("hi", "rachel", "elevenlabs-v3")
      // multilingual, NO meta → "elevenlabs-multilingual"
      await directElevenLabsTTS("hi", "rachel", "elevenlabs-multilingual")
      // omitted provider → resolveModel sends turbo → "elevenlabs-turbo"
      await directElevenLabsTTS("hi", "rachel")
      const keys = seen.filter((c) => c.operation === "tts").map((c) => c.modelKey)
      expect(keys).toEqual(["elevenlabs-v3", "elevenlabs-multilingual", "elevenlabs-turbo"])
    } finally {
      clearEgressDecorator()
      await srv.close()
    }
  })
})
