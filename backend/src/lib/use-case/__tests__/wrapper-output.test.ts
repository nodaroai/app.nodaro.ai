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
  buildTightenEpisodeGraph,
  clipPackNoneRenderedMessage,
  parseClipPackNoneRendered,
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
