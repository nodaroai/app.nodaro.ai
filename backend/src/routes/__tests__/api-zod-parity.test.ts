/**
 * L4#2 — Frontend api.ts ↔ backend Zod parity (stopgap fixture walker).
 *
 * Per the test-strategy spec: "Two sources of truth drifting: frontend
 * sends a field backend strips (silent feature loss) or omits a required
 * field (silent 400)." The long-term fix is migrating frontend api.ts to
 * the typed `@nodaro/client` SDK so TypeScript enforces parity at compile
 * time. Until then, this test is the stopgap.
 *
 * Approach: for each high-value endpoint, define a fixture matching what
 * `frontend/src/lib/api.ts` constructs and pass it through the backend's
 * route Zod schema. If the schema rejects, drift is real — frontend will
 * 400 in production.
 *
 * **Scope**: 5 endpoints to start (image gen, video gen, t2v, tts,
 * extract-frame). Add more as drift surfaces. The full ~100-endpoint
 * walker is tracked as a follow-up to the SDK migration.
 *
 * Pattern for adding a new endpoint:
 *   1. Find the frontend's payload construction in api.ts (the body
 *      object passed to fetch).
 *   2. Find the backend's Zod schema (e.g., `xBody` in routes/x.ts).
 *   3. Export the schema if not already exported.
 *   4. Add a minimal valid fixture below + the optional/extreme fixtures.
 *
 * If a fixture stops parsing because the schema changed, two cases:
 *   (a) Frontend constructs the OLD shape and backend's new schema rejects
 *       → fix frontend api.ts AND update fixture.
 *   (b) Frontend already updated → just update the fixture here to match.
 */

import { describe, it, expect } from "vitest"
import { generateImageBody } from "../generate-image.js"
import { generateVideoBody } from "../generate-video.js"
import { textToVideoBody } from "../text-to-video.js"
import { textToSpeechBody } from "../text-to-speech.js"
import { extractFrameBody } from "../extract-frame.js"

// ---------------------------------------------------------------------------
// generate-image — POST /v1/generate-image
//
// Frontend construction (frontend/src/lib/api.ts::generateImage):
//   body: { prompt, ?referenceImageUrls, ?characterDescriptions, ?provider,
//           ?aspectRatio, ?userId, ?resolution, ?quality, ?negativePrompt,
//           ?seed, ?renderingSpeed, ?styleType, ?expandPrompt }
// ---------------------------------------------------------------------------

