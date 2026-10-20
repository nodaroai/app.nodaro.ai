import { describe, it, expect } from "vitest"
import {
  CLIP_PACK_DEFAULTS,
  EPISODE_CHAPTERS_DEFAULTS,
  EPISODE_TRAILER_DEFAULTS,
  TIGHTEN_EPISODE_DEFAULTS,
  buildClipPackGraph,
  buildEpisodeChaptersGraph,
  buildEpisodeTrailerGraph,
  resolveClipPackSettings,
  resolveEpisodeTrailerSettings,
  buildSpeakerLayoutGraph,
  buildTightenEpisodeGraph,
  clipPackNoneRenderedMessage,
  resolveSpeakerLayoutSettings,
  parseClipPackNoneRendered,
  resolveTightenEpisodeSettings,
  toStoredInlineGraph,
  type TightenEpisodeSettings,
} from "@nodaro/render-rules"
import { usecaseNoClipsRenderedMessage, usecaseNoResultMessage, usecaseWrapperHasResult, usecaseWrapperKeepsPartial, usecaseWrapperOutput, type UseCaseWrapperOutput } from "../wrapper-output.js"
import { usecaseJobOutput } from "../../../services/workflow-engine/use-case-output.js"
import { assembleFanOutResult, type FanOutIterationValue } from "../../../workers/fan-out-result.js"
import { getListFanOutForNode } from "../../../services/workflow-engine/input-resolver.js"
import { EDITED_EDL_VERSION, editPlanBasis, resolveEditPlanOutput } from "@nodaro/shared/edl"
import { edlSpanKey } from "@nodaro/shared/nodes"

const graph = (over: Partial<TightenEpisodeSettings> = {}) => {
  const settings: TightenEpisodeSettings = { ...TIGHTEN_EPISODE_DEFAULTS, ...over }
  return toStoredInlineGraph(buildTightenEpisodeGraph(settings, { media: { url: "https://r2/ep.mp4", kind: "video" } }), settings)
}
const plan = { version: 1, sources: [], segments: [{ id: "s0" }], dropped: [{ reason: "silence" }] }
const words = { words: [{ text: "hi" }] }

describe("usecaseWrapperOutput", () => {
  it("a finished run: the final media, the plan as json, the transcript", () => {
    const out = usecaseWrapperOutput(graph(), {
      "uc-transcribe": { status: "completed", output: { json: words } },
      "uc-plan": { status: "completed", output: { json: plan } },
      "uc-render": { status: "completed", output: { videoUrl: "https://r2/cut.mp4", quality: "final" } },
      "uc-captions": { status: "completed", output: { videoUrl: "https://r2/captioned.mp4" } },
    }, "exec-1")
    expect(out).toEqual({ videoUrl: "https://r2/captioned.mp4", json: plan, plan, transcript: words, quality: "final", useCaseSettings: graph().settings, _executionId: "exec-1" })
  })
  it("a review-on run stopped at the proxy: the preview is the media (captions were gated)", () => {
    const out = usecaseWrapperOutput(graph({ reviewBeforeRender: true }), {
      "uc-plan": { status: "completed", output: { json: plan } },
      "uc-render": { status: "completed", output: { videoUrl: "https://r2/preview.mp4", quality: "proxy" } },
      "uc-captions": { status: "skipped" },
    }, "exec-1")
    expect(out).toMatchObject({ videoUrl: "https://r2/preview.mp4", quality: "proxy" })
  })
  it("a failed run keeps what finished and names the step that failed", () => {
    const out = usecaseWrapperOutput(graph(), {
      "uc-transcribe": { status: "completed", output: { json: words } },
      "uc-plan": { status: "completed", output: { json: plan } },
      "uc-render": { status: "failed", error: "boom" },
    }, "exec-1")
    expect(out).toEqual({ json: plan, plan, transcript: words, quality: "final", useCaseSettings: graph().settings, _executionId: "exec-1", failedNodeId: "uc-render", failedStep: "Apply Cut" })
  })
  it("an audio episode reports audioUrl", () => {
    const settings: TightenEpisodeSettings = { ...TIGHTEN_EPISODE_DEFAULTS, output: "audio", captions: false }
    const g = toStoredInlineGraph(buildTightenEpisodeGraph(settings, { media: { url: "https://r2/ep.m4a", kind: "audio" } }), settings)
    expect(usecaseWrapperOutput(g, { "uc-render": { status: "completed", output: { audioUrl: "https://r2/cut.m4a" } } }, "e").audioUrl).toBe("https://r2/cut.m4a")
  })
  it("reads nothing the graph does not map, and never mutates the states", () => {
    const states = Object.freeze({ "uc-render": Object.freeze({ status: "completed", output: Object.freeze({ videoUrl: "https://r2/cut.mp4" }) }) })
    const g = graph({ captions: false })
    expect(usecaseWrapperOutput(g, states, "e")).toEqual({ videoUrl: "https://r2/cut.mp4", quality: "final", useCaseSettings: g.settings, _executionId: "e" })
  })
  it("stamps the take with its render's bases and names the settings the run was built from", () => {
    const g = graph({ reviewBeforeRender: true, framing: { aspect: "9:16", layout: "stacked" } })
    const out = usecaseWrapperOutput(g, {
      "uc-plan": { status: "completed", output: { json: plan } },
      "uc-render": { status: "completed", output: { videoUrl: "https://r2/preview.mp4", quality: "proxy", planBasis: "aaaaaaaaaaaaaaaa", renderBasis: "bbbbbbbbbbbbbbbb" } },
    }, "exec-1")
    expect(out).toMatchObject({ planBasis: "aaaaaaaaaaaaaaaa", renderBasis: "bbbbbbbbbbbbbbbb" })
    expect(out.useCaseSettings).toMatchObject({ reviewBeforeRender: true, framing: { aspect: "9:16", layout: "stacked" } })
  })

  describe("the episode's length: the cut its render recorded, through every step after it (decided 2026-10-16)", () => {
    const withMusic = (over: Partial<TightenEpisodeSettings> = {}, kind: "video" | "audio" = "video") => {
      const settings: TightenEpisodeSettings = { ...TIGHTEN_EPISODE_DEFAULTS, ...(kind === "audio" ? { output: "audio" as const, captions: false } : {}), ...over }
      return toStoredInlineGraph(buildTightenEpisodeGraph(settings, { media: { url: "https://r2/ep", kind }, music: { url: "https://r2/bed.mp3" } }), settings)
    }
    const render = { status: "completed", output: { videoUrl: "https://r2/cut.mp4", quality: "final", durationSec: 1834.5 } }
    it("through the captions", () => {
      const out = usecaseWrapperOutput(graph(), { "uc-render": render, "uc-captions": { status: "completed", output: { videoUrl: "https://r2/captioned.mp4" } } }, "e")
      expect(out).toMatchObject({ videoUrl: "https://r2/captioned.mp4", durationSec: 1834.5 })
    })
    it("through the captions, the music mix and the merge", () => {
      const out = usecaseWrapperOutput(withMusic(), {
        "uc-render": render,
        "uc-captions": { status: "completed", output: { videoUrl: "https://r2/captioned.mp4" } },
        "uc-mix": { status: "completed", output: { audioUrl: "https://r2/mix.m4a" } },
        "uc-merge": { status: "completed", output: { videoUrl: "https://r2/episode.mp4" } },
      }, "e")
      expect(out).toMatchObject({ videoUrl: "https://r2/episode.mp4", durationSec: 1834.5 })
    })
    it("an audio episode through the music mix", () => {
      const out = usecaseWrapperOutput(withMusic({}, "audio"), {
        "uc-render": { status: "completed", output: { audioUrl: "https://r2/cut.m4a", durationSec: 1200 } },
        "uc-mix": { status: "completed", output: { audioUrl: "https://r2/mix.m4a" } },
      }, "e")
      expect(out).toMatchObject({ audioUrl: "https://r2/mix.m4a", durationSec: 1200 })
    })
    it("a review-on run's preview: the proxy render's own", () => {
      const out = usecaseWrapperOutput(graph({ reviewBeforeRender: true }), { "uc-render": { status: "completed", output: { videoUrl: "https://r2/p.mp4", quality: "proxy", durationSec: 1834.5 } }, "uc-captions": { status: "skipped" } }, "e")
      expect(out).toMatchObject({ videoUrl: "https://r2/p.mp4", durationSec: 1834.5 })
    })
    it("none when the render recorded none, or the run made no episode", () => {
      expect(usecaseWrapperOutput(graph(), { "uc-render": { status: "completed", output: { videoUrl: "https://r2/cut.mp4" } }, "uc-captions": { status: "completed", output: { videoUrl: "https://r2/c.mp4" } } }, "e")).not.toHaveProperty("durationSec")
      expect(usecaseWrapperOutput(graph(), { "uc-render": { status: "failed" } }, "e")).not.toHaveProperty("durationSec")
    })
    it("the node's output carries it on to the step after the node", () => {
      expect(usecaseJobOutput({ videoUrl: "https://r2/c.mp4", quality: "final", durationSec: 1834.5 })).toMatchObject({ videoUrl: "https://r2/c.mp4", durationSec: 1834.5 })
      expect(usecaseJobOutput({ durationSec: 1834.5 })).not.toHaveProperty("durationSec")
    })
  })
})

