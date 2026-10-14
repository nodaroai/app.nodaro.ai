/**
 * The canvas half of the use-case graph totality guard: every edge a Tighten
 * Episode graph can contain is one the editor would let a user draw
 * (`isValidWorkflowConnection` — producer sets × target handle rules), so the
 * built chain is exactly a hand-buildable chain (precedent:
 * podcast-templates-connections.test.ts). A failure here is a design error in
 * the builder — fix the builder, never the validator.
 */
import { describe, it, expect } from "vitest"
import { TIGHTEN_EPISODE_DEFAULTS, buildTightenEpisodeGraph, resolveTightenEpisodeSettings } from "@nodaro/render-rules"
import { buildAdjacency, isValidWorkflowConnection } from "../connection-validation"

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

  it("the validator does discriminate (a transcript is not the mix's media)", () => {
    const types: Record<string, string> = { t: "transcribe", m: "mix-audio", s: "silence-detect", c: "add-captions" }
    const typeOf = (id: string) => types[id]
    expect(isValidWorkflowConnection({ source: "t", target: "m", sourceHandle: "json", targetHandle: "in" }, typeOf, buildAdjacency([]))).toBe(false)
    expect(isValidWorkflowConnection({ source: "s", target: "c", sourceHandle: "json", targetHandle: "in" }, typeOf, buildAdjacency([]))).toBe(false)
  })
})
