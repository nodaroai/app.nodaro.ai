import { describe, it, expect } from "vitest"
import { TIGHTEN_EPISODE_DEFAULTS, buildTightenEpisodeGraph, toStoredInlineGraph, type TightenEpisodeSettings } from "@nodaro/render-rules"
import { usecaseWrapperOutput } from "../wrapper-output.js"

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
})