describe("usecaseWrapperHasResult (the finaliser completes only a run that delivered what its kind promises)", () => {
  const base: UseCaseWrapperOutput = { quality: "final", _executionId: "e" }
  const withKind = (kind: string, extra: Record<string, unknown> = {}) => {
    const g = graph()
    return { ...g, outputMap: { ...g.outputMap, kind, ...extra } } as never
  }
  it("an episode (a P1 snapshot names no kind): its video or audio", () => {
    expect(usecaseWrapperHasResult(graph(), { ...base, videoUrl: "https://r2/v.mp4" })).toBe(true)
    expect(usecaseWrapperHasResult(graph(), { ...base, audioUrl: "https://r2/a.m4a" })).toBe(true)
    expect(usecaseWrapperHasResult(graph(), base)).toBe(false)
    expect(usecaseWrapperHasResult(withKind("episode"), { ...base, videoUrl: "https://r2/v.mp4" })).toBe(true)
  })
  it("no snapshot (erased): the episode rule, as P1 read it", () => {
    expect(usecaseWrapperHasResult(null, { ...base, videoUrl: "https://r2/v.mp4" })).toBe(true)
    expect(usecaseWrapperHasResult(null, base)).toBe(false)
  })
  it("clips: at least one clip", () => {
    expect(usecaseWrapperHasResult(withKind("clips"), { ...base, clips: [{ url: "https://r2/c.mp4", quality: "final" }] })).toBe(true)
    expect(usecaseWrapperHasResult(withKind("clips"), { ...base, clips: [], videoUrl: "https://r2/v.mp4" })).toBe(false)
  })
  it("formats: at least one format, or a review-on run's proxy preview", () => {
    const formats = withKind("formats", { formats: [{ format: "16:9", ref: { nodeId: "x", handle: "y" } }] })
    expect(usecaseWrapperHasResult(formats, { ...base, formats: [{ format: "16:9", url: "https://r2/f.mp4" }] })).toBe(true)
    expect(usecaseWrapperHasResult(formats, { ...base, quality: "proxy", videoUrl: "https://r2/p.mp4" })).toBe(true)
    expect(usecaseWrapperHasResult(formats, { ...base, videoUrl: "https://r2/p.mp4" })).toBe(false)
  })
  it("chapters: their text", () => {
    expect(usecaseWrapperHasResult(withKind("chapters"), { ...base, text: "00:00 Intro" })).toBe(true)
    expect(usecaseWrapperHasResult(withKind("chapters"), { ...base, text: "" })).toBe(false)
  })
  it("a layout: its framed video (a review-on run's is its proxy preview)", () => {
    expect(usecaseWrapperHasResult(withKind("layout"), { ...base, videoUrl: "https://r2/v.mp4" })).toBe(true)
    expect(usecaseWrapperHasResult(withKind("layout"), { ...base, quality: "proxy", videoUrl: "https://r2/p.mp4" })).toBe(true)
    expect(usecaseWrapperHasResult(withKind("layout"), { ...base, audioUrl: "https://r2/a.m4a", json: {} })).toBe(false)
  })
})

describe("a Chapters run's result", () => {
  const g = toStoredInlineGraph(buildEpisodeChaptersGraph(EPISODE_CHAPTERS_DEFAULTS, { media: { url: "https://r2/ep.mp4", kind: "video" } }), EPISODE_CHAPTERS_DEFAULTS)
  const done = (output: Record<string, unknown>) => ({ status: "completed", output })
  it("text is the show notes, json the chapter list", () => {
    const out = usecaseWrapperOutput(g, {
      "uc-transcribe": done({ json: { words: [] } }),
      "uc-plan": done({ json: { version: 1, chapters: [{ startMs: 0, title: "Intro" }, { startMs: 754_000, title: "Main" }] } }),
    }, "exec-1")
    expect(out).toMatchObject({ text: "0:00 Intro\n12:34 Main", json: [{ startMs: 0, title: "Intro" }, { startMs: 754_000, title: "Main" }], quality: "final", _executionId: "exec-1" })
    expect(out.videoUrl).toBeUndefined()
    expect(usecaseWrapperHasResult(g, out)).toBe(true)
  })
  it("the list's first row starts at 0, exactly as the show notes list it", () => {
    const out = usecaseWrapperOutput(g, {
      "uc-plan": done({ json: { version: 1, chapters: [{ startMs: 2_400, title: "Cold open" }, { startMs: 754_000, title: "Main" }] } }),
    }, "exec-1")
    expect(out).toMatchObject({ text: "0:00 Cold open\n12:34 Main", json: [{ startMs: 0, title: "Cold open" }, { startMs: 754_000, title: "Main" }] })
  })
  it("no chapters: no result, in the kind's own words", () => {
    const out = usecaseWrapperOutput(g, { "uc-plan": done({ json: { version: 1, chapters: [] } }) }, "exec-1")
    expect(usecaseWrapperHasResult(g, out)).toBe(false)
    expect(usecaseNoResultMessage(g)).toBe("The plan found no chapters in this recording.")
  })
  it("an episode, or an erased snapshot, keeps the words it had", () => {
    expect(usecaseNoResultMessage(graph())).toBe("The run finished without a result")
    expect(usecaseNoResultMessage(null)).toBe("The run finished without a result")
  })
})

