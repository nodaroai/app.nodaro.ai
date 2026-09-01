/**
 * L4#2 — Frontend api.ts ↔ backend Zod parity (stopgap fixture walker).
 *
 * Per the test-strategy spec: "Two sources of truth drifting: frontend
 * sends a field backend strips (silent feature loss) or omits a required
 * field (silent 400)." The long-term fix is migrating frontend api.ts to
 * the typed `@nodaro/sdk` SDK so TypeScript enforces parity at compile
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
import { MODEL_CATALOG, VIDEO_GEN_PROVIDERS, TEXT_TO_VIDEO_PROVIDERS } from "@nodaro/shared"
import { generateImageBody } from "../generate-image.js"
import { generateVideoBody } from "../generate-video.js"
import { textToVideoBody } from "../text-to-video.js"
import { textToSpeechBody } from "../text-to-speech.js"
import { extractFrameBody } from "../extract-frame.js"
import { generateCharacterMotionBody } from "../generate-character-motion.js"

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
      userId: "00000000-0000-4000-8000-000000000001",
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

  // WI-1b: `prompt` was relaxed from `.min(1)` to `.min(0)` — an empty prompt
  // is now ACCEPTED at the Zod layer because structured inputs
  // (`connectedReferences` / `direction` / `structured`) can fill it. The
  // empty-prompt rejection MOVED post-assembly: the handler returns 400
  // (`no_prompt`) when the FINAL assembled prompt is empty (see
  // generate-image.test.ts "returns 400 when structured inputs assemble to an
  // empty prompt"). `prompt` is still REQUIRED as a key — a missing prompt
  // still fails Zod.
  it("accepts: empty prompt (empty-check moved post-assembly in WI-1b)", () => {
    expect(generateImageBody.safeParse({ prompt: "" }).success).toBe(true)
  })

  it("rejects: missing prompt key", () => {
    expect(generateImageBody.safeParse({ provider: "nano-banana" }).success).toBe(false)
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

  it("minimax-h3 with reference images + videos + audio", () => {
    const result = generateVideoBody.safeParse({
      imageUrl: "https://r2.test/start.png",
      provider: "minimax-h3",
      duration: 12,
      aspectRatio: "adaptive",
      referenceImageUrls: ["https://r2.test/ref1.png", "https://r2.test/ref2.png"],
      referenceVideoUrls: ["https://r2.test/refvid.mp4"],
      referenceAudioUrls: ["https://r2.test/voice.mp3"],
    })
    expect(result.success).toBe(true)
  })

  it("wan-3 / wan-3-prime: adaptive aspect + the 2-30s duration ladder ends", () => {
    for (const provider of ["wan-3", "wan-3-prime"]) {
      for (const duration of [2, 5, 30]) {
        const result = generateVideoBody.safeParse({
          imageUrl: "https://r2.test/start.png",
          provider,
          duration,
          aspectRatio: "adaptive",
          resolution: "720p",
          referenceImageUrls: ["https://r2.test/ref1.png"],
          referenceVideoUrls: ["https://r2.test/refvid.mp4"],
          referenceAudioUrls: ["https://r2.test/voice.mp3"],
        })
        expect(
          result.success,
          `${provider} @ ${duration}s: ${result.success ? "" : JSON.stringify(result.error.issues)}`,
        ).toBe(true)
      }
    }
  })

  it("gemini-omni-flash: 4K resolution + the sparse duration menu", () => {
    for (const duration of [4, 6, 8, 10]) {
      const result = generateVideoBody.safeParse({
        imageUrl: "https://r2.test/start.png",
        provider: "gemini-omni-flash",
        duration,
        resolution: "4k",
        referenceVideoUrls: ["https://r2.test/source.mp4"],
      })
      expect(result.success, result.success ? "" : JSON.stringify(result.error.issues)).toBe(true)
    }
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

// ---------------------------------------------------------------------------
// generate-character-motion — POST /v1/generate-character-motion
//
// Frontend construction (frontend/src/lib/api.ts::generateCharacterMotion):
//   body: { motionPrompt, sourceImageUrl, ?provider, name, ?description,
//           ?gender, ?style, ?baseOutfit }
// ---------------------------------------------------------------------------

describe("generate-character-motion — frontend payload × backend Zod", () => {
  it("minimal: motionPrompt + sourceImageUrl + name", () => {
    const result = generateCharacterMotionBody.safeParse({
      motionPrompt: "walking confidently",
      sourceImageUrl: "https://r2.test/portrait.png",
      name: "Alex",
    })
    expect(result.success, result.success ? "" : JSON.stringify(result.error.issues)).toBe(true)
  })

  it("full: provider + all optional character fields", () => {
    const result = generateCharacterMotionBody.safeParse({
      motionPrompt: "waving at the camera",
      sourceImageUrl: "https://r2.test/portrait.png",
      provider: "wan-2.7-i2v",
      name: "Mia",
      description: "tall, dark hair",
      gender: "female",
      style: "realistic",
      baseOutfit: "leather jacket",
    })
    expect(result.success, result.success ? "" : JSON.stringify(result.error.issues)).toBe(true)
  })

  it("rejects: missing name", () => {
    expect(
      generateCharacterMotionBody.safeParse({
        motionPrompt: "walking",
        sourceImageUrl: "https://r2.test/portrait.png",
      }).success,
    ).toBe(false)
  })

  it("rejects: empty motionPrompt", () => {
    expect(
      generateCharacterMotionBody.safeParse({
        motionPrompt: "",
        sourceImageUrl: "https://r2.test/portrait.png",
        name: "Alex",
      }).success,
    ).toBe(false)
  })

  it("rejects: unknown provider", () => {
    expect(
      generateCharacterMotionBody.safeParse({
        motionPrompt: "walking",
        sourceImageUrl: "https://r2.test/portrait.png",
        name: "Alex",
        provider: "veo3" as never,
      }).success,
    ).toBe(false)
  })

  it("rejects: non-http sourceImageUrl", () => {
    expect(
      generateCharacterMotionBody.safeParse({
        motionPrompt: "walking",
        sourceImageUrl: "ftp://r2.test/portrait.png",
        name: "Alex",
      }).success,
    ).toBe(false)
  })
})


// ---------------------------------------------------------------------------
// Catalog ↔ route-Zod TOTALITY (root CLAUDE.md pitfall 2)
//
// The recurring outage: a model declares a capability in MODEL_CATALOG that the
// route's hand-written Zod enum does not list, so every run of that combination
// 400s (or, worse, is only discovered mid-run after credits are reserved). The
// per-model fixtures above catch the models somebody remembered to add; this
// sweep catches the ones nobody did — it walks EVERY video catalog entry and
// pushes its own declared aspect ratios and durations through both video route
// schemas. Declare the capability honestly in the catalog and this passes for
// free; add one the enum lacks and it fails HERE, in CI, before the model ships.
//
// `resolution` is deliberately not swept: both schemas type it `z.string()` and
// the catalog-derived normalizers (normalizeModelInput / normalizeNodeModelParams)
// are the invariant there, not an enum.
// ---------------------------------------------------------------------------

describe("video MODEL_CATALOG × route Zod totality", () => {
  const videoEntries = Object.values(MODEL_CATALOG).filter((e) => e.kind === "video")

  it("has video entries to sweep (guards against a vacuous pass)", () => {
    expect(videoEntries.length).toBeGreaterThan(10)
  })

  it("every declared aspect ratio parses on both video routes", () => {
    const rejected: string[] = []
    for (const entry of videoEntries) {
      for (const aspectRatio of entry.aspectRatios ?? []) {
        if ((VIDEO_GEN_PROVIDERS as readonly string[]).includes(entry.id)) {
          const r = generateVideoBody.safeParse({ imageUrl: "https://r2.test/s.png", provider: entry.id, aspectRatio })
          if (!r.success) rejected.push(`generate-video ${entry.id} aspectRatio=${aspectRatio}`)
        }
        if ((TEXT_TO_VIDEO_PROVIDERS as readonly string[]).includes(entry.id)) {
          const r = textToVideoBody.safeParse({ prompt: "x", provider: entry.id, aspectRatio })
          if (!r.success) rejected.push(`text-to-video ${entry.id} aspectRatio=${aspectRatio}`)
        }
      }
    }
    expect(rejected).toEqual([])
  })

  it("every declared duration parses on both video routes", () => {
    const rejected: string[] = []
    for (const entry of videoEntries) {
      for (const duration of entry.durations ?? []) {
        if ((VIDEO_GEN_PROVIDERS as readonly string[]).includes(entry.id)) {
          const r = generateVideoBody.safeParse({ imageUrl: "https://r2.test/s.png", provider: entry.id, duration })
          if (!r.success) rejected.push(`generate-video ${entry.id} duration=${duration}`)
        }
        if ((TEXT_TO_VIDEO_PROVIDERS as readonly string[]).includes(entry.id)) {
          const r = textToVideoBody.safeParse({ prompt: "x", provider: entry.id, duration })
          if (!r.success) rejected.push(`text-to-video ${entry.id} duration=${duration}`)
        }
      }
    }
    expect(rejected).toEqual([])
  })

  it("covers the three 2026-09 additions", () => {
    for (const id of ["wan-3", "wan-3-prime", "gemini-omni-flash"]) {
      expect(videoEntries.some((e) => e.id === id), id).toBe(true)
      expect((VIDEO_GEN_PROVIDERS as readonly string[]).includes(id), `${id} in VIDEO_GEN_PROVIDERS`).toBe(true)
      expect((TEXT_TO_VIDEO_PROVIDERS as readonly string[]).includes(id), `${id} in TEXT_TO_VIDEO_PROVIDERS`).toBe(true)
    }
  })
})
