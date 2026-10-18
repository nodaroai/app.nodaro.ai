/**
 * A setting added since a failed attempt ran holds its default for that
 * attempt — and a default a resolver derives from the node's inputs (its
 * music bed, here) is read with the inputs the attempt ran with (proven equal
 * to the node's own before the settings are compared), never as if it had
 * none (failed-attempt.ts `attemptRanWithInputs`). A fake type stands in for
 * a future resolver: today's read no input.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@nodaro/render-rules", async (orig) => {
  const actual = await orig<typeof import("@nodaro/render-rules")>()
  const descriptor = {
    ...actual.usecaseDescriptor("tighten-episode"),
    inputs: ["media", "music"],
    settingKeys: ["duck"],
    // The new setting ducks the bed by 30 when there is one, else not at all.
    resolveSettings: (raw: Record<string, unknown> | undefined) => ({ duck: raw?.duck ?? (raw?.musicUrl ? 30 : 0) }),
  }
  return { ...actual, usecaseDescriptor: () => descriptor }
})

import { attemptRanWithInputs } from "../failed-attempt.js"

const MEDIA = "https://r2/ep.mp4"
const MUSIC = "https://r2/bed.mp3"
// Stored before the setting existed: no `duck`, and the attempt ran with the bed.
const ranWith = { mediaUrl: MEDIA, musicUrl: MUSIC, settings: {} }

describe("a new setting's default, for an attempt that ran with music", () => {
  it("left at its default (30 with a bed), the attempt resumes", () => {
    expect(attemptRanWithInputs("tighten-episode", ranWith, "video", { mediaUrls: [MEDIA], musicUrl: MUSIC })).toBe(true)
  })

  it("set to what it would default to WITHOUT a bed (0), the attempt runs fresh: that is not what it ran with", () => {
    expect(attemptRanWithInputs("tighten-episode", ranWith, "video", { mediaUrls: [MEDIA], musicUrl: MUSIC, duck: 0 })).toBe(false)
  })

  it("set to its default with the bed (30), it still resumes", () => {
    expect(attemptRanWithInputs("tighten-episode", ranWith, "video", { mediaUrls: [MEDIA], musicUrl: MUSIC, duck: 30 })).toBe(true)
  })
})