describe("a Trailer run's result", () => {
  const settings = { ...EPISODE_TRAILER_DEFAULTS, formats: ["9:16", "1:1"] as const }
  const g = toStoredInlineGraph(buildEpisodeTrailerGraph(settings, { media: { url: "https://r2/ep.mp4", kind: "video" } }), settings)
  const done = (output: Record<string, unknown>) => ({ status: "completed", output })
  it("one delivery per format, in format order; the first is the scalar read", () => {
    const out = usecaseWrapperOutput(g, {
      "uc-plan": done({ json: { segments: [] } }),
      "uc-render": done({ videoUrl: "https://r2/trailer.mp4", quality: "final", planBasis: "pb", renderBasis: "rb" }),
      "uc-format-9x16": done({ videoUrl: "https://r2/t-916.mp4" }),
      "uc-format-1x1": done({ videoUrl: "https://r2/t-11.mp4" }),
    }, "exec-2")
    expect(out).toMatchObject({
      formats: [{ format: "9:16", url: "https://r2/t-916.mp4" }, { format: "1:1", url: "https://r2/t-11.mp4" }],
      videoUrl: "https://r2/t-916.mp4", quality: "final", planBasis: "pb", renderBasis: "rb", json: { segments: [] },
    })
    expect(usecaseWrapperHasResult(g, out)).toBe(true)
  })
  it("a format that did not complete is left out; the first that did is the scalar read", () => {
    const out = usecaseWrapperOutput(g, {
      "uc-render": done({ videoUrl: "https://r2/trailer.mp4", quality: "final" }),
      "uc-format-9x16": { status: "failed", error: "boom" },
      "uc-format-1x1": done({ videoUrl: "https://r2/t-11.mp4" }),
    }, "exec-2")
    expect(out).toMatchObject({ formats: [{ format: "1:1", url: "https://r2/t-11.mp4" }], videoUrl: "https://r2/t-11.mp4", failedNodeId: "uc-format-9x16", failedFormats: ["9:16"] })
    // The run keeps the format that rendered (decided 2026-10-18).
    expect(usecaseWrapperKeepsPartial(g, out)).toBe(true)
  })
  it("every format rendered: no failed formats named", () => {
    const out = usecaseWrapperOutput(g, {
      "uc-render": done({ videoUrl: "https://r2/trailer.mp4", quality: "final" }),
      "uc-format-9x16": done({ videoUrl: "https://r2/t-916.mp4" }),
      "uc-format-1x1": done({ videoUrl: "https://r2/t-11.mp4" }),
    }, "exec-2")
    expect(out).not.toHaveProperty("failedFormats")
  })
  it("no format rendered, or a run that is not a list: nothing kept from a failed run", () => {
    const none = usecaseWrapperOutput(g, {
      "uc-render": done({ videoUrl: "https://r2/trailer.mp4", quality: "final" }),
      "uc-format-9x16": { status: "failed", error: "boom" },
      "uc-format-1x1": { status: "failed", error: "boom" },
    }, "exec-2")
    expect(none).toMatchObject({ formats: [], failedFormats: ["9:16", "1:1"] })
    expect(usecaseWrapperKeepsPartial(g, none)).toBe(false)
    expect(usecaseWrapperKeepsPartial(graph(), { quality: "final", _executionId: "e", videoUrl: "https://r2/v.mp4" })).toBe(false)
    expect(usecaseWrapperKeepsPartial(null, { quality: "final", _executionId: "e", formats: [{ format: "9:16", url: "u" }] })).toBe(false)
  })
  it("a final run whose formats never ran delivers nothing (the render alone is not the result)", () => {
    const out = usecaseWrapperOutput(g, { "uc-render": done({ videoUrl: "https://r2/trailer.mp4", quality: "final" }) }, "exec-2")
    expect(out).toMatchObject({ formats: [], quality: "final" })
    expect(out.videoUrl).toBeUndefined()
    expect(usecaseWrapperHasResult(g, out)).toBe(false)
  })
  it("review on: the preview is the result until Render final", () => {
    const review = { ...settings, reviewBeforeRender: true }
    const gp = toStoredInlineGraph(buildEpisodeTrailerGraph(review, { media: { url: "https://r2/ep.mp4", kind: "video" } }), review)
    const out = usecaseWrapperOutput(gp, { "uc-render": done({ videoUrl: "https://r2/preview.mp4", quality: "proxy" }) }, "exec-3")
    expect(out).toMatchObject({ formats: [], videoUrl: "https://r2/preview.mp4", quality: "proxy" })
    expect(usecaseWrapperHasResult(gp, out)).toBe(true)
  })
})

