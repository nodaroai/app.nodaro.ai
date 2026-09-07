import { describe, it, expect } from "vitest"
import type { Workflow } from "@nodaro/sdk"
import { DIRECTION_ARRAY_CEILING, DIRECTION_KEYS } from "@nodaro/prompts"

import { clipResults, type PlanMusic, type Shot, type ProductionMusic } from "../shot"
import type { ConnectedReference } from "@nodaro/shared"
import type { VoiceDirection } from "../voice-direction"
import {
  serializeProduction,
  parseProduction,
  studioIndexExpectsShots,
} from "../shot-graph"

/**
 * The graph <-> shots mapping is the production's persistence spine: every save
 * emits the COMPLETE node/edge set from `shots[]`, and a reload reconstructs
 * `shots[]` from the workflow. These tests:
 *   1. SNAPSHOT the serialized `{ nodes, edges, settings }` for the four shapes
 *      (empty | still | still+clip | two shots) so any `@nodaro/sdk` node/edge
 *      schema drift (a renamed field, a changed edge handle) fails LOUDLY rather
 *      than silently shipping a graph the Nodaro canvas can't read.
 *   2. ROUND-TRIP `parse(serialize(shots)) === shots` (modulo dropped placeholders).
 *   3. Assert BOTH a v1 settings object AND a bare generate-image-only graph
 *      MIGRATE to a single Shot (parity with the old single-shot rehydrate).
 * Mirrors assembly.test.ts (the sibling drift tripwire for prompt assembly).
 */

// ── fixtures (stable ids so snapshots are deterministic) ──
const stillOnly: Shot = {
  id: "shot-a",
  still: {
    nodeId: "generate-image-job1",
    url: "https://r2.example/still-a.png",
    provider: "flux-2-max",
    prompt: "a knight on a hill",
  },
}

const stillAndClip: Shot = {
  id: "shot-b",
  still: {
    nodeId: "generate-image-job2",
    url: "https://r2.example/still-b.png",
    provider: "nano-banana",
    prompt: "a dragon over the sea",
  },
  clip: {
    nodeId: "generate-video-job3",
    url: "https://r2.example/clip-b.mp4",
    provider: "grok-i2v",
    prompt: "the dragon beats its wings",
    duration: 5,
  },
}

const emptyShot: Shot = { id: "shot-empty" }

describe("serializeProduction", () => {
  it("emits nothing to the graph for an empty (still-less) shot but indexes it", () => {
    const result = serializeProduction([emptyShot], "shot-empty")
    expect(result).toMatchInlineSnapshot(`
      {
        "edges": [],
        "nodes": [],
        "settings": {
          "studio": {
            "selectedShotId": "shot-empty",
            "shotOrder": [],
            "shots": [
              {
                "id": "shot-empty",
              },
            ],
            "version": 3,
          },
        },
      }
    `)
  })

  it("emits ONE generate-image node for a still-only shot (today's data shape)", () => {
    const result = serializeProduction([stillOnly], "shot-a")
    expect(result).toMatchInlineSnapshot(`
      {
        "edges": [],
        "nodes": [
          {
            "data": {
              "activeResultIndex": 0,
              "generatedImageUrl": "https://r2.example/still-a.png",
              "generatedResults": [
                {
                  "url": "https://r2.example/still-a.png",
                },
              ],
              "label": "Shot 1 frame",
              "prompt": "a knight on a hill",
              "provider": "flux-2-max",
            },
            "id": "generate-image-job1",
            "position": {
              "x": 0,
              "y": 0,
            },
            "type": "generate-image",
            "width": 220,
          },
        ],
        "settings": {
          "studio": {
            "selectedShotId": "shot-a",
            "shotOrder": [
              "generate-image-job1",
            ],
            "shots": [
              {
                "id": "shot-a",
                "imageNodeId": "generate-image-job1",
                "stillProvider": "flux-2-max",
              },
            ],
            "version": 3,
          },
        },
      }
    `)
  })

  it("emits a generate-image + generate-video node wired still->clip via the startFrame handle", () => {
    const result = serializeProduction([stillAndClip], "shot-b")
    expect(result).toMatchInlineSnapshot(`
      {
        "edges": [
          {
            "id": "e-generate-image-job2-generate-video-job3",
            "source": "generate-image-job2",
            "sourceHandle": "image",
            "target": "generate-video-job3",
            "targetHandle": "startFrame",
          },
        ],
        "nodes": [
          {
            "data": {
              "activeResultIndex": 0,
              "generatedImageUrl": "https://r2.example/still-b.png",
              "generatedResults": [
                {
                  "url": "https://r2.example/still-b.png",
                },
              ],
              "label": "Shot 1 frame",
              "prompt": "a dragon over the sea",
              "provider": "nano-banana",
            },
            "id": "generate-image-job2",
            "position": {
              "x": 0,
              "y": 0,
            },
            "type": "generate-image",
            "width": 220,
          },
          {
            "data": {
              "activeResultIndex": 0,
              "duration": 5,
              "generatedResults": [
                {
                  "duration": 5,
                  "prompt": "the dragon beats its wings",
                  "provider": "grok-i2v",
                  "url": "https://r2.example/clip-b.mp4",
                },
              ],
              "generatedVideoUrl": "https://r2.example/clip-b.mp4",
              "imageUrl": "https://r2.example/still-b.png",
              "label": "Shot 1 video",
              "prompt": "the dragon beats its wings",
              "provider": "grok-i2v",
            },
            "id": "generate-video-job3",
            "position": {
              "x": 340,
              "y": 0,
            },
            "type": "generate-video",
            "width": 220,
          },
        ],
        "settings": {
          "studio": {
            "selectedShotId": "shot-b",
            "shotOrder": [
              "generate-image-job2",
              "generate-video-job3",
            ],
            "shots": [
              {
                "clipDuration": 5,
                "clipProvider": "grok-i2v",
                "id": "shot-b",
                "imageNodeId": "generate-image-job2",
                "stillProvider": "nano-banana",
                "videoNodeId": "generate-video-job3",
              },
            ],
            "version": 3,
          },
        },
      }
    `)
  })

  it("orders two shots' nodes (still then clip, per shot) in shotOrder", () => {
    const result = serializeProduction([stillOnly, stillAndClip], "shot-b")
    expect(result.nodes.map((n) => n.id)).toEqual([
      "generate-image-job1",
      "generate-image-job2",
      "generate-video-job3",
    ])
    expect(result.settings.studio.shotOrder).toEqual([
      "generate-image-job1",
      "generate-image-job2",
      "generate-video-job3",
    ])
    expect(result.settings.studio.shots.map((s) => s.id)).toEqual([
      "shot-a",
      "shot-b",
    ])
  })

  it("gives every node a canvas position (else React Flow stacks them at 0,0)", () => {
    const result = serializeProduction([stillOnly, stillAndClip], "shot-b")
    expect(
      result.nodes.every(
        (n) => "position" in n && typeof (n as { position?: unknown }).position === "object",
      ),
    ).toBe(true)
  })

  it("wires every clip into ONE combine-videos node (≥2 clips) in shot order", () => {
    const secondClip: Shot = {
      id: "shot-c",
      still: {
        nodeId: "generate-image-job4",
        url: "https://r2.example/still-c.png",
        provider: "nano-banana",
        prompt: "a ship at dawn",
      },
      clip: {
        nodeId: "generate-video-job5",
        url: "https://r2.example/clip-c.mp4",
        provider: "grok-i2v",
        prompt: "it sails forward",
        duration: 5,
      },
    }
    const result = serializeProduction([stillAndClip, secondClip], "shot-b")

    // still -> clip edges use the canvas START-FRAME handle (not imageUrl).
    expect(result.edges.filter((e) => e.targetHandle === "startFrame")).toHaveLength(2)

    // Exactly one combine-videos node, fed by BOTH clips' `video` -> `in`, in order.
    const combine = result.nodes.find((n) => n.type === "combine-videos")
    expect(combine).toBeDefined()
    const intoCombine = result.edges.filter(
      (e) => e.target === combine?.id && e.targetHandle === "in",
    )
    expect(intoCombine.map((e) => e.source)).toEqual([
      "generate-video-job3",
      "generate-video-job5",
    ])
  })

  it("omits the combine-videos node with fewer than 2 clips", () => {
    const oneClip = serializeProduction([stillAndClip], "shot-b")
    expect(oneClip.nodes.some((n) => n.type === "combine-videos")).toBe(false)
    const noClip = serializeProduction([stillOnly], "shot-a")
    expect(noClip.nodes.some((n) => n.type === "combine-videos")).toBe(false)
  })

  it("does not mutate the input shots array", () => {
    const shots = [stillOnly, stillAndClip]
    const frozen = Object.freeze([...shots])
    serializeProduction(frozen, "shot-a")
    expect(shots).toEqual([stillOnly, stillAndClip])
  })
})

