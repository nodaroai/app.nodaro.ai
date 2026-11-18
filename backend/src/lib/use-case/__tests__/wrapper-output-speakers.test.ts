/**
 * A run's speakers (`speakers`): each transcript label in first-heard order,
 * the name the request gave it (never a guessed one), and how long they talk.
 */
import { describe, it, expect } from "vitest"
import {
  CLIP_PACK_DEFAULTS,
  TIGHTEN_EPISODE_DEFAULTS,
  buildClipPackGraph,
  buildSpeakerLayoutGraph,
  buildTightenEpisodeGraph,
  resolveSpeakerLayoutSettings,
  resolveTightenEpisodeSettings,
  toStoredInlineGraph,
} from "@nodaro/render-rules"
import { usecaseWrapperOutput } from "../wrapper-output.js"
import { USE_CASE_TALK_GAP_MS, usecaseSpeakers } from "../wrapper-output-speakers.js"
import { usecaseJobOutput } from "../../../services/workflow-engine/use-case-output.js"

const word = (startMs: number, endMs: number, speaker?: string, text = " w") => ({ text, startMs, endMs, ...(speaker ? { speaker } : {}) })
/** speaker_1 speaks first; speaker_0 answers; speaker_1 pauses past the gap mid-thought. */
const transcript = {
  version: 1,
  words: [
    word(1_000, 1_400, "speaker_1"), word(1_500, 2_000, "speaker_1"),
    word(2_200, 2_600, "speaker_0"), word(2_600, 3_000, "speaker_0"),
    word(3_100, 3_500, "speaker_1"),
    // A pause of more than the gap: not counted as talk.
    word(3_500 + USE_CASE_TALK_GAP_MS + 1, 3_500 + USE_CASE_TALK_GAP_MS + 501, "speaker_1"),
  ],
}

describe("usecaseSpeakers", () => {
  it("the pause that ends a run of talk is 0.7 s: the figure docs/nodes/processing-video/tighten-episode.md and speaker-layout.md state", () => {
    expect(USE_CASE_TALK_GAP_MS).toBe(700)
  })
  it("first-heard order; talk is each run of a speaker's words, a pause shorter than the gap kept inside it", () => {
    expect(usecaseSpeakers(transcript)).toEqual([
      // 1000–2000 (the 100 ms pause is kept), 3100–3500, then 500 ms after the long pause.
      { label: "speaker_1", talkMs: 1_000 + 400 + 500 },
      { label: "speaker_0", talkMs: 800 },
    ])
  })
  it("a pause of the gap or longer splits a run; another speaker's word always does", () => {
    const t = { words: [word(0, 1_000, "a"), word(1_000 + USE_CASE_TALK_GAP_MS, 2_000 + USE_CASE_TALK_GAP_MS, "a"), word(5_000, 6_000, "a"), word(6_100, 6_200, "b"), word(6_300, 7_000, "a")] }
    expect(usecaseSpeakers(t)).toEqual([{ label: "a", talkMs: 1_000 + 1_000 + 1_000 + 700 }, { label: "b", talkMs: 100 }])
  })
  it("names come from the request alone, trimmed; a name for a label nobody spoke, or a blank one, is dropped", () => {
    expect(usecaseSpeakers(transcript, { speaker_0: "  Dana  ", speaker_9: "Ghost", speaker_1: "   " })).toEqual([
      { label: "speaker_1", talkMs: 1_900 },
      { label: "speaker_0", name: "Dana", talkMs: 800 },
    ])
  })
  it("only a name the request gave: a label that is also an Object property has none", () => {
    const t = { words: [word(0, 500, "constructor"), word(600, 900, "toString")] }
    expect(usecaseSpeakers(t, { speaker_0: "Dana" })).toEqual([{ label: "constructor", talkMs: 500 }, { label: "toString", talkMs: 300 }])
  })
  it("words without a speaker are not anyone's talk", () => {
    expect(usecaseSpeakers({ words: [word(0, 500), word(600, 900, "a")] })).toEqual([{ label: "a", talkMs: 300 }])
  })
  it("no speaker labels, no transcript, or not a transcript: no speakers", () => {
    expect(usecaseSpeakers({ words: [word(0, 500)] })).toEqual([])
    expect(usecaseSpeakers(undefined)).toEqual([])
    expect(usecaseSpeakers("{not json")).toEqual([])
  })
  it("a JSON-string transcript reads the same", () => {
    expect(usecaseSpeakers(JSON.stringify(transcript))).toEqual(usecaseSpeakers(transcript))
  })
})

