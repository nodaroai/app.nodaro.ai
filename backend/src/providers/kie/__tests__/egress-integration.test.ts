import { describe, it, expect, afterEach, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import type { EgressCall } from "../../egress.js"

// Mutable base so each test can point the module-level KIE_API_BASE at its
// own loopback server. The mock object is read fresh at module import time.
const cfg: {
  KIE_API_KEY: string; NODE_ENV: string; KIE_API_BASE_URL: string
  SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string
} = {
  KIE_API_KEY: "test-key",
  NODE_ENV: "test",
  KIE_API_BASE_URL: "http://127.0.0.1:1",
  // video.ts pulls in credit-audit → supabase client at import; a valid-shaped
  // URL lets createClient construct (no query runs in these decorate-only tests).
  SUPABASE_URL: "http://127.0.0.1:1",
  SUPABASE_SERVICE_ROLE_KEY: "test-key",
}
vi.mock("@/lib/config.js", () => ({
  config: cfg,
  hasCredits: () => true,
}))

async function loopback(
  handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void,
): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => handler(req, body, res))
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const { port } = server.address() as AddressInfo
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) }
}

afterEach(() => vi.resetModules())

describe("video create sites — full egress dimensions from the wire body (G9)", () => {
  it("a generic seedance t2v create call surfaces resolution + audio + duration in dimensions", async () => {
    const srv = await loopback((req, _body, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        req.url?.includes("recordInfo")
          ? JSON.stringify({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["http://x/v.mp4"] }) } })
          : JSON.stringify({ code: 200, data: { taskId: "sd-1" } }),
      )
    })
    cfg.KIE_API_BASE_URL = srv.base
    vi.resetModules()
    const { setEgressDecorator, clearEgressDecorator } = await import("../../egress.js")
    const { KieVideoProvider } = await import("../video.js")
    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c: EgressCall) => { seen.push(c); return null } })
    try {
      await new KieVideoProvider().textToVideo("a dog", "seedance", 8, "16:9", { resolution: "1080p" }, { modelKey: "seedance" })
      const call = seen.find((c) => c.operation === "jobs.createTask")
      expect(call).toBeDefined()
      expect(call!.dimensions.resolution).toBe("1080p")
      expect(call!.dimensions.audio).toBe(false) // seedance extraParams generate_audio:false
      expect(call!.dimensions.duration).toBe(8)
      expect(call!.dimensions.durationLabel).toBe("8s")
    } finally {
      clearEgressDecorator()
      await srv.close()
    }
  })

  it("a VEO t2v create call surfaces resolution + duration in dimensions", async () => {
    const srv = await loopback((req, _body, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        req.url?.includes("/veo/generate")
          ? JSON.stringify({ code: 200, data: { taskId: "veo-t2v" } })
          : JSON.stringify({ code: 200, data: { successFlag: 1, response: { resultUrls: ["http://x/v.mp4"] } } }),
      )
    })
    cfg.KIE_API_BASE_URL = srv.base
    vi.resetModules()
    const { setEgressDecorator, clearEgressDecorator } = await import("../../egress.js")
    const { KieVideoProvider } = await import("../video.js")
    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c: EgressCall) => { seen.push(c); return null } })
    try {
      await new KieVideoProvider().textToVideo("a dog", "veo3", 8, "16:9", { resolution: "1080p" }, { modelKey: "veo3" })
      const call = seen.find((c) => c.operation === "veo.generate")
      expect(call).toBeDefined()
      expect(call!.dimensions.resolution).toBe("1080p")
      expect(call!.dimensions.duration).toBe(8)
      expect(call!.dimensions.durationLabel).toBe("8s")
    } finally {
      clearEgressDecorator()
      await srv.close()
    }
  })
})