describe("parseProduction (v2 round-trip)", () => {
  /** Serialize shots to a v2 settings object, then wrap as a loaded Workflow. */
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

  describe("studioIndexExpectsShots — hydration-failure guard", () => {
    const stillShot: Shot = {
      id: "s1",
      still: {
        nodeId: "generate-image-s1",
        url: "https://r2.example/s1.png",
        provider: "nano-banana",
        prompt: "p",
      },
    }

    it("is TRUE when the index references a node-backed shot", () => {
      expect(studioIndexExpectsShots(asWorkflow([stillShot], "s1"))).toBe(true)
    })

    it("flags the overwrite trap — a non-empty index whose nodes are GONE", () => {
      // The exact failure mode: the index still references generate-image-s1 but
      // the nodes vanished, so parse yields 0 shots. A naive full-graph persist
      // would then PATCH shots:[] over real work — this guard lets the caller
      // refuse that write.
      const wf = { ...asWorkflow([stillShot], "s1"), nodes: [] }
      expect(parseProduction(wf).shots).toEqual([])
      expect(studioIndexExpectsShots(wf)).toBe(true)
    })

    it("is FALSE for a placeholder-only index (a fresh empty shot is legitimately empty)", () => {
      expect(studioIndexExpectsShots(asWorkflow([{ id: "s1" }], "s1"))).toBe(false)
    })

    it("is FALSE for an empty index and for a non-studio workflow", () => {
      expect(studioIndexExpectsShots(asWorkflow([]))).toBe(false)
      expect(
        studioIndexExpectsShots({ ...asWorkflow([]), settings: {} }),
      ).toBe(false)
    })
  })

  it("round-trips a still-only + still+clip production exactly", () => {
    const shots = [stillOnly, stillAndClip]
    const parsed = parseProduction(asWorkflow(shots, "shot-b"))
    expect(parsed.shots).toEqual(shots)
    expect(parsed.selectedShotId).toBe("shot-b")
  })

  // A picked look is a SETTING: it holds until the user changes it. Both layers
  // must survive the save/reload round-trip — a new optional field that isn't
  // read back by the narrowers is erased on the next save, which is exactly how
  // "I chose something and after a refresh it was back to Default" happens.
  it("round-trips the FILM look and each scene's own look", () => {
    const film = { camera: "wide-angle", colour: "teal-orange" }
    const shots: Shot[] = [
      { ...stillOnly, look: { lighting: "golden-hour" } },
      { ...stillAndClip },
    ]
    const { nodes, edges, settings } = serializeProduction(
      shots,
      "shot-b",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      film,
    )
    const parsed = parseProduction({
      ...asWorkflow([]),
      nodes,
      edges,
      settings,
    })
    expect(parsed.film).toEqual(film)
    expect(parsed.shots[0]!.look).toEqual({ lighting: "golden-hour" })
    // A scene with no look of its own stays byte-identical (no empty map).
    expect(parsed.shots[1]!.look).toBeUndefined()
  })

  it("round-trips the storyboard authoring state (so the tab survives a reload)", () => {
    const sb = {
      on: true,
      brief: "a Rome car chase",
      filmLength: 60,
      scripts: { "shot-a": "Alley launch" },
      breakdowns: { "shot-a": "Panel 1 (00:00-00:01): [[c:Natalie]] floors it" },
      seconds: { "shot-a": 5 },
    }
    const { settings } = serializeProduction([stillOnly], "shot-a", undefined, undefined, undefined, sb)
    const parsed = parseProduction({ ...asWorkflow([stillOnly], "shot-a"), settings })
    expect(parsed.storyboard).toEqual(sb)
  })

  it("round-trips the CUT VERSIONS (every FreeCut production export survives a reload)", () => {
    const cuts = [
      {
        id: "cut-1",
        name: "Cut A",
        url: "https://r2/cut-a.mp4",
        freecutProjectUrl: "https://r2/cut-a.json",
        duration: 122,
        shotsCount: 8,
        exportedAt: "2026-07-27T12:00:00.000Z",
        final: true as const,
      },
      {
        id: "cut-2",
        name: "Cut B — tighter opening",
        url: "https://r2/cut-b.mp4",
        exportedAt: "2026-07-27T13:00:00.000Z",
      },
    ]
    const { settings } = serializeProduction(
      [stillOnly], "shot-a", undefined, undefined, undefined, undefined, cuts,
    )
    const parsed = parseProduction({ ...asWorkflow([stillOnly], "shot-a"), settings })
    expect(parsed.cuts).toEqual(cuts)
  })

  it("omits cuts from settings when absent + drops a url-less persisted blob", () => {
    const { settings } = serializeProduction([stillOnly], "shot-a")
    expect((settings.studio as { cuts?: unknown }).cuts).toBeUndefined()
    // A junk entry (no url) narrows AWAY instead of poisoning the store.
    const wf = asWorkflow([stillOnly], "shot-a")
    const junk = {
      ...wf,
      settings: {
        studio: {
          ...(wf.settings as { studio: object }).studio,
          cuts: [{ exportedAt: "x" }],
        },
      },
    }
    expect(parseProduction(junk).cuts).toBeUndefined()
  })

  it("MIGRATES the short-lived single finalCut blob into a one-entry cuts list", () => {
    const wf = asWorkflow([stillOnly], "shot-a")
    const legacy = {
      ...wf,
      settings: {
        studio: {
          ...(wf.settings as { studio: object }).studio,
          finalCut: {
            url: "https://r2/final-cut.mp4",
            freecutProjectUrl: "https://r2/final-cut.json",
            exportedAt: "2026-07-27T12:00:00.000Z",
          },
        },
      },
    }
    const parsed = parseProduction(legacy)
    expect(parsed.cuts).toHaveLength(1)
    expect(parsed.cuts?.[0]).toMatchObject({
      name: "Cut A",
      url: "https://r2/final-cut.mp4",
      freecutProjectUrl: "https://r2/final-cut.json",
      final: true,
    })
  })

  it("omits the storyboard from settings when it carries no content", () => {
    const { settings } = serializeProduction([stillOnly], "shot-a", undefined, undefined, undefined, {})
    expect((settings.studio as { storyboard?: unknown }).storyboard).toBeUndefined()
    expect(parseProduction(asWorkflow([stillOnly], "shot-a")).storyboard).toBeUndefined()
  })

  it("prunes orphan storyboard keys (a removed shot leaves no dead key in the blob)", () => {
    // "ghost" has no live shot — only "shot-a" (stillOnly) is in the production.
    const sb = {
      scripts: { "shot-a": "kept", ghost: "orphan" },
      seconds: { "shot-a": 5, ghost: 9 },
    }
    const { settings } = serializeProduction([stillOnly], "shot-a", undefined, undefined, undefined, sb)
    const saved = (settings.studio as { storyboard?: typeof sb }).storyboard
    expect(saved?.scripts).toEqual({ "shot-a": "kept" })
    expect(saved?.seconds).toEqual({ "shot-a": 5 })
  })

  it("round-trips a shot's user name (⋯ Rename)", () => {
    const named: Shot = { ...stillOnly, name: "Opening wide" }
    const parsed = parseProduction(asWorkflow([named], "shot-a"))
    expect(parsed.shots).toEqual([named])
    expect(parsed.shots[0]?.name).toBe("Opening wide")
  })

  it("round-trips a shot's MULTIPLE still results (X images per shot)", () => {
    const multi: Shot = {
      id: "shot-a",
      still: {
        nodeId: "generate-image-job1",
        url: "https://r2.example/b.png", // active = index 1
        provider: "flux-2-max",
        prompt: "a knight",
        results: [
          // Per-result prompt + provider ride along (reloaded on strip-click).
          { url: "https://r2.example/a.png", jobId: "job1", prompt: "a knight", provider: "flux-2-max" },
          { url: "https://r2.example/b.png", jobId: "job2", prompt: "a knight, dawn", provider: "nano-banana" },
        ],
        activeIndex: 1,
      },
    }
    const { nodes } = serializeProduction([multi], "shot-a")
    const img = nodes.find((n) => n.type === "generate-image")
    // The whole results list (+ per-result prompt/provider) + the active index
    // land on ONE generate-image node.
    expect(img?.data?.generatedResults).toEqual([
      { url: "https://r2.example/a.png", jobId: "job1", prompt: "a knight", provider: "flux-2-max" },
      { url: "https://r2.example/b.png", jobId: "job2", prompt: "a knight, dawn", provider: "nano-banana" },
    ])
    expect(img?.data?.activeResultIndex).toBe(1)
    expect(img?.data?.generatedImageUrl).toBe("https://r2.example/b.png") // active
    expect(parseProduction(asWorkflow([multi], "shot-a")).shots).toEqual([multi])
  })

  it("round-trips negativePrompt on still results, clip results AND pending markers", () => {
    // The negative prompt lives per-result (restore context, like the prompt) and
    // on the in-flight marker (resume context). A field serialized but not read
    // back by the narrowers is ERASED on the next save (the readVoice lesson) —
    // this pins all three read paths at once. The lone still/clip results also
    // exercise the keep-predicates: a negative-bearing lone result must KEEP its
    // results list (collapsing to the bare shape would drop the field).
    const withNegatives: Shot = {
      id: "shot-a",
      still: {
        nodeId: "generate-image-job1",
        url: "https://r2.example/a.png",
        provider: "qwen",
        prompt: "a knight",
        results: [
          {
            url: "https://r2.example/a.png",
            jobId: "job1",
            prompt: "a knight",
            negativePrompt: "blur, text, watermark",
            provider: "qwen",
          },
        ],
        activeIndex: 0,
      },
      clip: {
        nodeId: "generate-video-job2",
        url: "https://r2.example/a.mp4",
        provider: "kling-3.0",
        prompt: "pan left",
        results: [
          {
            url: "https://r2.example/a.mp4",
            jobId: "job2",
            prompt: "pan left",
            negativePrompt: "shaky camera",
            provider: "kling-3.0",
            startFrameUrl: "https://r2.example/a.png",
          },
        ],
        activeIndex: 0,
      },
      pendingClips: [
        {
          jobId: "vid-789",
          provider: "kling-3.0",
          prompt: "another take",
          negativePrompt: "jump cuts",
          startedAt: 1717000000000,
        },
      ],
    }
    expect(parseProduction(asWorkflow([withNegatives], "shot-a")).shots).toEqual([
      withNegatives,
    ])
  })

  it("round-trips the LEVERS a result was made at (aspect / resolution / count)", () => {
    // What "take the settings of scene 3" reads back. Results already recorded
    // their prompt / model / refs; these three were the gap. Serialized but not
    // read back = ERASED on the next save (the readVoice lesson), and the copy
    // would then silently apply nothing — so all three read paths are pinned
    // here at once: still result, clip result, and the in-flight marker.
    const withLevers: Shot = {
      id: "shot-a",
      still: {
        nodeId: "generate-image-job1",
        url: "https://r2.example/a.png",
        provider: "qwen",
        prompt: "a knight",
        results: [
          {
            url: "https://r2.example/a.png",
            jobId: "job1",
            prompt: "a knight",
            provider: "qwen",
            aspectRatio: "16:9",
            resolution: "2k",
            count: 4,
          },
        ],
        activeIndex: 0,
      },
      clip: {
        nodeId: "generate-video-job2",
        url: "https://r2.example/a.mp4",
        provider: "seedance-2",
        prompt: "pan left",
        results: [
          {
            url: "https://r2.example/a.mp4",
            jobId: "job2",
            prompt: "pan left",
            provider: "seedance-2",
            aspectRatio: "21:9",
            resolution: "720p",
            startFrameUrl: "https://r2.example/a.png",
          },
        ],
        activeIndex: 0,
      },
      pendingClips: [
        {
          jobId: "vid-789",
          provider: "seedance-2",
          prompt: "another take",
          aspectRatio: "1:1",
          resolution: "480p",
          startedAt: 1717000000000,
        },
      ],
    }
    expect(parseProduction(asWorkflow([withLevers], "shot-a")).shots).toEqual([
      withLevers,
    ])
  })

  it("round-trips a result's referenceImageUrls (restore the refs sent to the model)", () => {
    // The reference images a generation was sent ride along per-result so a
    // strip-click can restore them into the composer's manual-refs channel.
    const withRefs: Shot = {
      id: "shot-a",
      still: {
        nodeId: "generate-image-job1",
        url: "https://r2.example/b.png", // active = index 1
        provider: "nano-banana",
        prompt: "a knight",
        results: [
          {
            url: "https://r2.example/a.png",
            jobId: "job1",
            prompt: "a knight",
            provider: "flux-2-max",
          },
          {
            url: "https://r2.example/b.png",
            jobId: "job2",
            prompt: "a knight, dawn",
            provider: "nano-banana",
            referenceImageUrls: [
              "https://r2.example/ref1.png",
              "https://r2.example/ref2.png",
            ],
          },
        ],
        activeIndex: 1,
      },
    }
    const { nodes } = serializeProduction([withRefs], "shot-a")
    const img = nodes.find((n) => n.type === "generate-image")
    // The refs land on the per-result blob (the result WITHOUT refs stays bare).
    expect(img?.data?.generatedResults).toEqual([
      {
        url: "https://r2.example/a.png",
        jobId: "job1",
        prompt: "a knight",
        provider: "flux-2-max",
      },
      {
        url: "https://r2.example/b.png",
        jobId: "job2",
        prompt: "a knight, dawn",
        provider: "nano-banana",
        referenceImageUrls: [
          "https://r2.example/ref1.png",
          "https://r2.example/ref2.png",
        ],
      },
    ])
    expect(parseProduction(asWorkflow([withRefs], "shot-a")).shots).toEqual([
      withRefs,
    ])
  })

  it("round-trips a result WITHOUT refs unchanged (back-compat, no empty array)", () => {
    // A pre-feature result (no referenceImageUrls) must round-trip byte-identical
    // — no stray empty `referenceImageUrls` key creeps onto the serialized blob.
    const { nodes } = serializeProduction([stillOnly], "shot-a")
    const img = nodes.find((n) => n.type === "generate-image")
    expect(img?.data?.generatedResults).toEqual([
      { url: "https://r2.example/still-a.png" },
    ])
    expect(
      (img?.data?.generatedResults as Array<Record<string, unknown>>)[0],
    ).not.toHaveProperty("referenceImageUrls")
    expect(parseProduction(asWorkflow([stillOnly], "shot-a")).shots).toEqual([
      stillOnly,
    ])
  })

  it("round-trips a still result's custom name — a LONE named still keeps its list", () => {
    // A renamed image (referenced as an image chip) lives per-result. A LONE named
    // still must keep its results list (buildStill's keep-predicate) so the name
    // isn't collapsed away, and the name must survive serialize -> parse.
    const named: Shot = {
      id: "shot-a",
      still: {
        nodeId: "generate-image-job1",
        url: "https://r2.example/hero.png",
        provider: "nano-banana",
        prompt: "a knight",
        results: [
          {
            url: "https://r2.example/hero.png",
            jobId: "job1",
            name: "Hero astronaut",
            prompt: "a knight",
            provider: "nano-banana",
          },
        ],
        activeIndex: 0,
      },
    }
    const { nodes } = serializeProduction([named], "shot-a")
    const img = nodes.find((n) => n.type === "generate-image")
    expect(
      (img?.data?.generatedResults as Array<Record<string, unknown>>)[0],
    ).toMatchObject({ name: "Hero astronaut" })
    // A result WITHOUT a name never gets a stray `name` key (byte-identical).
    expect(
      (
        serializeProduction([stillOnly], "shot-a").nodes.find(
          (n) => n.type === "generate-image",
        )?.data?.generatedResults as Array<Record<string, unknown>>
      )[0],
    ).not.toHaveProperty("name")
    expect(parseProduction(asWorkflow([named], "shot-a")).shots).toEqual([named])
  })

  it("round-trips a renamed clip TAKE — a lone named take keeps its list", () => {
    // The clips-rail rename (the video mirror of the named still above): takes
    // share a start frame, so the name is what tells them apart. A LONE named
    // take must keep its results list (buildClip's keep-predicate) and the name
    // must survive serialize -> parse — a field written to the wire but not read
    // back by readClipResults would be ERASED on the next save.
    const namedTake: Shot = {
      id: "shot-t",
      still: {
        nodeId: "generate-image-job1",
        url: "https://r2.example/still.png",
        provider: "nano-banana",
        prompt: "p",
      },
      clip: {
        nodeId: "generate-video-take1",
        url: "https://r2.example/take1.mp4",
        provider: "seedance-2",
        prompt: "they collide",
        duration: 5,
        results: [
          {
            url: "https://r2.example/take1.mp4",
            jobId: "take1",
            name: "Crash into frame",
            prompt: "they collide",
            startFrameUrl: "https://r2.example/still.png",
          },
        ],
        activeIndex: 0,
      },
    }
    const { nodes } = serializeProduction([namedTake], "shot-t")
    const vid = nodes.find((n) => n.type === "generate-video")
    expect(
      (vid?.data?.generatedResults as Array<Record<string, unknown>>)[0],
    ).toMatchObject({ name: "Crash into frame" })
    expect(parseProduction(asWorkflow([namedTake], "shot-t")).shots).toEqual([
      namedTake,
    ])
  })

  it("round-trips a ONE-TAKE clip's frames and references (the collapse keeps them)", () => {
    // The frames a take was animated FROM and the references rail it was sent
    // with live per-result and have no clip-level mirror, so the lone-result
    // collapse DROPPED them: a single frames take reloaded with no start/end
    // frame and a single references take with an empty rail, while a two-take
    // history kept both. The keep-predicate holds the list for them now — the
    // reader (readClipResults) already read every one of them back.
    const oneTake: Shot = {
      id: "shot-1",
      still: {
        nodeId: "generate-image-job1",
        url: "https://r2.example/still.png",
        provider: "nano-banana",
        prompt: "p",
      },
      clip: {
        nodeId: "generate-video-take1",
        url: "https://r2.example/take1.mp4",
        provider: "seedance-2",
        prompt: "she turns",
        duration: 6,
        results: [
          {
            url: "https://r2.example/take1.mp4",
            jobId: "take1",
            prompt: "she turns",
            startFrameUrl: "https://r2.example/start.png",
            endFrameUrl: "https://r2.example/end.png",
            referenceImageUrls: ["https://r2.example/ref1.png"],
          },
        ],
        activeIndex: 0,
      },
    }
    expect(parseProduction(asWorkflow([oneTake], "shot-1")).shots).toEqual([
      oneTake,
    ])
  })

  it("round-trips a clip result's directing references — chips survive a project reload", () => {
    // The user's exact bug: leaving the project and coming back dropped the directing
    // `@`-entity chips to plain text. A clip result's bound references must survive
    // serialize -> parse. A LONE clip WITH chips keeps its results list (so the chips
    // aren't collapsed away with the result) and round-trips exactly — rich fields
    // (slug / canonical) included.
    const muli = {
      id: "muli",
      defaultName: "Muli",
      source: "wired-character" as const,
      url: "https://r2.example/muli.png",
      characterSlug: "muli",
      characterCanonicalDescription: "a tall astronaut",
    }
    const clipWithChips: Shot = {
      id: "shot-c",
      still: {
        nodeId: "generate-image-s1",
        url: "https://r2.example/still.png",
        provider: "nano-banana",
        prompt: "astronauts",
      },
      clip: {
        nodeId: "generate-video-s1",
        url: "https://r2.example/clip.mp4",
        provider: "seedance-2",
        prompt: "Muli walks",
        results: [{ url: "https://r2.example/clip.mp4", references: [muli] }],
        activeIndex: 0,
      },
    }
    const { nodes } = serializeProduction([clipWithChips], "shot-c")
    const vid = nodes.find((n) => n.type === "generate-video")
    expect(
      (vid?.data?.generatedResults as Array<Record<string, unknown>>)[0]
        .references,
    ).toEqual([muli])
    expect(parseProduction(asWorkflow([clipWithChips], "shot-c")).shots).toEqual([
      clipWithChips,
    ])
  })

  it("round-trips a still result's framing references — chips survive a reload", () => {
    // The framing mirror: a still result's bound chips survive serialize -> parse too
    // (the lone still keeps its results list so the chips aren't collapsed away).
    const kira = {
      id: "kira",
      defaultName: "Kira",
      source: "wired-character" as const,
      url: "https://r2.example/kira.png",
    }
    const stillWithChips: Shot = {
      id: "shot-d",
      still: {
        nodeId: "generate-image-s1",
        url: "https://r2.example/a.png",
        provider: "nano-banana",
        prompt: "Kira smiles",
        results: [{ url: "https://r2.example/a.png", references: [kira] }],
        activeIndex: 0,
      },
    }
    const { nodes } = serializeProduction([stillWithChips], "shot-d")
    const img = nodes.find((n) => n.type === "generate-image")
    expect(
      (img?.data?.generatedResults as Array<Record<string, unknown>>)[0]
        .references,
    ).toEqual([kira])
    expect(parseProduction(asWorkflow([stillWithChips], "shot-d")).shots).toEqual(
      [stillWithChips],
    )
  })

  it("round-trips a shot's MULTIPLE clip results (video history) + per-result source frames", () => {
    // The video mirror of the X-images-per-shot test: every directing candidate
    // rides along on ONE generate-video node, each remembering the start/end
    // frames it was generated from (spec #9c) + the directing prompt.
    const multiClip: Shot = {
      id: "shot-b",
      still: { ...stillAndClip.still! },
      clip: {
        nodeId: "generate-video-job3",
        url: "https://r2.example/clip-b2.mp4", // active = index 1
        // Clip level MIRRORS the ACTIVE result (index 1) — like `url`. The
        // card's length badge / filmstrip / export read these, so they follow
        // the take on screen, not the first-ever generation.
        provider: "veo-3",
        prompt: "the dragon dives",
        duration: 8,
        results: [
          {
            url: "https://r2.example/clip-b1.mp4",
            jobId: "job3",
            prompt: "the dragon beats its wings",
            provider: "grok-i2v",
            duration: 5,
            startFrameUrl: "https://r2.example/start1.png",
            endFrameUrl: "https://r2.example/end1.png",
          },
          {
            url: "https://r2.example/clip-b2.mp4",
            jobId: "job4",
            prompt: "the dragon dives",
            provider: "veo-3",
            duration: 8,
            startFrameUrl: "https://r2.example/start2.png",
          },
        ],
        activeIndex: 1,
      },
    }
    const { nodes } = serializeProduction([multiClip], "shot-b")
    const vid = nodes.find((n) => n.type === "generate-video")
    // The whole results list (+ per-result source frames/prompt/jobId/model+length)
    // + the active index land on ONE generate-video node. The 2nd result has no
    // endFrame, so that key stays absent (minimal).
    expect(vid?.data?.generatedResults).toEqual([
      {
        url: "https://r2.example/clip-b1.mp4",
        jobId: "job3",
        prompt: "the dragon beats its wings",
        provider: "grok-i2v",
        duration: 5,
        startFrameUrl: "https://r2.example/start1.png",
        endFrameUrl: "https://r2.example/end1.png",
      },
      {
        url: "https://r2.example/clip-b2.mp4",
        jobId: "job4",
        prompt: "the dragon dives",
        provider: "veo-3",
        duration: 8,
        startFrameUrl: "https://r2.example/start2.png",
      },
    ])
    expect(vid?.data?.activeResultIndex).toBe(1)
    expect(vid?.data?.generatedVideoUrl).toBe("https://r2.example/clip-b2.mp4") // active
    expect(parseProduction(asWorkflow([multiClip], "shot-b")).shots).toEqual([multiClip])
  })

  it("round-trips a clip's re-voice provenance (revoicedVoiceId + name)", () => {
    // A clip produced via the transparent re-voice chain carries the target
    // ElevenLabs voice; it must survive on the generate-video node (the
    // intermediate trim/voice-changer/merge jobs are transient + NOT persisted).
    const revoiced: Shot = {
      ...stillAndClip,
      clip: {
        ...stillAndClip.clip!,
        revoicedVoiceId: "voice-uuid-123",
        revoicedVoiceName: "Rachel",
      },
    }
    const { nodes } = serializeProduction([revoiced], "shot-b")
    const vid = nodes.find((n) => n.type === "generate-video")
    expect(vid?.data?.revoicedVoiceId).toBe("voice-uuid-123")
    expect(vid?.data?.revoicedVoiceName).toBe("Rachel")
    expect(parseProduction(asWorkflow([revoiced], "shot-b")).shots).toEqual([
      revoiced,
    ])
  })

  it("round-trips a plain clip WITHOUT re-voice fields unchanged (no stray keys)", () => {
    // An un-revoiced clip must round-trip byte-identical — no empty
    // revoicedVoiceId/Name keys creep onto the serialized generate-video node.
    const { nodes } = serializeProduction([stillAndClip], "shot-b")
    const vid = nodes.find((n) => n.type === "generate-video")
    expect(vid?.data).not.toHaveProperty("revoicedVoiceId")
    expect(vid?.data).not.toHaveProperty("revoicedVoiceName")
    expect(parseProduction(asWorkflow([stillAndClip], "shot-b")).shots).toEqual([
      stillAndClip,
    ])
  })

  it("round-trips start AND end frame keyframes (start→end interpolation)", () => {
    const withFrames: Shot = {
      ...stillOnly,
      startFrame: "https://r2.example/start.png",
      endFrame: "https://r2.example/end.png",
    }
    const { settings } = serializeProduction([withFrames], "shot-a")
    expect(settings.studio.shots[0].startFrameUrl).toBe("https://r2.example/start.png")
    expect(settings.studio.shots[0].endFrameUrl).toBe("https://r2.example/end.png")
    expect(parseProduction(asWorkflow([withFrames], "shot-a")).shots).toEqual([withFrames])
  })

  it("round-trips a shot's directing references (Seedance 2-style input)", () => {
    const withRefs: Shot = {
      ...stillOnly,
      directingReferenceUrls: [
        "https://r2.example/ref1.png",
        "https://r2.example/ref2.png",
      ],
    }
    const { settings } = serializeProduction([withRefs], "shot-a")
    expect(settings.studio.shots[0].directingReferenceUrls).toEqual([
      "https://r2.example/ref1.png",
      "https://r2.example/ref2.png",
    ])
    expect(parseProduction(asWorkflow([withRefs], "shot-a")).shots).toEqual([withRefs])
  })

  it("round-trips a keyframe shot WITHOUT directing-reference keys (no stray keys)", () => {
    // A shot with no references must stay byte-identical — no empty
    // directingReferenceUrls key creeps onto the serialized entry.
    const { settings } = serializeProduction([stillOnly], "shot-a")
    expect(settings.studio.shots[0]).not.toHaveProperty("directingReferenceUrls")
    expect(parseProduction(asWorkflow([stillOnly], "shot-a")).shots).toEqual([stillOnly])
  })

  it("round-trips a clip result's referenceImageUrls (references-mode clip, no end frame)", () => {
    // Per-result references survive on the generate-video node alongside the
    // frames-mode sibling — restored when stepping back to a past clip (#9c).
    // Two results here; a LONE references take keeps its list too (the
    // keep-predicate) — that case is pinned by the one-take round-trip above.
    const refClip: Shot = {
      id: "shot-c",
      still: { ...stillAndClip.still! },
      clip: {
        nodeId: "generate-video-jobR",
        url: "https://r2.example/ref-clip.mp4", // active = index 0
        provider: "seedance-2",
        prompt: "she turns and smiles",
        duration: 6,
        results: [
          {
            url: "https://r2.example/ref-clip.mp4",
            jobId: "jobR",
            prompt: "she turns and smiles",
            provider: "seedance-2",
            duration: 6,
            startFrameUrl: "https://r2.example/start.png",
            referenceImageUrls: [
              "https://r2.example/ref1.png",
              "https://r2.example/ref2.png",
            ],
          },
          {
            url: "https://r2.example/frames-clip.mp4",
            jobId: "jobF",
            prompt: "she walks away",
            provider: "veo3",
            duration: 6,
            startFrameUrl: "https://r2.example/start.png",
            endFrameUrl: "https://r2.example/end.png",
          },
        ],
        activeIndex: 0,
      },
    }
    const { nodes } = serializeProduction([refClip], "shot-c")
    const vid = nodes.find((n) => n.type === "generate-video")
    const results = vid?.data?.generatedResults as Array<Record<string, unknown>>
    expect(results[0].referenceImageUrls).toEqual([
      "https://r2.example/ref1.png",
      "https://r2.example/ref2.png",
    ])
    // References mode is end-frame-free; the frames-mode sibling carries no refs.
    expect(results[0]).not.toHaveProperty("endFrameUrl")
    expect(results[1]).not.toHaveProperty("referenceImageUrls")
    expect(parseProduction(asWorkflow([refClip], "shot-c")).shots).toEqual([refClip])
  })

  it("round-trips a clip result's VIDEO + AUDIO references (Seedance 2 references mode)", () => {
    const refClip: Shot = {
      id: "shot-av",
      still: { ...stillAndClip.still! },
      clip: {
        nodeId: "generate-video-jobAV",
        url: "https://r2.example/av-clip.mp4",
        provider: "seedance-2",
        prompt: "match this motion + voice",
        duration: 6,
        results: [
          {
            url: "https://r2.example/av-clip.mp4",
            jobId: "jobAV",
            prompt: "match this motion + voice",
            provider: "seedance-2",
            duration: 6,
            referenceImageUrls: ["https://r2.example/i1.png"],
            referenceVideoUrls: [
              "https://r2.example/v1.mp4",
              "https://r2.example/v2.mp4",
            ],
            referenceAudioUrls: ["https://r2.example/a1.mp3"],
          },
          {
            url: "https://r2.example/plain-clip.mp4",
            jobId: "jobP",
            prompt: "she walks away",
            provider: "veo3",
            duration: 6,
            startFrameUrl: "https://r2.example/start.png",
          },
        ],
        activeIndex: 0,
      },
    }
    const { nodes } = serializeProduction([refClip], "shot-av")
    const results = nodes.find((n) => n.type === "generate-video")?.data
      ?.generatedResults as Array<Record<string, unknown>>
    expect(results[0].referenceVideoUrls).toEqual([
      "https://r2.example/v1.mp4",
      "https://r2.example/v2.mp4",
    ])
    expect(results[0].referenceAudioUrls).toEqual(["https://r2.example/a1.mp3"])
    // The plain sibling carries none of the reference kinds.
    expect(results[1]).not.toHaveProperty("referenceVideoUrls")
    expect(results[1]).not.toHaveProperty("referenceAudioUrls")
    expect(parseProduction(asWorkflow([refClip], "shot-av")).shots).toEqual([refClip])
  })

  it("round-trips a shot's directing references for every media kind (settings.studio)", () => {
    const shot: Shot = {
      id: "shot-d",
      still: { ...stillAndClip.still! },
      directingReferenceUrls: ["https://r2.example/img1.png"],
      directingReferenceVideoUrls: ["https://r2.example/vid1.mp4"],
      directingReferenceAudioUrls: ["https://r2.example/aud1.mp3"],
    }
    expect(parseProduction(asWorkflow([shot], "shot-d")).shots).toEqual([shot])
  })

  it("round-trips a references-mode clip with NO still (references ARE the input)", () => {
    // A references run animates from reference images, not a start-frame still —
    // so the shot has a clip but no still. It serializes a STANDALONE generate-video
    // node (no image node, no still→clip edge, no imageUrl) and survives reload.
    const refOnly: Shot = {
      id: "shot-r",
      clip: {
        nodeId: "generate-video-shot-r",
        url: "https://r2.example/ref-clip.mp4",
        provider: "seedance-2",
        prompt: "they meet in the street",
        duration: 6,
      },
      directingReferenceUrls: [
        "https://r2.example/ref1.png",
        "https://r2.example/ref2.png",
      ],
    }
    const { nodes, edges } = serializeProduction([refOnly], "shot-r")
    expect(nodes.filter((n) => n.type === "generate-image")).toHaveLength(0)
    const vid = nodes.find((n) => n.type === "generate-video")
    expect(vid).toBeDefined()
    expect(vid?.data).not.toHaveProperty("imageUrl") // no start frame
    expect(edges).toHaveLength(0) // no still→clip edge
    expect(parseProduction(asWorkflow([refOnly], "shot-r")).shots).toEqual([refOnly])
  })

  it("round-trips a shot's in-flight animate markers (one per concurrent render)", () => {
    const pending: Shot = {
      ...stillOnly,
      pendingClips: [
        {
          jobId: "vid-123",
          provider: "seedance-2",
          prompt: "they meet in the street",
          duration: 12,
          startedAt: 1717000000000,
        },
        {
          jobId: "vid-456",
          provider: "grok-i2v",
          prompt: "another take",
          startedAt: 1717000005000,
        },
      ],
    }
    const { settings } = serializeProduction([pending], "shot-a")
    expect(
      settings.studio.shots[0].pendingClips?.map((p) => p.jobId),
    ).toEqual(["vid-123", "vid-456"])
    expect(parseProduction(asWorkflow([pending], "shot-a")).shots).toEqual([pending])
  })

  it("round-trips a shot WITHOUT pending markers unchanged (no stray key)", () => {
    const { settings } = serializeProduction([stillOnly], "shot-a")
    expect(settings.studio.shots[0]).not.toHaveProperty("pendingClips")
    expect(parseProduction(asWorkflow([stillOnly], "shot-a")).shots).toEqual([stillOnly])
  })

  it("round-trips a revoice plan's keep-slots + per-voice settings + noise flag", () => {
    // A reload mid-render must resume the EXACT recast: speaker 1 kept (null
    // wire slot), speaker 2 tuned — losing `keep`/`settings` would silently
    // recast the kept speaker / drop the user's levers.
    const withRevoice: Shot = {
      ...stillOnly,
      pendingClips: [
        {
          jobId: "vid-789",
          provider: "seedance-2",
          prompt: "two speakers",
          startedAt: 1717000000000,
          revoiceTo: {
            orderedVoices: [
              { voiceId: "v-keep", voiceName: "Kept", keep: true },
              {
                voiceId: "v-david",
                voiceName: "David",
                settings: { stability: 0.9, seed: 42 },
              },
            ],
            settings: {
              preserveBackground: true,
              separationQuality: "fast",
              musicVolumeMode: "match",
              removeBackgroundNoise: true,
            },
          },
        },
      ],
    }
    expect(parseProduction(asWorkflow([withRevoice], "shot-a")).shots).toEqual([
      withRevoice,
    ])
  })

  it("round-trips a follow-up marker's native-render fallback (`nativeVideoUrl`)", () => {
    // The voice-changer follow-up marker carries the finished NATIVE render so
    // a failed recast appends it instead of dropping the take. Losing it on
    // reload would forfeit the fallback exactly when it matters (a reload
    // during the recast) — the "completed but no video ever appeared" bug.
    const withFallback: Shot = {
      ...stillOnly,
      pendingClips: [
        {
          jobId: "vc-1",
          provider: "seedance-2",
          prompt: "no dialogue, just waves",
          startedAt: 1717000000000,
          nativeVideoUrl: "https://r2/native-take.mp4",
          revoicedVoiceId: "v-david",
          revoicedVoiceName: "David",
        },
      ],
    }
    expect(parseProduction(asWorkflow([withFallback], "shot-a")).shots).toEqual([
      withFallback,
    ])
  })

  it("round-trips an in-flight marker's `@`-entity chips (the reload-resume contract)", () => {
    // THE BUG THIS PINS: the bound chips lived only in an in-memory per-job map,
    // so a render that finished after a reload landed a clip with NO references
    // and the prompt came back with its `@` mentions as flat text — while the
    // `/` direction chips (already on the marker) survived. The marker carries
    // both now, so the completion can restore either from disk.
    const withRefs: Shot = {
      ...stillOnly,
      pendingClips: [
        {
          jobId: "vid-chips",
          provider: "seedance-2",
          prompt: "Eitan crashes into Andre Williams 2",
          startedAt: 1717000000000,
          directions: [{ kind: "sfx", text: "wind blowing" }],
          references: [
            {
              id: "char-eitan",
              defaultName: "Eitan",
              source: "wired-character",
              url: "https://r2/eitan.png",
            },
          ],
        },
      ],
    }
    const { settings } = serializeProduction([withRefs], "shot-a")
    expect(settings.studio.shots[0].pendingClips?.[0].references).toHaveLength(1)
    expect(parseProduction(asWorkflow([withRefs], "shot-a")).shots).toEqual([
      withRefs,
    ])
  })

  it("MIGRATES a legacy single `pendingClip` index entry into the markers list", () => {
    // Productions persisted before the concurrent-markers change carry ONE
    // `pendingClip` object on the entry — it must resume as a one-item list.
    const wf = asWorkflow([stillOnly], "shot-a")
    const legacyMarker = {
      jobId: "vid-legacy",
      provider: "seedance-2",
      prompt: "old take",
      startedAt: 1717000000000,
    }
    const studio = (wf.settings as { studio: { shots: object[] } }).studio
    studio.shots[0] = { ...studio.shots[0], pendingClip: legacyMarker }
    expect(parseProduction(wf).shots[0]?.pendingClips).toEqual([legacyMarker])
  })

  it("round-trips a shot's end-frame target (start→end keyframe)", () => {
    const withEnd: Shot = {
      ...stillOnly,
      endFrame: "https://r2.example/end-frame.png",
    }
    const { settings } = serializeProduction([withEnd], "shot-a")
    // Persisted inline on the index entry (a studio-layer input, no canvas node).
    expect(settings.studio.shots[0].endFrameUrl).toBe(
      "https://r2.example/end-frame.png",
    )
    const parsed = parseProduction(asWorkflow([withEnd], "shot-a"))
    expect(parsed.shots).toEqual([withEnd])
    expect(parsed.shots[0]?.endFrame).toBe("https://r2.example/end-frame.png")
  })

  it("round-trips folders + a shot's folder assignment (⋯ Move to Folder)", () => {
    const folders = [{ id: "f1", name: "Act One" }]
    const filed: Shot = { ...stillOnly, folderId: "f1" }
    const { nodes, edges, settings } = serializeProduction(
      [filed],
      "shot-a",
      undefined,
      undefined,
      folders,
    )
    expect(settings.studio.folders).toEqual(folders)
    expect(settings.studio.shots[0].folderId).toBe("f1")

    const wf = {
      id: "wf-2",
      projectId: "p-1",
      userId: "u-1",
      name: "Production",
      nodes,
      edges,
      settings,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
    } as Workflow
    const parsed = parseProduction(wf)
    expect(parsed.folders).toEqual(folders)
    expect(parsed.shots[0]?.folderId).toBe("f1")
  })

  it("KEEPS still-less placeholder shots on reload (the storyboard shot list survives)", () => {
    const parsed = parseProduction(asWorkflow([emptyShot, stillOnly], "shot-empty"))
    // A placeholder (a storyboard shot before it's framed — no node) round-trips by
    // id, in order, alongside the still-bearing shot — so the shot list isn't lost.
    expect(parsed.shots).toEqual([emptyShot, stillOnly])
    expect(parsed.selectedShotId).toBe("shot-empty")
  })

  it("still DROPS a LOST entry (claims a node that vanished) — overwrite-trap intact", () => {
    // stillOnly's index entry references generate-image-shot-a, but the nodes are
    // gone: a lost shot, not an intentional placeholder, so it must NOT resurrect.
    const wf = { ...asWorkflow([stillOnly], "shot-a"), nodes: [] }
    expect(parseProduction(wf).shots).toEqual([])
  })

  it("round-trips a duplicated shot's distinct node ids (no id collision)", () => {
    // A duplicate shares urls/prompts but MUST carry distinct node ids, else the
    // graph would have duplicate node ids + a mis-wired edge.
    const dup: Shot = {
      id: "shot-b-copy",
      still: { ...stillAndClip.still!, nodeId: "generate-image-dup-x" },
      clip: { ...stillAndClip.clip!, nodeId: "generate-video-dup-x" },
    }
    const parsed = parseProduction(asWorkflow([stillAndClip, dup], "shot-b-copy"))
    expect(parsed.shots).toEqual([stillAndClip, dup])
    const ids = parsed.shots.flatMap((s) => [s.still?.nodeId, s.clip?.nodeId])
    expect(new Set(ids).size).toBe(ids.length) // all distinct
  })
})