describe("a Clip Pack run's result", () => {
  const g = toStoredInlineGraph(buildClipPackGraph(CLIP_PACK_DEFAULTS, { media: { url: "https://r2/ep.mp4", kind: "video" } }), CLIP_PACK_DEFAULTS)
  const done = (output: object) => ({ status: "completed", output })
  const CAM = { id: "cam", url: "https://r2/ep.mp4", kind: "video" }
  const clip = (id: string, inMs: number, meta?: Record<string, unknown>) =>
    ({ version: 1, sources: [CAM], segments: [{ id, video: "cam", inMs, outMs: inMs + 30_000 }], ...(meta ? { meta } : {}) })
  const plan = [clip("a", 0, { title: "The pivot", hook: "We almost quit." }), clip("b", 60_000, { title: "The fix" }), clip("c", 120_000)]
  const keyOf = (i: number) => edlSpanKey(plan[i]) as string
  const sent = plan.map((_, i) => ({ quality: "final" as const, clipKey: keyOf(i) }))

  // One fan-out iteration as the orchestrator settles it (its result and the URL it adds to the list).
  const ok = (index: number, url: string, output: Record<string, unknown> = {}): PromiseSettledResult<FanOutIterationValue> => ({
    status: "fulfilled",
    value: { index, resultValue: url, result: { output: { videoUrl: url, ...output }, creditsUsed: 30, jobId: `job-${url}` } } as FanOutIterationValue,
  })
  const fail = (msg: string): PromiseSettledResult<FanOutIterationValue> => ({ status: "rejected", reason: new Error(msg) })
  /** The render's fan-out over the plan's clips, as the orchestrator assembles it (rows stamped with what each was sent for). */
  const renderOf = (settled: PromiseSettledResult<FanOutIterationValue>[]) =>
    assembleFanOutResult(settled, settled.length, "speaker-view", sent.slice(0, settled.length)).output
  /** The captions' fan-out: one iteration per render row that has a file (a hole is skipped). */
  const captionsOf = (settled: PromiseSettledResult<FanOutIterationValue>[]) => assembleFanOutResult(settled, settled.length, "add-captions").output
  const rendered = (i: number) => ok(i, `https://r2/r${i}.mp4`, { quality: "final", clipKey: keyOf(i), planBasis: `pb${i}`, renderBasis: `rb${i}` })

  it("one clip per clip that came back, with its title, hook and stamps; a failed MIDDLE render keeps every later clip on its own clip", () => {
    const out = usecaseWrapperOutput(g, {
      "uc-plan": done({ json: plan }),
      "uc-render": done(renderOf([rendered(0), fail("render failed"), rendered(2)])),
      // Captions ran twice: on clip 0's render and clip 2's — its row 1 is clip 2.
      "uc-captions": done(captionsOf([ok(0, "https://r2/c0.mp4"), ok(1, "https://r2/c2.mp4")])),
    }, "exec-4")
    expect(out.clips).toEqual([
      { url: "https://r2/c0.mp4", quality: "final", clipKey: keyOf(0), planBasis: "pb0", renderBasis: "rb0", title: "The pivot", hook: "We almost quit." },
      { url: "https://r2/c2.mp4", quality: "final", clipKey: keyOf(2), planBasis: "pb2", renderBasis: "rb2" },
    ])
    expect(out.failedClips).toBe(1)
    expect(out.videoUrl).toBe("https://r2/c0.mp4")
    expect(out.json).toEqual(plan)
    expect(usecaseWrapperHasResult(g, out)).toBe(true)
    expect(usecaseWrapperKeepsPartial(g, out)).toBe(true)
  })

  it("one caption failing in the middle: that clip's render stands in, uncaptioned and named; no clip failed (decided 2026-10-18)", () => {
    const out = usecaseWrapperOutput(g, {
      "uc-plan": done({ json: plan }),
      "uc-render": done(renderOf([rendered(0), rendered(1), rendered(2)])),
      "uc-captions": done(captionsOf([ok(0, "https://r2/c0.mp4"), fail("captions failed"), ok(2, "https://r2/c2.mp4")])),
    }, "exec-4")
    expect(out.clips!.map((c) => [c.url, c.clipKey, c.title ?? null, c.captionsFailed ?? false])).toEqual([
      ["https://r2/c0.mp4", keyOf(0), "The pivot", false],
      ["https://r2/r1.mp4", keyOf(1), "The fix", true],
      ["https://r2/c2.mp4", keyOf(2), null, false],
    ])
    expect(out.failedCaptions).toBe(1)
    expect(out).not.toHaveProperty("failedClips")
  })

  it("a failed render and a failed caption: the pairing holds (captions row j = the j-th rendered clip)", () => {
    const out = usecaseWrapperOutput(g, {
      "uc-plan": done({ json: plan }),
      "uc-render": done(renderOf([rendered(0), fail("render failed"), rendered(2)])),
      "uc-captions": done(captionsOf([fail("captions failed"), ok(1, "https://r2/c2.mp4")])),
    }, "exec-4")
    expect(out.clips!.map((c) => [c.url, c.clipKey, c.captionsFailed ?? false])).toEqual([
      ["https://r2/r0.mp4", keyOf(0), true],
      ["https://r2/c2.mp4", keyOf(2), false],
    ])
    expect(out).toMatchObject({ failedClips: 1, failedCaptions: 1 })
  })

  it("each clip carries the still of the file it delivers: its captioned file's, else (its captions failed) its render's", () => {
    const thumbRender = (i: number) => ok(i, `https://r2/r${i}.mp4`, { quality: "final", clipKey: keyOf(i), planBasis: `pb${i}`, renderBasis: `rb${i}`, thumbnailUrl: `https://r2/r${i}.png` })
    const out = usecaseWrapperOutput(g, {
      "uc-plan": done({ json: plan }),
      "uc-render": done(renderOf([thumbRender(0), fail("render failed"), thumbRender(2)])),
      "uc-captions": done(captionsOf([ok(0, "https://r2/c0.mp4", { thumbnailUrl: "https://r2/c0.png" }), fail("captions failed")])),
    }, "exec-4")
    expect(out.clips!.map((c) => [c.url, c.thumbnailUrl ?? null, c.captionsFailed ?? false])).toEqual([
      ["https://r2/c0.mp4", "https://r2/c0.png", false],
      ["https://r2/r2.mp4", "https://r2/r2.png", true],
    ])
    expect(out).toMatchObject({ failedClips: 1, failedCaptions: 1 })
  })

  it("every clip came back: no failed clips named", () => {
    const out = usecaseWrapperOutput(g, {
      "uc-plan": done({ json: plan }),
      "uc-render": done(renderOf([rendered(0), rendered(1), rendered(2)])),
      "uc-captions": done(captionsOf([ok(0, "https://r2/c0.mp4"), ok(1, "https://r2/c1.mp4"), ok(2, "https://r2/c2.mp4")])),
    }, "exec-4")
    expect(out.clips!.map((c) => c.title ?? null)).toEqual(["The pivot", "The fix", null])
    expect(out).not.toHaveProperty("failedClips")
  })

  it("a render row the run never started (cancelled) is not counted as a failure", () => {
    // Clip Pack's render tries every clip, so only a Stop leaves a row `cancelled` (and a stopped run keeps nothing).
    const out = usecaseWrapperOutput(g, {
      "uc-plan": done({ json: plan }),
      "uc-render": done(renderOf([rendered(0), fail("render failed"), fail("Execution cancelled")])),
      "uc-captions": done(captionsOf([ok(0, "https://r2/c0.mp4")])),
    }, "exec-4")
    expect(out.clips).toHaveLength(1)
    expect(out.failedClips).toBe(1)
  })

  it("a Render final: json is the plan with the review applied (the kept clips, an edited hook), never the plan as planned", () => {
    const edit = { v: EDITED_EDL_VERSION, kind: "clips", basis: editPlanBasis(plan), clips: [{ keep: true, hook: "Edited hook." }, { keep: false }, { keep: true }] }
    const applied = resolveEditPlanOutput(plan, edit).json as unknown[]
    expect(applied).toHaveLength(2)
    // The run's plan state is its seed: the review applied on `json`, the plan as planned on `plannedJson`.
    const out = usecaseWrapperOutput(g, {
      "uc-plan": done({ json: applied, plannedJson: plan }),
      "uc-render": done(assembleFanOutResult([rendered(0), ok(1, "https://r2/r2.mp4", { quality: "final", clipKey: keyOf(2) })], 2, "speaker-view", [sent[0], sent[2]]).output),
      "uc-captions": done(captionsOf([ok(0, "https://r2/c0.mp4"), ok(1, "https://r2/c2.mp4")])),
    }, "exec-7")
    expect(out.json).toEqual(applied)
    expect(out.clips!.map((c) => [c.clipKey, c.hook ?? null])).toEqual([[keyOf(0), "Edited hook."], [keyOf(2), null]])
    // The clip the review dropped is not a clip that could not be rendered.
    expect(out).not.toHaveProperty("failedClips")
  })

  it("a Render final with one clip dropped and one kept clip failing: failedClips is 1 (the dropped clip is never a failure)", () => {
    const edit = { v: EDITED_EDL_VERSION, kind: "clips", basis: editPlanBasis(plan), clips: [{ keep: true }, { keep: false }, { keep: true }] }
    const resolved = resolveEditPlanOutput(plan, edit)
    // The plan's seed as the continuation writes it: the kept clips, and the plan's rows with "" at the dropped clip.
    const seed = { status: "completed", output: { json: resolved.json, plannedJson: plan, listResults: resolved.listResults } }
    expect(seed.output.listResults).toEqual([JSON.stringify(plan[0]), "", JSON.stringify(plan[2])])
    // The render fans out over the kept clips only: the dropped clip's row is never an iteration.
    const render = g.nodes.find((n) => n.id === "uc-render")!
    const fanOut = getListFanOutForNode(render as never, g.edges as never, { "uc-plan": seed } as never, g.nodes as never)
    expect(fanOut?.items).toHaveLength(2)
    expect(fanOut?.rowIndices).toEqual([0, 2])
    const out = usecaseWrapperOutput(g, {
      "uc-plan": done(seed.output),
      "uc-render": done(assembleFanOutResult([rendered(0), fail("render failed")], 2, "speaker-view", [sent[0], sent[2]]).output),
      "uc-captions": done(captionsOf([ok(0, "https://r2/c0.mp4")])),
    }, "exec-9")
    expect(out.clips!.map((c) => c.clipKey)).toEqual([keyOf(0)])
    expect(out.failedClips).toBe(1)
  })

  it("a one-clip render that ran once (no list): its own take stamps name the clip", () => {
    const out = usecaseWrapperOutput(g, {
      "uc-plan": done({ json: plan.slice(0, 1) }),
      "uc-render": done({ videoUrl: "https://r2/r0.mp4", quality: "final", clipKey: keyOf(0), planBasis: "pb0", renderBasis: "rb0" }),
      "uc-captions": done({ videoUrl: "https://r2/c0.mp4" }),
    }, "exec-8")
    expect(out.clips).toEqual([{ url: "https://r2/c0.mp4", quality: "final", clipKey: keyOf(0), planBasis: "pb0", renderBasis: "rb0", title: "The pivot", hook: "We almost quit." }])
  })

  it("a plan with no clips: no result, in the kind's own words", () => {
    const out = usecaseWrapperOutput(g, { "uc-plan": done({ json: [] }) }, "exec-5")
    expect(out.clips).toEqual([])
    expect(out).not.toHaveProperty("failedClips")
    expect(usecaseWrapperHasResult(g, out)).toBe(false)
    expect(usecaseNoResultMessage(g)).toBe("The plan found no clips in this recording.")
    expect(usecaseNoResultMessage(g, out)).toBe("The plan found no clips in this recording.")
  })

  it("clips planned but none rendered (the render failed outright): how many, and the render's own reason (decided 2026-10-18)", () => {
    const out = usecaseWrapperOutput(g, { "uc-plan": done({ json: plan }), "uc-render": { status: "failed", error: "Speaker View could not read the recording." } }, "exec-5")
    expect(out).toMatchObject({ clips: [], failedClips: 3, renderError: "Speaker View could not read the recording." })
    expect(usecaseWrapperHasResult(g, out)).toBe(false)
    expect(usecaseWrapperKeepsPartial(g, out)).toBe(false)
    expect(usecaseNoResultMessage(g, out)).toBe("None of the 3 clips could be rendered: Speaker View could not read the recording.")
    const one = usecaseWrapperOutput(g, { "uc-plan": done({ json: plan.slice(0, 1) }), "uc-render": { status: "failed", error: "provider_error" } }, "exec-5")
    expect(usecaseNoResultMessage(g, one)).toBe("The plan's one clip could not be rendered: provider_error.")
    // A failed render with no error recorded: the count alone.
    const bare = usecaseWrapperOutput(g, { "uc-plan": done({ json: plan }), "uc-render": { status: "failed" } }, "exec-5")
    expect(usecaseNoResultMessage(g, bare)).toBe("None of the 3 clips could be rendered.")
  })

  it("the sentence and its parse are one rule (the editor reads the count and the reason back)", () => {
    expect(clipPackNoneRenderedMessage(4, "boom.")).toBe("None of the 4 clips could be rendered: boom.")
    expect(parseClipPackNoneRendered(clipPackNoneRenderedMessage(4, "boom"))).toEqual({ count: 4, reason: "boom" })
    expect(parseClipPackNoneRendered(clipPackNoneRenderedMessage(1, "a: b"))).toEqual({ count: 1, reason: "a: b" })
    expect(parseClipPackNoneRendered(clipPackNoneRenderedMessage(4))).toBeNull()
    expect(parseClipPackNoneRendered("Render Clip: boom")).toBeNull()
  })

  it("renders done but captioning never ran (the run stopped before it — a time cap, a dead worker): nothing kept, not \"none rendered\" (decided 2026-10-18)", () => {
    for (const captions of [undefined, { status: "pending" }, { status: "running" }, { status: "skipped" }]) {
      const out = usecaseWrapperOutput(g, {
        "uc-plan": done({ json: plan }),
        "uc-render": done(renderOf([rendered(0), fail("render failed"), rendered(2)])),
        ...(captions ? { "uc-captions": captions } : {}),
      }, "exec-10")
      expect(out, JSON.stringify(captions)).toMatchObject({ clips: [], captionsNotRun: true, failedClips: 1 })
      expect(out).not.toHaveProperty("failedCaptions")
      expect(usecaseWrapperHasResult(g, out)).toBe(false)
      expect(usecaseWrapperKeepsPartial(g, out)).toBe(false)
      expect(usecaseNoClipsRenderedMessage(g, out)).toBeNull()
    }
  })

  it("the take's quality: its rows' stamps first, then the job's output, then the snapshot's setting", () => {
    const review = { ...CLIP_PACK_DEFAULTS, reviewBeforeRender: true }
    const gp = toStoredInlineGraph(buildClipPackGraph(review, { media: { url: "https://r2/ep.mp4", kind: "video" } }), review)
    const stamped = usecaseWrapperOutput(gp, { "uc-plan": done({ json: plan.slice(0, 1) }), "uc-render": done({ listResults: ["https://r2/p0.mp4"], quality: "final", listResultStamps: [{ quality: "proxy", clipKey: keyOf(0) }] }) }, "e")
    expect(stamped).toMatchObject({ quality: "proxy", clips: [{ quality: "proxy" }] })
    const job = usecaseWrapperOutput(gp, { "uc-plan": done({ json: plan.slice(0, 1) }), "uc-render": done({ listResults: ["https://r2/p0.mp4"], quality: "final", listResultStamps: [{}] }) }, "e")
    expect(job.quality).toBe("final")
    const snapshot = usecaseWrapperOutput(gp, { "uc-plan": done({ json: plan.slice(0, 1) }), "uc-render": done({ listResults: ["https://r2/p0.mp4"], listResultStamps: [{}] }) }, "e")
    expect(snapshot.quality).toBe("proxy")
  })

  it("every rendered clip's captions failed (the step failed): the clips come uncaptioned, each named, and the run keeps them (decided 2026-10-18)", () => {
    const out = usecaseWrapperOutput(g, {
      "uc-plan": done({ json: plan.slice(0, 2) }),
      "uc-render": done(renderOf([rendered(0), rendered(1)])),
      "uc-captions": { status: "failed", error: "captions failed" },
    }, "exec-5")
    expect(out.clips).toEqual([
      { url: "https://r2/r0.mp4", quality: "final", clipKey: keyOf(0), planBasis: "pb0", renderBasis: "rb0", title: "The pivot", hook: "We almost quit.", captionsFailed: true },
      { url: "https://r2/r1.mp4", quality: "final", clipKey: keyOf(1), planBasis: "pb1", renderBasis: "rb1", title: "The fix", captionsFailed: true },
    ])
    expect(out).toMatchObject({ videoUrl: "https://r2/r0.mp4", failedCaptions: 2 })
    expect(out).not.toHaveProperty("failedClips")
    expect(usecaseWrapperHasResult(g, out)).toBe(true)
    expect(usecaseWrapperKeepsPartial(g, out)).toBe(true)
    // "None of the N clips could be rendered" is only for a run where no clip rendered.
    expect(usecaseNoResultMessage(g, out)).toBe("The plan found no clips in this recording.")
  })

  it("review on: the per-clip previews are the clips (captions not run yet)", () => {
    const review = { ...CLIP_PACK_DEFAULTS, reviewBeforeRender: true }
    const gp = toStoredInlineGraph(buildClipPackGraph(review, { media: { url: "https://r2/ep.mp4", kind: "video" } }), review)
    const out = usecaseWrapperOutput(gp, {
      "uc-plan": done({ json: plan.slice(0, 1) }),
      "uc-render": done({ listResults: ["https://r2/p0.mp4"], videoUrl: "https://r2/p0.mp4", quality: "proxy", listResultStamps: [{ quality: "proxy", clipKey: keyOf(0) }] }),
    }, "exec-6")
    expect(out).toMatchObject({ quality: "proxy", clips: [{ url: "https://r2/p0.mp4", quality: "proxy", clipKey: keyOf(0), title: "The pivot" }], videoUrl: "https://r2/p0.mp4" })
    // A preview is never kept from a failed run: only a final delivers.
    expect(usecaseWrapperKeepsPartial(gp, out)).toBe(false)
  })

  it("an audio recording: audio clips straight from the render", () => {
    const settings = resolveClipPackSettings({}, "audio")
    const ga = toStoredInlineGraph(buildClipPackGraph(settings, { media: { url: "https://r2/ep.m4a", kind: "audio" } }), settings)
    const out = usecaseWrapperOutput(ga, {
      "uc-plan": done({ json: plan.slice(0, 2) }),
      "uc-render": done({ audioUrl: "https://r2/a0.m4a", quality: "final", listResults: ["https://r2/a0.m4a", "https://r2/a1.m4a"], listResultStamps: [{ clipKey: keyOf(0) }, { clipKey: keyOf(1) }] }),
    }, "exec-9")
    expect(out).toMatchObject({ audioUrl: "https://r2/a0.m4a", clips: [{ url: "https://r2/a0.m4a" }, { url: "https://r2/a1.m4a" }] })
    expect(out.videoUrl).toBeUndefined()
  })
})

