/**
 * Transcripts whose cuts collapse into runs (R11 of the inspectors design),
 * for the review inspector's tests.
 */
// A run of cut paragraphs 60 s or longer collapses (R11): "off topic" is one.
export const COLLAPSING = {
  plan: {
    version: 1,
    clock: "master",
    sources: [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }],
    segments: [
      { id: "s0", inMs: 0, outMs: 5000, video: "cam" },
      { id: "s1", inMs: 80000, outMs: 85000, video: "cam" },
    ],
    dropped: [{ inMs: 5000, outMs: 80000, reason: "tangent" }],
  },
  transcript: {
    version: 1,
    words: [
      { text: "hello", startMs: 100, endMs: 500, speaker: "A" },
      { text: "off", startMs: 20000, endMs: 20400, speaker: "B" },
      { text: "topic", startMs: 30000, endMs: 30400, speaker: "B" },
      { text: "back", startMs: 80100, endMs: 80500, speaker: "A" },
    ],
  },
}

// Three speaker turns cut whole (B, C, D): a run of three paragraphs, "off topic" its first.
export const THREE_PARAGRAPH_RUN = {
  plan: COLLAPSING.plan,
  transcript: {
    version: 1,
    words: [
      { text: "hello", startMs: 100, endMs: 500, speaker: "A" },
      { text: "off", startMs: 20000, endMs: 20400, speaker: "B" },
      { text: "topic", startMs: 30000, endMs: 30400, speaker: "B" },
      { text: "more", startMs: 40000, endMs: 40400, speaker: "C" },
      { text: "stuff", startMs: 50000, endMs: 50400, speaker: "C" },
      { text: "again", startMs: 60000, endMs: 60400, speaker: "D" },
      { text: "back", startMs: 80100, endMs: 80500, speaker: "A" },
    ],
  },
}

// Two tangents of 75 s, each one paragraph that says "topic".
export const TWO_RUNS = {
  plan: {
    version: 1,
    clock: "master",
    sources: [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }],
    segments: [
      { id: "s0", inMs: 0, outMs: 5000, video: "cam" },
      { id: "s1", inMs: 80000, outMs: 85000, video: "cam" },
      { id: "s2", inMs: 160000, outMs: 165000, video: "cam" },
    ],
    dropped: [{ inMs: 5000, outMs: 80000, reason: "tangent" }, { inMs: 85000, outMs: 160000, reason: "tangent" }],
  },
  transcript: {
    version: 1,
    words: [
      { text: "hello", startMs: 100, endMs: 500, speaker: "A" },
      { text: "off", startMs: 20000, endMs: 20400, speaker: "B" },
      { text: "topic", startMs: 30000, endMs: 30400, speaker: "B" },
      { text: "back", startMs: 80100, endMs: 80500, speaker: "A" },
      { text: "another", startMs: 100000, endMs: 100400, speaker: "B" },
      { text: "topic", startMs: 110000, endMs: 110400, speaker: "B" },
      { text: "end", startMs: 160100, endMs: 160500, speaker: "A" },
    ],
  },
}

// Forty one-word turns, two seconds apart; turns 2–4 and 30–32 are cut whole.
export function manyTurns() {
  const words = Array.from({ length: 40 }, (_, i) => ({ text: `w${i}`, startMs: i * 2000 + 100, endMs: i * 2000 + 500, speaker: i % 2 ? "B" : "A" }))
  return {
    plan: {
      version: 1,
      clock: "master",
      sources: [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }],
      segments: [
        { id: "s0", inMs: 0, outMs: 4000, video: "cam" },
        { id: "s1", inMs: 10000, outMs: 60000, video: "cam" },
        { id: "s2", inMs: 66000, outMs: 80000, video: "cam" },
      ],
      dropped: [{ inMs: 4000, outMs: 10000, reason: "tangent" }, { inMs: 60000, outMs: 66000, reason: "tangent" }],
    },
    transcript: { version: 1, words },
  }
}

