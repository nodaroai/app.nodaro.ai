import { describe, expect, it } from "vitest"

import { findResult, resultKey } from "../result-key"
import { serializeProduction } from "../shot-graph"
import { toProductionSummary, toProductionView } from "../view"
import type { Cast } from "../cast"
import type { ProductionCut, ProductionFolder, Shot } from "../shot"
import type { TrashedItem } from "../trash"
import type { WorkflowLike } from "../workflow-like"

/**
 * The read shape of every `/v1/studio/productions` route and every studio MCP
 * tool. Two things it has to get right, and they pull in opposite directions:
 * a LIST must stay small enough that an agent can read twenty of them, and a
 * GET must carry enough that "regenerate the second one" needs no second call.
 * `detail` is that line.
 *
 * Every fixture below is built by SERIALIZING shots, not by hand-writing the
 * stored JSON: the view reads what the codec writes, so a fixture the codec
 * would never produce would test a document that cannot exist.
 */

const ISO = "2026-09-06T10:00:00Z"

interface ProductionParts {
  shots: Shot[]
  folders?: ProductionFolder[]
  cuts?: ProductionCut[]
  trash?: TrashedItem[]
  cast?: Cast
  film?: Record<string, string | string[]>
  shared?: boolean
  archived?: boolean
}

function workflow(parts: ProductionParts): WorkflowLike & {
  id: string
  version: number
  updatedAt: string
} {
  const graph = serializeProduction(
    parts.shots,
    undefined,
    undefined,
    parts.shared,
    parts.folders,
    undefined,
    parts.cuts,
    parts.trash,
    undefined,
    parts.film,
    parts.cast,
    undefined,
    parts.archived,
  )
  return {
    id: "wf-1",
    name: "The Long Walk",
    version: 7,
    updatedAt: ISO,
    thumbnailUrl: "https://r2/thumb.png",
    nodes: graph.nodes,
    edges: graph.edges,
    settings: { studio: graph.settings.studio },
  }
}

/** Two shots: one with a still history of two, one with a still and a clip. */
function twoShots(): Shot[] {
  return [
    {
      id: "shot-1",
      name: "Opening",
      still: {
        nodeId: "generate-image-a",
        url: "https://r2/a2.png",
        provider: "flux-2",
        prompt: "a lighthouse at dawn",
        activeIndex: 1,
        results: [
          { url: "https://r2/a1.png", jobId: "job-a1", prompt: "a lighthouse" },
          { url: "https://r2/a2.png", jobId: "job-a2", prompt: "a lighthouse at dawn" },
        ],
      },
    },
    {
      id: "shot-2",
      still: {
        nodeId: "generate-image-b",
        url: "https://r2/b1.png",
        provider: "flux-2",
        prompt: "the keeper",
      },
      clip: {
        nodeId: "generate-video-b",
        url: "https://r2/b1.mp4",
        provider: "seedance-2",
        prompt: "slow dolly in",
        duration: 5,
        results: [
          { url: "https://r2/b1.mp4", jobId: "job-b1", startFrameUrl: "https://r2/b1.png" },
        ],
      },
      startFrame: "https://r2/b1.png",
      scenePrompt: "a storm is coming",
    },
  ]
}

const CAST: Cast = {
  kira: { kind: "character", displayName: "Kira" },
}

describe("resultKey", () => {
  it("prefers the job id", () => {
    expect(resultKey({ url: "https://r2/x.png", jobId: "job-x" })).toBe("job-x")
  })

  it("falls back to the url for media that no job produced", () => {
    // An upload, or a frame extracted and attached by hand: real results with
    // no job row behind them.
    expect(resultKey({ url: "https://r2/x.png" })).toBe("https://r2/x.png")
  })

  it("resolves a duplicate key to the first match", () => {
    const list = [
      { url: "https://r2/1.png", jobId: "dup" },
      { url: "https://r2/2.png", jobId: "dup" },
    ]
    expect(findResult(list, "dup")).toBe(list[0])
  })

  it("finds by url when that is the key, and misses cleanly", () => {
    const list = [{ url: "https://r2/1.png" }, { url: "https://r2/2.png", jobId: "j" }]
    expect(findResult(list, "https://r2/2.png")).toBeUndefined()
    expect(findResult(list, "https://r2/1.png")).toBe(list[0])
    expect(findResult(list, "nope")).toBeUndefined()
  })
})