describe("the cameras report (decided 2026-10-17)", () => {
  const v = (n: number) => ({ url: `https://r2/c${n}.mp4`, kind: "video" as const })
  const multicamGraph = (raw: Record<string, unknown>, recordings: number, master: boolean) => {
    const settings = resolveTightenEpisodeSettings({ captions: false, ...raw }, "video", { recordings, masterAudio: master })
    const sources = {
      media: v(1),
      ...(recordings > 1 ? { moreMedia: Array.from({ length: recordings - 1 }, (_, i) => v(i + 2)) } : {}),
      ...(master ? { masterAudio: { url: "https://r2/m.wav", kind: "audio" as const } } : {}),
    }
    return toStoredInlineGraph(buildTightenEpisodeGraph(settings, sources), settings)
  }
  const render = { "uc-render": { status: "completed", output: { videoUrl: "https://r2/out.mp4", quality: "final" } } }

  it("a multicam run reports who was put on which camera, and the sync and map notes", () => {
    const graph = multicamGraph({}, 3, true)
    const states = {
      "uc-sync": { status: "completed", output: { json: { version: 1, reference: "uc-master", offsets: [], notes: ["\"uc-cam-3\": no clear match …"] } } },
      "uc-map": { status: "completed", output: { json: { version: 1, speakerMap: { speaker_0: "uc-cam-2", speaker_1: "" }, confidence: { speaker_0: { camera: "uc-cam-2", marginDb: 7.5 }, speaker_1: { camera: "", marginDb: 0.4 } }, notes: ["…"] } } },
      "uc-transcribe": { status: "completed", output: { json: { words: [{ text: "a", startMs: 0, endMs: 1, speaker: "speaker_1" }, { text: "b", startMs: 2, endMs: 3, speaker: "speaker_0" }] } } },
      ...render,
    }
    expect(usecaseWrapperOutput(graph, states, "exec-1").cameras).toEqual({
      speakers: [{ speaker: "speaker_1", ordinal: 1, camera: null, marginDb: 0.4 }, { speaker: "speaker_0", ordinal: 2, camera: 2, marginDb: 7.5 }],
      syncNotes: ["\"uc-cam-3\": no clear match …"],
      mapNotes: ["…"],
    })
  })
  it("the first camera is position 1; a speaker the map names but the transcript never heard comes last", () => {
    const graph = multicamGraph({}, 2, false)
    const states = {
      "uc-map": { status: "completed", output: { json: JSON.stringify({ version: 1, speakerMap: { speaker_0: "uc-source", speaker_9: "uc-cam-2" }, confidence: { speaker_0: { camera: "uc-source", marginDb: null } }, notes: [] }) } },
      "uc-transcribe": { status: "completed", output: { json: { words: [{ text: "a", startMs: 0, endMs: 1, speaker: "speaker_0" }] } } },
      ...render,
    }
    expect(usecaseWrapperOutput(graph, states, "e").cameras!.speakers).toEqual([
      { speaker: "speaker_0", ordinal: 1, camera: 1, marginDb: null },
      { speaker: "speaker_9", ordinal: 2, camera: 2, marginDb: null },
    ])
  })
  it("a sync output that is a string which does not parse, or steps that never completed: no notes, never a throw", () => {
    const graph = multicamGraph({}, 2, true)
    const out = usecaseWrapperOutput(graph, { "uc-sync": { status: "completed", output: { json: "{not json" } }, "uc-map": { status: "failed" }, ...render }, "e")
    expect(out.cameras).toEqual({ speakers: [], syncNotes: [], mapNotes: [] })
  })
  it("one camera + Master audio: Audio Sync's notes only (nothing is cut between, no speakers)", () => {
    const graph = multicamGraph({}, 1, true)
    const states = { "uc-sync": { status: "completed", output: { json: { version: 1, notes: ["offset 1.2 s"] } } }, ...render }
    expect(usecaseWrapperOutput(graph, states, "e").cameras).toEqual({ speakers: [], syncNotes: ["offset 1.2 s"], mapNotes: [] })
  })
  it("a one-recording run has no cameras report", () => {
    const g = toStoredInlineGraph(buildTightenEpisodeGraph(TIGHTEN_EPISODE_DEFAULTS, { media: { url: "https://r2/ep.mp4", kind: "video" } }), TIGHTEN_EPISODE_DEFAULTS)
    expect(usecaseWrapperOutput(g, render, "e")).not.toHaveProperty("cameras")
  })
  it("the node's output carries it as useCaseCameras (a malformed one is dropped)", () => {
    const cameras = { speakers: [{ speaker: "speaker_0", ordinal: 1, camera: 2, marginDb: 6 }], syncNotes: ["x"], mapNotes: [] }
    expect(usecaseJobOutput({ videoUrl: "https://r2/out.mp4", cameras })).toMatchObject({ useCaseCameras: cameras })
    expect(usecaseJobOutput({ videoUrl: "https://r2/out.mp4", cameras: { speakers: "no" } })).not.toHaveProperty("useCaseCameras")
    expect(usecaseJobOutput({ videoUrl: "https://r2/out.mp4" })).not.toHaveProperty("useCaseCameras")
  })
})

