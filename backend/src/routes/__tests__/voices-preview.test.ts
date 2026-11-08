/**
 * Same-site voice previews on the voice routes (VOICE_PREVIEW_PROXY=true): a
 * deployment whose browsers may reach only its own host cannot play a preview
 * at the speech provider's storage address, so the lists give each one as a
 * same-site address and GET /v1/voices/:voiceId/preview streams the file.
 *
 *   - Off (the default): both lists answer byte for byte as before, cache hit
 *     and miss alike, and the preview route answers 404.
 *   - On: every preview a list gives is same-site; the caches keep the
 *     provider's; an internal call (an MCP tool) still gets the provider's.
 *   - The route serves a file only behind a signature the lists made, never a
 *     voice the voice lock refuses, and fetches nothing for either refusal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const cfgState = vi.hoisted(() => ({ key: "test-eleven-key" as string, business: false, proxy: false }))
vi.mock("@/lib/config.js", () => ({
  config: {
    get ELEVENLABS_API_KEY() {
      return cfgState.key
    },
    ELEVENLABS_BASE_URL: "https://api.elevenlabs.io",
    get VOICE_PREVIEW_PROXY() {
      return cfgState.proxy
    },
    INTERNAL_ORCHESTRATOR_SECRET: "voice-preview-test-secret-0000000000000000",
  },
  isBusiness: () => cfgState.business,
  isCloud: () => false,
}))
vi.mock("@/providers/kie/audio.js", () => ({ registerVoiceLookup: vi.fn() }))
const redisStore = vi.hoisted(() => ({ map: new Map<string, string>() }))
vi.mock("@/lib/queue-connection.js", () => ({
  redis: {
    get: vi.fn(async (key: string) => redisStore.map.get(key) ?? null),
    pipeline: vi.fn(() => {
      const ops: Array<[string, string]> = []
      const p = {
        set(key: string, value: string) {
          ops.push([key, value])
          return p
        },
        async exec() {
          for (const [key, value] of ops) redisStore.map.set(key, value)
          return []
        },
      }
      return p
    }),
  },
}))
// The lock's resolver reaches the database only for a user's own clone; no test here names one.
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => {
      throw new Error("no database in this test")
    },
  },
}))
const safeFetch = vi.hoisted(() => vi.fn())
vi.mock("@/lib/safe-fetch.js", async (orig) => ({ ...(await orig<typeof import("@/lib/safe-fetch.js")>()), safeFetch }))

const RACHEL = "https://storage.googleapis.com/eleven-public-prod/premade/voices/21m00Tcm4TlvDq8ikWAM/r.mp3"
const ADAM = "https://storage.googleapis.com/eleven-public-prod/premade/voices/pNInz6obpgDQGcFmaJgB/a.mp3"
const PREMADE = {
  voices: [
    { voice_id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", preview_url: RACHEL, labels: { gender: "female" }, category: "premade" },
    { voice_id: "pNInz6obpgDQGcFmaJgB", name: "Adam", preview_url: ADAM, labels: { gender: "male" }, category: "premade" },
    { voice_id: "NoSample000000000001", name: "Quiet", preview_url: "", labels: { gender: "female" }, category: "premade" },
  ],
}
const LIBRARY = {
  voices: [
    { voice_id: "LibFemale000000000001", name: "Her", gender: "female", preview_url: "https://storage.googleapis.com/eleven-public-prod/lib/her.mp3" },
    { voice_id: "LibMale00000000000001", name: "Him", gender: "male", preview_url: "https://storage.googleapis.com/eleven-public-prod/lib/him.mp3" },
  ],
  has_more: false,
}

let app: FastifyInstance
let fetchMock: ReturnType<typeof vi.fn>

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response
const audio = (bytes: number[], type = "audio/mpeg") =>
  new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": type, "content-length": String(bytes.length) } })

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  cfgState.key = "test-eleven-key"
  cfgState.business = false
  cfgState.proxy = false
  redisStore.map.clear()
  fetchMock = vi.fn(async (url: string) => (String(url).includes("/v1/shared-voices") ? json(LIBRARY) : json(PREMADE)))
  vi.stubGlobal("fetch", fetchMock)
  safeFetch.mockReset()

  const { voicesRoutes } = await import("../voices.js")
  app = Fastify({ logger: false })
  // What the auth hook sets for the platform's own internal calls.
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-test-internal"] === "1") req.isInternalCall = true
  })
  await app.register(async (instance) => {
    await voicesRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  vi.unstubAllGlobals()
  delete process.env.NODARO_SURFACE_PROFILE
})

const previews = (body: string) => (JSON.parse(body) as { voices: Array<{ voice_id: string; preview_url: string }> }).voices.map((v) => [v.voice_id, v.preview_url])

describe("with the switch off (the default)", () => {
  it("GET /v1/voices answers exactly as before", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/voices" })
    expect(previews(res.body)).toEqual([
      ["21m00Tcm4TlvDq8ikWAM", RACHEL],
      ["pNInz6obpgDQGcFmaJgB", ADAM],
      ["NoSample000000000001", ""],
    ])
    expect(res.headers["cache-control"]).toBe("public, max-age=3600, stale-while-revalidate=86400")
  })

  it("GET /v1/voices/library answers exactly as before, from the provider and from the cache", async () => {
    const miss = await app.inject({ method: "GET", url: "/v1/voices/library" })
    const hit = await app.inject({ method: "GET", url: "/v1/voices/library" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(hit.body).toBe(miss.body)
    expect(previews(miss.body)).toEqual(LIBRARY.voices.map((v) => [v.voice_id, v.preview_url]))
  })

  it("the preview route is not there", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/voices/Rachel/preview?src=x&sig=y" })
    expect(res.statusCode).toBe(404)
    expect(safeFetch).not.toHaveBeenCalled()
  })
})

describe("with the switch on", () => {
  beforeEach(() => {
    cfgState.proxy = true
  })

  it("every preview a list gives is a same-site address; none stays none", async () => {
    const premade = previews((await app.inject({ method: "GET", url: "/v1/voices" })).body)
    expect(premade[0]![1]).toMatch(/^\/v1\/voices\/21m00Tcm4TlvDq8ikWAM\/preview\?src=[\w-]+&sig=[\w-]+$/)
    expect(premade[1]![1]).toMatch(/^\/v1\/voices\/pNInz6obpgDQGcFmaJgB\/preview\?/)
    expect(premade[2]).toEqual(["NoSample000000000001", ""])

    const library = previews((await app.inject({ method: "GET", url: "/v1/voices/library" })).body)
    for (const [id, url] of library) expect(url).toMatch(new RegExp(`^/v1/voices/${id}/preview\\?`))
  })

  it("the library cache keeps the provider's addresses: a hit is rewritten on the way out too", async () => {
    await app.inject({ method: "GET", url: "/v1/voices/library" })
    const hit = previews((await app.inject({ method: "GET", url: "/v1/voices/library" })).body)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    for (const [, url] of hit) expect(url).toMatch(/^\/v1\/voices\//)

    cfgState.proxy = false
    const after = previews((await app.inject({ method: "GET", url: "/v1/voices/library" })).body)
    expect(after).toEqual(LIBRARY.voices.map((v) => [v.voice_id, v.preview_url]))
  })

  it("an internal call (an MCP tool, not a browser on this site) still gets the provider's addresses", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/voices", headers: { "x-test-internal": "1" } })
    expect(previews(res.body)[0]).toEqual(["21m00Tcm4TlvDq8ikWAM", RACHEL])
  })

  async function previewPathOf(voiceId: string): Promise<string> {
    const list = previews((await app.inject({ method: "GET", url: "/v1/voices" })).body)
    return list.find(([id]) => id === voiceId)![1]!
  }

  it("streams the provider's file at the address the list gave", async () => {
    safeFetch.mockResolvedValueOnce(audio([1, 2, 3, 4, 5]))
    const res = await app.inject({ method: "GET", url: await previewPathOf("21m00Tcm4TlvDq8ikWAM") })

    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toBe("audio/mpeg")
    expect(res.headers["accept-ranges"]).toBe("bytes")
    expect(res.headers["cache-control"]).toBe("private, max-age=86400")
    expect([...res.rawPayload]).toEqual([1, 2, 3, 4, 5])
    expect(safeFetch).toHaveBeenCalledWith(RACHEL, expect.anything())
  })

  it("answers HEAD with the file's headers and no body", async () => {
    safeFetch.mockResolvedValueOnce(audio([1, 2, 3]))
    const res = await app.inject({ method: "HEAD", url: await previewPathOf("21m00Tcm4TlvDq8ikWAM") })
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toBe("audio/mpeg")
    expect(res.rawPayload.byteLength).toBe(0)
  })

  it("answers a media player's byte range with a 206, and an impossible one with a 416", async () => {
    safeFetch.mockResolvedValueOnce(audio([1, 2, 3, 4, 5]))
    const path = await previewPathOf("21m00Tcm4TlvDq8ikWAM")

    const ranged = await app.inject({ method: "GET", url: path, headers: { range: "bytes=1-2" } })
    expect(ranged.statusCode).toBe(206)
    expect(ranged.headers["content-range"]).toBe("bytes 1-2/5")
    expect([...ranged.rawPayload]).toEqual([2, 3])

    const past = await app.inject({ method: "GET", url: path, headers: { range: "bytes=9-" } })
    expect(past.statusCode).toBe(416)
    expect(past.headers["content-range"]).toBe("bytes */5")
    // One file, fetched once.
    expect(safeFetch).toHaveBeenCalledTimes(1)
  })

  it("refuses an address the list did not make, and fetches nothing", async () => {
    const path = await previewPathOf("21m00Tcm4TlvDq8ikWAM")
    const url = new URL(path, "https://site.invalid")
    const forged = Buffer.from("https://evil.example/x.mp3").toString("base64url")

    for (const bad of [
      `/v1/voices/21m00Tcm4TlvDq8ikWAM/preview?src=${forged}&sig=${url.searchParams.get("sig")}`,
      `/v1/voices/21m00Tcm4TlvDq8ikWAM/preview?src=${url.searchParams.get("src")}&sig=nope`,
      `/v1/voices/pNInz6obpgDQGcFmaJgB/preview${url.search}`,
      `/v1/voices/21m00Tcm4TlvDq8ikWAM/preview`,
    ]) {
      const res = await app.inject({ method: "GET", url: bad })
      expect(res.statusCode, bad).toBe(404)
      expect(res.json()).toEqual({ error: { code: "not_found", message: "Not found" } })
    }
    expect(safeFetch).not.toHaveBeenCalled()
  })

  it("never serves a voice the voice lock refuses, and fetches nothing for it", async () => {
    const adam = await previewPathOf("pNInz6obpgDQGcFmaJgB") // minted before the lock
    cfgState.business = true
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders: ["female"] } })
    vi.resetModules()
    const { voicesRoutes } = await import("../voices.js")
    const locked = Fastify({ logger: false })
    await locked.register(async (instance) => {
      await voicesRoutes(instance)
    })
    await locked.ready()

    const res = await locked.inject({ method: "GET", url: adam })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: { code: "voice_not_available", message: "The selected voice is not available on this deployment." } })
    expect(safeFetch).not.toHaveBeenCalled()

    // A voice the lock allows still plays.
    safeFetch.mockResolvedValueOnce(audio([7]))
    const rachel = previews((await locked.inject({ method: "GET", url: "/v1/voices" })).body).find(([id]) => id === "21m00Tcm4TlvDq8ikWAM")![1]!
    expect((await locked.inject({ method: "GET", url: rachel })).statusCode).toBe(200)
    await locked.close()
  })

  it("says so when the provider's file cannot be served (not audio, too large, gone)", async () => {
    safeFetch.mockResolvedValueOnce(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }))
    const res = await app.inject({ method: "GET", url: await previewPathOf("21m00Tcm4TlvDq8ikWAM") })
    expect(res.statusCode).toBe(502)
    expect(res.json()).toEqual({ error: { code: "preview_unavailable", message: "This voice's preview could not be loaded." } })
  })
})
