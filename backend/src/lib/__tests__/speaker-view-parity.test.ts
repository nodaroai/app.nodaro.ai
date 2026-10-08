/**
 * The app's Speaker View rule against the cloud plugin's (C3.2, SV24 relaxed,
 * the late-camera SNAP). The rule in `@nodaro/render-rules` MIRRORS what the
 * plugin's route refuses, so the editor's badge says "refused" for exactly the
 * edits the plugin refuses. The fixture is the plugin's own answer to each
 * case (see `fixtures/README.md` to regenerate it); this test fails the moment
 * the two disagree — a plugin rule that moved, or an app rule that drifted.
 *
 * Scope per case: `verdict` compares only refused-or-not and the refusal code
 * (the plugin splits unnamed segments at transcript turns, which the public
 * app does not copy); `full` also compares the layout each segment is DRAWN
 * with, the cameras it shows, and the late-camera notes.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import {
  coerceSpeakerViewEdl,
  findSpeakerViewIssues,
  layOutSpeakerView,
  resolveSpeakerViewAspect,
  speakerViewSlotSet,
  type SpeakerViewIssueCode,
  type SpeakerViewSettings,
} from "@nodaro/render-rules"
import { resolveEdlSegmentSlots, transcriptSpeakerLabels } from "@nodaro/shared"

interface ParityCase {
  name: string
  scope: "verdict" | "full"
  edl: unknown
  transcript?: unknown
  transcriptAsString?: boolean
  settings?: SpeakerViewSettings
  expected: {
    refusal: "invalid_edl" | "unsupported_setting" | "too_long" | null
    message?: string
    segments?: Array<{ id: string; mode: string; slots: string[] }>
    notes?: string[]
  }
}

const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures", "speaker-view-parity.json"), "utf8")) as {
  source: string
  cases: ParityCase[]
}

const transcriptOf = (c: ParityCase) => (c.transcript === undefined ? undefined : c.transcriptAsString ? JSON.stringify(c.transcript) : c.transcript)

/** The checks whose wording is copied from the plugin; the others share only the refusal code. */
const SAME_WORDS: ReadonlySet<SpeakerViewIssueCode> = new Set(["edit", "region", "wire-camera-switch", "no-transcript", "no-speaker-labels", "reads-before-source", "output-cap"])

describe("Speaker View rule: parity with the plugin's route", () => {
  it("names the plugin commit it was generated from, and has the cases it means to", () => {
    expect(fixture.source).toMatch(/nodaro-cloud-plugins .* [0-9a-f]{8}/)
    expect(fixture.cases.length).toBeGreaterThanOrEqual(90)
    expect(new Set(fixture.cases.map((c) => c.name)).size).toBe(fixture.cases.length)
  })

  it("covers every refusal the plugin has, so a new one cannot slip by", () => {
    const codes = new Set(fixture.cases.map((c) => c.expected.refusal))
    expect([...codes].map(String).sort()).toEqual(["invalid_edl", "null", "too_long", "unsupported_setting"])
  })

  describe.each(fixture.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const verdict = findSpeakerViewIssues({ edl: c.edl, transcript: transcriptOf(c), settings: c.settings ?? {} })

    it("is refused exactly when the plugin refuses it", () => {
      expect(verdict.ok, JSON.stringify(verdict.issues)).toBe(c.expected.refusal === null)
      if (c.expected.refusal === null) return
      expect(verdict.issues[0]?.refusal).toBe(c.expected.refusal)
    })

    if (c.expected.refusal !== null) {
      it("says what the plugin says (for the checks whose wording is copied)", () => {
        const first = verdict.issues[0]!
        if (SAME_WORDS.has(first.code)) expect(`speaker-view: ${first.message}`).toBe(c.expected.message)
      })
      return
    }

    if (c.scope === "full") {
      it("counts the late-camera snaps the plugin counts", () => {
        expect(verdict.notes).toEqual(c.expected.notes)
      })

      it("draws each segment with the plugin's layout and cameras", () => {
        const coerced = coerceSpeakerViewEdl(c.edl)
        if (!("edl" in coerced)) throw new Error("fixture edit must be readable")
        const transcript = transcriptOf(c)
        const labels = transcript === undefined ? [] : transcriptSpeakerLabels(transcript)
        const laid = layOutSpeakerView(coerced.edl, {
          aspect: resolveSpeakerViewAspect(c.settings?.targetAspect, coerced.edl),
          ...(typeof c.settings?.layout === "string" ? { layout: c.settings.layout } : {}),
          speakers: speakerViewSlotSet(coerced.edl, labels),
        })
        const drawn = laid.drawn.segments.map((s) => ({
          id: s.id,
          mode: s.layout?.mode ?? "single",
          slots: resolveEdlSegmentSlots(laid.drawn, s).map((r) => r.source),
        }))
        expect(drawn).toEqual(c.expected.segments)
      })
    }
  })
})
