import { describe, it, expect } from "vitest"
import type { Workflow } from "@nodaro/sdk"

import type { Shot } from "../shot"
import { buildClip, buildStill, clipResults, stillResults } from "../shot"
import { serializeProduction, parseProduction } from "../shot-graph"

/**
 * The prompt-format marker + its look ids must survive a project reload — on
 * BOTH result kinds and on the in-flight animate marker.
 *
 * They are the D4 restore contract: `promptFormat: 2` says `prompt` is the RAW
 * editor prose and the look lives in `look` as ids; its ABSENCE says the prompt
 * has the catalog clauses baked in, so restoring it must not also re-arm the
 * live pickers (or the same hint folds twice). Get either half wrong and a
 * perfectly good result comes back claiming to be the other kind.
 *
 * TWO traps, both exercised here (cloned from the `filerobotDesignStateUrl`
 * round-trip, which exists for the same reasons):
 *  1. `buildStill`/`buildClip` COLLAPSE a lone result to the bare `{ url }`
 *     shape unless the keep-predicate names the field — and one result is the
 *     COMMON case, so the marker would be dropped at the first store write and
 *     read back as legacy, gagging the pickers on a brand-new result.
 *  2. A field written by the serializer but not read back by the parser is
 *     ERASED on the next debounced save (the readVoice lesson).
 */
describe("promptFormat / look / subject round-trip", () => {
  function asWorkflow(shots: Shot[], selectedShotId?: string): Workflow {
    const { nodes, edges, settings } = serializeProduction(shots, selectedShotId)
    return {
      id: "wf-1",
      projectId: "p-1",
      userId: "u-1",
      name: "Production",
      nodes,
      edges,
      settings,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
    }
  }

  const LOOK = { framingId: "medium-shot", atmosphereId: ["fog", "haze"] }
  const SUBJECT = { age: "age-30s", ethnicity: ["eth-a", "eth-b"] }

  it("survives the LONE-result collapse in buildStill", () => {
    const still = buildStill(
      { nodeId: "generate-image-s1", provider: "flux-2-max", prompt: "a knight" },
      [{ url: "https://cdn/a.png", promptFormat: 2, look: LOOK }],
      0,
    )
    const [r] = stillResults(still)
    expect(r.promptFormat).toBe(2)
    expect(r.look).toEqual(LOOK)
  })

  it("survives the LONE-result collapse in buildClip", () => {
    const clip = buildClip(
      { nodeId: "generate-video-s1", provider: "seedance-2", prompt: "she turns" },
      [{ url: "https://cdn/a.mp4", promptFormat: 2, look: LOOK }],
      0,
    )
    const [r] = clipResults(clip)
    expect(r.promptFormat).toBe(2)
    expect(r.look).toEqual(LOOK)
  })

  it("keeps a SUBJECT-only lone result too (the third field)", () => {
    // A keep-predicate that names only two of the three would silently drop the
    // subject ids the S6 leg now puts here.
    const still = buildStill(
      { nodeId: "generate-image-s1", provider: "flux-2-max", prompt: "a knight" },
      [{ url: "https://cdn/a.png", subject: SUBJECT }],
      0,
    )
    expect(stillResults(still)[0].subject).toEqual(SUBJECT)
  })

  it("survives serialize → parse for a lone still result", () => {
    const shot: Shot = {
      id: "shot-s",
      still: buildStill(
        { nodeId: "generate-image-s1", provider: "flux-2-max", prompt: "a knight" },
        [
          {
            url: "https://cdn/a.png",
            prompt: "a knight",
            promptFormat: 2,
            look: LOOK,
            subject: SUBJECT,
          },
        ],
        0,
      ),
    }
    const { nodes } = serializeProduction([shot], "shot-s")
    const img = nodes.find((n) => n.type === "generate-image")
    const wire = (img?.data?.generatedResults as Array<Record<string, unknown>>)[0]
    expect(wire.promptFormat).toBe(2)
    expect(wire.look).toEqual(LOOK)

    const parsed = parseProduction(asWorkflow([shot], "shot-s")).shots
    expect(parsed).toEqual([shot])
  })

  it("survives serialize → parse for a lone clip result", () => {
    const shot: Shot = {
      id: "shot-s",
      still: buildStill(
        { nodeId: "generate-image-s1", provider: "flux-2-max", prompt: "a knight" },
        [{ url: "https://cdn/a.png" }],
        0,
      ),
      clip: buildClip(
        { nodeId: "generate-video-s1", provider: "seedance-2", prompt: "she turns" },
        [
          {
            url: "https://cdn/a.mp4",
            prompt: "she turns",
            promptFormat: 2,
            look: LOOK,
            subject: SUBJECT,
          },
        ],
        0,
      ),
    }
    const parsed = parseProduction(asWorkflow([shot], "shot-s")).shots
    expect(parsed).toEqual([shot])
  })

  it("survives serialize → parse on an in-flight PENDING marker", () => {
    // The marker is the only channel a reload-resumed render has left: without
    // this hop a resumed take lands knowing less than a fresh one.
    const shot: Shot = {
      id: "shot-s",
      pendingClips: [
        {
          jobId: "job-1",
          provider: "seedance-2",
          prompt: "she turns",
          startedAt: 1_760_000_000_000,
          promptFormat: 2,
          look: LOOK,
          subject: SUBJECT,
        },
      ],
    }
    const parsed = parseProduction(asWorkflow([shot], "shot-s")).shots
    expect(parsed[0].pendingClips?.[0].promptFormat).toBe(2)
    expect(parsed[0].pendingClips?.[0].look).toEqual(LOOK)
    expect(parsed[0].pendingClips?.[0].subject).toEqual(SUBJECT)
  })

  it("a marker-less result stays byte-identical (no stray keys)", () => {
    const shot: Shot = {
      id: "shot-s",
      still: buildStill(
        { nodeId: "generate-image-s1", provider: "flux-2-max", prompt: "a knight" },
        [{ url: "https://cdn/a.png" }],
        0,
      ),
    }
    const { nodes } = serializeProduction([shot], "shot-s")
    const wire = (
      nodes.find((n) => n.type === "generate-image")?.data
        ?.generatedResults as Array<Record<string, unknown>>
    )[0]
    expect(wire).not.toHaveProperty("promptFormat")
    expect(wire).not.toHaveProperty("look")
    expect(wire).not.toHaveProperty("subject")
    expect(parseProduction(asWorkflow([shot], "shot-s")).shots).toEqual([shot])
  })

  it("a CORRUPT marker reads as legacy, never as a format it isn't", () => {
    // Degrading toward legacy is the safe direction: a legacy read seeds the
    // prompt verbatim and injects nothing, where a wrongly-trusted marker would
    // fold the same look twice — the exact bug the marker exists to prevent.
    const wf = asWorkflow(
      [
        {
          id: "shot-s",
          still: buildStill(
            { nodeId: "generate-image-s1", provider: "flux-2-max", prompt: "x" },
            [{ url: "https://cdn/a.png", promptFormat: 2, look: LOOK }],
            0,
          ),
        },
      ],
      "shot-s",
    )
    const img = wf.nodes!.find((n) => n.type === "generate-image")!
    const results = img.data!.generatedResults as Array<Record<string, unknown>>
    results[0].promptFormat = 3
    const parsed = parseProduction(wf).shots
    expect(stillResults(parsed[0].still!)[0]).not.toHaveProperty("promptFormat")
    // The ids still round-trip — only the FORMAT claim is rejected.
    expect(stillResults(parsed[0].still!)[0].look).toEqual(LOOK)
  })
})