describe("audio create sites — full egress dimensions from the wire body (G9)", () => {
  it("a dialogue create call surfaces summed characters in dimensions", async () => {
    const srv = await loopback((req, _body, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        req.url?.includes("recordInfo")
          ? JSON.stringify({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["http://x/a.mp3"] }) } })
          : JSON.stringify({ code: 200, data: { taskId: "dlg-1" } }),
      )
    })
    cfg.KIE_API_BASE_URL = srv.base
    vi.resetModules()
    const { setEgressDecorator, clearEgressDecorator } = await import("../../egress.js")
    const { KieAudioProvider } = await import("../audio.js")
    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c: EgressCall) => { seen.push(c); return null } })
    try {
      await new KieAudioProvider().generateDialogue(
        [{ text: "ab", voice: "Rachel" }, { text: "cde", voice: "Rachel" }],
        {},
        { modelKey: "elevenlabs-dialogue" },
      ).catch(() => {})
      const call = seen.find((c) => c.modelKey === "elevenlabs-dialogue")
      expect(call).toBeDefined()
      expect(call!.dimensions.characters).toBe(5)
    } finally {
      clearEgressDecorator()
      await srv.close()
    }
  })

  it("a TTS create call still surfaces characters", async () => {
    const srv = await loopback((req, _body, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        req.url?.includes("recordInfo")
          ? JSON.stringify({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["http://x/a.mp3"] }) } })
          : JSON.stringify({ code: 200, data: { taskId: "tts-1" } }),
      )
    })
    cfg.KIE_API_BASE_URL = srv.base
    vi.resetModules()
    const { setEgressDecorator, clearEgressDecorator } = await import("../../egress.js")
    const { KieAudioProvider } = await import("../audio.js")
    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c: EgressCall) => { seen.push(c); return null } })
    try {
      await new KieAudioProvider().textToSpeech("hello world", "Rachel", "elevenlabs-turbo", {}, { modelKey: "elevenlabs-turbo" }).catch(() => {})
      const call = seen.find((c) => c.operation === "jobs.createTask")
      expect(call).toBeDefined()
      expect(call!.dimensions.characters).toBe(11)
    } finally {
      clearEgressDecorator()
      await srv.close()
    }
  })
})

describe("providerFetch — boolean dimensions ride through to the decorator (widened type)", () => {
  it("passes a boolean dimension through to the decorator unchanged", async () => {
    vi.resetModules()
    const { providerFetch, setEgressDecorator, clearEgressDecorator } = await import("../../egress.js")
    const seen: Array<Record<string, unknown>> = []
    setEgressDecorator({ decorate: (call) => { seen.push(call.dimensions); return null } })
    try {
      // 127.0.0.1:1 refuses immediately; decorate() runs BEFORE fetch, so the
      // assertion is on the captured dimensions, not the (failing) network call.
      await providerFetch(
        {
          provider: "kie", operation: "test", modelKey: "seedance-2",
          body: {}, dimensions: { resolution: "4K", videoInput: true, audio: false },
        },
        "http://127.0.0.1:1/x",
        {},
      ).catch(() => {})
    } finally {
      clearEgressDecorator()
    }
    expect(seen[0]).toEqual({ resolution: "4K", videoInput: true, audio: false })
  })
})

describe("createKieTask — routes through the egress seam with a body-based price read", () => {
  it("captures OUR modelKey (≠ provider id) and the exact wire body in the EgressCall", async () => {
    let postedBody: unknown
    const srv = await loopback((req, body, res) => {
      postedBody = JSON.parse(body)
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ code: 200, data: { taskId: "task-xyz" } }))
    })
    cfg.KIE_API_BASE_URL = srv.base
    vi.resetModules()

    const { setEgressDecorator, clearEgressDecorator } = await import("../../egress.js")
    const { createKieTask } = await import("../client.js")

    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c: EgressCall) => { seen.push(c); return null } })

    try {
      // Two Nodaro keys map to ONE provider id "nano-banana-pro"; the caller
      // passes the provider id as `model` and OUR key as `meta.modelKey`.
      // The input has been through the per-model remap (resolution 4K present).
      const wireInput = { prompt: "a cat", resolution: "4K", image_size: "16:9" }
      const result = await createKieTask("nano-banana-pro", wireInput, {
        modelKey: "nano-banana",
        dimensions: { resolution: "4K" },
      })

      expect(result.taskId).toBe("task-xyz")
      // The seam saw OUR key, distinct from the provider id it was posted under.
      expect(seen).toHaveLength(1)
      expect(seen[0].modelKey).toBe("nano-banana")
      expect(seen[0].provider).toBe("kie")
      expect(seen[0].operation).toBe("jobs.createTask")
      // Price must read the WIRE BODY (post-remap), which carries the resolution
      // that decides the composite price — not the caller's raw options.
      expect(seen[0].body).toEqual({ model: "nano-banana-pro", input: wireInput })
      expect(seen[0].dimensions).toEqual({ resolution: "4K" })
      // And the server actually received that exact body.
      expect(postedBody).toEqual({ model: "nano-banana-pro", input: wireInput })
    } finally {
      clearEgressDecorator()
      await srv.close()
    }
  })
})