describe("toProductionView", () => {
  const full = (): ProductionParts => ({
    shots: twoShots(),
    film: { lighting: "golden-hour" },
    cast: CAST,
    folders: [{ id: "f-1", name: "Act one" }],
    cuts: [{ id: "cut-1", name: "Cut A", url: "https://r2/cut.mp4", exportedAt: ISO }],
    shared: true,
  })

  it("carries the production's identity and audience", () => {
    const view = toProductionView(workflow(full()), { detail: "summary" })
    expect(view.id).toBe("wf-1")
    expect(view.name).toBe("The Long Walk")
    expect(view.version).toBe(7)
    expect(view.updatedAt).toBe(ISO)
    expect(view.thumbnailUrl).toBe("https://r2/thumb.png")
    expect(view.shared).toBe(true)
    expect(view.archived).toBe(false)
  })

  it("summary carries counts and active urls, and NO result lists", () => {
    const view = toProductionView(workflow(full()), { detail: "summary" })
    expect(view.shots).toHaveLength(2)

    const [one, two] = view.shots
    expect(one.still?.count).toBe(2)
    expect(one.still?.activeUrl).toBe("https://r2/a2.png")
    expect(one.still?.active).toBe("job-a2")
    expect(one.still?.results).toBeUndefined()

    expect(two.clip?.count).toBe(1)
    expect(two.clip?.activeUrl).toBe("https://r2/b1.mp4")
    expect(two.clip?.results).toBeUndefined()
  })

  it("full carries every result with the context that regenerates it", () => {
    const view = toProductionView(workflow(full()), { detail: "full" })
    const results = view.shots[0].still?.results
    expect(results).toHaveLength(2)
    expect(results?.[0]).toMatchObject({
      key: "job-a1",
      url: "https://r2/a1.png",
      jobId: "job-a1",
      prompt: "a lighthouse",
    })

    const clip = view.shots[1].clip?.results?.[0]
    expect(clip).toMatchObject({
      key: "job-b1",
      url: "https://r2/b1.mp4",
      startFrameUrl: "https://r2/b1.png",
    })
  })

  it("shotId narrows to one shot and keeps its TIMELINE index", () => {
    const view = toProductionView(workflow(full()), { detail: "full", shotId: "shot-2" })
    expect(view.shots).toHaveLength(1)
    expect(view.shots[0].id).toBe("shot-2")
    // The index is the shot's place in the timeline, not in the returned array:
    // "shot 2" has to keep meaning the same shot after a narrow.
    expect(view.shots[0].index).toBe(1)
  })

  it("a missing shotId narrows to nothing rather than to everything", () => {
    const view = toProductionView(workflow(full()), { detail: "full", shotId: "shot-404" })
    expect(view.shots).toEqual([])
  })

  it("carries the production-level document as the codec read it", () => {
    const view = toProductionView(workflow(full()), { detail: "full" })
    expect(view.film).toEqual({ lighting: "golden-hour" })
    expect(view.cast).toEqual(CAST)
    expect(view.folders).toEqual([{ id: "f-1", name: "Act one" }])
    expect(view.cuts).toHaveLength(1)
    expect(view.shots[1].scenePrompt).toBe("a storm is coming")
    expect(view.shots[1].startFrame).toBe("https://r2/b1.png")
  })

  it("counts what is in flight without opening it", () => {
    const shots = twoShots()
    shots[1] = {
      ...shots[1],
      pendingClips: [
        { jobId: "job-pending", provider: "seedance-2", prompt: "again", startedAt: 0 },
      ],
    }
    const view = toProductionView(workflow({ shots }), { detail: "summary" })
    expect(view.pending).toEqual({ stills: 0, clips: 1, music: false, draft: null })
    // A summary still says the marker EXISTS — an agent has to be able to see
    // that something is running without asking for every result.
    expect(view.shots[1].clip?.pending).toEqual([
      {
        jobId: "job-pending",
        provider: "seedance-2",
        prompt: "again",
        startedAt: "1970-01-01T00:00:00.000Z",
      },
    ])
  })

  it("a narrowed read still reports what is running on the WHOLE production", () => {
    const shots = twoShots()
    shots[1] = {
      ...shots[1],
      pendingClips: [
        { jobId: "job-pending", provider: "seedance-2", prompt: "again", startedAt: 0 },
      ],
    }
    const view = toProductionView(workflow({ shots }), { detail: "full", shotId: "shot-1" })
    expect(view.shots).toHaveLength(1)
    // "Is anything running?" must not change its answer because the caller
    // asked about one shot.
    expect(view.pending.clips).toBe(1)
  })

  it("the bin is a count at summary and items at full", () => {
    const trash: TrashedItem[] = [
      {
        kind: "still",
        id: "t-1",
        shotId: "shot-1",
        index: 0,
        deletedAt: ISO,
        stillBase: { nodeId: "generate-image-a", provider: "flux-2", prompt: "a lighthouse" },
        result: { url: "https://r2/gone.png", jobId: "job-gone" },
      },
    ]
    expect(toProductionView(workflow({ shots: twoShots(), trash }), { detail: "summary" }).trash)
      .toEqual({ count: 1 })
    const binned = toProductionView(workflow({ shots: twoShots(), trash }), { detail: "full" })
      .trash
    expect(binned.count).toBe(1)
    expect(binned.items).toHaveLength(1)
  })

  it("an archived production says so", () => {
    const view = toProductionView(workflow({ shots: twoShots(), archived: true }), {
      detail: "summary",
    })
    expect(view.archived).toBe(true)
  })

  it("a v1 legacy workflow — nodes, no studio index — views as its shots", () => {
    // The codec has always read v1: a bare `generate-image` node IS a shot.
    // The view inherits that, so a production nobody has opened since v1 is
    // readable by an agent without being migrated first.
    const view = toProductionView(
      {
        id: "wf-legacy",
        name: "Old one",
        version: 1,
        updatedAt: ISO,
        thumbnailUrl: null,
        nodes: [
          {
            id: "generate-image-1",
            type: "generate-image",
            position: { x: 0, y: 0 },
            data: {
              prompt: "a lighthouse",
              generatedImageUrl: "https://r2/legacy.png",
              provider: "flux-2",
            },
          },
        ],
        edges: [],
        settings: {},
      },
      { detail: "full" },
    )
    expect(view.shots).toHaveLength(1)
    expect(view.shots[0].still?.activeUrl).toBe("https://r2/legacy.png")
    expect(view.shots[0].still?.count).toBe(1)
    // No job produced it as far as the document knows, so the url IS the key.
    expect(view.shots[0].still?.active).toBe("https://r2/legacy.png")
  })

  it("an empty production is a production, not an error", () => {
    const view = toProductionView(workflow({ shots: [] }), { detail: "full" })
    expect(view.shots).toEqual([])
    expect(view.folders).toEqual([])
    expect(view.cuts).toEqual([])
    expect(view.trash).toEqual({ count: 0, items: [] })
    expect(view.pending).toEqual({ stills: 0, clips: 0, music: false, draft: null })
  })
})

describe("toProductionSummary", () => {
  it("is a dashboard row: identity, audience and a shot count, no shot bodies", () => {
    const summary = toProductionSummary(workflow({ shots: twoShots(), shared: true }))
    expect(summary).toEqual({
      id: "wf-1",
      name: "The Long Walk",
      version: 7,
      updatedAt: ISO,
      thumbnailUrl: "https://r2/thumb.png",
      shared: true,
      archived: false,
      shotCount: 2,
    })
  })
})
