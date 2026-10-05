/**
 * ElevenLabs Sound Effects, direct — the provider that replaces KIE's
 * `elevenlabs/sound-effect-v2` wrapper (which began failing every request with
 * a 500 after ~34 s, October 2026).
 *
 * Pinned here: the wire request (endpoint, model id, field names, ranges, the
 * auto-duration omission), the error mapping a user sees (honest, vendor-free,
 * deterministic only for a refusal of the inputs), the keyless failure, and
 * that the egress seam sees OUR model key with no caller meta.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { cfg, credits } = vi.hoisted(() => ({
  cfg: {
    ELEVENLABS_API_KEY: "test-key",
    ELEVENLABS_BASE_URL: "https://api.elevenlabs.io",
    NODE_ENV: "test",
  } as Record<string, unknown>,
  credits: { on: true },
}))
vi.mock("@/lib/config.js", () => ({ config: cfg, hasCredits: () => credits.on }))

import {
  generateSoundEffect,
  buildSoundEffectBody,
  soundEffectFailure,
  SoundEffectError,
  SOUND_EFFECT_MODEL,
} from "../sound-effects.js"
import { MissingProviderKeyError } from "../../provider-keys.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"
import { providerDetailOf } from "../../../lib/provider-error-detail.js"
import { userFacingMessage } from "../../../lib/user-facing-error.js"
import { isRetryableFailure } from "../../../lib/mcp/tools/_job-error.js"
import { setEgressDecorator, clearEgressDecorator, type EgressCall } from "../../egress.js"

const audioResponse = (bytes = [1, 2, 3]) =>
  new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "audio/mpeg" } })

const errorResponse = (status: number, body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

/** No user-facing sentence may name the vendor or the proxy it replaced. */
function expectVendorFree(message: string) {
  expect(message.toLowerCase()).not.toContain("elevenlabs")
  expect(message.toLowerCase()).not.toContain("eleven_")
  expect(message.toLowerCase()).not.toContain("kie")
}

beforeEach(() => {
  vi.restoreAllMocks()
  cfg.ELEVENLABS_API_KEY = "test-key"
  credits.on = true
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  clearEgressDecorator()
  vi.useRealTimers()
})

describe("buildSoundEffectBody", () => {
  it("always names the v2 sound model and the prompt text", () => {
    expect(buildSoundEffectBody("thunder")).toEqual({ text: "thunder", model_id: "eleven_text_to_sound_v2" })
    expect(SOUND_EFFECT_MODEL).toBe("eleven_text_to_sound_v2")
  })

  it("maps duration / loop / promptInfluence onto the API's field names", () => {
    expect(buildSoundEffectBody("rain", { duration: 10, loop: true, promptInfluence: 0.4 })).toEqual({
      text: "rain",
      model_id: "eleven_text_to_sound_v2",
      duration_seconds: 10,
      loop: true,
      prompt_influence: 0.4,
    })
  })

  it("omits duration_seconds when unset, so the API picks the length (auto mode)", () => {
    const body = buildSoundEffectBody("door creak", { loop: false })
    expect(body).not.toHaveProperty("duration_seconds")
    expect(body.loop).toBe(false)
  })

  it("clamps duration to 0.5–30 s and prompt influence to 0–1", () => {
    expect(buildSoundEffectBody("x", { duration: 0.1 }).duration_seconds).toBe(0.5)
    expect(buildSoundEffectBody("x", { duration: 45 }).duration_seconds).toBe(30)
    expect(buildSoundEffectBody("x", { promptInfluence: -1 }).prompt_influence).toBe(0)
    expect(buildSoundEffectBody("x", { promptInfluence: 3 }).prompt_influence).toBe(1)
  })
})

describe("generateSoundEffect — request", () => {
  it("POSTs JSON to /v1/sound-generation with the key header and returns the audio bytes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(audioResponse([9, 8, 7]))

    const audio = await generateSoundEffect("explosion", { duration: 5, loop: false, promptInfluence: 0.8 })

    expect(Buffer.isBuffer(audio)).toBe(true)
    expect([...audio]).toEqual([9, 8, 7])
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.elevenlabs.io/v1/sound-generation")
    expect(init.method).toBe("POST")
    expect(init.headers).toMatchObject({ "xi-api-key": "test-key", "Content-Type": "application/json" })
    expect(JSON.parse(init.body as string)).toEqual({
      text: "explosion",
      model_id: "eleven_text_to_sound_v2",
      duration_seconds: 5,
      loop: false,
      prompt_influence: 0.8,
    })
  })

  it("sends no request at all without a key — the shared missing-key error", async () => {
    cfg.ELEVENLABS_API_KEY = ""
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    await expect(generateSoundEffect("rain")).rejects.toBeInstanceOf(MissingProviderKeyError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("the egress seam sees OUR model key (elevenlabs-sfx) with no caller meta", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(audioResponse())
    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c) => { seen.push(c); return null } })

    await generateSoundEffect("rain", { duration: 12, loop: true })

    expect(seen).toHaveLength(1)
    expect(seen[0].provider).toBe("elevenlabs")
    expect(seen[0].operation).toBe("soundEffects")
    expect(seen[0].modelKey).toBe("elevenlabs-sfx")
    expect(seen[0].dimensions).toEqual({ duration: 12, loop: true })
  })

  it("an auto-length request is labelled as such for the seam", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(audioResponse())
    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c) => { seen.push(c); return null } })
    await generateSoundEffect("rain")
    expect(seen[0].dimensions).toEqual({ durationLabel: "auto" })
  })
})