describe("runVeoTask — routes through the egress seam on the VEO endpoint", () => {
  it("carries operation veo.generate, OUR modelKey and the duration dimension", async () => {
    const srv = await loopback((req, body, res) => {
      if (req.url?.includes("/veo/generate")) {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ code: 200, data: { taskId: "veo-1" } }))
      } else {
        // record-info poll → immediately successful
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ code: 200, data: { successFlag: 1, response: { resultUrls: ["http://x/v.mp4"] } } }))
      }
    })
    cfg.KIE_API_BASE_URL = srv.base
    vi.resetModules()

    const { setEgressDecorator, clearEgressDecorator } = await import("../../egress.js")
    const { runVeoTask } = await import("../client.js")

    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c: EgressCall) => { seen.push(c); return null } })
    try {
      // Real signature: (model, prompt, imageUrls?, options?, reconcileOpts?).
      // OUR modelKey + the duration dimension ride the reconcileOpts (5th arg).
      await runVeoTask(
        "veo3",
        "a dog",
        undefined,
        { duration: 8 },
        { modelKey: "veo3", dimensions: { duration: "8" } },
      )
      const create = seen.find((c) => c.operation === "veo.generate")
      expect(create).toBeDefined()
      expect(create!.provider).toBe("kie")
      expect(create!.modelKey).toBe("veo3")
      expect(create!.dimensions).toEqual({ duration: "8" })
    } finally {
      clearEgressDecorator()
      await srv.close()
    }
  })
})

