/**
 * The canvas half of the use-case graph totality guard: every edge a Tighten
 * Episode graph can contain is one the editor would let a user draw
 * (`isValidWorkflowConnection` — producer sets × target handle rules), so the
 * built chain is exactly a hand-buildable chain (precedent:
 * podcast-templates-connections.test.ts). A failure here is a design error in
 * the builder — fix the builder, never the validator.
 */
import { describe, it, expect, vi } from "vitest"
// Camera Switch's Speaker map input follows Speaker Map's availability for the
// viewer (withheld until the answer lands, and while Speaker Map is withheld):
// the multicam graphs are checked as a viewer who is offered Speaker Map.
const availability = vi.hoisted(() => ({ loaded: true, unavailable: new Set<string>() }))
vi.mock("@/lib/surface-availability", async (orig) => ({
  ...(await orig<typeof import("@/lib/surface-availability")>()),
  surfaceAvailabilityLoaded: () => availability.loaded,
  isNodeUnavailable: (type: string) => availability.unavailable.has(type),
}))
import {
  MULTICAM_SPEAKER_MAP_TYPE,
  TIGHTEN_EPISODE_DEFAULTS,
  buildTightenEpisodeGraph,
  resolveTightenEpisodeSettings,
  usecaseRecordings,
  type UseCaseGraph,
  type UseCaseSources,
} from "@nodaro/render-rules"
import { buildAdjacency, isValidWorkflowConnection } from "../connection-validation"

/** The first edge of `g` the canvas validator refuses, or null. */
function refusedEdge(g: UseCaseGraph): string | null {
  const typeOf = (id: string) => g.nodes.find((n) => n.id === id)?.type
  for (const e of g.edges) {
    const others = g.edges.filter((x) => x.id !== e.id)
    const ok = isValidWorkflowConnection(
      { source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle },
      typeOf,
      buildAdjacency(others),
    )
    if (!ok) return e.id
  }
  return null
}

const vid = (n: number) => ({ url: `https://r2/cam${n}.mp4`, kind: "video" as const })
const MASTER = { url: "https://r2/master.wav", kind: "audio" as const }
const MULTICAM_RECORDINGS: ReadonlyArray<UseCaseSources> = [
  { media: vid(1), masterAudio: MASTER },
  { media: vid(1), moreMedia: [vid(2)] },
  { media: vid(1), moreMedia: [vid(2), vid(3)], masterAudio: MASTER },
  { media: { url: "https://r2/mixer.wav", kind: "audio" }, moreMedia: [vid(2), vid(3), vid(4), vid(5), vid(6)] },
  { media: vid(1), moreMedia: [vid(2), vid(3), vid(4), vid(5)], masterAudio: MASTER },
]

const FRAMINGS = [null, { aspect: "9:16", layout: "stacked" }, { aspect: "16:9", layout: "side-by-side" }, { aspect: "1:1", layout: "grid" }] as const

