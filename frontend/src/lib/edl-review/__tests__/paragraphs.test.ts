import { describe, it, expect } from "vitest"
import { normalizeTranscript } from "@nodaro/shared"
import { buildParagraphs, PARAGRAPH_MAX_WORDS } from "../paragraphs"

const w = (text: string, startMs: number, endMs: number, speaker?: string) => ({
  text,
  startMs,
  endMs,
  ...(speaker ? { speaker } : {}),
})
const transcriptOf = (words: ReturnType<typeof w>[], segments?: Array<{ startMs: number; endMs: number; text: string }>) =>
  normalizeTranscript({ version: 1, words, ...(segments ? { segments } : {}) })
const ranges = (t: ReturnType<typeof transcriptOf>) => buildParagraphs(t).map((p) => [p.first, p.end])

/** `n` contiguous words of one speaker, 100 ms each; the indices in `ends` end a sentence. */
const monologue = (n: number, ends: number[] = [], text = (i: number) => `w${i}`) =>
  Array.from({ length: n }, (_, i) => w(`${text(i)}${ends.includes(i) ? "." : ""}`, i * 150, i * 150 + 100, "A"))

describe("buildParagraphs: the transcript as timestamped speaker paragraphs", () => {
  it("an empty transcript, or one without word timings, has no paragraphs (its segments are the rows)", () => {
    expect(buildParagraphs(transcriptOf([]))).toEqual([])
    expect(buildParagraphs(transcriptOf([], [{ startMs: 0, endMs: 900, text: "Hello there." }]))).toEqual([])
  })

  it("with speakers: one paragraph per turn, timestamped by its words; a long pause inside a turn does not split it", () => {
    const t = transcriptOf([
      w("So", 0, 200, "A"),
      w("the", 250, 400, "A"),
      w("thing.", 5000, 5300, "A"),
      w("Right.", 5400, 5700, "B"),
      w("And", 6000, 6200, "A"),
    ])
    expect(buildParagraphs(t)).toEqual([
      { first: 0, end: 3, startMs: 0, endMs: 5300, speaker: "A" },
      { first: 3, end: 4, startMs: 5400, endMs: 5700, speaker: "B" },
      { first: 4, end: 5, startMs: 6000, endMs: 6200, speaker: "A" },
    ])
  })

  it("the transcript's own segments come first: a paragraph starts at each segment, whoever speaks", () => {
    const t = transcriptOf(
      [w("Hi", 0, 200, "A"), w("hey", 500, 700, "B"), w("So", 3100, 3300, "A"), w("yes", 3400, 3600, "A")],
      [{ startMs: 0, endMs: 3000, text: "Hi hey" }, { startMs: 3000, endMs: 9000, text: "So yes" }],
    )
    expect(buildParagraphs(t)).toEqual([
      { first: 0, end: 2, startMs: 0, endMs: 700, speaker: "A" },
      { first: 2, end: 4, startMs: 3100, endMs: 3600, speaker: "A" },
    ])
  })

  it("with neither segments nor speakers: a paragraph breaks at a pause of 2 s or more", () => {
    const t = transcriptOf([w("a", 0, 200), w("b", 300, 500), w("c", 2500, 2700), w("d", 2800, 3000), w("e", 4999, 5100)])
    expect(buildParagraphs(t)).toEqual([
      { first: 0, end: 2, startMs: 0, endMs: 500 },
      { first: 2, end: 5, startMs: 2500, endMs: 5100 },
    ])
  })

  it("a long turn breaks after its last sentence end within ~60 words (from word 20 on)", () => {
    expect(PARAGRAPH_MAX_WORDS).toBe(60)
    expect(ranges(transcriptOf(monologue(150, [29, 44, 99])))).toEqual([[0, 45], [45, 100], [100, 150]])
  })

  it("with no usable sentence end, it breaks at exactly 60 words", () => {
    expect(ranges(transcriptOf(monologue(130)))).toEqual([[0, 60], [60, 120], [120, 130]])
    // A sentence end before word 20 would leave a stub paragraph: not used.
    expect(ranges(transcriptOf(monologue(70, [10])))).toEqual([[0, 60], [60, 70]])
  })

  it("reads sentence ends the way transcripts write them: a leading space, closing quotes, ? ! … 。", () => {
    const words = monologue(70, [], (i) => (i === 21 ? " it.”" : i === 50 ? " why?)" : ` w${i}`))
    expect(ranges(transcriptOf(words))).toEqual([[0, 51], [51, 70]])
    const ja = monologue(70, [], (i) => (i === 30 ? "です。" : "ね"))
    expect(ranges(transcriptOf(ja))).toEqual([[0, 31], [31, 70]])
  })

  it("a paragraph ends at its latest word end, even when crosstalk ends earlier", () => {
    const [p] = buildParagraphs(transcriptOf([w("long", 0, 900, "A"), w("short", 100, 300, "A")]))
    expect(p).toEqual({ first: 0, end: 2, startMs: 0, endMs: 900, speaker: "A" })
  })
})
