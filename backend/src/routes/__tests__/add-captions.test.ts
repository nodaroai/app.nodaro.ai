import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { KINETIC_ONLY_CAPTION_LEVER_KEYS, CAPTION_LEVER_BOUNDS } from "@nodaro/shared/captions"
import { addCaptionsBody } from "../add-captions.js"

const VIDEO = "https://example.com/clip.mp4"

type ParseResult = ReturnType<typeof addCaptionsBody.safeParse>
function issuePaths(result: ParseResult): string[] {
  return result.success ? [] : result.error.issues.map((i) => i.path.map(String).join("."))
}

describe("addCaptionsBody — look levers gate on kinetic style", () => {
  it("accepts a kinetic style with the full look (incl. look preset + fontWeight)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      text: "hello world",
      style: "tiktok-words",
      look: "outline",
      fontFamily: "Montserrat",
      fontWeight: 900,
      strokeColor: "#000000",
      strokeWidth: 6,
      highlightColor: "#22ff88",
      uppercase: true,
      positionY: 65,
    })
    expect(r.success).toBe(true)
  })

  it("ACCEPTS a styling lever on the static subtitle style (a styled subtitle routes to the Remotion SubtitleOverlay, which applies it)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      text: "hello",
      // style omitted → defaults to "subtitle"
      fontFamily: "Montserrat",
    })
    expect(r.success).toBe(true)
  })

  it("ACCEPTS every STYLING lever at once on subtitle (look/font/weight/stroke/uppercase/positionY route to Remotion)", () => {
    // The styling levers are honoured by the Remotion SubtitleOverlay, so a
    // subtitle carrying them is valid — they are NO LONGER rejected. Only the
    // kinetic-only levers (highlightColor/animate) stay rejected on subtitle.
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      text: "hi",
      style: "subtitle",
      look: "outline",
      fontFamily: "Anton",
      fontWeight: 700,
      strokeColor: "#000000",
      strokeWidth: 4,
      uppercase: true,
      positionY: 50,
    })
    expect(r.success).toBe(true)
  })

  it("rejects EACH kinetic-only lever on subtitle, by its own path (data-driven from the shared constant)", () => {
    // KINETIC_ONLY_CAPTION_LEVER_KEYS is the single source the route iterates to
    // reject; the test derives from it too, so narrowing/growing the set can't
    // leave this guard asserting a stale hardcoded list.
    for (const k of KINETIC_ONLY_CAPTION_LEVER_KEYS) {
      const value: unknown = k === "animate" ? true : "#22ff88"
      const r = addCaptionsBody.safeParse({ videoUrl: VIDEO, text: "hi", style: "subtitle", [k]: value })
      expect(r.success, `${k} should be rejected on subtitle`).toBe(false)
      expect(issuePaths(r)).toContain(k)
    }
  })

  it("ACCEPTS the look preset on subtitle (a styled subtitle routes to the Remotion SubtitleOverlay)", () => {
    const r = addCaptionsBody.safeParse({ videoUrl: VIDEO, text: "hi", style: "subtitle", look: "outline" })
    expect(r.success).toBe(true)
  })

  it("rejects a fontWeight that is not a 100-step (100–900) even on a kinetic style", () => {
    const notStep = addCaptionsBody.safeParse({ videoUrl: VIDEO, text: "hi", style: "word-pop", fontWeight: 650 })
    expect(notStep.success).toBe(false)
    expect(issuePaths(notStep)).toContain("fontWeight")
    const outOfRange = addCaptionsBody.safeParse({ videoUrl: VIDEO, text: "hi", style: "word-pop", fontWeight: 1000 })
    expect(outOfRange.success).toBe(false)
    const unknownLook = addCaptionsBody.safeParse({ videoUrl: VIDEO, text: "hi", style: "word-pop", look: "sparkles" })
    expect(unknownLook.success).toBe(false)
    expect(issuePaths(unknownLook)).toContain("look")
  })

  it("plain subtitle with no look still parses", () => {
    const r = addCaptionsBody.safeParse({ videoUrl: VIDEO, text: "hello" })
    expect(r.success).toBe(true)
  })

  it("rejects an unknown font face on a kinetic style", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      text: "hi",
      style: "karaoke",
      fontFamily: "NotARealFont",
    })
    expect(r.success).toBe(false)
    expect(issuePaths(r)).toContain("fontFamily")
  })

  it("accepts word-level captions[] omitting timestampMs/confidence (now optional)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      style: "word-highlight",
      captions: [
        { text: "face", startMs: 0, endMs: 300 },
        { text: "doesn't", startMs: 300, endMs: 700 },
      ],
    })
    expect(r.success).toBe(true)
    if (r.success) {
      // Omitted fields default to null (a valid @remotion/captions Caption).
      expect(r.data.captions?.[0]?.timestampMs).toBeNull()
      expect(r.data.captions?.[0]?.confidence).toBeNull()
    }
  })

  it("still requires a caption source", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      style: "tiktok-words",
      auto_transcribe: false,
    })
    expect(r.success).toBe(false)
  })
})

