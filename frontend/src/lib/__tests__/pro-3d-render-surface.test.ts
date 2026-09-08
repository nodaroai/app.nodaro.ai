import { describe, expect, it, beforeEach, vi } from "vitest"

// The node is Cloud-only (it settles credits), so the picker's edition filter
// would hide it in a default test environment for a reason that has nothing to
// do with the readiness gate under test.
vi.mock("@/lib/edition", async () => {
  const actual = await vi.importActual<typeof import("@/lib/edition")>("@/lib/edition")
  return { ...actual, hasCredits: () => true }
})
import {
  ASPECT_RATIO_DIMENSIONS,
  COMPOSER_PLAN_MAP,
  PRO3D_RENDER_ASPECT_RATIOS,
  PRO3D_RENDER_DEFAULT_REPAIR_PASSES,
  PRO3D_RENDER_MAX_REPAIR_PASSES,
  VIDEO_PRODUCER_TYPES,
  buildPro3DRenderSource,
  isPro3DRenderRenderOnly,
  pro3DRenderTimingOverrides,
} from "@nodaro/shared"
import { PRO3D_ASPECT_RATIOS } from "@/components/editor/config-panels/model-options"
import { resolvePro3DSceneRef } from "@/lib/scene3d/pro-source"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import { getNodeOptions } from "@/lib/node-options"
import { __setScene3DProAvailableForTests } from "@/lib/scene3d-pro-availability"
import { HANDLE_OUTPUT_TYPES } from "@/lib/handle-output-types"
import { isValidScene3DConnection } from "@/lib/scene3d-handles"
import { buildCompletedResultPatch, computeCompletedJobPatches } from "@/lib/reconcile-completed-jobs"
import type { WorkflowNode } from "@/types/nodes"

/**
 * The canvas side of 3D Render Pro.
 *
 * Two properties, both of which have failed silently for other nodes before:
 *
 *  - the node is NOT offered until the deployment says it can serve it, and the
 *    default is hidden. A picker entry for a node that can only 503 is worse
 *    than a missing one;
 *  - the node's TWO outputs resolve per handle — `video` to the MP4 URL,
 *    `composition` to the plan marker. A media handle that resolves to a
 *    marker is the "cannot connect the outputs" class; a plan handle that
 *    resolves to a URL feeds a renderer something it cannot parse.
 */
const withScene = {
  id: "n1", type: "pro-3d-render",
  data: {
    scenePlan: { planType: "3d-scene", revisionId: "r1" },
    generatedVideoUrl: "https://r2.example/renders/pro.mp4",
  },
} as never

describe("engine readiness gates the picker entry", () => {
  beforeEach(() => __setScene3DProAvailableForTests(false))

  it("hides the node until the deployment reports it", () => {
    expect(getNodeOptions().some((o) => o.type === "pro-3d-render")).toBe(false)
  })

  it("offers it once the deployment reports it", () => {
    __setScene3DProAvailableForTests(true)
    expect(getNodeOptions().some((o) => o.type === "pro-3d-render")).toBe(true)
  })
})

describe("one node, two outputs", () => {
  it("resolves the selected render from history before the legacy video field", () => {
    const node = {
      id: "pro", type: "pro-3d-render", data: {
        generatedVideoUrl: "https://r2.example/old.mp4",
        generatedResults: [{ url: "https://r2.example/first.mp4" }, { url: "https://r2.example/selected.mp4" }],
        activeResultIndex: 1,
        scenePlan: { planType: "3d-scene", revisionId: "r2" },
      },
    } as never
    expect(extractNodeOutput(node, "video")).toBe("https://r2.example/selected.mp4")
    expect(extractNodeOutput(node, "composition")).toBe("plan-ready")
  })

  it("resolves the video handle to the MP4", () => {
    expect(extractNodeOutput(withScene, "video")).toBe("https://r2.example/renders/pro.mp4")
  })

  it("resolves the composition handle to the plan marker", () => {
    expect(extractNodeOutput(withScene, "composition")).toBe("plan-ready")
    expect(extractNodeOutput(withScene)).toBe("plan-ready")
  })

  it("declares both handle types so wires are coloured, not neutral", () => {
    expect(HANDLE_OUTPUT_TYPES["pro-3d-render"]).toEqual({ composition: "control", video: "video" })
  })

  it("is a video producer, so its video output can connect downstream", () => {
    expect(VIDEO_PRODUCER_TYPES.has("pro-3d-render")).toBe(true)
  })

  it("is a composer, so its composition re-renders through the existing lane", () => {
    expect(COMPOSER_PLAN_MAP["pro-3d-render"]).toEqual({ planType: "3d-scene", planField: "scenePlan" })
  })
})

