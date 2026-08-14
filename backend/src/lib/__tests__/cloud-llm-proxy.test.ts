import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The LLM lane never reaches the capability router and mostly answers
 * synchronously, so neither the provider registry nor the job-replay path can
 * cover it. These tests pin the two things the route proxy must get right:
 * a local key always wins, and media on THIS instance is re-hosted before the
 * body is forwarded (the cloud refuses private hosts — the same wall
 * image-to-video hit).
 */
const env = {
  KIE_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  GEMINI_API_KEY: "",
  R2_PUBLIC_URL: "",
  PUBLIC_URL: "",
  R2_PUBLIC_FALLBACK_DOMAIN: "",
}
vi.mock("../config.js", () => ({ config: env }))

const getNodaroConnection = vi.fn()
vi.mock("../nodaro-connect.js", () => ({
  getNodaroConnection: () => getNodaroConnection(),
  nodaroCloudBase: () => "https://cloud.example",
}))

const ensureCloudReachableMediaUrl = vi.fn(async (u: string) => u)
vi.mock("../../providers/nodaro/client.js", () => ({
  ensureCloudReachableMediaUrl: (u: string) => ensureCloudReachableMediaUrl(u),
}))

const { maybeProxyLlmRouteToCloud, shouldProxyLlmToCloud } = await import("../cloud-llm-proxy.js")

function makeReply() {
  const state: Record<string, unknown> = {}
  const reply = {
    status: vi.fn((s: number) => { state.status = s; return reply }),
    header: vi.fn(() => reply),
    send: vi.fn((b: unknown) => { state.body = b; return reply }),
    raw: {},
    state,
  }
  return reply
}
const req = { body: {}, raw: { on: vi.fn() }, log: { error: vi.fn() } } as never

describe("shouldProxyLlmToCloud", () => {
  beforeEach(() => {
    env.KIE_API_KEY = ""; env.ANTHROPIC_API_KEY = ""; env.GEMINI_API_KEY = ""
    getNodaroConnection.mockResolvedValue({ accessToken: "ndr_app_x" })
  })

  it("is false when ANY local LLM key exists — a keyed install keeps its own path", async () => {
    for (const key of ["KIE_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"] as const) {
      env.KIE_API_KEY = ""; env.ANTHROPIC_API_KEY = ""; env.GEMINI_API_KEY = ""
      env[key] = "set"
      expect(await shouldProxyLlmToCloud(), key).toBe(false)
    }
  })

  it("is false with no connection, so a keyless unconnected install still fails locally with its own message", async () => {
    getNodaroConnection.mockResolvedValue(null)
    expect(await shouldProxyLlmToCloud()).toBe(false)
  })

  it("is true only when keyless AND connected", async () => {
    expect(await shouldProxyLlmToCloud()).toBe(true)
  })
})

describe("maybeProxyLlmRouteToCloud", () => {
  beforeEach(() => {
    env.KIE_API_KEY = ""; env.ANTHROPIC_API_KEY = ""; env.GEMINI_API_KEY = ""
    getNodaroConnection.mockResolvedValue({ accessToken: "ndr_app_x" })
    ensureCloudReachableMediaUrl.mockReset().mockImplementation(async (u: string) =>
      u.includes("localhost") ? "https://cloud/up/x.png" : u,
    )
  })

  it("declines and lets the local path run when a key is present", async () => {
    env.KIE_API_KEY = "kie"
    const reply = makeReply()
    expect(await maybeProxyLlmRouteToCloud(req, reply as never, "/v1/qa-check")).toBe(false)
    expect(reply.send).not.toHaveBeenCalled()
  })

  it("forwards the body and mirrors the cloud's status and payload verbatim", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    const reply = makeReply()
    const handled = await maybeProxyLlmRouteToCloud(
      { body: { content: "hi" }, raw: { on: vi.fn() }, log: { error: vi.fn() } } as never,
      reply as never,
      "/v1/qa-check",
    )
    expect(handled).toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://cloud.example/v1/qa-check",
      expect.objectContaining({ method: "POST" }),
    )
    expect(reply.state.status).toBe(200)
    expect(reply.state.body).toBe(JSON.stringify({ ok: true }))
    fetchSpy.mockRestore()
  })

  it("passes a cloud error through unchanged — a 402 must still read as 402", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "insufficient_credits" } }), { status: 402 }),
    )
    const reply = makeReply()
    await maybeProxyLlmRouteToCloud(req, reply as never, "/v1/qa-check")
    expect(reply.state.status).toBe(402)
    expect(String(reply.state.body)).toContain("insufficient_credits")
    fetchSpy.mockRestore()
  })

  it("re-hosts instance-local media but leaves prompts containing links alone", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }))
    const reply = makeReply()
    await maybeProxyLlmRouteToCloud(
      {
        body: {
          imageUrl: "http://localhost:3000/storage/images/a.png",
          prompt: "describe http://localhost:3000/storage/images/a.png",
        },
        raw: { on: vi.fn() },
        log: { error: vi.fn() },
      } as never,
      reply as never,
      "/v1/image-critic",
    )
    const sent = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
    expect(sent.imageUrl).toBe("https://cloud/up/x.png")
    expect(sent.prompt).toBe("describe http://localhost:3000/storage/images/a.png")
    fetchSpy.mockRestore()
  })

  it("answers 502 with an actionable message when the cloud is unreachable", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"))
    const reply = makeReply()
    expect(await maybeProxyLlmRouteToCloud(req, reply as never, "/v1/qa-check")).toBe(true)
    expect(reply.state.status).toBe(502)
    expect(JSON.stringify(reply.state.body)).toContain("Integrations")
    fetchSpy.mockRestore()
  })
})


describe("nested media and client disconnect", () => {
  beforeEach(() => {
    env.KIE_API_KEY = ""; env.ANTHROPIC_API_KEY = ""; env.GEMINI_API_KEY = ""
    getNodaroConnection.mockResolvedValue({ accessToken: "ndr_app_x" })
    ensureCloudReachableMediaUrl.mockReset().mockImplementation(async (u: string) =>
      u.includes("localhost") ? "https://cloud/up/x.png" : u,
    )
  })

  it("re-hosts media nested inside arrays of objects", async () => {
    // scene-graph takes assets[].url. A top-level-only walk left those local
    // and the cloud refused the whole request.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }))
    const reply = makeReply()
    await maybeProxyLlmRouteToCloud(
      {
        body: {
          assets: [
            { id: "a", url: "http://localhost:3000/storage/images/a.png" },
            { id: "b", url: "https://public.example/b.png" },
          ],
        },
        raw: { on: vi.fn() },
        log: { error: vi.fn() },
      } as never,
      reply as never,
      "/v1/scene-graph/generate",
    )
    const sent = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
    expect(sent.assets[0].url).toBe("https://cloud/up/x.png")
    expect(sent.assets[1].url).toBe("https://public.example/b.png")
    fetchSpy.mockRestore()
  })

  it("aborts the upstream call when the client disconnects", async () => {
    // Otherwise the cloud keeps generating — and billing — for an answer
    // nobody will read.
    let onClose: (() => void) | undefined
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      onClose?.()
      expect((init as RequestInit).signal?.aborted).toBe(true)
      return new Response("{}", { status: 200 })
    })
    const reply = makeReply()
    await maybeProxyLlmRouteToCloud(
      {
        body: {},
        raw: { on: (ev: string, cb: () => void) => { if (ev === "close") onClose = cb } },
        log: { error: vi.fn() },
      } as never,
      reply as never,
      "/v1/qa-check",
    )
    expect(fetchSpy).toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
