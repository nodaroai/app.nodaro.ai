import { describe, it, expect } from "vitest"
import {
  EPISODE_CHAPTERS_DEFAULTS,
  TIGHTEN_EPISODE_DEFAULTS,
  buildEpisodeChaptersGraph,
  buildTightenEpisodeGraph,
  toStoredInlineGraph,
  type TightenEpisodeSettings,
} from "@nodaro/render-rules"
import { usecaseNoResultMessage, usecaseWrapperHasResult, usecaseWrapperOutput, type UseCaseWrapperOutput } from "../wrapper-output.js"
import { usecaseJobOutput } from "../../../services/workflow-engine/use-case-output.js"

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
