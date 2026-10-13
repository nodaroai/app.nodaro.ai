import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"
import { captionInputSchema, type CaptionSegmentInput } from "@nodaro/shared"
import { burnCaptionsPlanSchema, validatePlanByType } from "../plan-schemas.js"
import { resolveCaptionSegments } from "../../providers/video/caption-segments.js"

/**
 * A burn-captions plan whose word entries carry only `{ text, startMs, endMs }`.
 *
 * The fixture is the exact `segments` a server-side workflow run sent for an
 * add-captions node wired to a UGC Cards caption plan (a Hebrew script): a hook
 * plate (its own text) and a body whose words came straight from forced
 * alignment, with no `timestampMs` / `confidence`. The render then failed plan
 * validation with `captions.1.timestampMs: … expected number, received undefined`
 * — `captions.0` is the hook plate's text block, which the resolver builds with
 * both keys; every body word after it lacked them. Nothing here is
 * language-specific: an English caption plan's words have the same shape.
 */
const RUN_SEGMENTS: CaptionSegmentInput[] = [
  { look: "clean", text: "כל מודלי ה-AI במקום אחד.", color: "#111111", endMs: 2660, style: "subtitle", startMs: 0, fontSize: 32, position: "top", positionY: 20, uppercase: false, fontFamily: "Rubik", fontWeight: 800, backgroundColor: "#FFFFFF", maxWordsPerLine: 4 },
  {
    look: "outline", color: "#FFFFFF", endMs: 11170, style: "word-highlight", startMs: 2660,
    captions: [
      { text: "זה", endMs: 2820, startMs: 2660 }, { text: "Nodaro,", endMs: 3420, startMs: 2940 }, { text: "קנבס", endMs: 4000, startMs: 3600 },
      { text: "שמריץ", endMs: 4420, startMs: 4059 }, { text: "את", endMs: 4600, startMs: 4460 }, { text: "כולם", endMs: 5020, startMs: 4640 },
      { text: "יחד.", endMs: 5480, startMs: 5080 }, { text: "הקוד", endMs: 5920, startMs: 5600 }, { text: "פתוח", endMs: 6280, startMs: 5940 },
      { text: "ב-GitHub,", endMs: 6900, startMs: 6340 }, { text: "אפשר", endMs: 7320, startMs: 7040 }, { text: "להריץ", endMs: 7640, startMs: 7360 },
      { text: "אצלך.", endMs: 8100, startMs: 7680 }, { text: "מתחיל", endMs: 8560, startMs: 8260 }, { text: "מעשרה", endMs: 9040, startMs: 8600 },
      { text: "דולר", endMs: 9340, startMs: 9100 }, { text: "לחודש.", endMs: 9940, startMs: 9380 }, { text: "כדאי", endMs: 10460, startMs: 10240 },
      { text: "לבדוק.", endMs: 10900, startMs: 10500 },
    ] as CaptionSegmentInput["captions"],
    fontSize: 32, position: "bottom", positionY: 72, uppercase: false, fontFamily: "Rubik", maxWordsPerLine: 3,
  },
]

/** The plan exactly as the add-captions worker builds it for a segments-only request. */
function planFromSegments(segments: CaptionSegmentInput[]): Record<string, unknown> {
  const resolved = resolveCaptionSegments([], segments, { style: "subtitle", position: "bottom", fontSize: 32, explicit: {} })
  return {
    planType: "burn-captions",
    sourceVideo: "https://example.com/overlay.mp4",
    // No shared transcript: the top level falls back to the segments' own words.
    captions: resolved.flatMap((s) => s.captions),
    style: "subtitle",
    position: "bottom",
    fontSize: 32,
    color: "#ffffff",
    segments: resolved,
    fps: 30,
    width: 768,
    height: 1344,
    durationInFrames: 336,
  }
}

describe("burn-captions plan — word entries without timestampMs / confidence", () => {
  it("validates the run's segments and fills both keys with null, top level and per segment", () => {
    const plan = validatePlanByType("burn-captions", planFromSegments(RUN_SEGMENTS)) as unknown as {
      captions: Record<string, unknown>[]
      segments: { captions: Record<string, unknown>[] }[]
    }
    // 1 hook block + 19 body words.
    expect(plan.captions).toHaveLength(20)
    // The hook block (its text wrapped to the segment's words-per-line cap) keeps
    // the timestamp the resolver gave it.
    expect(plan.captions[0]).toMatchObject({ startMs: 0, endMs: 2660, timestampMs: 0, confidence: null })
    for (const c of plan.captions.slice(1)) {
      expect(c).toHaveProperty("timestampMs", null)
      expect(c).toHaveProperty("confidence", null)
    }
    for (const c of plan.segments[1]!.captions) {
      expect(c).toHaveProperty("timestampMs", null)
      expect(c).toHaveProperty("confidence", null)
    }
    // Timings are untouched.
    expect(plan.captions[2]).toMatchObject({ text: "Nodaro,", startMs: 2940, endMs: 3420 })
  })

  it("an explicit timestamp survives the defaults", () => {
    const plan = validatePlanByType("burn-captions", {
      ...planFromSegments(RUN_SEGMENTS),
      captions: [{ text: "hi", startMs: 100, endMs: 400, timestampMs: 120, confidence: 0.9 }],
    }) as unknown as { captions: Record<string, unknown>[] }
    expect(plan.captions[0]).toMatchObject({ timestampMs: 120, confidence: 0.9 })
  })
})

describe("burn-captions plan — one caption entry schema (guard)", () => {
  it("the plan's word entries, top level and per segment, ARE the add-captions route's entry schema", () => {
    const top = burnCaptionsPlanSchema.shape.captions.element
    const segment = burnCaptionsPlanSchema.shape.segments.unwrap().element.shape.captions.element
    expect(top).toBe(captionInputSchema)
    expect(segment).toBe(captionInputSchema)
  })

  it("no backend schema requires timestampMs without defaulting it (an absent key must never fail a paid render)", () => {
    const root = join(__dirname, "..", "..")
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) {
          if (name !== "__tests__" && name !== "node_modules") walk(path)
          continue
        }
        if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue
        readFileSync(path, "utf8").split("\n").forEach((line, i) => {
          if (/\btimestampMs:\s*z\./.test(line) && !line.includes(".default(null)")) offenders.push(`${relative(root, path)}:${i + 1}`)
        })
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})
