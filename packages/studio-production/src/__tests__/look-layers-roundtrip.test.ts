import { describe, it, expect } from "vitest"
import type { Workflow } from "@nodaro/sdk"

import type { Shot } from "../shot"
import { buildClip, buildStill, clipResults, stillResults } from "../shot"
import { serializeProduction, parseProduction } from "../shot-graph"

/**
 * The LAYER SPLIT behind a result's merged `look` (`filmLook` / `sceneLook`,
 * spec D-A1) must survive a project reload — on BOTH result kinds and on the
 * in-flight animate marker.
 *
 * It is the restore contract for the two picker SURFACES: `look` says WHAT was
 * picked, these say WHICH SURFACE each id came from, so selecting an old asset
 * can re-arm the FILM strip and the SCENE grid separately instead of guessing
 * by key. Their PRESENCE is the discriminator (an absent sibling means that
 * layer was genuinely empty at submit), so a lost field is not a degradation —
 * it is a lie about what the run was made with.
 *
 * TWO traps, both exercised here (cloned from the prompt-format round-trip,
 * which exists for the same reasons):
 *  1. `buildStill`/`buildClip` COLLAPSE a lone result to the bare `{ url }`
 *     shape unless the keep-predicate names the field — and one result is the
 *     COMMON case, so the layers would be dropped at the first store write and
 *     the asset would read back as merged-only (the D-A3 heuristic path).
 *  2. A field written by the serializer but not read back by the parser is
 *     ERASED on the next debounced save (the readVoice lesson).
 */
describe("filmLook / sceneLook round-trip (D-A1)", () => {
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

  const FILM = { colorLookId: "warm", eraId: "era-1980s" }
  // The multi-pick array exercises `copyLookMap`'s array arm on the layers too.
  const SCENE = { lightingId: "golden-hour", atmosphereId: ["fog", "haze"] }
  const LOOK = { ...FILM, ...SCENE }

  it("survives the LONE-result collapse in buildStill", () => {
    const still = buildStill(
      { nodeId: "generate-image-s1", provider: "flux-2-max", prompt: "a knight" },
      [
        {
          url: "https://cdn/a.png",
          promptFormat: 2,
          look: LOOK,
          filmLook: FILM,
          sceneLook: SCENE,
        },
      ],
      0,
    )
    const [r] = stillResults(still)
    expect(r.filmLook).toEqual(FILM)
    expect(r.sceneLook).toEqual(SCENE)
  })

  it("survives the LONE-result collapse in buildClip", () => {
    const clip = buildClip(
      { nodeId: "generate-video-s1", provider: "seedance-2", prompt: "she turns" },
      [
        {
          url: "https://cdn/a.mp4",
          promptFormat: 2,
          look: LOOK,
          filmLook: FILM,
          sceneLook: SCENE,
        },
      ],
      0,
    )
    const [r] = clipResults(clip)
    expect(r.filmLook).toEqual(FILM)
    expect(r.sceneLook).toEqual(SCENE)
  })

  it("keeps a LAYER-ONLY lone result too (`look` does not imply the layers)", () => {
    // The clause that forbids leaning on `r.look` in the keep-predicate: a
    // result can carry a layer with no merged echo, and a predicate that named
    // only `look` would drop it at the first store write.
    const still = buildStill(
      { nodeId: "generate-image-s1", provider: "flux-2-max", prompt: "a knight" },
      [{ url: "https://cdn/a.png", sceneLook: SCENE }],
      0,
    )
    expect(stillResults(still)[0].sceneLook).toEqual(SCENE)
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
            filmLook: FILM,
            sceneLook: SCENE,
          },
        ],
        0,
      ),
    }
    const { nodes } = serializeProduction([shot], "shot-s")
    const img = nodes.find((n) => n.type === "generate-image")
    const wire = (img?.data?.generatedResults as Array<Record<string, unknown>>)[0]
    expect(wire.filmLook).toEqual(FILM)
    expect(wire.sceneLook).toEqual(SCENE)

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
            filmLook: FILM,
            sceneLook: SCENE,
          },
        ],
        0,
      ),
    }
    const { nodes } = serializeProduction([shot], "shot-s")
    const vid = nodes.find((n) => n.type === "generate-video")
    const wire = (vid?.data?.generatedResults as Array<Record<string, unknown>>)[0]
    expect(wire.filmLook).toEqual(FILM)
    expect(wire.sceneLook).toEqual(SCENE)

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
          filmLook: FILM,
          sceneLook: SCENE,
        },
      ],
    }
    const parsed = parseProduction(asWorkflow([shot], "shot-s")).shots
    expect(parsed[0].pendingClips?.[0].filmLook).toEqual(FILM)
    expect(parsed[0].pendingClips?.[0].sceneLook).toEqual(SCENE)
  })

  it("a layer-less result stays byte-identical (no stray keys)", () => {
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
    expect(wire).not.toHaveProperty("filmLook")
    expect(wire).not.toHaveProperty("sceneLook")
    expect(parseProduction(asWorkflow([shot], "shot-s")).shots).toEqual([shot])
  })

  it("migrates a RETIRED id in the layers exactly as in the merged map", () => {
    // The guard against a hand-rolled narrower: `readLookMap` runs every value
    // through `liveLookId`, so a retirement (`head-to-knees` → the Shot Size
    // row that replaced it — see retired-looks.test) lands identically on both.
    // Narrow the layers any other way and INV-A3 breaks the day an id retires:
    // the merged map would migrate while its own halves did not.
    const retired = { ...SCENE, framingId: "head-to-knees" }
    const shot: Shot = {
      id: "shot-s",
      still: buildStill(
        { nodeId: "generate-image-s1", provider: "flux-2-max", prompt: "a knight" },
        [
          {
            url: "https://cdn/a.png",
            promptFormat: 2,
            look: { ...FILM, ...retired },
            filmLook: FILM,
            sceneLook: retired,
          },
        ],
        0,
      ),
    }
    const parsed = parseProduction(asWorkflow([shot], "shot-s")).shots
    const r = stillResults(parsed[0].still!)[0]
    expect(r.sceneLook!.framingId).toBe("medium-wide-shot")
    expect(r.sceneLook!.framingId).toBe(r.look!.framingId)
    // INV-A3 still holds after the read: the halves merge back to the whole.
    expect({ ...r.filmLook, ...r.sceneLook }).toEqual(r.look)
  })
})
