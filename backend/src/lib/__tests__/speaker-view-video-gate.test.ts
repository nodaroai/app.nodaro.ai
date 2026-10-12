/**
 * R15 (decided 2026-10-12): Speaker View's video mode goes live only when
 * Speaker Frames is priced, on top of Speaker View itself being priced. ONE
 * predicate answers it, in `@nodaro/render-rules`, so the video input (Zod,
 * both engines, MCP), the clip-measuring route, the face check, "Add
 * Transcribe", the macro and the template all refuse or hide on the same
 * fact. Edit-driven Speaker View is not behind it.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import {
  SPEAKER_FRAMES_PRICED,
  SPEAKER_VIEW_PRICED,
  SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE,
  speakerViewVideoModeLive,
  speakerViewVideoModeRefusal,
} from "@nodaro/render-rules"

describe("speakerViewVideoModeLive", () => {
  it("is live only when BOTH Speaker View and Speaker Frames are priced", () => {
    expect(speakerViewVideoModeLive({ viewPriced: true, framesPriced: true })).toBe(true)
    expect(speakerViewVideoModeLive({ viewPriced: true, framesPriced: false })).toBe(false)
    expect(speakerViewVideoModeLive({ viewPriced: false, framesPriced: true })).toBe(false)
    expect(speakerViewVideoModeLive({ viewPriced: false, framesPriced: false })).toBe(false)
  })

  it("reads the real flags when none are given, so a test that stands in for them stands in for the gate", () => {
    expect(speakerViewVideoModeLive()).toBe(SPEAKER_VIEW_PRICED && SPEAKER_FRAMES_PRICED)
    expect(speakerViewVideoModeLive({ framesPriced: true })).toBe(SPEAKER_VIEW_PRICED)
    expect(speakerViewVideoModeLive({ viewPriced: true })).toBe(SPEAKER_FRAMES_PRICED)
  })

  it("is closed today: Speaker Frames has no price yet", () => {
    expect(SPEAKER_VIEW_PRICED).toBe(true)
    expect(SPEAKER_FRAMES_PRICED).toBe(false)
    expect(speakerViewVideoModeLive()).toBe(false)
  })
})

describe("speakerViewVideoModeRefusal", () => {
  it("is null once the mode is live", () => {
    expect(speakerViewVideoModeRefusal({ viewPriced: true, framesPriced: true })).toBeNull()
  })

  it("is ONE clear message, whichever flag is the one that is off", () => {
    const a = speakerViewVideoModeRefusal({ viewPriced: true, framesPriced: false })
    const b = speakerViewVideoModeRefusal({ viewPriced: false, framesPriced: true })
    const c = speakerViewVideoModeRefusal({ viewPriced: false, framesPriced: false })
    for (const r of [a, b, c]) {
      expect(r).toEqual({ code: "video-mode-not-live", message: SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE })
    }
  })

  it("says what to do instead and that nothing was charged, with no flag name or price in it", () => {
    expect(SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE).toMatch(/not available yet/i)
    expect(SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE).toMatch(/edit/i)
    expect(SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE).toMatch(/nothing was charged/i)
    expect(SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE).not.toMatch(/PRICED|\$/)
  })

  it("reads the real flags when none are given", () => {
    expect(speakerViewVideoModeRefusal() === null).toBe(speakerViewVideoModeLive())
  })
})

// ── The gate stays ONE predicate ──────────────────────────────────────────
// Nobody re-derives "video mode is live" by hand-combining the two flags: a
// copy is a surface that opens (or stays shut) when the others do not.

const SRC_ROOTS = ["backend/src", "frontend/src", "packages/render-rules/src", "packages/shared/src", "packages/prompts/src", "packages/client/src"]
const REPO_ROOT = join(__dirname, "..", "..", "..", "..")
const THE_PREDICATE = "packages/render-rules/src/speaker-view-video-gate.ts"

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "__tests__") continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* sourceFiles(full)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield full
  }
}

describe("the video-mode gate has one definition", () => {
  const files = SRC_ROOTS.flatMap((root) => {
    try {
      return [...sourceFiles(join(REPO_ROOT, root))]
    } catch {
      return []
    }
  })

  it("scans real source", () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it("no file outside the predicate's own module combines SPEAKER_VIEW_PRICED with SPEAKER_FRAMES_PRICED", () => {
    const combined = /SPEAKER_VIEW_PRICED\s*(&&|\|\|)\s*!?\s*SPEAKER_FRAMES_PRICED|SPEAKER_FRAMES_PRICED\s*(&&|\|\|)\s*!?\s*SPEAKER_VIEW_PRICED/
    const offenders = files
      .map((f) => f.slice(REPO_ROOT.length + 1))
      .filter((rel) => rel !== THE_PREDICATE)
      .filter((rel) => combined.test(readFileSync(join(REPO_ROOT, rel), "utf8")))
    expect(offenders, "call speakerViewVideoModeLive() / speakerViewVideoModeRefusal() instead").toEqual([])
  })
})