describe("Tighten Episode graphs are drawable", () => {
  it("every edge in every combination passes the canvas validator", () => {
    let graphs = 0
    for (const kind of ["video", "audio"] as const)
      for (const output of ["video", "audio"] as const)
        for (const captions of [true, false])
          for (const reviewBeforeRender of [true, false])
            for (const music of [false, true])
              for (const framing of FRAMINGS) {
                const settings = resolveTightenEpisodeSettings({ ...TIGHTEN_EPISODE_DEFAULTS, output, captions, reviewBeforeRender, framing }, kind)
                const g = buildTightenEpisodeGraph(settings, {
                  media: { url: "https://r2/ep", kind },
                  ...(music ? { music: { url: "https://r2/bed.mp3" } } : {}),
                })
                const typeOf = (id: string) => g.nodes.find((n) => n.id === id)?.type
                for (const e of g.edges) {
                  const others = g.edges.filter((x) => x.id !== e.id)
                  const ok = isValidWorkflowConnection(
                    { source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle },
                    typeOf,
                    buildAdjacency(others),
                  )
                  expect(ok, `${kind}/${output}/captions=${captions}/review=${reviewBeforeRender}/music=${music}/framing=${JSON.stringify(framing)}: ${e.id}`).toBe(true)
                }
                graphs++
              }
    expect(graphs).toBe(128)
  })

  it("every edge of every multicam graph (2–6 recordings, a Master audio) passes the canvas validator", () => {
    let graphs = 0
    for (const sources of MULTICAM_RECORDINGS)
      for (const output of ["video", "audio"] as const)
        for (const synced of [false, true])
          for (const wide of [null, usecaseRecordings(sources).length])
            for (const captions of [true, false])
              for (const reviewBeforeRender of [true, false])
                for (const music of [false, true])
                  for (const framing of [null, { aspect: "9:16", layout: "stacked" }] as const) {
                    const shape = { recordings: usecaseRecordings(sources).length, masterAudio: !!sources.masterAudio }
                    const raw = { ...TIGHTEN_EPISODE_DEFAULTS, output, captions, reviewBeforeRender, framing, cameras: { wide, synced, speakerCameras: { "1": 2 } } }
                    const g = buildTightenEpisodeGraph(resolveTightenEpisodeSettings(raw, "video", shape), { ...sources, ...(music ? { music: { url: "https://r2/bed.mp3" } } : {}) })
                    expect(refusedEdge(g), JSON.stringify({ shape, raw, music })).toBeNull()
                    graphs++
                  }
    expect(graphs).toBe(5 * 2 * 2 * 2 * 2 * 2 * 2 * 2)
  })

  it("following faces (decided 2026-10-17): every edge of every framed graph with Speaker Frames passes the canvas validator", () => {
    let graphs = 0
    const tracking = (raw: Record<string, unknown>) => ({ ...raw, framingSource: "tracking" })
    for (const captions of [true, false])
      for (const reviewBeforeRender of [true, false])
        for (const music of [false, true])
          for (const framing of FRAMINGS.filter((f) => f !== null)) {
            const one = buildTightenEpisodeGraph(
              resolveTightenEpisodeSettings(tracking({ ...TIGHTEN_EPISODE_DEFAULTS, captions, reviewBeforeRender, framing }), "video"),
              { media: { url: "https://r2/ep", kind: "video" }, ...(music ? { music: { url: "https://r2/bed.mp3" } } : {}) },
            )
            expect(one.nodes.some((n) => n.type === "speaker-frames")).toBe(true)
            expect(refusedEdge(one), JSON.stringify({ captions, reviewBeforeRender, music, framing })).toBeNull()
            graphs++
            for (const sources of MULTICAM_RECORDINGS) {
              const shape = { recordings: usecaseRecordings(sources).length, masterAudio: !!sources.masterAudio }
              const g = buildTightenEpisodeGraph(
                resolveTightenEpisodeSettings(tracking({ ...TIGHTEN_EPISODE_DEFAULTS, captions, reviewBeforeRender, framing }), "video", shape),
                { ...sources, ...(music ? { music: { url: "https://r2/bed.mp3" } } : {}) },
              )
              expect(g.nodes.some((n) => n.type === "speaker-frames")).toBe(true)
              expect(refusedEdge(g), JSON.stringify({ shape, captions, reviewBeforeRender, music, framing })).toBeNull()
              graphs++
            }
          }
    expect(graphs).toBe(2 * 2 * 2 * 3 * (1 + MULTICAM_RECORDINGS.length))
  })

  it("while Speaker Map is withheld from the viewer, the switch's Speaker map wire is refused on the canvas (the run still reads it)", () => {
    const g = buildTightenEpisodeGraph(
      resolveTightenEpisodeSettings({ captions: false }, "video", { recordings: 2, masterAudio: false }),
      { media: vid(1), moreMedia: [vid(2)] },
    )
    try {
      availability.unavailable.add(MULTICAM_SPEAKER_MAP_TYPE)
      expect(refusedEdge(g)).toBe("uc-e-uc-map-json-uc-switch-speakerMap")
      availability.unavailable.clear()
      availability.loaded = false
      expect(refusedEdge(g)).toBe("uc-e-uc-map-json-uc-switch-speakerMap")
    } finally {
      availability.unavailable.clear()
      availability.loaded = true
    }
    expect(refusedEdge(g)).toBeNull()
  })

  it("the validator does discriminate (a transcript is not the mix's media)", () => {
    const types: Record<string, string> = { t: "transcribe", m: "mix-audio", s: "silence-detect", c: "add-captions" }
    const typeOf = (id: string) => types[id]
    expect(isValidWorkflowConnection({ source: "t", target: "m", sourceHandle: "json", targetHandle: "in" }, typeOf, buildAdjacency([]))).toBe(false)
    expect(isValidWorkflowConnection({ source: "s", target: "c", sourceHandle: "json", targetHandle: "in" }, typeOf, buildAdjacency([]))).toBe(false)
  })
})