describe("the runs that report speakers", () => {
  const done = (output: Record<string, unknown>) => ({ status: "completed", output })
  const RECORDING_MS = 10_000

  it("Tighten Episode: from the transcribe step, with the names the job kept", () => {
    const g = toStoredInlineGraph(buildTightenEpisodeGraph(TIGHTEN_EPISODE_DEFAULTS, { media: { url: "https://r2/ep.mp4", kind: "video" } }), TIGHTEN_EPISODE_DEFAULTS)
    const out = usecaseWrapperOutput(g, {
      "uc-transcribe": done({ json: transcript }),
      "uc-render": done({ videoUrl: "https://r2/cut.mp4", quality: "final" }),
      "uc-captions": done({ videoUrl: "https://r2/c.mp4" }),
    }, "e", { speakerNames: { speaker_1: "Avi" } })
    expect(out.speakers).toEqual([{ label: "speaker_1", name: "Avi", talkMs: 1_900 }, { label: "speaker_0", talkMs: 800 }])
    for (const s of out.speakers ?? []) {
      expect(s.talkMs).toBeGreaterThanOrEqual(0)
      expect(s.talkMs).toBeLessThanOrEqual(RECORDING_MS)
    }
  })

  it("Tighten Episode on several cameras: the speakers line up with the cameras report", () => {
    const settings = resolveTightenEpisodeSettings({ captions: false }, "video", { recordings: 2, masterAudio: false })
    const g = toStoredInlineGraph(buildTightenEpisodeGraph(settings, { media: { url: "https://r2/c1.mp4", kind: "video" }, moreMedia: [{ url: "https://r2/c2.mp4", kind: "video" }] }), settings)
    const out = usecaseWrapperOutput(g, {
      "uc-map": done({ json: { version: 1, speakerMap: { speaker_0: "uc-cam-2", speaker_1: "uc-source" }, confidence: {}, notes: [] } }),
      "uc-transcribe": done({ json: transcript }),
      "uc-render": done({ videoUrl: "https://r2/cut.mp4", quality: "final" }),
    }, "e")
    expect(out.speakers?.map((s) => s.label)).toEqual(out.cameras?.speakers.map((s) => s.speaker))
  })

  it("Speaker Layout: from the transcribe step, never the transcript its render renamed", () => {
    const settings = resolveSpeakerLayoutSettings({ framingSource: "static" }, "video")
    const g = toStoredInlineGraph(buildSpeakerLayoutGraph(settings, { media: { url: "https://r2/c1.mp4", kind: "video" } }), settings)
    const renamed = { words: transcript.words.map((w) => ({ ...w, speaker: w.speaker === "speaker_0" ? "Dana" : "Avi" })), speakerNames: { speaker_0: "Dana", speaker_1: "Avi" } }
    const out = usecaseWrapperOutput(g, {
      "uc-transcribe": done({ json: transcript }),
      "uc-render": done({ videoUrl: "https://r2/out.mp4", transcript: renamed, quality: "final" }),
    }, "e", { speakerNames: { speaker_0: "Dana" } })
    expect(out.speakers).toEqual([{ label: "speaker_1", talkMs: 1_900 }, { label: "speaker_0", name: "Dana", talkMs: 800 }])
    // The transcript the run already reported is unchanged.
    expect(out.transcript).toEqual(renamed)
  })

  it("no speaker labels in the transcript, or no transcript: no speakers field", () => {
    const g = toStoredInlineGraph(buildTightenEpisodeGraph(TIGHTEN_EPISODE_DEFAULTS, { media: { url: "https://r2/ep.mp4", kind: "video" } }), TIGHTEN_EPISODE_DEFAULTS)
    const render = { "uc-render": done({ videoUrl: "https://r2/cut.mp4" }), "uc-captions": done({ videoUrl: "https://r2/c.mp4" }) }
    expect(usecaseWrapperOutput(g, { ...render, "uc-transcribe": done({ json: { words: [word(0, 500)] } }) }, "e", { speakerNames: { speaker_0: "Dana" } })).not.toHaveProperty("speakers")
    expect(usecaseWrapperOutput(g, render, "e")).not.toHaveProperty("speakers")
  })

  it("a Clip Pack run does not report them", () => {
    const g = toStoredInlineGraph(buildClipPackGraph(CLIP_PACK_DEFAULTS, { media: { url: "https://r2/ep.mp4", kind: "video" } }), CLIP_PACK_DEFAULTS)
    expect(usecaseWrapperOutput(g, { "uc-transcribe": done({ json: transcript }) }, "e")).not.toHaveProperty("speakers")
  })

  it("a job saved before the field shipped reads as it always did on the canvas", () => {
    const old = { videoUrl: "https://r2/c.mp4", quality: "final", durationSec: 60 }
    expect(usecaseJobOutput({ ...old, speakers: usecaseSpeakers(transcript) })).toEqual(usecaseJobOutput(old))
  })
})
