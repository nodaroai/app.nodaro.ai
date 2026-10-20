/**
 * The canvas half of the use-case graph totality guard for Trailer: every edge
 * a Trailer graph can contain — one recording, or 2–6 recordings and a Master
 * audio (decided 2026-10-17) — is one the editor would let a user draw
 * (`isValidWorkflowConnection`), so the built chain is exactly a hand-buildable
 * chain. A failure here is a design error in the builder — fix the builder,
 * never the validator.
 */
import { describe, it, expect, vi } from "vitest"
// Camera Switch's Speaker map input follows Speaker Map's availability for the
// viewer: the multicam graphs are checked as a viewer who is offered Speaker Map.
const availability = vi.hoisted(() => ({ loaded: true, unavailable: new Set<string>() }))
vi.mock("@/lib/surface-availability", async (orig) => ({
  ...(await orig<typeof import("@/lib/surface-availability")>()),
  surfaceAvailabilityLoaded: () => availability.loaded,
  isNodeUnavailable: (type: string) => availability.unavailable.has(type),
}))
import {
  MULTICAM_SPEAKER_MAP_TYPE,
  TRAILER_FORMATS,
  buildEpisodeTrailerGraph,
  resolveEpisodeTrailerSettings,
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
const CARD = { url: "https://r2/card.mp4", durationSec: 6 }
const RECORDINGS: ReadonlyArray<UseCaseSources> = [
  { media: vid(1) },
  { media: vid(1), masterAudio: MASTER },
  { media: vid(1), moreMedia: [vid(2)] },
  { media: vid(1), moreMedia: [vid(2), vid(3)], masterAudio: MASTER },
  { media: { url: "https://r2/mixer.wav", kind: "audio" }, moreMedia: [vid(2), vid(3), vid(4), vid(5), vid(6)] },
  { media: vid(1), moreMedia: [vid(2), vid(3), vid(4), vid(5)], masterAudio: MASTER },
]

describe("Trailer graphs are drawable", () => {
  it("every edge of every graph (one recording, 2–6 recordings, a Master audio) passes the canvas validator", () => {
    let graphs = 0
    for (const sources of RECORDINGS)
      for (const synced of [false, true])
        for (const wide of [null, usecaseRecordings(sources).length])
          for (const reviewBeforeRender of [true, false])
            for (const formats of [["9:16"], [...TRAILER_FORMATS]])
              for (const introCard of [false, true]) {
                const shape = { recordings: usecaseRecordings(sources).length, masterAudio: !!sources.masterAudio }
                const raw = { formats, reviewBeforeRender, cameras: { wide, synced, speakerCameras: { "1": 2 } } }
                const g = buildEpisodeTrailerGraph(resolveEpisodeTrailerSettings(raw, "video", shape), { ...sources, ...(introCard ? { introCard: CARD } : {}) })
                expect(refusedEdge(g), JSON.stringify({ shape, raw, introCard })).toBeNull()
                graphs++
              }
    expect(graphs).toBe(6 * 2 * 2 * 2 * 2 * 2)
  })

  it("while Speaker Map is withheld from the viewer, the switch's Speaker map wire is refused on the canvas (the run still reads it)", () => {
    const g = buildEpisodeTrailerGraph(resolveEpisodeTrailerSettings({}, "video", { recordings: 2, masterAudio: false }), { media: vid(1), moreMedia: [vid(2)] })
    try {
      availability.unavailable.add(MULTICAM_SPEAKER_MAP_TYPE)
      expect(refusedEdge(g)).toBe("uc-e-uc-map-json-uc-switch-speakerMap")
    } finally {
      availability.unavailable.clear()
    }
    expect(refusedEdge(g)).toBeNull()
  })
})
