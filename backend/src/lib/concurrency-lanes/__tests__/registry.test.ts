// The job lane registry (lib/concurrency-lanes/registry.ts): every job name a
// lane-gated worker can receive has a class. It enumerates every node unit's
// worker, so a unit change selects it.
// @test-watches frontend/src/nodes/** backend/src/nodes/**
import { beforeEach, describe, expect, it, vi } from "vitest"
// The handler maps video-worker.ts spreads into `allHandlers`, imported one by
// one: importing video-worker.ts itself boots a BullMQ Worker (precedent:
// lib/reconcile/__tests__/finalize-job-type-coverage.test.ts).
import { imageAIHandlers } from "../../../workers/handlers/image-ai.js"
import { videoAIHandlers } from "../../../workers/handlers/video-ai.js"
import { videoSfxHandlers } from "../../../workers/handlers/video-sfx.js"
import { videoDepthHandlers } from "../../../workers/handlers/video-depth.js"
import { videoMaskHandlers } from "../../../workers/handlers/video-mask.js"
import { ffmpegHandlers } from "../../../workers/handlers/ffmpeg.js"
import { audioAIHandlers } from "../../../workers/handlers/audio-ai.js"
import { sunoHandlers } from "../../../workers/handlers/suno.js"
import { entityHandlers } from "../../../workers/handlers/entity.js"
import { referenceSheetHandlers } from "../../../workers/handlers/reference-sheet.js"
import { motionGraphicsLottieHandlers } from "../../../workers/handlers/motion-graphics-lottie.js"
import { llmStructuredHandlers } from "../../../workers/handlers/llm-structured.js"
import { scene3dHandlers } from "../../../workers/handlers/scene3d.js"
import { nodaroExclusiveRelayHandlers } from "../../../workers/handlers/nodaro-exclusive-relay.js"
import { createSurroundHandlers } from "../../../workers/handlers/surround.js"
import { UNIT_NODE_DESCRIPTORS, laneOf } from "../../unit-descriptors.js"
import type { LaneClass, LaneQueueName } from "../types.js"

type Registry = typeof import("../registry.js")
// The plugin declarations are process state: each case starts from a fresh module.
let reg: Registry
beforeEach(async () => {
  vi.resetModules()
  reg = await import("../registry.js")
})

/** Every name the video worker can be handed: the static maps, the community relay, surround. */
const VIDEO_WORKER_NAMES: readonly string[] = Object.keys({
  ...imageAIHandlers,
  ...videoAIHandlers,
  ...videoSfxHandlers,
  ...videoDepthHandlers,
  ...videoMaskHandlers,
  ...ffmpegHandlers,
  ...audioAIHandlers,
  ...sunoHandlers,
  ...entityHandlers,
  ...referenceSheetHandlers,
  ...motionGraphicsLottieHandlers,
  ...llmStructuredHandlers,
  ...scene3dHandlers,
  ...nodaroExclusiveRelayHandlers,
  ...createSurroundHandlers(undefined),
})
/** The render queue's real names: the Remotion render, the add-captions burn hand-off, the 3D scene child. */
const RENDER_WORKER_NAMES = ["render-video", "render", "scene-render-child"] as const
/** The node units whose job runs on the video worker. */
const UNIT_WORKER_TYPES = UNIT_NODE_DESCRIPTORS.filter((d) => d.execution.kind === "worker").map((d) => d.type)

const leaf = (lane: "provider" | "llm" | "local"): LaneClass => ({ kind: "leaf", lane })
const COORDINATOR: LaneClass = { kind: "coordinator" }

/** Classified = a static entry under its queue, or (video queue) a unit's lane capability — never the fallback. */
function classified(queue: LaneQueueName, name: string): boolean {
  return Object.hasOwn(reg.JOB_LANE_CLASSES, `${queue}:${name}`) || (queue === "video-generation" && laneOf(name) !== undefined)
}

