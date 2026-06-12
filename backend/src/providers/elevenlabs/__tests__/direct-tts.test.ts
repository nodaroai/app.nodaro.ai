import { describe, it, expect, vi, afterEach } from "vitest"
import { resolveDirectVoiceId, stripAudioTags, isKnownPremadeVoiceRef, directElevenLabsTTS } from "../direct-tts.js"

vi.mock("../../../lib/config.js", () => ({
  config: { ELEVENLABS_API_KEY: "test-key" },
}))

describe("resolveDirectVoiceId", () => {
  it("maps known premade voice names to ElevenLabs UUIDs", () => {
    expect(resolveDirectVoiceId("Rachel")).toBe("21m00Tcm4TlvDq8ikWAM")
    expect(resolveDirectVoiceId("George")).toBe("JBFqnCBsd6RMkjVDRZzb")
    expect(resolveDirectVoiceId("Bill")).toBe("pqHfZKP75CvOlQylNhV4")
  })

  it("passes through anything that isn't a known name (UUIDs, custom voices)", () => {
    expect(resolveDirectVoiceId("21m00Tcm4TlvDq8ikWAM")).toBe("21m00Tcm4TlvDq8ikWAM")
    expect(resolveDirectVoiceId("custom-uuid-here")).toBe("custom-uuid-here")
  })

  it("defaults to Rachel's UUID when voice is undefined", () => {
    expect(resolveDirectVoiceId(undefined)).toBe("21m00Tcm4TlvDq8ikWAM")
  })
})

describe("stripAudioTags", () => {
  it("removes bracketed audio tags and collapses whitespace", () => {
    expect(stripAudioTags("Hello [laughs] world")).toBe("Hello world")
    expect(stripAudioTags("[whispers] secret [pause] ok")).toBe("secret ok")
  })

  it("leaves text without tags unchanged", () => {
    expect(stripAudioTags("Plain sentence.")).toBe("Plain sentence.")
  })
})

describe("isKnownPremadeVoiceRef", () => {
  it("recognizes premade names and their UUIDs", () => {
    expect(isKnownPremadeVoiceRef("Rachel")).toBe(true)
    expect(isKnownPremadeVoiceRef("21m00Tcm4TlvDq8ikWAM")).toBe(true)
  })
  it("rejects unknown ids (library voices, clones, arbitrary strings)", () => {
    expect(isKnownPremadeVoiceRef("V55PLkF0YuZYdHsom49R")).toBe(false)
    expect(isKnownPremadeVoiceRef("My Clone")).toBe(false)
  })
})

describe("directElevenLabsTTS", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function audioResponse(): Response {
    return new Response(new ArrayBuffer(4), { status: 200 })
  }

  it("omits voice_settings when the caller sets no sliders (voice's stored settings apply)", async () => {
    const calls: Array<{ url: string; body?: unknown }> = []
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return audioResponse()
    }))

    await directElevenLabsTTS("hi", "Aaa111Bbb222Ccc333Dd", undefined, { allowDefaultVoiceFallback: false })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toContain("/v1/text-to-speech/Aaa111Bbb222Ccc333Dd")
    expect((calls[0]!.body as Record<string, unknown>).voice_settings).toBeUndefined()
  })

  it("merges explicit sliders over the voice's stored settings (keeps speaker boost)", async () => {
    const calls: Array<{ url: string; body?: unknown }> = []
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (u.endsWith("/settings")) {
        return new Response(JSON.stringify({
          stability: 0.3, similarity_boost: 0.9, style: 0.2, use_speaker_boost: true, speed: 1,
        }), { status: 200 })
      }
      return audioResponse()
    }))

    await directElevenLabsTTS("hi", "Ddd444Eee555Fff666Gg", undefined, { speed: 1.1 })

    const tts = calls.find((c) => c.url.includes("/v1/text-to-speech/"))!
    expect((tts.body as { voice_settings: unknown }).voice_settings).toEqual({
      stability: 0.3, similarity_boost: 0.9, style: 0.2, use_speaker_boost: true, speed: 1.1,
    })
  })

  it("falls back to Rachel on voice_not_found ONLY when allowDefaultVoiceFallback is set", async () => {
    const urls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url)
      urls.push(u)
      if (u.includes("Ggg777Hhh888Iii999Jj")) {
        return new Response(JSON.stringify({ detail: { status: "voice_not_found" } }), { status: 404 })
      }
      return audioResponse()
    }))

    await directElevenLabsTTS("hi", "Ggg777Hhh888Iii999Jj", undefined, { allowDefaultVoiceFallback: true })
    expect(urls.some((u) => u.includes("21m00Tcm4TlvDq8ikWAM"))).toBe(true)
  })

  it("fails loudly on voice_not_found for user-picked voices (no fallback flag)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ detail: { status: "voice_not_found" } }), { status: 404 }),
    ))

    await expect(
      directElevenLabsTTS("hi", "Kkk000Lll111Mmm222Nn", undefined, undefined),
    ).rejects.toThrow(/was not found on ElevenLabs/)
  })
})