describe("references in", () => {
  it("accepts the same producers the Basic authoring nodes accept", () => {
    expect(isValidScene3DConnection("references", "generate-image")).toBe(true)
    expect(isValidScene3DConnection("references", "upload-video")).toBe(true)
    expect(isValidScene3DConnection("references", "text-prompt")).toBe(false)
  })
})

describe("recovering a settled run after a reload", () => {
  const plan = { planType: "3d-scene", schemaVersion: 1, revisionId: "rev-new", parentRevisionId: "rev-base" }
  const output = { scenePlan: plan, videoUrl: "https://r2.example/renders/pro.mp4" }

  it("restores BOTH halves when the node is still on the run's base revision", () => {
    const patch = buildCompletedResultPatch("pro-3d-render", output, "job-1", "2026-09-08T00:00:00.000Z", {
      scenePlan: { planType: "3d-scene", revisionId: "rev-base" },
      sceneJobBaseRevisionId: "rev-base",
    })
    expect(patch?.scenePlan).toEqual(plan)
    expect(patch?.generatedVideoUrl).toBe("https://r2.example/renders/pro.mp4")
  })

  it("does not overwrite live media when the arriving revision is parked", () => {
    // The user edited the scene after this run started: the arriving revision
    // is kept in history, but its video belongs to the older scene.
    const patch = buildCompletedResultPatch("pro-3d-render", output, "job-1", "2026-09-08T00:00:00.000Z", {
      scenePlan: { planType: "3d-scene", revisionId: "rev-user-edit" },
      sceneJobBaseRevisionId: "rev-base",
    })
    expect(patch?.scenePendingPlan).toEqual(plan)
    expect(patch?.generatedVideoUrl).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Reload recovery — the node that has ALREADY produced a video
// ---------------------------------------------------------------------------

/**
 * The reconciler exists for "billed, in My Library, nothing on canvas": a run
 * whose in-memory poll died with the tab. 3D Render Pro is the node most
 * exposed to it (a durable render is long) and the one most easily skipped —
 * every OTHER lane is gated on the node being empty, and a Pro node that has
 * rendered before is not.
 */
function wfNode(id: string, type: string, data: Record<string, unknown>): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
}

const NOW = "2026-09-08T12:00:00.000Z"
const OLD_MP4 = "https://r2.example/renders/old.mp4"
const NEW_MP4 = "https://r2.example/renders/new.mp4"
const NEW_PLAN = { planType: "3d-scene", schemaVersion: 2, revisionId: "rev-new", parentRevisionId: "rev-base" }
const JOB_OUTPUT = { scenePlan: NEW_PLAN, videoUrl: NEW_MP4 }

describe("reload recovery on a Pro node that already has a video", () => {
  it("recovers the settled run even though the node holds an EARLIER MP4", async () => {
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "n1", jobId: "job-2" }],
      [
        wfNode("n1", "pro-3d-render", {
          scenePlan: { planType: "3d-scene", revisionId: "rev-base" },
          sceneJobBaseRevisionId: "rev-base",
          generatedVideoUrl: OLD_MP4,
          generatedResults: [{ url: OLD_MP4, timestamp: "2026-09-07T00:00:00.000Z", jobId: "job-1" }],
          activeResultIndex: 0,
        }),
      ],
      async () => ({ status: "completed", output_data: JOB_OUTPUT }),
      NOW,
    )
    expect(patches).toHaveLength(1)
    const updates = patches[0].updates
    expect(updates.scenePlan).toEqual(NEW_PLAN)
    expect(updates.generatedVideoUrl).toBe(NEW_MP4)
  })

  it("writes the adopted media with real provenance and a matching active index", async () => {
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "n1", jobId: "job-2" }],
      [
        wfNode("n1", "pro-3d-render", {
          scenePlan: { planType: "3d-scene", revisionId: "rev-base" },
          sceneJobBaseRevisionId: "rev-base",
          generatedVideoUrl: OLD_MP4,
          generatedResults: [{ url: OLD_MP4, timestamp: "2026-09-07T00:00:00.000Z", jobId: "job-1" }],
          activeResultIndex: 0,
        }),
      ],
      async () => ({ status: "completed", output_data: JOB_OUTPUT }),
      NOW,
    )
    const results = patches[0].updates.generatedResults as Array<Record<string, unknown>>
    // Appended, not replaced: the earlier render was billed and is in My Library.
    expect(results).toHaveLength(2)
    expect(results[1]).toEqual({ url: NEW_MP4, timestamp: NOW, jobId: "job-2" })
    expect(patches[0].updates.activeResultIndex).toBe(1)
  })

  it("does not recover an ordinary media node that already has its result", async () => {
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "v1", jobId: "job-2" }],
      [wfNode("v1", "generate-video", { generatedVideoUrl: OLD_MP4 })],
      async () => ({ status: "completed", output_data: { videoUrl: NEW_MP4 } }),
      NOW,
    )
    expect(patches).toEqual([])
  })

  it("parks against the LIVE node when the scene moved on during the lookup", async () => {
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "n1", jobId: "job-2" }],
      [
        wfNode("n1", "pro-3d-render", {
          scenePlan: { planType: "3d-scene", revisionId: "rev-base" },
          sceneJobBaseRevisionId: "rev-base",
          generatedVideoUrl: OLD_MP4,
        }),
      ],
      async () => ({ status: "completed", output_data: JOB_OUTPUT }),
      NOW,
      // The user nudged the scene while the job lookup was in flight.
      () => ({
        scenePlan: { planType: "3d-scene", revisionId: "rev-user-edit" },
        sceneJobBaseRevisionId: "rev-base",
        generatedVideoUrl: OLD_MP4,
      }),
    )
    const updates = patches[0].updates
    expect(updates.scenePendingPlan).toEqual(NEW_PLAN)
    expect(updates.scenePlan).toBeUndefined()
    // The live MP4 is untouched, and the paid revision is still filed.
    expect(updates.generatedVideoUrl).toBeUndefined()
    expect(updates.generatedResults).toBeUndefined()
    expect((updates.sceneHistory as Array<{ revisionId: string }>).map((h) => h.revisionId)).toContain("rev-new")
  })

  it("is idempotent across reloads — a revision already in history writes nothing", async () => {
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "n1", jobId: "job-2" }],
      [
        wfNode("n1", "pro-3d-render", {
          scenePlan: NEW_PLAN,
          sceneHistory: [{ revisionId: "rev-new", scenePlan: NEW_PLAN, source: "generate", createdAt: NOW, jobId: "job-2" }],
          generatedVideoUrl: NEW_MP4,
          generatedResults: [{ url: NEW_MP4, timestamp: NOW, jobId: "job-2" }],
          activeResultIndex: 0,
        }),
      ],
      async () => ({ status: "completed", output_data: JOB_OUTPUT }),
      NOW,
    )
    expect(patches).toEqual([])
  })

  it("selects an already-recorded result instead of appending a duplicate row", () => {
    // Media arrived on an earlier pass but the revision did not — the media half
    // must not grow a second row for one render.
    const patch = buildCompletedResultPatch("pro-3d-render", JOB_OUTPUT, "job-2", NOW, {
      scenePlan: { planType: "3d-scene", revisionId: "rev-base" },
      sceneJobBaseRevisionId: "rev-base",
      generatedResults: [
        { url: OLD_MP4, timestamp: "2026-09-07T00:00:00.000Z", jobId: "job-1" },
        { url: NEW_MP4, timestamp: NOW, jobId: "job-2" },
      ],
    })
    expect(patch?.generatedResults).toHaveLength(2)
    expect(patch?.activeResultIndex).toBe(1)
    expect(patch?.generatedVideoUrl).toBe(NEW_MP4)
  })

  it("still recovers a BASIC scene node, which has no media half at all", async () => {
    const patches = await computeCompletedJobPatches(
      [{ nodeId: "s1", jobId: "job-2" }],
      [
        wfNode("s1", "generate-3d-scene", {
          scenePlan: { planType: "3d-scene", revisionId: "rev-base" },
          sceneJobBaseRevisionId: "rev-base",
        }),
      ],
      async () => ({ status: "completed", output_data: { scenePlan: NEW_PLAN } }),
      NOW,
    )
    expect(patches[0].updates.scenePlan).toEqual(NEW_PLAN)
    expect(patches[0].updates.generatedResults).toBeUndefined()
  })
})