describe("generate-image — frontend payload × backend Zod", () => {
  it("minimal: only prompt", () => {
    const result = generateImageBody.safeParse({ prompt: "a cat in a hat" })
    expect(result.success, result.success ? "" : JSON.stringify(result.error.issues)).toBe(true)
  })

  it("full: every optional field set, common values", () => {
    const result = generateImageBody.safeParse({
      prompt: "a cat in a hat",
      provider: "nano-banana",
      aspectRatio: "16:9",
      resolution: "1K",
      quality: "high",
      seed: 12345,
      negativePrompt: "blurry, low quality",
      referenceImageUrls: ["https://example.com/ref1.png"],
      characterDescriptions: ["a wise old wizard"],
      renderingSpeed: "BALANCED",
      styleType: "AUTO",
      expandPrompt: true,
      userId: "00000000-0000-0000-0000-000000000001",
    })
    expect(result.success, result.success ? "" : JSON.stringify(result.error.issues)).toBe(true)
  })

  it("ideogram: rendering speed + style type", () => {
    const result = generateImageBody.safeParse({
      prompt: "a logo",
      provider: "ideogram-v3",
      renderingSpeed: "TURBO",
    })
    expect(result.success).toBe(true)
  })

  it("rejects: empty prompt", () => {
    expect(generateImageBody.safeParse({ prompt: "" }).success).toBe(false)
  })

  it("rejects: unknown provider", () => {
    expect(
      generateImageBody.safeParse({ prompt: "x", provider: "totally-fake-provider" }).success,
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// generate-video (i2v) — POST /v1/generate-video
//
// Frontend construction (frontend/src/lib/api.ts::generateVideo):
//   body: { imageUrl, ?endFrameUrl, ?prompt, ?provider, ?duration, ?mode,
//           ?sound, ?aspectRatio, ?seed, ... }
// ---------------------------------------------------------------------------

describe("generate-video (i2v) — frontend payload × backend Zod", () => {
  it("minimal: imageUrl only (start frame, default provider)", () => {
    const result = generateVideoBody.safeParse({
      imageUrl: "https://r2.test/start.png",
    })
    expect(result.success, result.success ? "" : JSON.stringify(result.error.issues)).toBe(true)
  })

  it("kling i2v with end frame + duration", () => {
    const result = generateVideoBody.safeParse({
      imageUrl: "https://r2.test/start.png",
      endFrameUrl: "https://r2.test/end.png",
      provider: "kling",
      duration: 10,
      sound: false,
    })
    expect(result.success, result.success ? "" : JSON.stringify(result.error.issues)).toBe(true)
  })

  it("VEO with first+last frames + audio toggle", () => {
    const result = generateVideoBody.safeParse({
      imageUrl: "https://r2.test/start.png",
      endFrameUrl: "https://r2.test/end.png",
      provider: "veo3.1",
      generateAudio: true,
    })
    expect(result.success).toBe(true)
  })

  it("seedance-2 with reference images + videos", () => {
    const result = generateVideoBody.safeParse({
      imageUrl: "https://r2.test/start.png",
      provider: "seedance-2",
      duration: 8,
      referenceImageUrls: ["https://r2.test/ref1.png", "https://r2.test/ref2.png"],
      referenceVideoUrls: ["https://r2.test/refvid.mp4"],
    })
    expect(result.success).toBe(true)
  })

  it("rejects: unknown provider", () => {
    expect(
      generateVideoBody.safeParse({
        imageUrl: "https://r2.test/start.png",
        provider: "made-up-model",
      }).success,
    ).toBe(false)
  })

  it("rejects: invalid imageUrl (not http(s))", () => {
    expect(
      generateVideoBody.safeParse({ imageUrl: "javascript:alert(1)" }).success,
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// text-to-video — POST /v1/text-to-video
//
// Frontend construction (frontend/src/lib/api.ts::generateTextToVideo):
//   body: { prompt, ?provider, ?duration, ?aspectRatio, ?sound, ... }
// ---------------------------------------------------------------------------

describe("text-to-video — frontend payload × backend Zod", () => {
  it("minimal: prompt only", () => {
    const result = textToVideoBody.safeParse({ prompt: "a sunset over mountains" })
    expect(result.success, result.success ? "" : JSON.stringify(result.error.issues)).toBe(true)
  })

  it("VEO t2v with audio + duration", () => {
    const result = textToVideoBody.safeParse({
      prompt: "a sunset over mountains",
      provider: "veo3",
      sound: true,
    })
    expect(result.success).toBe(true)
  })

  it("rejects: empty prompt", () => {
    expect(textToVideoBody.safeParse({ prompt: "" }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// text-to-speech — POST /v1/text-to-speech
//
// Frontend construction (frontend/src/lib/api.ts::generateTextToSpeech):
//   body: { text, ?voice, ?provider, ?stability, ?similarityBoost, ... }
// ---------------------------------------------------------------------------

describe("text-to-speech — frontend payload × backend Zod", () => {
  it("minimal: text only", () => {
    const result = textToSpeechBody.safeParse({ text: "Hello world" })
    expect(result.success, result.success ? "" : JSON.stringify(result.error.issues)).toBe(true)
  })

  it("v3 with voice + audio tags", () => {
    const result = textToSpeechBody.safeParse({
      text: "[whispers] Hello [pauses] world",
      voice: "EXAVITQu4vr4xnSDxMaL",
      provider: "elevenlabs-v3",
    })
    expect(result.success).toBe(true)
  })

  it("v2 with stability + similarity tuning", () => {
    const result = textToSpeechBody.safeParse({
      text: "Hello world",
      provider: "elevenlabs-turbo",
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0.3,
      speed: 1.0,
    })
    expect(result.success).toBe(true)
  })

  it("rejects: empty text", () => {
    expect(textToSpeechBody.safeParse({ text: "" }).success).toBe(false)
  })

  it("rejects: invalid speed (out of 0.7-1.2 range)", () => {
    expect(textToSpeechBody.safeParse({ text: "x", speed: 2.0 }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// extract-frame — POST /v1/extract-frame
//
// Frontend construction (frontend/src/lib/api.ts::extractFrame):
//   body: { videoUrl, ?mode, ?timestamp }
// ---------------------------------------------------------------------------

describe("extract-frame — frontend payload × backend Zod", () => {
  it("minimal: videoUrl only (defaults to first frame)", () => {
    const result = extractFrameBody.safeParse({
      videoUrl: "https://r2.test/clip.mp4",
    })
    expect(result.success, result.success ? "" : JSON.stringify(result.error.issues)).toBe(true)
    if (result.success) {
      expect(result.data.mode).toBe("first") // default applied
    }
  })

  it("last frame mode", () => {
    const result = extractFrameBody.safeParse({
      videoUrl: "https://r2.test/clip.mp4",
      mode: "last",
    })
    expect(result.success).toBe(true)
  })

  it("timestamp mode at 2.5s", () => {
    const result = extractFrameBody.safeParse({
      videoUrl: "https://r2.test/clip.mp4",
      mode: "timestamp",
      timestamp: 2.5,
    })
    expect(result.success).toBe(true)
  })

  it("rejects: invalid mode", () => {
    expect(
      extractFrameBody.safeParse({
        videoUrl: "https://r2.test/clip.mp4",
        mode: "middle" as never,
      }).success,
    ).toBe(false)
  })

  it("rejects: negative timestamp", () => {
    expect(
      extractFrameBody.safeParse({
        videoUrl: "https://r2.test/clip.mp4",
        mode: "timestamp",
        timestamp: -1,
      }).success,
    ).toBe(false)
  })
})