describe("a Trailer run on several recordings (decided 2026-10-17)", () => {
  const cam = (n: number) => ({ url: `https://r2/c${n}.mp4`, kind: "video" as const })
  const sources = { media: cam(1), moreMedia: [cam(2), cam(3)], masterAudio: { url: "https://r2/m.wav", kind: "audio" as const } }
  const settings = resolveEpisodeTrailerSettings({ formats: ["9:16", "1:1"] }, "video", { recordings: 3, masterAudio: true })
  const g = toStoredInlineGraph(buildEpisodeTrailerGraph(settings, sources), settings)
  const done = (output: Record<string, unknown>) => ({ status: "completed", output })
  const front = {
    "uc-sync": done({ json: { version: 1, reference: "uc-master", offsets: [], notes: [] } }),
    "uc-map": done({ json: { version: 1, speakerMap: { speaker_0: "uc-cam-2" }, confidence: { speaker_0: { camera: "uc-cam-2", marginDb: 6 } }, notes: [] } }),
    "uc-transcribe": done({ json: { words: [{ text: "a", startMs: 0, endMs: 1, speaker: "speaker_0" }] } }),
    "uc-plan": done({ json: { segments: [] } }),
  }

  it("every format delivered, and the cameras report beside them", () => {
    const out = usecaseWrapperOutput(g, {
      ...front,
      "uc-switch": done({ edl: { segments: [] } }),
      "uc-render": done({ videoUrl: "https://r2/trailer.mp4", quality: "final" }),
      "uc-format-9x16": done({ videoUrl: "https://r2/t-916.mp4" }),
      "uc-format-1x1": done({ videoUrl: "https://r2/t-11.mp4" }),
    }, "exec-m")
    expect(out).toMatchObject({
      formats: [{ format: "9:16", url: "https://r2/t-916.mp4" }, { format: "1:1", url: "https://r2/t-11.mp4" }],
      cameras: { speakers: [{ speaker: "speaker_0", ordinal: 1, camera: 2, marginDb: 6 }], syncNotes: [], mapNotes: [] },
    })
    expect(out).not.toHaveProperty("failedFormats")
  })
  it("a failed format keeps the delivered ones, as on one recording", () => {
    const out = usecaseWrapperOutput(g, {
      ...front,
      "uc-switch": done({ edl: { segments: [] } }),
      "uc-render": done({ videoUrl: "https://r2/trailer.mp4", quality: "final" }),
      "uc-format-9x16": { status: "failed", error: "boom" },
      "uc-format-1x1": done({ videoUrl: "https://r2/t-11.mp4" }),
    }, "exec-m")
    expect(out).toMatchObject({ formats: [{ format: "1:1", url: "https://r2/t-11.mp4" }], failedFormats: ["9:16"] })
    expect(usecaseWrapperKeepsPartial(g, out)).toBe(true)
  })
  it("Camera Switch failed: it is upstream of every format, so no format renders and the run fails (nothing kept)", () => {
    const out = usecaseWrapperOutput(g, { ...front, "uc-switch": { status: "failed", error: "no speaker map" } }, "exec-m")
    expect(out).toMatchObject({ formats: [], failedNodeId: "uc-switch" })
    expect(out.videoUrl).toBeUndefined()
    expect(usecaseWrapperHasResult(g, out)).toBe(false)
    expect(usecaseWrapperKeepsPartial(g, out)).toBe(false)
  })
  it("Audio Sync or Speaker Map failed: the same (upstream of the plan or the switch)", () => {
    for (const failed of ["uc-sync", "uc-map"]) {
      const { [failed as "uc-sync"]: _gone, ...rest } = front
      const out = usecaseWrapperOutput(g, { ...rest, [failed]: { status: "failed", error: "boom" } }, "exec-m")
      expect(out, failed).toMatchObject({ formats: [], failedNodeId: failed })
      expect(usecaseWrapperKeepsPartial(g, out), failed).toBe(false)
    }
  })
})

