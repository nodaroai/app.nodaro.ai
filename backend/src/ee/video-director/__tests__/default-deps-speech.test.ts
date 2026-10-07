/**
 * The video director's real wiring voices its script through POST /v1/text-to-speech
 * with the default speech model — the same model a request that names none runs on —
 * so the director and the route can never disagree about which model voiced the cut.
 */
import { describe, it, expect, vi } from "vitest"
import { DEFAULT_TTS_PROVIDER } from "@nodaro/shared"

vi.mock("@/services/shot-sequence/baker.js", () => ({ bakeShotSequence: vi.fn() }))

import { defaultDirectorDeps } from "../orchestrate.js"

describe("defaultDirectorDeps().createSpeechJob", () => {
  it("asks the text-to-speech route for the default speech model (ElevenLabs v4), with timings", async () => {
    const inject = vi.fn().mockResolvedValue({ statusCode: 200, body: JSON.stringify({ jobId: "tts-1" }) })
    const deps = defaultDirectorDeps({ inject } as never)

    await expect(deps.createSpeechJob("Voice-over line.", "user-1")).resolves.toEqual({ jobId: "tts-1" })

    expect(DEFAULT_TTS_PROVIDER).toBe("elevenlabs-v4")
    expect(inject).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "/v1/text-to-speech",
        payload: { text: "Voice-over line.", provider: DEFAULT_TTS_PROVIDER, userId: "user-1", withTimestamps: true },
      }),
    )
  })
})
