import { describe, it, expect } from "vitest"

/**
 * Live fal.ai integration test for the sync-lipsync v3 anchor.
 *
 * Gated on FAL_KEY: runs ONLY where a real fal account key is set
 * (`FAL_KEY=... npx vitest run src/providers/fal/__tests__/integration.test.ts`),
 * and is skipped everywhere else (CI, local without the key). This is the one
 * test that actually exercises the fal queue end-to-end (submit → poll →
 * result) — the rest of the suite mocks `@fal-ai/client`.
 *
 * Sample inputs are short public clips; swap for current fal example assets if
 * these 404 (the assertion only cares that a video URL + a positive cost come
 * back).
 */
const RUN = !!process.env.FAL_KEY

const SAMPLE_VIDEO =
  "https://storage.googleapis.com/falserverless/example_inputs/sync-lipsync-input.mp4"
const SAMPLE_AUDIO =
  "https://storage.googleapis.com/falserverless/example_inputs/sync-lipsync-audio.mp3"

describe.runIf(RUN)("fal sync-lipsync v3 (live)", () => {
  it(
    "dubs a short clip end-to-end and returns a video URL + cost",
    async () => {
      const { falLipSync } = await import("../lip-sync.js")
      const res = await falLipSync(
        "sync-lipsync-v3",
        SAMPLE_VIDEO,
        SAMPLE_AUDIO,
        { syncMode: "cut_off", audioDurationSec: 8 },
      )
      expect(res.videoUrl).toMatch(/^https?:\/\//)
      expect(res.cost).toBeGreaterThan(0)
    },
    300_000,
  )
})

describe.skipIf(RUN)("fal sync-lipsync v3 (live) — skipped", () => {
  it("is skipped without FAL_KEY", () => {
    expect(RUN).toBe(false)
  })
})