/** Speaker Layout (decided 2026-10-17): the whole recording framed by speaker — its one render is its result. */
describe("a layout run's result", () => {
  const rec = (n: number) => ({ url: `https://r2/c${n}.mp4`, kind: "video" as const })
  const layoutGraph = (over: Record<string, unknown> = {}, sources: Parameters<typeof buildSpeakerLayoutGraph>[1] = { media: rec(1) }, shape?: { recordings: number; masterAudio: boolean }) => {
    const settings = resolveSpeakerLayoutSettings({ framingSource: "static", ...over }, "video", shape)
    return toStoredInlineGraph(buildSpeakerLayoutGraph(settings, sources), settings)
  }
  const done = (output: Record<string, unknown>) => ({ status: "completed", output })
  const drawn = { version: 1, sources: [{ id: "c1" }], segments: [{ id: "s0" }] }
  const renamed = { words: [{ text: "hi", speaker: "s0" }] }

  it("one recording: the render's video, the edit it drew on json, its renamed transcript, its basis, the run's settings", () => {
    const g = layoutGraph()
    const out = usecaseWrapperOutput(g, {
      "uc-transcribe": done({ json: { words: [{ text: "hi" }] } }),
      "uc-render": done({ videoUrl: "https://r2/out.mp4", json: drawn, transcript: renamed, quality: "final", renderBasis: "rb1", durationSec: 3600 }),
    }, "exec-1")
    expect(out).toEqual({
      videoUrl: "https://r2/out.mp4",
      json: drawn,
      transcript: renamed,
      quality: "final",
      renderBasis: "rb1",
      useCaseSettings: g.settings,
      durationSec: 3600,
      _executionId: "exec-1",
    })
    // No plan: nothing on `plan`, no `planBasis`, no cameras report for one recording.
    expect(out).not.toHaveProperty("plan")
    expect(usecaseWrapperHasResult(g, out)).toBe(true)
    // What the node lands: the video, the drawn edit on json, the transcript, the take's stamps.
    expect(usecaseJobOutput(out as unknown as Record<string, unknown>)).toMatchObject({ videoUrl: "https://r2/out.mp4", json: drawn, transcript: renamed, quality: "final", renderBasis: "rb1", durationSec: 3600 })
  })

  it("a review-on run: the render's proxy preview, read as a result", () => {
    const g = layoutGraph({ reviewBeforeRender: true })
    const out = usecaseWrapperOutput(g, { "uc-render": done({ videoUrl: "https://r2/proxy.mp4" }) }, "exec-1")
    expect(out).toMatchObject({ videoUrl: "https://r2/proxy.mp4", quality: "proxy" })
    expect(usecaseWrapperHasResult(g, out)).toBe(true)
  })

  it("a failed render: no result, the step named; a failed layout keeps nothing", () => {
    const g = layoutGraph()
    const out = usecaseWrapperOutput(g, { "uc-transcribe": done({ json: { words: [] } }), "uc-render": { status: "failed" } }, "exec-1")
    expect(out.videoUrl).toBeUndefined()
    expect(out.failedNodeId).toBe("uc-render")
    expect(usecaseWrapperHasResult(g, out)).toBe(false)
    expect(usecaseWrapperKeepsPartial(g, out)).toBe(false)
    expect(usecaseNoResultMessage(g, out)).toBe("The run finished without a framed video.")
  })

  it("two cameras: the cameras report (who was put on which camera, the sync and map notes)", () => {
    const g = layoutGraph({}, { media: rec(1), moreMedia: [rec(2)] }, { recordings: 2, masterAudio: false })
    const states: Record<string, unknown> = {
      "uc-map": done({ json: { version: 1, speakerMap: { s0: "uc-source", s1: "uc-rec-2" }, confidence: { s0: { camera: "uc-source", marginDb: 6 }, s1: { camera: "uc-rec-2", marginDb: 4 } }, notes: ["m"] } }),
      "uc-transcribe": done({ json: { words: [{ text: "a", speaker: "s0" }, { text: "b", speaker: "s1" }] } }),
      "uc-render": done({ videoUrl: "https://r2/out.mp4" }),
    }
    const out = usecaseWrapperOutput(g, states, "e")
    expect(out.cameras?.mapNotes).toEqual(["m"])
    expect(out.cameras?.speakers.map((sp) => sp.speaker)).toEqual(["s0", "s1"])
  })

  it("one camera + Master audio (nothing to cut between): no per-speaker lines, no map notes — only the sync notes", () => {
    // A graph with Speaker Map but no Camera Switch (Speaker Layout's one-camera edit): every speaker is "" by construction, which says nothing.
    const settings = resolveSpeakerLayoutSettings({ framingSource: "static" }, "video", { recordings: 1, masterAudio: true })
    const g = toStoredInlineGraph(buildSpeakerLayoutGraph(settings, { media: { url: "https://r2/c1.mp4", kind: "video" }, masterAudio: { url: "https://r2/m.wav", kind: "audio" } }), settings)
    const out = usecaseWrapperOutput(g, {
      "uc-sync": { status: "completed", output: { json: { version: 1, reference: "uc-master", offsets: [], notes: ["n"] } } },
      "uc-map": { status: "completed", output: { json: { version: 1, speakerMap: { s0: "" }, confidence: { s0: { camera: "", marginDb: null } }, notes: ["fewer than two"] } } },
      "uc-render": { status: "completed", output: { videoUrl: "https://r2/out.mp4" } },
    }, "e")
    expect(out.cameras).toEqual({ speakers: [], syncNotes: ["n"], mapNotes: [] })
  })
})