describe("the source the canvas builds", () => {
  const nodes = [
    {
      id: "scene-node",
      type: "generate-3d-scene",
      data: {
        scenePlan: { planType: "3d-scene", revisionId: "rev-1" },
        sceneHistory: [{ revisionId: "rev-1", jobId: "scene-job-9", scenePlan: {}, source: "generate", createdAt: "" }],
      },
    },
    { id: "pro", type: "pro-3d-render", data: {} },
  ] as never
  const edges = [{ source: "scene-node", target: "pro", targetHandle: "scene" }]

  it("reads the wired scene and its recorded source job", () => {
    expect(resolvePro3DSceneRef("pro", {}, nodes, edges)).toEqual({ revisionId: "rev-1", sourceJobId: "scene-job-9" })
  })

  it("submits a retained manual revision without inventing a generation job", () => {
    const untracked = [
      { id: "scene-node", type: "generate-3d-scene", data: { scenePlan: { planType: "3d-scene", schemaVersion: 2, revisionId: "rev-old" } } },
    ] as never
    const ref = resolvePro3DSceneRef("pro", {}, untracked, edges)
    expect(ref).toEqual({ revisionId: "rev-old", sourceJobId: undefined })
    const built = buildPro3DRenderSource({ sourceMode: "scene", ...ref })
    expect(built).toEqual({ ok: true, source: { kind: "scene", revisionId: "rev-old" } })
  })

  it("does not send an earlier render job as the generating job of a retained revision", () => {
    const data = {
      scenePlan: { planType: "3d-scene", schemaVersion: 2, revisionId: "retained" },
      sceneHistory: [{ revisionId: "retained", jobId: "later-render-job", scenePlan: {}, source: "generate", createdAt: "" }],
    } as never
    const connected = [{ id: "scene-node", type: "pro-3d-render", data }]
    for (const ref of [resolvePro3DSceneRef("pro", {}, connected, edges), resolvePro3DSceneRef("pro", data, [], [])]) {
      expect(buildPro3DRenderSource({ sourceMode: "scene", ...ref }))
        .toEqual({ ok: true, source: { kind: "scene", revisionId: "retained" } })
    }
  })

  it("keeps an absent edit instruction absent — that IS the render-only request", () => {
    const built = buildPro3DRenderSource({ sourceMode: "scene", revisionId: "rev-1", sourceJobId: "job-1", editPrompt: "   " })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.source).toEqual({ kind: "scene", revisionId: "rev-1", sourceJobId: "job-1" })
    expect("editPrompt" in built.source).toBe(false)
    expect(isPro3DRenderRenderOnly(built.source)).toBe(true)
  })

  it("withholds the node's timing from a scene source unless re-timing is explicit", () => {
    const source = { kind: "scene", revisionId: "r", sourceJobId: "j" } as const
    expect(pro3DRenderTimingOverrides({ source, durationSeconds: 5, fps: 60, aspectRatio: "1:1" })).toEqual({})
    expect(
      pro3DRenderTimingOverrides({ source, overrideSourceTiming: true, durationSeconds: 5, fps: 60, aspectRatio: "1:1" }),
    ).toEqual({ durationSeconds: 5, fps: 60, aspectRatio: "1:1" })
  })

  it("always sends timing for a new scene", () => {
    const source = { kind: "prompt", prompt: "x" } as const
    expect(pro3DRenderTimingOverrides({ source, durationSeconds: 30, fps: 24, aspectRatio: "21:9" }))
      .toEqual({ durationSeconds: 30, fps: 24, aspectRatio: "21:9" })
  })
})

describe("the acceptance fixture's shape is expressible", () => {
  it("offers 21:9 with the contract's supported pixel pair", () => {
    expect(PRO3D_RENDER_ASPECT_RATIOS).toContain("21:9")
    expect(ASPECT_RATIO_DIMENSIONS["21:9"]).toEqual({ width: 1680, height: 720 })
    expect(PRO3D_ASPECT_RATIOS.some((o) => o.value === "21:9")).toBe(true)
  })

  it("bounds the correction budget at two passes", () => {
    expect(PRO3D_RENDER_MAX_REPAIR_PASSES).toBe(2)
    expect(PRO3D_RENDER_DEFAULT_REPAIR_PASSES).toBe(2)
  })
})

describe("the scene input", () => {
  it("accepts a composition from any 3D scene producer, and nothing else", () => {
    expect(isValidScene3DConnection("scene", "generate-3d-scene")).toBe(true)
    expect(isValidScene3DConnection("scene", "pro-3d-render")).toBe(true)
    expect(isValidScene3DConnection("scene", "generate-image")).toBe(false)
  })
})