describe("job lane registry", () => {
  it("finds the handler maps (guard against an import going stale)", () => {
    expect(VIDEO_WORKER_NAMES.length).toBeGreaterThanOrEqual(100)
    for (const n of ["generate-image", "trim-video", "generate-video-pro", "generate-surround-continuation"]) expect(VIDEO_WORKER_NAMES).toContain(n)
    expect(UNIT_WORKER_TYPES.length).toBeGreaterThanOrEqual(3)
  })

  it("every video-worker, render-worker and unit worker job name is classified", () => {
    const names: Array<[LaneQueueName, string]> = [
      ...VIDEO_WORKER_NAMES.map((n): [LaneQueueName, string] => ["video-generation", n]),
      ...UNIT_WORKER_TYPES.map((n): [LaneQueueName, string] => ["video-generation", n]),
      ...RENDER_WORKER_NAMES.map((n): [LaneQueueName, string] => ["video-render", n]),
      ["workflow-orchestration", "workflow-execution"],
      ["pipeline-orchestration", "run"],
      ["video-director", "video-director"],
    ]
    expect(names.filter(([q, n]) => !classified(q, n)).map(([q, n]) => `${q}:${n}`)).toEqual([])
  })

  it("names only real job names (no stale entry)", () => {
    const real = new Set([
      ...VIDEO_WORKER_NAMES.map((n) => `video-generation:${n}`),
      ...RENDER_WORKER_NAMES.map((n) => `video-render:${n}`),
      "workflow-orchestration:workflow-execution",
      "pipeline-orchestration:run",
      "video-director:video-director",
    ])
    expect(Object.keys(reg.JOB_LANE_CLASSES).filter((k) => !real.has(k))).toEqual([])
  })

  it("ffmpeg and sharp jobs are local", () => {
    for (const n of ["trim-video", "combine-videos", "apply-edl", "image-collage", "image-overlay", "add-captions", "mask-composite", "mask-erase"]) {
      expect(`${n}:${JSON.stringify(reg.laneClassOf("video-generation", n, {}))}`).toBe(`${n}:${JSON.stringify(leaf("local"))}`)
    }
    for (const n of RENDER_WORKER_NAMES) expect(reg.laneClassOf("video-render", n, {})).toEqual(leaf("local"))
    // Every legacy ffmpeg handler. The unit workers ffmpegHandlers also carries
    // count in the lane their capability names ("a unit worker's lane comes from its lane capability").
    for (const n of Object.keys(ffmpegHandlers).filter((t) => laneOf(t) === undefined)) expect(`${n}:${JSON.stringify(reg.laneClassOf("video-generation", n, {}))}`).toBe(`${n}:${JSON.stringify(leaf("local"))}`)
  })

  it("reference-sheet composes in-process and is local", () => {
    expect(reg.laneClassOf("video-generation", "reference-sheet", {})).toEqual(leaf("local"))
  })

  it("llm-only jobs are llm", () => {
    for (const n of ["generate-script", "llm-structured", "motion-graphics-lottie", "generate-3d-scene", "edit-3d-scene"]) {
      expect(reg.laneClassOf("video-generation", n, {})).toEqual(leaf("llm"))
    }
  })

  it("provider jobs are provider", () => {
    for (const n of ["generate-image", "image-to-video", "text-to-speech", "suno-generate", "generate-character", "reference-board", "extract-youtube-audio", "video-mask"]) {
      expect(reg.laneClassOf("video-generation", n, {})).toEqual(leaf("provider"))
    }
  })

  it("the coordinators are keyed by queue and name", () => {
    for (const n of ["generate-video-pro", "edit-video-pro", "voice-changer-pro", "video-analysis", "video-audit", "edit-plan", "camera-switch", "speaker-view", "speaker-frames", "generate-surround-continuation"]) {
      expect(reg.laneClassOf("video-generation", n, {})).toEqual(COORDINATOR)
    }
    expect(reg.laneClassOf("workflow-orchestration", "workflow-execution", {})).toEqual(COORDINATOR)
    expect(reg.laneClassOf("pipeline-orchestration", "run", {})).toEqual(COORDINATOR)
    expect(reg.laneClassOf("video-director", "video-director", {})).toEqual(COORDINATOR)
    // `run` is the pipeline queue's name only: on the video queue it is no job of ours.
    expect(Object.hasOwn(reg.JOB_LANE_CLASSES, "video-generation:run")).toBe(false)
  })

  it("an undeclared plugin type is a coordinator and a declared one wins", () => {
    reg.notePluginJobTypes(["plugin-leaf", "plugin-undeclared", "video-analysis"])
    expect(reg.laneClassOf("video-generation", "plugin-leaf", {})).toEqual(COORDINATOR)
    expect(reg.laneClassOf("video-generation", "plugin-undeclared", {})).toEqual(COORDINATOR)
    reg.registerPluginJobLanes({ "plugin-leaf": leaf("provider"), "video-analysis": leaf("llm") })
    expect(reg.laneClassOf("video-generation", "plugin-leaf", {})).toEqual(leaf("provider"))
    expect(reg.laneClassOf("video-generation", "plugin-undeclared", {})).toEqual(COORDINATOR)
    // On Cloud the plugin's handler replaces the relay's, so its declaration beats the static entry.
    expect(reg.laneClassOf("video-generation", "video-analysis", {})).toEqual(leaf("llm"))
    // The same classes reach an in-process or live call of that job type.
    expect(reg.laneClassOf("inline", "plugin-leaf", {})).toEqual(leaf("provider"))
  })

  it("an invalid plugin declaration is ignored, leaving the type undeclared", () => {
    reg.notePluginJobTypes(["plugin-x"])
    reg.registerPluginJobLanes({ "plugin-x": { kind: "leaf", lane: "run" } as unknown as LaneClass })
    expect(reg.laneClassOf("video-generation", "plugin-x", {})).toEqual(COORDINATOR)
    expect(reg.undeclaredPluginJobTypes()).toEqual(["plugin-x"])
  })

  it("undeclaredPluginJobTypes lists plugin handler keys with no declaration", () => {
    expect(reg.undeclaredPluginJobTypes()).toEqual([])
    reg.notePluginJobTypes(["c-type", "a-type", "b-type"])
    reg.registerPluginJobLanes({ "b-type": leaf("local") })
    expect(reg.undeclaredPluginJobTypes()).toEqual(["a-type", "c-type"])
  })

  it("a unit worker's lane comes from its lane capability", () => {
    for (const d of UNIT_NODE_DESCRIPTORS.filter((u) => u.execution.kind === "worker")) {
      const lanes = d.capabilities.filter((c) => c.startsWith("lane:"))
      expect(`${d.type}:${lanes.length}`).toBe(`${d.type}:1`)
      expect(Object.hasOwn(reg.JOB_LANE_CLASSES, `video-generation:${d.type}`)).toBe(false)
      expect(reg.laneClassOf("video-generation", d.type, {})).toEqual(leaf(lanes[0]!.slice("lane:".length) as "provider" | "llm" | "local"))
    }
    expect(laneOf("generate-image")).toBeUndefined()
    expect(laneOf(undefined)).toBeUndefined()
  })
})