// "Shape once, enumerate the rest": one create-family per KIE-family client, each
// asserting the create's EgressCall carries OUR modelKey (never the provider id)
// and an honest operation label. The mock success envelope for each poll is
// mirrored from that client's real terminal-success parser, so the create fn
// resolves after a single poll instead of looping its full budget.
describe("KIE-family egress coverage — every create-family routes through the seam", () => {
  it("kling3Generate → kling3.generate with OUR modelKey", async () => {
    const srv = await loopback((req, _body, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        req.url?.includes("createTask")
          ? JSON.stringify({ code: 200, data: { taskId: "k3-1" } })
          : JSON.stringify({ code: 200, data: { state: "success", videoUrl: "http://x/v.mp4" } }),
      )
    })
    cfg.KIE_API_BASE_URL = srv.base
    vi.resetModules()
    const { setEgressDecorator, clearEgressDecorator } = await import("../../egress.js")
    const { kling3Generate } = await import("../kling3-client.js")
    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c: EgressCall) => { seen.push(c); return null } })
    try {
      await kling3Generate({ prompt: "x", duration: 5 } as never, { modelKey: "kling-3.0" })
      expect(seen.some((c) => c.operation === "kling3.generate" && c.modelKey === "kling-3.0")).toBe(true)
    } finally {
      clearEgressDecorator()
      await srv.close()
    }
  })

  it("runLumaModifyTask → luma.modify with OUR modelKey", async () => {
    const srv = await loopback((req, _body, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        req.url?.includes("record-info")
          ? JSON.stringify({ code: 200, data: { successFlag: 1, response: { resultUrls: ["http://x/v.mp4"] } } })
          : JSON.stringify({ code: 200, data: { taskId: "luma-1" } }),
      )
    })
    cfg.KIE_API_BASE_URL = srv.base
    vi.resetModules()
    const { setEgressDecorator, clearEgressDecorator } = await import("../../egress.js")
    const { runLumaModifyTask } = await import("../luma-client.js")
    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c: EgressCall) => { seen.push(c); return null } })
    try {
      await runLumaModifyTask({ prompt: "x", videoUrl: "http://x/in.mp4" }, { modelKey: "luma-modify" })
      expect(seen.some((c) => c.operation === "luma.modify" && c.modelKey === "luma-modify")).toBe(true)
    } finally {
      clearEgressDecorator()
      await srv.close()
    }
  })

  it("runRunwayTask → runway.generate with OUR modelKey", async () => {
    const srv = await loopback((req, _body, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        req.url?.includes("record-detail")
          ? JSON.stringify({ code: 200, data: { state: "success", videoInfo: { videoUrl: "http://x/v.mp4" } } })
          : JSON.stringify({ code: 200, data: { taskId: "rw-1" } }),
      )
    })
    cfg.KIE_API_BASE_URL = srv.base
    vi.resetModules()
    const { setEgressDecorator, clearEgressDecorator } = await import("../../egress.js")
    const { runRunwayTask } = await import("../runway-client.js")
    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c: EgressCall) => { seen.push(c); return null } })
    try {
      await runRunwayTask({ prompt: "x" }, { modelKey: "runway" })
      expect(seen.some((c) => c.operation === "runway.generate" && c.modelKey === "runway")).toBe(true)
    } finally {
      clearEgressDecorator()
      await srv.close()
    }
  })

  it("runFluxKontextTask → kontext.generate with OUR modelKey", async () => {
    const srv = await loopback((req, _body, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        req.url?.includes("record-info")
          ? JSON.stringify({ code: 200, data: { successFlag: 1, response: { resultImageUrl: "http://x/i.png" } } })
          : JSON.stringify({ code: 200, data: { taskId: "kx-1" } }),
      )
    })
    cfg.KIE_API_BASE_URL = srv.base
    vi.resetModules()
    const { setEgressDecorator, clearEgressDecorator } = await import("../../egress.js")
    const { runFluxKontextTask } = await import("../kontext-client.js")
    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c: EgressCall) => { seen.push(c); return null } })
    try {
      await runFluxKontextTask("flux-kontext-pro", { prompt: "x" }, { modelKey: "flux-kontext" })
      expect(seen.some((c) => c.operation === "kontext.generate" && c.modelKey === "flux-kontext")).toBe(true)
    } finally {
      clearEgressDecorator()
      await srv.close()
    }
  })

  it("sunoGenerate → suno.generate with OUR modelKey (shared createSunoTask funnel)", async () => {
    const srv = await loopback((req, _body, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        req.url?.includes("record-info")
          ? JSON.stringify({ code: 200, data: { status: "SUCCESS", response: { sunoData: [{ id: "t1", audio_url: "http://x/a.mp3" }] } } })
          : JSON.stringify({ code: 200, data: { taskId: "suno-1" } }),
      )
    })
    cfg.KIE_API_BASE_URL = srv.base
    vi.resetModules()
    const { setEgressDecorator, clearEgressDecorator } = await import("../../egress.js")
    const { sunoGenerate } = await import("../suno-client.js")
    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c: EgressCall) => { seen.push(c); return null } })
    try {
      await sunoGenerate({ prompt: "a song" } as never, { modelKey: "suno" })
      expect(seen.some((c) => c.operation === "suno.generate" && c.modelKey === "suno")).toBe(true)
    } finally {
      clearEgressDecorator()
      await srv.close()
    }
  })

  // The three Suno funnels that DEFAULT the key inside (single-purpose, so the
  // production callers pass no meta) — proves the seam still sees OUR key even
  // with NO caller-supplied modelKey, which the "supplies the key" tests above
  // cannot show.
  it("sunoStyleBoost → suno.styleBoost defaults OUR key with no meta supplied", async () => {
    const srv = await loopback((_req, _body, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ code: 200, data: "boosted style" }))
    })
    cfg.KIE_API_BASE_URL = srv.base
    vi.resetModules()
    const { setEgressDecorator, clearEgressDecorator } = await import("../../egress.js")
    const { sunoStyleBoost } = await import("../suno-client.js")
    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c: EgressCall) => { seen.push(c); return null } })
    try {
      await sunoStyleBoost({ content: "make it epic" })
      expect(seen.some((c) => c.operation === "suno.styleBoost" && c.modelKey === "suno-style-boost")).toBe(true)
    } finally {
      clearEgressDecorator()
      await srv.close()
    }
  })

  it("sunoVoiceGenerate → suno.voice.generate defaults suno-voice-create with no meta", async () => {
    const srv = await loopback((_req, _body, res) => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ code: 200, data: { taskId: "vg-1" } }))
    })
    cfg.KIE_API_BASE_URL = srv.base
    vi.resetModules()
    const { setEgressDecorator, clearEgressDecorator } = await import("../../egress.js")
    const { sunoVoiceGenerate, sunoVoiceValidate } = await import("../suno-client.js")
    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c: EgressCall) => { seen.push(c); return null } })
    try {
      await sunoVoiceGenerate({ taskId: "t-1", verifyUrl: "https://x/read.mp3" } as never)
      expect(seen.some((c) => c.operation === "suno.voice.generate" && c.modelKey === "suno-voice-create")).toBe(true)
      // Free validate carries the ownership-tag key, not the billed one.
      seen.length = 0
      await sunoVoiceValidate({ voiceUrl: "https://x/v.mp3", vocalStartS: 0, vocalEndS: 5 } as never)
      expect(seen.some((c) => c.operation === "suno.voice.validate" && c.modelKey === "suno-voice-validate")).toBe(true)
    } finally {
      clearEgressDecorator()
      await srv.close()
    }
  })
})