describe("parseProduction (v3 audio round-trip)", () => {
  function asWorkflow(
    shots: Shot[],
    selectedShotId?: string,
    music?: ProductionMusic,
  ): Workflow {
    const { nodes, edges, settings } = serializeProduction(
      shots,
      selectedShotId,
      music,
    )
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

  const voicedShot: Shot = {
    ...stillAndClip,
    id: "shot-voiced",
    voice: {
      url: "https://r2.example/voice.mp3",
      text: "Hello there.",
      voiceId: "21m00Tcm4TlvDq8ikWAM",
    },
  }
  const music: ProductionMusic = {
    url: "https://cdn.nodaro.ai/audios/track.wav",
    prompt: "ambient pads",
    provider: "suno",
  }

  it("round-trips a per-shot voiceover", () => {
    const parsed = parseProduction(asWorkflow([voicedShot], "shot-voiced"))
    expect(parsed.shots).toEqual([voicedShot])
  })

  it("round-trips a per-shot voiceover's voiceType (library/custom resolution)", () => {
    // The voice's KIND must survive save→load so text-to-speech can resolve a
    // library/custom voice by id later (premade/legacy voices carry no field).
    const typedVoice: Shot = {
      ...stillAndClip,
      id: "shot-typed-voice",
      voice: {
        url: "https://r2.example/voice.mp3",
        text: "Hello there.",
        voiceId: "v2",
        voiceType: "library",
      },
    }
    const parsed = parseProduction(asWorkflow([typedVoice], "shot-typed-voice"))
    expect(parsed.shots).toEqual([typedVoice])
    expect(parsed.shots[0]?.voice?.voiceType).toBe("library")
  })

  it("round-trips a clip result's `/` voice-direction chips (+ drops corrupt entries)", () => {
    // Directions are semantic {kind, text}; the prompt keeps their neutral
    // `[text]` form. The read side must hydrate them (a written-but-not-read
    // field is ERASED on the next save — the readVoice lesson) and must drop
    // malformed entries instead of leaking garbage into the store.
    const directed: Shot = {
      ...stillAndClip,
      id: "shot-directed",
      clip: {
        ...stillAndClip.clip!,
        results: [
          {
            url: stillAndClip.clip!.url,
            prompt: "She opens the door [door creaks]",
            directions: [{ kind: "sfx", text: "door creaks" }],
          },
          {
            url: "https://r2.example/clip-2.mp4",
            prompt: "quiet [soft piano]",
            directions: [{ kind: "music", text: "soft piano" }],
          },
        ],
        activeIndex: 1,
        url: "https://r2.example/clip-2.mp4",
      },
    }
    const parsed = parseProduction(asWorkflow([directed], "shot-directed"))
    expect(parsed.shots).toEqual([directed])

    // Corrupt persisted entries (bad kind / empty text) are dropped on read.
    const wf = asWorkflow([directed], "shot-directed")
    const vid = (wf.nodes ?? []).find((n) => n.type === "generate-video")
    const results = (vid!.data as { generatedResults: Array<Record<string, unknown>> })
      .generatedResults
    results[0].directions = [
      { kind: "sfx", text: "door creaks" },
      { kind: "yelling", text: "nope" },
      { kind: "music", text: "   " },
    ]
    const reparsed = parseProduction(wf)
    expect(
      clipResults(reparsed.shots[0].clip!)[0].directions,
    ).toEqual([{ kind: "sfx", text: "door creaks" }])
  })

  it("round-trips a voiceover's verified provider + tuned delivery levers", () => {
    // The v2-verified provider gates the tag UI + keeps regenerates on the
    // voice's verified model, and `delivery` is the levers a regenerate must
    // restore — the read side dropping either silently ERASES it on the next
    // debounced save (the serialize spread writes only what the store holds).
    const tunedVoice: Shot = {
      ...stillAndClip,
      id: "shot-tuned-voice",
      voice: {
        url: "https://r2.example/voice.mp3",
        text: "Hello there.",
        voiceId: "v2",
        voiceType: "library",
        ttsProvider: "elevenlabs-multilingual",
        delivery: { speed: 0.9, stability: 0.8 },
      },
    }
    const parsed = parseProduction(asWorkflow([tunedVoice], "shot-tuned-voice"))
    expect(parsed.shots).toEqual([tunedVoice])
    expect(parsed.shots[0]?.voice?.ttsProvider).toBe("elevenlabs-multilingual")
    expect(parsed.shots[0]?.voice?.delivery).toEqual({ speed: 0.9, stability: 0.8 })
  })

  it("drops malformed persisted delivery levers instead of hydrating garbage", () => {
    // A hand-edited / corrupt index entry must not leak non-numeric levers (or
    // unknown keys) into the store → the wire.
    const corrupt = {
      ...stillAndClip,
      id: "shot-corrupt-voice",
      voice: {
        url: "https://r2.example/voice.mp3",
        text: "Hello there.",
        // Not a valid VoiceDeliverySettings shape — smuggled via the cast.
        delivery: { speed: "fast", bogus: 1 },
      },
    } as unknown as Shot
    const parsed = parseProduction(asWorkflow([corrupt], "shot-corrupt-voice"))
    expect(parsed.shots[0]?.voice?.delivery).toBeUndefined()
  })

  it("round-trips the production soundtrack", () => {
    const parsed = parseProduction(asWorkflow([stillAndClip], "shot-b", music))
    expect(parsed.music).toEqual(music)
  })

  it("serializes settings.studio at version 3 with the music inline", () => {
    const { settings } = serializeProduction([stillAndClip], "shot-b", music)
    expect(settings.studio.version).toBe(3)
    expect(settings.studio.music).toEqual(music)
  })

  const musicPlan: PlanMusic = {
    prompt: "a driving synth pulse",
    duration: 20,
    selections: {
      vocals: "vocals",
      vocalGender: "female",
      instruments: ["synth"],
      genre: "synthwave",
    },
  }

  it("round-trips the soundtrack PLAN, the 12th serializeProduction argument (D5)", () => {
    const { nodes, edges, settings } = serializeProduction(
      [stillAndClip],
      "shot-b",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      musicPlan,
    )
    const parsed = parseProduction({
      id: "wf-1",
      projectId: "p-1",
      userId: "u-1",
      name: "Production",
      nodes,
      edges,
      settings,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
    })
    expect(parsed.musicPlan).toEqual(musicPlan)
  })

  it("omits musicPlan cleanly when absent, and keeps it out of settings.studio", () => {
    const { settings } = serializeProduction([stillAndClip], "shot-b")
    expect(settings.studio.musicPlan).toBeUndefined()
    const parsed = parseProduction(asWorkflow([stillAndClip], "shot-b"))
    expect(parsed.musicPlan).toBeUndefined()
  })

  /** A PICKER-ONLY draft — a genre picked before a word is typed — is what
   *  `draftMusicPlan` stores (`{ prompt: "", selections }`, R64/A2), so the
   *  reader has to take it back: refusing a blank prompt wrote the picks to the
   *  server and dropped them on every read (a reload, a media import, a bundle
   *  parse), which is the save the panel promises. Fix round 1. */
  it("round-trips a PICKER-ONLY plan — a blank prompt with picks is a decision", () => {
    const pickerOnly: PlanMusic = {
      prompt: "",
      selections: { vocals: "instrumental", vocalGender: "any", instruments: [], genre: "synthwave" },
    }
    const { nodes, edges, settings } = serializeProduction(
      [stillAndClip],
      "shot-b",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      pickerOnly,
    )
    const parsed = parseProduction({
      id: "wf-1",
      projectId: "p-1",
      userId: "u-1",
      name: "Production",
      nodes,
      edges,
      settings,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
    })
    expect(parsed.musicPlan).toEqual(pickerOnly)
  })

  it("reads a blank prompt with NO pick as absent — that plan carries nothing", () => {
    const blank: PlanMusic = {
      prompt: "",
      selections: { vocals: "instrumental", vocalGender: "any", instruments: [] },
    }
    const { nodes, edges, settings } = serializeProduction(
      [stillAndClip],
      "shot-b",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      blank,
    )
    const parsed = parseProduction({
      id: "wf-1",
      projectId: "p-1",
      userId: "u-1",
      name: "Production",
      nodes,
      edges,
      settings,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
    })
    expect(parsed.musicPlan).toBeUndefined()
  })

  /** The dashboard's soft-hide flag is the 13th argument (A4). It has to
   *  round-trip for the same reason `shared` does — every save REPLACES
   *  `settings.studio` whole, so a flag the serializer doesn't know is erased
   *  by the first edit after archiving. */
  it("round-trips the archived flag (settings.studio.archived)", () => {
    const { nodes, edges, settings } = serializeProduction(
      [stillAndClip],
      "shot-b",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    )
    expect(settings.studio.archived).toBe(true)
    const parsed = parseProduction({
      id: "wf-1",
      projectId: "p-1",
      userId: "u-1",
      name: "Production",
      nodes,
      edges,
      settings,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
    })
    expect(parsed.archived).toBe(true)
  })

  it("omits archived cleanly when the production is visible", () => {
    const { settings } = serializeProduction([stillAndClip], "shot-b")
    expect("archived" in settings.studio).toBe(false)
    expect(parseProduction(asWorkflow([stillAndClip], "shot-b")).archived).toBeUndefined()
  })

  it("round-trips the public-share flag (settings.studio.shared)", () => {
    const { nodes, edges, settings } = serializeProduction(
      [stillAndClip],
      "shot-b",
      undefined,
      true,
    )
    expect(settings.studio.shared).toBe(true)
    const parsed = parseProduction({
      id: "wf-1",
      projectId: "p-1",
      userId: "u-1",
      name: "Production",
      nodes,
      edges,
      settings,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
    })
    expect(parsed.shared).toBe(true)
  })

  it("omits `shared` when not shared (private default)", () => {
    const { settings } = serializeProduction([stillAndClip], "shot-b")
    expect(settings.studio.shared).toBeUndefined()
  })

  it("omits audio cleanly when absent (no music, no voice)", () => {
    const parsed = parseProduction(asWorkflow([stillAndClip], "shot-b"))
    expect(parsed.music).toBeUndefined()
    expect(parsed.shots[0]?.voice).toBeUndefined()
  })

  it("still reads a legacy v2 index (audio absent) — forward/back compatible", () => {
    // A hand-built v2 settings object (version 2, no audio fields) MUST parse —
    // the reader accepts v2 OR v3 so old productions keep loading.
    const { nodes, edges } = serializeProduction([stillAndClip], "shot-b")
    const v2Wf: Workflow = {
      id: "wf-1",
      projectId: "p-1",
      userId: "u-1",
      name: "Production",
      nodes,
      edges,
      settings: {
        studio: {
          version: 2,
          shots: [
            {
              id: "shot-b",
              imageNodeId: "generate-image-job2",
              videoNodeId: "generate-video-job3",
              stillProvider: "nano-banana",
              clipProvider: "grok-i2v",
              clipDuration: 5,
            },
          ],
          shotOrder: ["generate-image-job2", "generate-video-job3"],
          selectedShotId: "shot-b",
        },
      },
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
    }
    const parsed = parseProduction(v2Wf)
    expect(parsed.shots).toEqual([stillAndClip])
    expect(parsed.music).toBeUndefined()
  })
})

describe("parseProduction (v1 / legacy migration)", () => {
  /** A bare workflow record helper. */
  function workflow(partial: Partial<Workflow>): Workflow {
    return {
      id: "wf-1",
      projectId: "p-1",
      userId: "u-1",
      name: "Production",
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
      ...partial,
    }
  }

  it("migrates a v1 {shotOrder:[img,vid]} settings + nodes to a single Shot", () => {
    const wf = workflow({
      nodes: [
        {
          id: "generate-image-old",
          type: "generate-image",
          data: {
            provider: "flux-2-max",
            prompt: "legacy still",
            generatedImageUrl: "https://r2.example/old-still.png",
            generatedResults: [{ url: "https://r2.example/old-still.png" }],
            activeResultIndex: 0,
          },
        },
        {
          id: "generate-video-old",
          type: "generate-video",
          data: {
            provider: "grok-i2v",
            prompt: "legacy clip",
            imageUrl: "https://r2.example/old-still.png",
            generatedVideoUrl: "https://r2.example/old-clip.mp4",
            generatedResults: [{ url: "https://r2.example/old-clip.mp4" }],
            activeResultIndex: 0,
          },
        },
      ],
      settings: {
        studio: {
          shotOrder: ["generate-image-old", "generate-video-old"],
          perShot: { "generate-video-old": { jobId: "j" } },
        },
      },
    })
    const parsed = parseProduction(wf)
    expect(parsed.shots).toHaveLength(1)
    const [shot] = parsed.shots
    expect(shot.id).toMatch(/[0-9a-f-]{36}/) // a fresh uuid, not a node id
    expect(shot.still).toEqual({
      nodeId: "generate-image-old",
      url: "https://r2.example/old-still.png",
      provider: "flux-2-max",
      prompt: "legacy still",
    })
    expect(shot.clip).toEqual({
      nodeId: "generate-video-old",
      url: "https://r2.example/old-clip.mp4",
      provider: "grok-i2v",
      prompt: "legacy clip",
      duration: undefined,
    })
    expect(parsed.selectedShotId).toBe(shot.id)
  })

  it("migrates a bare generate-image-only graph (no studio settings) to one Shot", () => {
    const wf = workflow({
      nodes: [
        {
          id: "generate-image-bare",
          type: "generate-image",
          data: {
            provider: "nano-banana",
            prompt: "just a still",
            generatedImageUrl: "https://r2.example/bare.png",
          },
        },
      ],
    })
    const parsed = parseProduction(wf)
    expect(parsed.shots).toHaveLength(1)
    expect(parsed.shots[0].still?.url).toBe("https://r2.example/bare.png")
    expect(parsed.shots[0].clip).toBeUndefined()
  })

  it("returns no shots for a fresh production (no usable image node)", () => {
    expect(parseProduction(workflow({ nodes: [] })).shots).toEqual([])
    expect(parseProduction(workflow({})).shots).toEqual([])
  })
})

describe("motion beats (editor-v2) round-trip", () => {
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

  // Wraps an ALREADY-SERIALIZED graph as a Workflow (unlike asWorkflow above,
  // which re-derives the graph from shots) — needed to assert on a graph that
  // was tampered with after serialize (see the malformed-cue test below).
  function workflowFrom(graph: ReturnType<typeof serializeProduction>): Workflow {
    return {
      id: "wf-1",
      projectId: "p-1",
      userId: "u-1",
      name: "Production",
      nodes: graph.nodes,
      edges: graph.edges,
      settings: graph.settings,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
    }
  }

  it("round-trips a shot's beats — windows, labels and per-beat picks", () => {
    const withBeats: Shot = {
      ...stillOnly,
      beats: [
        { id: "b1", seconds: 2, label: "Start image", text: "The button is clicked." },
        {
          id: "b2",
          seconds: 4,
          text: "She is pulled backward.",
          picks: { framingId: "close-up", framingAngleId: "low-angle" },
        },
      ],
    }
    const parsed = parseProduction(asWorkflow([withBeats], "shot-a"))
    expect(parsed.shots).toEqual([withBeats])
  })

  it("keeps a fractional window, and settles an off-grid one onto a tenth", () => {
    // Windows are tenths of a second (lib/beats). 1.2 is stored as typed; the
    // graph is canvas-editable, so a 1.25 that never came through the editor
    // lands on the grid rather than leaking sums the editor cannot show.
    const exact = parseProduction(
      asWorkflow([{ ...stillOnly, beats: [{ id: "b1", seconds: 1.2, text: "A." }] }], "shot-a"),
    )
    expect(exact.shots[0].beats).toEqual([{ id: "b1", seconds: 1.2, text: "A." }])
    const odd = parseProduction(
      asWorkflow([{ ...stillOnly, beats: [{ id: "b1", seconds: 1.25, text: "A." }] }], "shot-a"),
    )
    expect(odd.shots[0].beats).toEqual([{ id: "b1", seconds: 1.3, text: "A." }])
  })

  it("round-trips a shot's Character FX node — the effect and its lever ids", () => {
    const withFx: Shot = {
      ...stillOnly,
      beats: [
        {
          id: "b1",
          seconds: 3,
          text: "She turns.",
          characterFx: { id: "werewolf", position: "start", intensity: "crazy" },
        },
        { id: "b2", seconds: 2, text: "She runs." },
      ],
    }
    const parsed = parseProduction(asWorkflow([withFx], "shot-a"))
    expect(parsed.shots).toEqual([withFx])
  })

  it("a Character FX node without an effect is NO node — levers alone drop at load", () => {
    // The same rule the transition node learned (#407): a lever tunes an
    // effect, so a stored `{ position }` with nothing to tune must not come
    // back as a control the user can neither see the point of nor clear.
    const workflow = asWorkflow(
      [
        {
          ...stillOnly,
          beats: [{ id: "b1", seconds: 3, text: "She turns.", characterFx: { position: "start" } }],
        },
      ],
      "shot-a",
    )
    const parsed = parseProduction(workflow)
    expect(parsed.shots[0].beats).toEqual([{ id: "b1", seconds: 3, text: "She turns." }])
  })

  // A beat OWNS the `@` chips bound into its own line. They are the inputs the
  // render is assembled from, so a narrower that drops them doesn't just lose a
  // label — the next save erases the references and the shot silently renders
  // without its character.
  it("round-trips the @ chips a beat is bound to", () => {
    const withRefs: Shot = {
      ...stillOnly,
      beats: [
        {
          id: "b1",
          seconds: 4,
          text: "Kira turns toward the door.",
          references: [
            {
              id: "kira",
              defaultName: "Kira",
              source: "wired-character",
              url: "https://r2.example/kira.png",
            },
          ],
        },
        { id: "b2", seconds: 4, text: "She runs." },
      ],
    }
    const parsed = parseProduction(asWorkflow([withRefs], "shot-a"))
    expect(parsed.shots).toEqual([withRefs])
    // A chip-less beat stays byte-identical — no empty references array.
    const entry = (
      serializeProduction([withRefs], "shot-a").settings.studio as unknown as {
        shots: Array<{ beats: Array<Record<string, unknown>> }>
      }
    ).shots[0]!
    expect("references" in entry.beats[1]!).toBe(false)
  })

  // A transition is a beat's OWN field, so it needs the same narrower its chips
  // do. Without one it lives happily in memory and is erased by the very next
  // save — the shot keeps rendering, silently minus the transition the user
  // chose, which is the quietest way this app can lose work.
  it("round-trips a beat's transition, levers and all", () => {
    const withTransition: Shot = {
      ...stillOnly,
      beats: [
        {
          id: "b1",
          seconds: 4,
          text: "The diver pushes off.",
          transition: {
            id: "cross-dissolve",
            position: "start",
            duration: "short",
            intensity: "subtle",
          },
        },
        // An id with NO levers is a real state (the node opened, one tile
        // picked) — it round-trips as itself rather than being dropped for
        // being partial.
        { id: "b2", seconds: 4, text: "She surfaces.", transition: { id: "whip-pan" } },
        { id: "b3", seconds: 2, text: "Cut to black." },
      ],
    }
    const parsed = parseProduction(asWorkflow([withTransition], "shot-a"))
    expect(parsed.shots).toEqual([withTransition])
    // An untouched shot stays byte-identical — no empty transition object.
    const entry = (
      serializeProduction([withTransition], "shot-a").settings.studio as unknown as {
        shots: Array<{ beats: Array<Record<string, unknown>> }>
      }
    ).shots[0]!
    expect("transition" in entry.beats[2]!).toBe(false)
  })

  // The SCENE's own end transition — how its last frames go out. A field
  // written by the serializer and not read back is ERASED on the very next
  // save, so it round-trips beside the beats' own transitions.
  it("round-trips the scene's end transition, levers and all", () => {
    const withEnd: Shot = {
      ...stillOnly,
      beats: [{ id: "b1", seconds: 4, text: "The diver pushes off." }],
      endTransition: {
        id: "cross-dissolve",
        position: "end",
        duration: "short",
        intensity: "subtle",
      },
    }
    const parsed = parseProduction(asWorkflow([withEnd], "shot-a"))
    expect(parsed.shots).toEqual([withEnd])
    // A scene that never chose one stays byte-identical — no empty node.
    const entry = (
      serializeProduction([stillOnly], "shot-a").settings.studio as unknown as {
        shots: Array<Record<string, unknown>>
      }
    ).shots[0]!
    expect("endTransition" in entry).toBe(false)
  })

  // …and the one a TAKE was made with. It rides the result for the same reason
  // the scene prompt does: the take's prose carries that node's CLAUSE baked in,
  // and only the take knows which node to take back out of the seed.
  it("round-trips the end transition a TAKE was made with", () => {
    const withTake: Shot = {
      ...stillAndClip,
      clip: {
        ...stillAndClip.clip!,
        results: [
          {
            ...clipResults(stillAndClip.clip!)[0]!,
            endTransition: { id: "cross-dissolve", duration: "short" },
          },
        ],
        activeIndex: 0,
      },
    }
    const parsed = parseProduction(asWorkflow([withTake], "shot-b"))
    expect(clipResults(parsed.shots[0]!.clip!)[0]!.endTransition).toEqual({
      id: "cross-dissolve",
      duration: "short",
    })
  })

  it("round-trips the end transition on an in-flight marker (the resume contract)", () => {
    const pending: Shot = {
      ...stillOnly,
      pendingClips: [
        {
          jobId: "vid-end",
          provider: "seedance-2",
          prompt: "0-4s — She turns. cross-dissolve.",
          startedAt: 1717000000000,
          endTransition: { id: "cross-dissolve", duration: "short" },
        },
      ],
    }
    expect(parseProduction(asWorkflow([pending], "shot-a")).shots).toEqual([pending])
  })

  // The same narrower the beats' transitions get: the blob is canvas-editable,
  // so a lever with no pick to tune is dropped rather than trusted.
  it("drops a scene end transition with no id", () => {
    const wf = asWorkflow([stillOnly], "shot-a")
    const studio = wf.settings!.studio as unknown as {
      shots: Array<Record<string, unknown>>
    }
    studio.shots[0]!.endTransition = { position: "end" }
    expect(parseProduction(wf).shots[0]!.endTransition).toBeUndefined()
  })

  // The settings blob is editable from the Nodaro canvas, so the narrower has
  // to be defensive about what comes back — every neighbouring reader is.
  it("drops a blank or whitespace-only transition id", () => {
    const wf = asWorkflow(
      [{ ...stillOnly, beats: [{ id: "b1", seconds: 4, text: "She turns." }] }],
      "shot-a",
    )
    const studio = wf.settings!.studio as unknown as {
      shots: Array<{ beats: Array<Record<string, unknown>> }>
    }
    studio.shots[0]!.beats[0]!.transition = { id: "   " }
    // Kept, it would render a nameless chip wearing the "set" accent and inject
    // a bare "." into the prompt.
    expect(parseProduction(wf).shots[0]!.beats![0]!.transition).toBeUndefined()
  })

  // The UI can no longer create this, and can no longer clear it either — the
  // levers are disabled without a transition, so a stuck `{ position }` would
  // show a value the user cannot take back and would ride "Copy settings from…"
  // into other scenes. Load is the only place left to clean it.
  it("drops levers with no transition to tune", () => {
    const wf = asWorkflow(
      [{ ...stillOnly, beats: [{ id: "b1", seconds: 4, text: "She turns." }] }],
      "shot-a",
    )
    const studio = wf.settings!.studio as unknown as {
      shots: Array<{ beats: Array<Record<string, unknown>> }>
    }
    studio.shots[0]!.beats[0]!.transition = { position: "start", duration: "short" }
    expect(parseProduction(wf).shots[0]!.beats![0]!.transition).toBeUndefined()
  })

  // The levers were the handoff's own words for one staging-only stretch
  // ("On cut", "0.4s", "Subtle"); they are the catalog's row ids now. A value
  // stored under the old words is not a row of any scale, so it reads as
  // unset — the pick itself is kept.
  it("drops levers stored under the pre-catalog words, keeping the pick", () => {
    const wf = asWorkflow(
      [{ ...stillOnly, beats: [{ id: "b1", seconds: 4, text: "She turns." }] }],
      "shot-a",
    )
    const studio = wf.settings!.studio as unknown as {
      shots: Array<{ beats: Array<Record<string, unknown>> }>
    }
    studio.shots[0]!.beats[0]!.transition = {
      id: "cross-dissolve",
      position: "On cut",
      duration: "0.4s",
      intensity: "Subtle",
    }
    expect(parseProduction(wf).shots[0]!.beats![0]!.transition).toEqual({ id: "cross-dissolve" })
  })

  // The pick was stored as a catalog LABEL for exactly one unmerged branch.
  // Resolving it back costs four lines; dropping it makes a choice the user
  // made disappear on reload.
  it("recovers a transition stored under the pre-id `name`", () => {
    const wf = asWorkflow(
      [{ ...stillOnly, beats: [{ id: "b1", seconds: 4, text: "She turns." }] }],
      "shot-a",
    )
    const studio = wf.settings!.studio as unknown as {
      shots: Array<{ beats: Array<Record<string, unknown>> }>
    }
    studio.shots[0]!.beats[0]!.transition = { name: "Cross-Dissolve", duration: "short" }
    expect(parseProduction(wf).shots[0]!.beats![0]!.transition).toEqual({
      id: "cross-dissolve",
      duration: "short",
    })
  })

  // Degrading a transition is safe; dropping the WRITING around it is not.
  it("a malformed transition drops only itself, never the beat", () => {
    const wf = asWorkflow(
      [{ ...stillOnly, beats: [{ id: "b1", seconds: 4, text: "She turns." }] }],
      "shot-a",
    )
    const studio = wf.settings!.studio as unknown as {
      shots: Array<{ beats: Array<Record<string, unknown>> }>
    }
    studio.shots[0]!.beats[0]!.transition = ["Cross-Dissolve"]
    const parsed = parseProduction(wf)
    expect(parsed.shots[0]!.beats).toEqual([{ id: "b1", seconds: 4, text: "She turns." }])
  })

  // A take restores the SHOTS it was made from. Without them, selecting a past
  // take put its prompt back while the shots stayed as they were — which makes
  // "+ New clip", which clears them for a fresh pass, a one-way door.
  it("round-trips the shots a TAKE was authored from", () => {
    const beats = [
      { id: "b1", seconds: 4, text: "She turns." },
      { id: "b2", seconds: 6, text: "She runs." },
    ]
    const withTake: Shot = {
      ...stillAndClip,
      clip: {
        ...stillAndClip.clip!,
        results: [{ ...clipResults(stillAndClip.clip!)[0], beats }],
        activeIndex: 0,
      },
    }
    const parsed = parseProduction(asWorkflow([withTake], "shot-b"))
    expect(clipResults(parsed.shots[0]!.clip!)[0]!.beats).toEqual(beats)
  })

  it("a beat-less shot serializes byte-identical (no empty beats field)", () => {
    const { settings } = serializeProduction([stillOnly], "shot-a")
    const entry = (settings.studio as unknown as { shots: Array<Record<string, unknown>> }).shots[0]
    expect("beats" in entry).toBe(false)
  })

  it("a malformed beats blob degrades to NO beats (never crashes hydration)", () => {
    const wf = asWorkflow([stillOnly], "shot-a")
    const studio = wf.settings!.studio as unknown as { shots: Array<Record<string, unknown>> }
    studio.shots[0].beats = [{ id: "b1", seconds: "four", text: 7 }]
    const parsed = parseProduction(wf)
    expect(parsed.shots[0].beats).toBeUndefined()
    expect(parsed.shots[0].id).toBe("shot-a")
  })

  // A shot's own `/` audio cues (plan-import-v2 D5) — placed INSIDE the shot's
  // prose, owned by the beat like its references/transition/characterFx are.
  // Round-trips through the ONE shared reader (readVoiceDirections), the same
  // one the clip-level `directions` uses; `speech` cues carry speaker/voice too.
  it("round-trips a shot's own audio cues (plan-import-v2 D5)", () => {
    const directions: VoiceDirection[] = [
      { kind: "speech", text: "Run!", speaker: "Anna", voice: "urgent" },
      { kind: "sfx", text: "wind" },
    ]
    const shot: Shot = {
      id: "s1",
      beats: [{ id: "b1", seconds: 4, text: "she runs [Run!] [wind]", directions }],
    }
    const graph = serializeProduction([shot], "s1")
    const entry = graph.settings.studio.shots[0].beats![0]
    expect(entry.directions).toEqual(directions)
    expect(entry.directions).not.toBe(directions)
    // Element-level identity — proves the copy is per-cue, not just per-array.
    expect(entry.directions![0]).not.toBe(directions[0])
    const { shots } = parseProduction(asWorkflow([shot], "s1"))
    expect(shots[0].beats![0].directions).toEqual(directions)
  })

  // readVoiceDirections is LENIENT by design — a bad cue among good ones drops
  // only itself. Contrast with readBeats's OTHER fields (e.g. a bad `picks`
  // value drops the WHOLE beats list): the beat here survives with the one
  // cue that validated.
  it("drops a malformed cue but keeps the beat", () => {
    const graph = serializeProduction(
      [
        {
          id: "s1",
          beats: [
            { id: "b1", seconds: 4, text: "x", directions: [{ kind: "sfx", text: "wind" }] },
          ],
        },
      ],
      "s1",
    )
    ;(graph.settings.studio.shots[0].beats![0] as { directions: unknown }).directions = [
      { kind: "sfx", text: "wind" },
      { kind: "nope", text: "y" },
      "junk",
    ]
    const { shots } = parseProduction(workflowFrom(graph))
    expect(shots[0].beats![0].directions).toEqual([{ kind: "sfx", text: "wind" }])
    // The beat itself — not just the cue list — survived the bad entry intact.
    expect(shots[0].beats![0]).toMatchObject({ id: "b1", seconds: 4, text: "x" })
  })

  // `...b` spreads FIRST in the serializer's beat map, so an explicit EMPTY
  // list (`[]`, not absent) would otherwise carry through BY REFERENCE — the
  // trailing conditional adds a key, it can never remove one. That aliases the
  // persisted index to the store's array, the exact thing this serializer's
  // deep-copy discipline exists to prevent, and breaks the omit-when-empty
  // guarantee every neighboring field (references, transition, characterFx)
  // already keeps. `BeatsEditor` writes `references: next.references`, which
  // is `[]` for a chip-less beat — this is a live path, not a hypothetical.
  it("an EMPTY chip or cue list is omitted from the persisted entry, never aliased (omit-when-empty)", () => {
    const references: ConnectedReference[] = []
    const directions: VoiceDirection[] = []
    const shot: Shot = {
      id: "s1",
      beats: [{ id: "b1", seconds: 4, text: "x", references, directions }],
    }
    const entry = serializeProduction([shot], "s1").settings.studio.shots[0]
      .beats![0] as unknown as Record<string, unknown>
    expect("references" in entry).toBe(false)
    expect("directions" in entry).toBe(false)
  })
})

describe("the scene prompt (the scene-level generic prompt) round-trip", () => {
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

  const SCENE = "A rain-soaked rooftop chase. Keep it grim — no slow motion."

  it("round-trips the scene's standing description", () => {
    const withScene: Shot = { ...stillOnly, scenePrompt: SCENE }
    expect(parseProduction(asWorkflow([withScene], "shot-a")).shots).toEqual([
      withScene,
    ])
  })

  it("a scene without one — or with a blank one — writes no key at all", () => {
    const entryOf = (shot: Shot) =>
      (
        serializeProduction([shot], "shot-a").settings.studio as unknown as {
          shots: Array<Record<string, unknown>>
        }
      ).shots[0]!
    expect("scenePrompt" in entryOf(stillOnly)).toBe(false)
    expect("scenePrompt" in entryOf({ ...stillOnly, scenePrompt: "" })).toBe(false)
    expect("scenePrompt" in entryOf({ ...stillOnly, scenePrompt: "   " })).toBe(false)
  })

  // Result parity: selecting a past take must not leave the scene prompt of the
  // take BEFORE it standing over it.
  it("round-trips the scene prompt a TAKE was made with", () => {
    const withTake: Shot = {
      ...stillAndClip,
      clip: {
        ...stillAndClip.clip!,
        results: [{ ...clipResults(stillAndClip.clip!)[0], scenePrompt: SCENE }],
        activeIndex: 0,
      },
    }
    const parsed = parseProduction(asWorkflow([withTake], "shot-b"))
    expect(clipResults(parsed.shots[0]!.clip!)[0]!.scenePrompt).toBe(SCENE)
  })

  it("round-trips the scene prompt on an in-flight marker (the resume contract)", () => {
    const pending: Shot = {
      ...stillOnly,
      pendingClips: [
        {
          jobId: "vid-scene",
          provider: "seedance-2",
          prompt: `${SCENE}\n\n0-4s — She turns.`,
          startedAt: 1717000000000,
          scenePrompt: SCENE,
        },
      ],
    }
    expect(parseProduction(asWorkflow([pending], "shot-a")).shots).toEqual([pending])
  })

  it("a malformed scene prompt degrades to none (never crashes hydration)", () => {
    const wf = asWorkflow([stillOnly], "shot-a")
    const studio = wf.settings!.studio as unknown as {
      shots: Array<Record<string, unknown>>
    }
    studio.shots[0]!.scenePrompt = { text: "not a string" }
    const parsed = parseProduction(wf)
    expect(parsed.shots[0]!.scenePrompt).toBeUndefined()
    expect(parsed.shots[0]!.id).toBe("shot-a")
  })
})

describe("trash — a deleted IMAGE is recoverable, like a deleted clip", () => {
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

  const trashedStill = {
    kind: "still" as const,
    id: "t1",
    shotId: "shot-a",
    shotName: "Opening",
    index: 1,
    deletedAt: "2026-08-27T10:00:00Z",
    stillBase: {
      nodeId: "generate-image-job1",
      provider: "nano-banana",
      prompt: "a knight on a hill",
    },
    result: {
      url: "https://r2.example/deleted.png",
      prompt: "a knight on a hill",
      provider: "nano-banana",
      name: "The good one",
    },
  }

  it("round-trips a trashed image through the persisted bin", () => {
    const { settings } = serializeProduction(
      [stillOnly],
      "shot-a",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [trashedStill],
    )
    const parsed = parseProduction({
      ...asWorkflow([stillOnly], "shot-a"),
      settings,
    })
    expect(parsed.trash).toEqual([trashedStill])
  })

  it("keeps the image's own fields (name, prompt, provider) across the round-trip", () => {
    const { settings } = serializeProduction(
      [stillOnly],
      "shot-a",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [trashedStill],
    )
    const parsed = parseProduction({
      ...asWorkflow([stillOnly], "shot-a"),
      settings,
    })
    const back = parsed.trash?.[0]
    expect(back?.kind).toBe("still")
    expect(back && "result" in back ? back.result.name : undefined).toBe(
      "The good one",
    )
  })
})

/**
 * The CINEMATIC channel on the emitted nodes: `direction` (platform catalog ids)
 * and `subject`, so a canvas re-run folds the same ids server-side instead of
 * re-reading a baked prompt.
 *
 * Three traps, all pinned here: a key written but not read back is ERASED on the
 * next save (the readVoice lesson); a `direction: {}` / `direction: undefined`
 * key breaks the byte-identical round-trip the whole file is built around; and a
 * STUDIO picker key on a node folds nothing on the canvas (the platform reader
 * drops every non-registry key without error).
 */
describe("shot-graph — direction / subject on the emitted nodes", () => {
  const workflowOf = (shots: Shot[]): Workflow => {
    const { nodes, edges, settings } = serializeProduction(shots, "shot-a")
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
    } as Workflow
  }

  const directed: Shot = {
    id: "shot-a",
    still: {
      nodeId: "generate-image-job1",
      url: "https://r2.example/a.png",
      provider: "qwen",
      prompt: "a knight on a hill",
      direction: { shotSize: "wide-shot", atmosphere: ["fog", "haze"] },
      subject: { age: "age-30s", ethnicity: ["eth-a", "eth-b"] },
    },
    clip: {
      nodeId: "generate-video-job2",
      url: "https://r2.example/a.mp4",
      provider: "kling-3.0",
      prompt: "pan left",
      direction: { cameraMotion: "pan-left", mood: ["tense"] },
      subject: { age: "age-40s" },
    },
  }

  it("round-trips both node kinds, multi-pick arrays included", () => {
    expect(parseProduction(workflowOf([directed])).shots).toEqual([directed])
  })

  it("survives TWO save/reload cycles (the erase-on-next-save trap)", () => {
    // A field written by the emitter but not read back by the node readers looks
    // fine on the first reload and vanishes on the next autosave.
    const once = parseProduction(workflowOf([directed])).shots
    expect(parseProduction(workflowOf(once)).shots).toEqual([directed])
  })

  it("coexists with an imported scene's PLAN, which rides the ENTRY", () => {
    // The seam the S-legs and production import/export meet on: run provenance
    // (`direction` / `subject`) lands in NODE data, authored intent (`plan`)
    // in the settings ENTRY, and the two readers must not clobber each other.
    // Two cycles, because a half-read field survives exactly one.
    const planned: Shot = {
      ...directed,
      plan: {
        frame: { prompt: "a knight on a hill", provider: "gpt-image-2", count: 2 },
        motion: { prompt: "pan left", cameraMotionId: "tracking-shot" },
      },
    }
    const once = parseProduction(workflowOf([planned])).shots
    expect(once).toEqual([planned])
    expect(parseProduction(workflowOf(once)).shots).toEqual([planned])
  })

  it("emits every key in the PLATFORM vocabulary, never studio picker keys", () => {
    const { nodes } = serializeProduction([directed], "shot-a")
    for (const node of nodes) {
      const d = node.data?.direction as Record<string, unknown> | undefined
      if (!d) continue
      // A key-set assertion against the imported constant — never a hardcoded
      // list, or a registry addition would need a studio edit to stay honest.
      for (const k of Object.keys(d)) expect(DIRECTION_KEYS).toContain(k)
    }
  })

  it("truncates an over-long array to the platform's own ceiling on READ", () => {
    const wide = {
      ...directed,
      still: {
        ...directed.still!,
        direction: {
          shotSize: "wide-shot",
          atmosphere: Array.from({ length: 12 }, (_, i) => `a-${i}`),
        },
      },
    }
    const back = parseProduction(workflowOf([wide])).shots[0]!.still!
    // Assert the READ value: studio's bounds ARE the canvas's, so what studio
    // reads back is exactly what a canvas run would fold.
    expect((back.direction!.atmosphere as string[]).length).toBe(
      DIRECTION_ARRAY_CEILING,
    )
  })

  it("a direction-less shot serializes BYTE-IDENTICAL to today's node data", () => {
    const plain: Shot = {
      id: "shot-a",
      still: {
        nodeId: "generate-image-job1",
        url: "https://r2.example/a.png",
        provider: "qwen",
        prompt: "a knight on a hill",
      },
      clip: {
        nodeId: "generate-video-job2",
        url: "https://r2.example/a.mp4",
        provider: "kling-3.0",
        prompt: "pan left",
      },
    }
    for (const node of serializeProduction([plain], "shot-a").nodes) {
      // Not `{}`, not `undefined` — the KEY must be absent, both because the
      // round-trip is byte-compared and because key presence is what marks a
      // node's prompt as unbaked prose.
      expect("direction" in node.data).toBe(false)
      expect("subject" in node.data).toBe(false)
    }
    expect(parseProduction(workflowOf([plain])).shots).toEqual([plain])
  })

  it("parses a hand-edited or legacy node without a usable direction", () => {
    const wf = workflowOf([directed])
    const nodes = (wf.nodes ?? []).map((n) => {
      const data = { ...n.data }
      // What an import, an MCP write or a canvas hand-edit can hand us.
      data.direction = n.type === "generate-image" ? "not-an-object" : []
      delete data.subject
      return { ...n, data }
    })
    const shots = parseProduction({ ...wf, nodes } as Workflow).shots
    expect(shots[0]!.still!.direction).toBeUndefined()
    expect("direction" in shots[0]!.still!).toBe(false)
    expect(shots[0]!.clip!.direction).toBeUndefined()
    expect(shots[0]!.still!.subject).toBeUndefined()
  })

  it("never aliases store state into the emitted nodes", () => {
    const { nodes } = serializeProduction([directed], "shot-a")
    const img = nodes.find((n) => n.id === "generate-image-job1")!
    expect(img.data.direction).toEqual(directed.still!.direction)
    expect(img.data.direction).not.toBe(directed.still!.direction)
    const emitted = img.data.direction as { atmosphere: string[] }
    emitted.atmosphere.push("smoke")
    expect(directed.still!.direction!.atmosphere).toEqual(["fog", "haze"])
  })

  /**
   * The THIRD channel on the same node data: `structured`, the platform's Path-1
   * FREE-TEXT fields. Studio authors none — the CANVAS and the MCP verbs do, and
   * `assembleImageInput` folds it beside `direction`/`subject`. Studio's node
   * `data` is rebuilt from a fixed field list, so a canvas-authored value that
   * studio does not carry is ERASED the next time the production is opened and
   * autosaved here. That is the readVoice lesson with someone ELSE's field, so
   * it gets the same two-cycle guard the other two channels have.
   */
  describe("the canvas's `structured` passthrough", () => {
    const structured = {
      person: { age: 34, gender: "woman" as const, hair: "auburn bob" },
      styling: { lighting: "single practical lamp" },
      mood: "wistful",
    }
    const authored: Shot = {
      ...directed,
      still: { ...directed.still!, structured },
      clip: { ...directed.clip!, structured },
    }

    it("survives TWO save/reload cycles on both node kinds", () => {
      const once = parseProduction(workflowOf([authored])).shots
      expect(once).toEqual([authored])
      expect(parseProduction(workflowOf(once)).shots).toEqual([authored])
    })

    it("is emitted onto the node data studio hands the canvas back", () => {
      for (const node of serializeProduction([authored], "shot-a").nodes) {
        expect(node.data.structured).toEqual(structured)
      }
    })

    it("never aliases store state (the GROUPED shape needs a deep copy)", () => {
      const img = serializeProduction([authored], "shot-a").nodes.find(
        (n) => n.id === "generate-image-job1",
      )!
      const emitted = img.data.structured as { person: { hair?: string } }
      expect(emitted.person).not.toBe(structured.person)
      emitted.person.hair = "shaved"
      expect(structured.person.hair).toBe("auburn bob")
    })

    it("stays ABSENT on a shot that carries none (byte-identity holds)", () => {
      for (const node of serializeProduction([directed], "shot-a").nodes) {
        expect("structured" in node.data).toBe(false)
      }
    })
  })
})