describe("generateSoundEffect — failures", () => {
  it("422 → a vendor-free, non-retryable 'rejected these settings' that fails the job now", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errorResponse(422, { detail: [{ loc: ["body", "duration_seconds"], msg: "must be <= 30" }] }),
    )
    const err = await generateSoundEffect("x", { duration: 5 }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(SoundEffectError)
    const msg = (err as Error).message
    expect(msg).toContain("rejected these settings")
    expectVendorFree(msg)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(isRetryableFailure(userFacingMessage(err, "x"))).toBe(false)
    // The operator still gets what the provider said.
    expect(providerDetailOf(err)).toContain("duration_seconds")
    expect(providerDetailOf(err)).toContain("422")
  })

  it("400 is a refusal of the inputs too", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errorResponse(400, { detail: { status: "invalid_request" } }))
    const err = await generateSoundEffect("x").catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
  })

  it("429 → 'temporarily busy', retryable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errorResponse(429, { detail: { status: "too_many_concurrent_requests" } }))
    const err = await generateSoundEffect("x").catch((e: unknown) => e)
    const msg = (err as Error).message
    expect(msg).toBe("Service is temporarily busy. Please try again in a moment.")
    expect(isDeterministicJobError(err)).toBe(false)
    expect(isRetryableFailure(msg)).toBe(true)
  })

  it.each([500, 502, 503])("%i → generic retryable failure that hides the provider's body", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errorResponse(status, "upstream exploded at elevenlabs internal"))
    const err = await generateSoundEffect("x").catch((e: unknown) => e)
    const msg = (err as Error).message
    expect(msg).toBe("Sound effect generation failed. Please try again or contact support if the issue persists.")
    expectVendorFree(msg)
    expect(isDeterministicJobError(err)).toBe(false)
    expect(isRetryableFailure(msg)).toBe(true)
    expect(providerDetailOf(err)).toContain("upstream exploded")
  })

  it("401 on cloud → our configuration problem, never the vendor's text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errorResponse(401, { detail: { status: "invalid_api_key", message: "Invalid API key" } }))
    const err = await generateSoundEffect("x").catch((e: unknown) => e)
    const msg = (err as Error).message
    expect(msg).toBe("Service is not properly configured. Please contact support.")
    expectVendorFree(msg)
    expect(isDeterministicJobError(err)).toBe(false)
  })

  it("401 on a self-host → tells the operator their own key was refused", async () => {
    credits.on = false
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errorResponse(401, { detail: { status: "invalid_api_key" } }))
    const err = await generateSoundEffect("x").catch((e: unknown) => e)
    expect((err as Error).message).toContain("ELEVENLABS_API_KEY was refused")
  })

  it("our quota running out → out-of-capacity (not charged), retryable, with an [ALERT] log", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      errorResponse(401, { detail: { status: "quota_exceeded", message: "This request exceeds your quota" } }),
    )
    const err = await generateSoundEffect("x").catch((e: unknown) => e)
    const msg = (err as Error).message
    expect(msg).toContain("temporarily out of capacity on our side")
    expectVendorFree(msg)
    expect(isDeterministicJobError(err)).toBe(false)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[ALERT]"))
  })

  it("a network failure is a generic retryable failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"))
    const err = await generateSoundEffect("x").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SoundEffectError)
    expect(isDeterministicJobError(err)).toBe(false)
    expect(providerDetailOf(err)).toContain("fetch failed")
  })

  it("a 200 with an empty body is a failure, not an empty audio file", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(audioResponse([]))
    await expect(generateSoundEffect("x")).rejects.toBeInstanceOf(SoundEffectError)
  })

  it("a stalled request aborts with the timeout sentence", async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          ;(init as RequestInit).signal?.addEventListener("abort", () => reject(new Error("aborted")))
        }),
    )
    const pending = generateSoundEffect("x").catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(120_000)
    const err = await pending
    expect((err as Error).message).toBe("Generation timed out. Please try again.")
  })
})

describe("soundEffectFailure", () => {
  it("caps the stored provider detail", () => {
    const err = soundEffectFailure(500, "x".repeat(5000))
    expect(err.internalDetails.length).toBeLessThanOrEqual(2000)
  })
})
