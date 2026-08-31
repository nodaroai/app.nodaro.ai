import { describe, it, expect, afterEach, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import type { EgressCall } from "../../egress.js"

// B3 egress seam — the direct-ElevenLabs create funnels DEFAULT OUR key inside
// (production callers in audio-ai/video-ai pass no meta), so the seam must see a
// non-null OUR key with NO caller-supplied meta. This is the production-path
// proof the "supplies the key itself" tests can't give. One test per funnel;
// the key mirrors each route's reservation identifier.
//
// The decorator captures the EgressCall BEFORE fetch runs, so response-body
// parsing is irrelevant — we ignore each funnel's outcome and assert the key.

const cfg: Record<string, unknown> = {
  ELEVENLABS_API_KEY: "test-key",
  NODE_ENV: "test",
  ELEVENLABS_BASE_URL: "http://127.0.0.1:1",
}
vi.mock("@/lib/config.js", () => ({ config: cfg, hasCredits: () => true }))
// startDubbing / forcedAlignment fetch the source audio via safeFetch (which
// blocks loopback) before the billed POST — stub it to a tiny audio buffer so
// the funnel reaches the create call.
vi.mock("@/lib/safe-fetch.js", () => ({
  safeFetch: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
}))

async function loopback(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  const server = http.createServer((req, res) => handler(req, res))
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const { port } = server.address() as AddressInfo
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) }
}

afterEach(() => vi.resetModules())

/** Run `fn` (ignoring its outcome) with a capturing decorator installed, then
 *  return the EgressCall whose operation matches `op`. */
async function keyFor(op: string, run: () => Promise<unknown>): Promise<EgressCall | undefined> {
  const { setEgressDecorator, clearEgressDecorator } = await import("../../egress.js")
  const seen: EgressCall[] = []
  setEgressDecorator({ decorate: (c: EgressCall) => { seen.push(c); return null } })
  try {
    await run().catch(() => {})
  } finally {
    clearEgressDecorator()
  }
  return seen.find((c) => c.operation === op)
}

describe("direct-ElevenLabs create funnels default OUR modelKey with no meta", () => {
  it("voiceChanger → elevenlabs-voice-changer", async () => {
    const srv = await loopback((_req, res) => { res.writeHead(200, { "content-type": "audio/mpeg" }); res.end(Buffer.from([1])) })
    cfg.ELEVENLABS_BASE_URL = srv.base
    vi.resetModules()
    const { directVoiceChanger } = await import("../voice-changer.js")
    const call = await keyFor("voiceChanger", () => directVoiceChanger(Buffer.from([1, 2, 3]), "Rachel"))
    expect(call?.provider).toBe("elevenlabs")
    expect(call?.modelKey).toBe("elevenlabs-voice-changer")
    await srv.close()
  })

  it("dialogue → elevenlabs-dialogue", async () => {
    const srv = await loopback((_req, res) => { res.writeHead(200, { "content-type": "audio/mpeg" }); res.end(Buffer.from([1])) })
    cfg.ELEVENLABS_BASE_URL = srv.base
    vi.resetModules()
    const { directElevenLabsDialogue } = await import("../direct-dialogue.js")
    const call = await keyFor("dialogue", () => directElevenLabsDialogue([
      { text: "Hello there", voice: "Rachel" },
      { text: "General Kenobi", voice: "George" },
    ]))
    expect(call?.provider).toBe("elevenlabs")
    expect(call?.modelKey).toBe("elevenlabs-dialogue")
    expect(call?.dimensions?.characters).toBe("Hello there".length + "General Kenobi".length)
    await srv.close()
  })

  it("voiceDesign → elevenlabs-voice-design", async () => {
    const srv = await loopback((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("{}") })
    cfg.ELEVENLABS_BASE_URL = srv.base
    vi.resetModules()
    const { designVoice } = await import("../voice-design.js")
    const call = await keyFor("voiceDesign", () => designVoice("hello", "a deep warm voice"))
    expect(call?.modelKey).toBe("elevenlabs-voice-design")
    await srv.close()
  })

  it("voiceRemix → elevenlabs-voice-remix", async () => {
    const srv = await loopback((_req, res) => { res.writeHead(200, { "content-type": "audio/mpeg" }); res.end(Buffer.from([1])) })
    cfg.ELEVENLABS_BASE_URL = srv.base
    vi.resetModules()
    const { remixVoice } = await import("../voice-remix.js")
    const call = await keyFor("voiceRemix", () => remixVoice("hello", "a deep warm voice"))
    expect(call?.modelKey).toBe("elevenlabs-voice-remix")
    await srv.close()
  })

  it("stt → elevenlabs-stt", async () => {
    const srv = await loopback((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("{}") })
    cfg.ELEVENLABS_BASE_URL = srv.base
    vi.resetModules()
    const { directSpeechToText } = await import("../direct-stt.js")
    const call = await keyFor("stt", () => directSpeechToText("https://example.com/a.mp3"))
    expect(call?.modelKey).toBe("elevenlabs-stt")
    await srv.close()
  })

  it("dubbing.start → elevenlabs-dubbing", async () => {
    const srv = await loopback((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("{}") })
    cfg.ELEVENLABS_BASE_URL = srv.base
    vi.resetModules()
    const { startDubbing } = await import("../dubbing.js")
    const call = await keyFor("dubbing.start", () => startDubbing("https://example.com/a.mp3", "es"))
    expect(call?.modelKey).toBe("elevenlabs-dubbing")
    await srv.close()
  })

  it("forcedAlignment → elevenlabs-forced-alignment", async () => {
    const srv = await loopback((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("{}") })
    cfg.ELEVENLABS_BASE_URL = srv.base
    vi.resetModules()
    const { forcedAlignment } = await import("../forced-alignment.js")
    const call = await keyFor("forcedAlignment", () => forcedAlignment("https://example.com/a.mp3", "hello world"))
    expect(call?.modelKey).toBe("elevenlabs-forced-alignment")
    await srv.close()
  })
})