describe("addCaptionsBody — Transcript input + wordLevel", () => {
  const TRANSCRIPT = { version: 1, words: [{ text: "hello", startMs: 0, endMs: 300 }] }

  it("accepts a transcript on a kinetic style, with wordLevel", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      style: "karaoke",
      transcript: TRANSCRIPT,
      wordLevel: true,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.wordLevel).toBe(true)
  })

  it("a transcript is a caption source on its own (auto_transcribe:false, no text)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      style: "word-pop",
      auto_transcribe: false,
      transcript: TRANSCRIPT,
    })
    expect(r.success).toBe(true)
  })

  it("ACCEPTS a transcript on the static subtitle style (it routes to Remotion and renders as timed phrase lines)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      // style omitted → defaults to "subtitle"
      transcript: TRANSCRIPT,
    })
    expect(r.success).toBe(true)
  })

  it("accepts a transcript alongside segments regardless of top-level style (all-Remotion render)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      transcript: TRANSCRIPT,
      segments: [{ startMs: 0, endMs: 3000 }],
    })
    expect(r.success).toBe(true)
  })
})

describe("addCaptionsBody — per-segment captions", () => {
  it("accepts non-overlapping segments with per-segment style/position/look + own text", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      auto_transcribe: false,
      segments: [
        { startMs: 0, endMs: 3000, style: "subtitle", position: "top", fontSize: 96, look: "outline", fontFamily: "Anton", fontWeight: 400, text: "Same face, every shot. No re-prompting." },
        { startMs: 3000, endMs: 12000, style: "word-pop", position: "bottom", fontSize: 48, look: "clean", uppercase: true, text: "Studio. Drift. Not once." },
      ],
    })
    // A look lever on a subtitle SEGMENT is fine — a segmented render is all
    // Remotion, so the subtitle overlay honours it (unlike the static path).
    expect(r.success).toBe(true)
  })

  it("rejects an invalid per-segment look/fontWeight (segment schema mirrors the top-level constraints)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      auto_transcribe: false,
      segments: [{ startMs: 0, endMs: 3000, look: "sparkles", fontWeight: 650, text: "x" }],
    })
    expect(r.success).toBe(false)
  })

  it("rejects overlapping segments", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      auto_transcribe: false,
      segments: [
        { startMs: 0, endMs: 4000, text: "a" },
        { startMs: 3000, endMs: 8000, text: "b" },
      ],
    })
    expect(r.success).toBe(false)
    expect(issuePaths(r)).toContain("segments")
  })

  it("rejects a segment whose endMs is not after startMs", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      auto_transcribe: false,
      segments: [{ startMs: 3000, endMs: 3000, text: "x" }],
    })
    expect(r.success).toBe(false)
  })

  it("allows a top-level look lever with segments present (segmented render is all Remotion, so no subtitle rejection)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      // style defaults to subtitle; with segments the top-level uppercase is a
      // default for segments, not a rejected FFmpeg-path lever.
      uppercase: true,
      segments: [{ startMs: 0, endMs: 3000, text: "hi" }],
    })
    expect(r.success).toBe(true)
  })

  it("requires a source: rejects self-unsourced segments with no shared transcript", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      auto_transcribe: false, // no shared transcript
      segments: [
        { startMs: 0, endMs: 3000, text: "has text" },
        { startMs: 3000, endMs: 6000 }, // no own text/captions AND no shared source
      ],
    })
    expect(r.success).toBe(false)
  })

  it("accepts self-unsourced segments when a shared transcript is available", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      // auto_transcribe defaults to attempted → shared transcript available.
      segments: [{ startMs: 0, endMs: 3000 }],
    })
    expect(r.success).toBe(true)
  })

  it("rejects whitespace-only segment text (would synthesise to zero words → render fail)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      auto_transcribe: false,
      segments: [{ startMs: 0, endMs: 3000, text: "   " }],
    })
    expect(r.success).toBe(false)
  })

  it("rejects whitespace-only top-level text", () => {
    const r = addCaptionsBody.safeParse({ videoUrl: VIDEO, style: "word-pop", text: "\t \n" })
    expect(r.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// transcribe_provider × word timings
//
// Auto-transcription feeds WORD timings to the kinetic / segmented render.
// openai/whisper cannot produce them (Replicate has no such input), and the
// worker SKIPS the vendor call for such a lane rather than earning
// `transcribe()`'s refusal — so the request is only impossible when
// transcription is the ONLY caption source the render could have. That exact
// case is rejected at ingress; anything the worker can still render passes.
// ---------------------------------------------------------------------------

describe("addCaptionsBody — transcribe_provider must be able to do word timings", () => {
  it("rejects whisper for a kinetic style that will auto-transcribe", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      style: "word-highlight",
      transcribe_provider: "whisper",
    })
    expect(r.success).toBe(false)
    expect(issuePaths(r)).toContain("transcribe_provider")
  })

  it("rejects whisper for a segmented render whose shared-transcript segment is KINETIC", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      transcribe_provider: "whisper",
      // Second segment carries no own words → needs the shared transcript, and
      // its kinetic style needs that transcript to be word-timed.
      segments: [
        { startMs: 0, endMs: 3000, text: "own words" },
        { startMs: 3000, endMs: 6000, style: "karaoke" },
      ],
    })
    expect(r.success).toBe(false)
    expect(issuePaths(r)).toContain("transcribe_provider")
  })

  it("ACCEPTS whisper when the shared-transcript segments are SUBTITLE (phrase lines need no word timings)", () => {
    // A subtitle segment draws whole lines, so the worker asks the lane for
    // phrase segments — which whisper returns. Rejecting this would refuse a
    // render the worker can serve.
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      transcribe_provider: "whisper",
      segments: [
        { startMs: 0, endMs: 3000, text: "own words" },
        { startMs: 3000, endMs: 6000 },
      ],
    })
    expect(r.success).toBe(true)
  })

  it("names the capable providers in the message", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      style: "karaoke",
      transcribe_provider: "whisper",
    })
    expect(r.success).toBe(false)
    const msg = r.success ? "" : r.error.issues.map((i) => i.message).join(" ")
    expect(msg).toContain("incredibly-fast-whisper")
    expect(msg).toContain("elevenlabs-stt")
  })

  it.each(["incredibly-fast-whisper", "elevenlabs-stt"])(
    "accepts %s for a kinetic auto-transcribe render",
    (provider) => {
      const r = addCaptionsBody.safeParse({
        videoUrl: VIDEO,
        style: "word-highlight",
        transcribe_provider: provider,
      })
      expect(r.success).toBe(true)
    },
  )

  // S1 — on a `subtitle` the caller's `text` IS the caption, so no transcription
  // runs at all and the lane's word-timing capability is irrelevant. Ingress must
  // accept the request unchanged (nothing refused, nothing stripped) whichever
  // lane is named and whatever `auto_transcribe` says: the worker's own
  // needTranscribe now shares this predicate (isStaticTextCaptionSource).
  it("accepts a word-less lane on a lever-carrying subtitle whose text IS the source", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      style: "subtitle",
      text: "SALE ENDS\nFRIDAY",
      positionY: 65, // a styling lever → Remotion renders it, still from the text
      transcribe_provider: "whisper",
      auto_transcribe: true,
    })
    expect(r.success).toBe(true)
    // The text survives ingress verbatim — line breaks included.
    expect(r.success && r.data.text).toBe("SALE ENDS\nFRIDAY")
    expect(r.success && r.data.positionY).toBe(65)
  })

  it("accepts whisper when no transcription runs (auto_transcribe: false)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      style: "word-highlight",
      text: "hello world",
      auto_transcribe: false,
      transcribe_provider: "whisper",
    })
    expect(r.success).toBe(true)
  })

  it("accepts whisper when captions[] already supply the words", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      style: "karaoke",
      transcribe_provider: "whisper",
      captions: [{ text: "hi", startMs: 0, endMs: 500 }],
    })
    expect(r.success).toBe(true)
  })

  it("accepts whisper when a transcript is wired (kinetic style, no vendor call)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      style: "karaoke",
      transcribe_provider: "whisper",
      transcript: { version: 1, words: [{ text: "hi", startMs: 0, endMs: 500 }] },
    })
    expect(r.success).toBe(true)
  })

  it("accepts whisper when every segment is self-sourced (no shared transcript needed)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      transcribe_provider: "whisper",
      segments: [
        { startMs: 0, endMs: 3000, text: "a" },
        { startMs: 3000, endMs: 6000, text: "b" },
      ],
    })
    expect(r.success).toBe(true)
  })

  it("accepts whisper on the static subtitle path (no word timings needed there)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      // style defaults to "subtitle" — one fixed FFmpeg overlay, not word-timed.
      transcribe_provider: "whisper",
    })
    expect(r.success).toBe(true)
  })

  it("ACCEPTS whisper for a kinetic render that carries `text` — that text is the fallback source", () => {
    // `text` does not suppress the worker's `needTranscribe`, but it IS a
    // caption source: the worker skips the incapable lane and renders the text
    // as evenly-spaced synthetic captions (what this node did before word
    // timings existed). Rejecting it would break a previously-working call, so
    // the rejection is reserved for renders with no other source at all.
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      style: "word-pop",
      text: "hello world",
      transcribe_provider: "whisper",
    })
    expect(r.success).toBe(true)
  })

  it("ACCEPTS whisper for a segmented render whose shared-transcript gap `text` can fill", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      transcribe_provider: "whisper",
      text: "hello world",
      segments: [
        { startMs: 0, endMs: 3000, text: "own words" },
        { startMs: 3000, endMs: 6000 },
      ],
    })
    expect(r.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Static styled subtitle — the new accept/reject boundary on `subtitle`.
// A styling lever (position/casing/stroke/font/look) now routes a subtitle to
// the Remotion SubtitleOverlay, so it PARSES; only highlightColor/animate stay
// rejected on subtitle (no per-word cursor, no motion to switch off).
// ---------------------------------------------------------------------------
describe("addCaptionsBody — subtitle styling levers", () => {
  it("ACCEPTS positionY / uppercase / stroke on a plain-text subtitle (valid parse)", () => {
    const r = addCaptionsBody.safeParse({
      videoUrl: VIDEO,
      text: "hello world",
      style: "subtitle",
      positionY: 80,
      uppercase: true,
      strokeColor: "#000000",
      strokeWidth: 6,
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.positionY).toBe(80)
      expect(r.data.uppercase).toBe(true)
      expect(r.data.strokeColor).toBe("#000000")
      expect(r.data.strokeWidth).toBe(6)
    }
  })

  it("REJECTS highlightColor on subtitle (no per-word spoken cursor to colour)", () => {
    const r = addCaptionsBody.safeParse({ videoUrl: VIDEO, text: "hi", style: "subtitle", highlightColor: "#FFE600" })
    expect(r.success).toBe(false)
    expect(issuePaths(r)).toContain("highlightColor")
  })

  it("REJECTS animate on subtitle (no motion to switch off)", () => {
    const r = addCaptionsBody.safeParse({ videoUrl: VIDEO, text: "hi", style: "subtitle", animate: false })
    expect(r.success).toBe(false)
    expect(issuePaths(r)).toContain("animate")
  })

  it("still ACCEPTS a plain-text subtitle with no lever at all (the cheap FFmpeg path)", () => {
    const r = addCaptionsBody.safeParse({ videoUrl: VIDEO, text: "hello world", style: "subtitle" })
    expect(r.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// buildAddCaptionsCreditId is module-PRIVATE (not exported), so — as the CLAUDE.md
// note directs — it is exercised here by a source guard rather than imported. The
// full kinetic-vs-plain truth table lives on captionRoutesToRemotion (the predicate
// this fn maps 1:1 from) in packages/shared/src/__tests__/caption-styles.test.ts.
// This pins the wiring: the credit id is derived from that predicate, never a
// separate hand-rolled style check that could drift from the renderer.
// ---------------------------------------------------------------------------
describe("buildAddCaptionsCreditId follows the renderer (source guard)", () => {
  const src = readFileSync(join(__dirname, "..", "add-captions.ts"), "utf8")
  it("derives the credit id from captionRoutesToRemotion, not a bespoke style check", () => {
    expect(src).toContain("function buildAddCaptionsCreditId")
    expect(src).toContain("captionRoutesToRemotion({")
  })
  it("bills a Remotion render as add-captions:kinetic and a plain-text burn as add-captions", () => {
    expect(src).toContain('"add-captions:kinetic"')
    expect(src).toContain('"add-captions"')
  })
})

// The numeric lever limits live in THREE places that must agree: this route's
// Zod, the render-plan schema, and @nodaro/shared's CAPTION_LEVER_BOUNDS (which
// payload-builder uses to COERCE authored node data). This pins the route to the
// shared bounds so a future edit to one cannot silently strand the others.
describe("addCaptionsBody numeric lever bounds = CAPTION_LEVER_BOUNDS", () => {
  const base = { videoUrl: "https://example.com/v.mp4", style: "word-highlight", text: "hi" }
  it.each(Object.entries(CAPTION_LEVER_BOUNDS))("%s accepts [min,max] and rejects just outside", (key, { min, max }) => {
    const step = key === "fontWeight" ? 100 : 1
    expect(addCaptionsBody.safeParse({ ...base, [key]: min }).success, `${key}=min`).toBe(true)
    expect(addCaptionsBody.safeParse({ ...base, [key]: max }).success, `${key}=max`).toBe(true)
    expect(addCaptionsBody.safeParse({ ...base, [key]: min - step }).success, `${key}<min`).toBe(false)
    expect(addCaptionsBody.safeParse({ ...base, [key]: max + step }).success, `${key}>max`).toBe(false)
  })
})