describe("a Clip Pack run on several cameras: a clip whose Camera Switch failed is a failed clip, counted once (decided 2026-10-18)", () => {
  const cam = (n: number) => ({ url: `https://r2/c${n}.mp4`, kind: "video" as const })
  const settings = resolveClipPackSettings({}, "video", { recordings: 2, masterAudio: true })
  const g = toStoredInlineGraph(buildClipPackGraph(settings, { media: cam(1), moreMedia: [cam(2)], masterAudio: { url: "https://r2/m.wav", kind: "audio" } }), settings)
  const done = (output: object) => ({ status: "completed", output })
  const CAMS = [{ id: "uc-source", url: "https://r2/c1.mp4", kind: "video" }, { id: "uc-cam-2", url: "https://r2/c2.mp4", kind: "video" }]
  const clip = (i: number) => ({ version: 1, sources: CAMS, segments: [{ id: `s${i}`, video: "uc-source", inMs: i * 60_000, outMs: i * 60_000 + 30_000 }], meta: { title: `Clip ${i + 1}` } })
  const plan = [0, 1, 2].map(clip)
  const keyOf = (i: number) => edlSpanKey(plan[i]) as string
  const ok = (index: number, value: string, output: Record<string, unknown> = {}): PromiseSettledResult<FanOutIterationValue> => ({
    status: "fulfilled",
    value: { index, resultValue: value, result: { output: { videoUrl: value, ...output }, creditsUsed: 2, jobId: `job-${index}` } } as FanOutIterationValue,
  })
  const fail = (msg: string): PromiseSettledResult<FanOutIterationValue> => ({ status: "rejected", reason: new Error(msg) })
  /** The switch's fan-out over the plan's clips: it tries every clip, so its rows are stamped up front (empty) like the orchestrator stamps them. */
  const switchOf = (settled: PromiseSettledResult<FanOutIterationValue>[]) => assembleFanOutResult(settled, settled.length, "camera-switch", settled.map(() => ({}))).output
  const switched = (i: number) => ok(i, JSON.stringify({ ...plan[i], switched: true }))
  /** The render's fan-out over the clips whose switch delivered (a hole is skipped), each row stamped with the clip it was sent for. */
  const renderOf = (clips: number[], settled: PromiseSettledResult<FanOutIterationValue>[]) =>
    assembleFanOutResult(settled, settled.length, "speaker-view", clips.map((i) => ({ quality: "final" as const, clipKey: keyOf(i) }))).output
  /** Render row `row` of clip `i`: its file, and the clip it was sent for. */
  const rendered = (row: number, i: number) => ok(row, `https://r2/r${i}.mp4`, { quality: "final", clipKey: keyOf(i) })
  const captionsOf = (settled: PromiseSettledResult<FanOutIterationValue>[]) => assembleFanOutResult(settled, settled.length, "add-captions", settled.map(() => ({}))).output

  it("three clips, the middle switch failed: clips 1 and 3 delivered, one failed clip, the run keeps its fee", () => {
    const out = usecaseWrapperOutput(g, {
      "uc-plan": done({ json: plan }),
      "uc-switch": done(switchOf([switched(0), fail("camera switch failed"), switched(2)])),
      "uc-render": done(renderOf([0, 2], [rendered(0, 0), rendered(1, 2)])),
      "uc-captions": done(captionsOf([ok(0, "https://r2/c0.mp4"), ok(1, "https://r2/c2.mp4")])),
    }, "exec-m")
    expect(out.clips!.map((c) => [c.clipKey, c.title, c.url])).toEqual([[keyOf(0), "Clip 1", "https://r2/c0.mp4"], [keyOf(2), "Clip 3", "https://r2/c2.mp4"]])
    expect(out.failedClips).toBe(1)
    expect(usecaseWrapperKeepsPartial(g, out)).toBe(true)
  })

  it("a Stop that left switch row 3 never started (cancelled) is not a failure", () => {
    const out = usecaseWrapperOutput(g, {
      "uc-plan": done({ json: plan }),
      "uc-switch": done(switchOf([switched(0), switched(1), fail("Cancelled")])),
      "uc-render": done(renderOf([0, 1], [rendered(0, 0), rendered(1, 1)])),
    }, "exec-m")
    expect(out).not.toHaveProperty("failedClips")
  })

  it("a switch that failed outright (no row list) failed every planned clip, and says why", () => {
    const out = usecaseWrapperOutput(g, { "uc-plan": done({ json: plan }), "uc-switch": { status: "failed", error: "Speaker map unavailable" } }, "exec-m")
    expect(out).toMatchObject({ clips: [], failedClips: 3, renderError: "Speaker map unavailable", failedNodeId: "uc-switch" })
    expect(usecaseWrapperKeepsPartial(g, out)).toBe(false)
    expect(usecaseNoClipsRenderedMessage(g, out)).toBe(clipPackNoneRenderedMessage(3, "Speaker map unavailable"))
  })

  it("a clip whose switch delivered but whose render failed is counted once; with a failed switch row beside it, two", () => {
    const out = usecaseWrapperOutput(g, {
      "uc-plan": done({ json: plan }),
      "uc-switch": done(switchOf([switched(0), fail("camera switch failed"), switched(2)])),
      "uc-render": done(renderOf([0, 2], [rendered(0, 0), fail("render failed")])),
      "uc-captions": done(captionsOf([ok(0, "https://r2/c0.mp4")])),
    }, "exec-m")
    expect(out.clips!.map((c) => c.title)).toEqual(["Clip 1"])
    expect(out.failedClips).toBe(2)
  })

  it("every switch delivered, the render failed outright: every planned clip failed (never counted twice)", () => {
    const out = usecaseWrapperOutput(g, {
      "uc-plan": done({ json: plan }),
      "uc-switch": done(switchOf([switched(0), switched(1), switched(2)])),
      "uc-render": { status: "failed", error: "Speaker View could not read the recording." },
    }, "exec-m")
    expect(out).toMatchObject({ clips: [], failedClips: 3, renderError: "Speaker View could not read the recording." })
  })

  it("a one-clip plan whose one switch ran once (no row list): delivered, nothing failed", () => {
    const one = [plan[0]]
    const out = usecaseWrapperOutput(g, {
      "uc-plan": done({ json: one }),
      "uc-switch": done({ json: { edl: { ...plan[0], switched: true }, transcript: { words: [] } } }),
      "uc-render": done({ videoUrl: "https://r2/r0.mp4", quality: "final", clipKey: keyOf(0) }),
      "uc-captions": done({ videoUrl: "https://r2/c0.mp4" }),
    }, "exec-m")
    expect(out.clips!.map((c) => c.url)).toEqual(["https://r2/c0.mp4"])
    expect(out).not.toHaveProperty("failedClips")
  })

  it("Audio Sync or Speaker Map failed: they come before every clip, so no clip is made and the run fails (nothing kept)", () => {
    for (const failed of ["uc-sync", "uc-map"]) {
      const out = usecaseWrapperOutput(g, { "uc-transcribe": done({ json: { words: [] } }), [failed]: { status: "failed", error: "boom" } }, "exec-m")
      expect(out, failed).toMatchObject({ clips: [], failedNodeId: failed })
      // No plan was read, so no clip is counted failed: the step that failed is named instead.
      expect(out, failed).not.toHaveProperty("failedClips")
      expect(usecaseWrapperKeepsPartial(g, out), failed).toBe(false)
      expect(usecaseWrapperHasResult(g, out), failed).toBe(false)
    }
  })

  it("the cameras report rides beside the clips", () => {
    const out = usecaseWrapperOutput(g, {
      "uc-sync": done({ json: { version: 1, reference: "uc-master", offsets: [], notes: ["n"] } }),
      "uc-map": done({ json: { version: 1, speakerMap: {}, confidence: {}, notes: [] } }),
      "uc-plan": done({ json: plan }),
      "uc-switch": done(switchOf([switched(0), switched(1), switched(2)])),
      "uc-render": done(renderOf([0, 1, 2], [rendered(0, 0), rendered(1, 1), rendered(2, 2)])),
    }, "exec-m")
    expect(out.cameras).toMatchObject({ syncNotes: ["n"] })
  })
})
