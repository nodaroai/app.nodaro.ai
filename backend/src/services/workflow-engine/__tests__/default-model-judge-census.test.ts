// Every job a worker runs is classified by its lane, and the unit workers'
// lanes come from their manifests, so a unit change selects this census; the
// editor's executable set names the older node types the registry does not.
// @test-watches frontend/src/nodes/** backend/src/nodes/** frontend/src/components/editor/workflow-editor/types.ts
/**
 * TOTALITY: on a deployment that restricts models, a server-run workflow
 * judges the model each node RUNS on — the one it names (the backstop at the
 * top of `buildPayload`), or, when it names none, the default its build filled
 * in (`refuseWithheldDefaultModel`, which reads it off the built job through
 * `jobRunModelOfBuild`). This holds every job that can run a model to that:
 *
 *  1. Every job of the lane registry whose lane calls an AI provider or an LLM
 *     (`provider` / `llm`) is one the workflow lane can judge, or is listed
 *     below with the reason it needs no judging. The lane registry's own census
 *     already holds every job a worker can be handed to a lane, so a new job
 *     that runs a model cannot reach a worker without a decision here.
 *  2. Every dispatchable node type that builds from a wired graph with no model
 *     named, and whose job is judged, resolves a default a restriction can name
 *     — a model id, not a pricing id — so the judgement is never vacuous.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildPayload } from "../payload-builder.js"
import type { ResolvedInputs, SimpleNode } from "../types.js"
import { JOB_LANE_CLASSES, laneClassOf } from "../../../lib/concurrency-lanes/registry.js"
import { UNIT_NODE_DESCRIPTORS, laneOf } from "../../../lib/unit-descriptors.js"
import { __availabilityUniverseReadyForTests, GATEABLE_MODEL_IDS, GATEABLE_NODE_TYPES } from "../../../lib/availability-override.js"
import { FIXED_MODEL_JOBS, jobRunModelOfBuild, judgesJobRunModel } from "../../../lib/run-model.js"
import { RESOLVED_MODEL_OF_JOB } from "../../../lib/job-resolved-model.js"

// ── Why a job that runs a model needs no judging on the workflow lane ────────

/** One model the catalog does not list: no model restriction can name it, so its node is the lever. */
const OUTSIDE_CATALOG = "runs a model the model catalog does not list, so no model restriction can name it — its node is the lever"
/** Created only by its own route, whose credit guard judges the model it runs. */
const ROUTE_ONLY = "enqueued only by its own route (no workflow node builds this job), whose credit guard judges the model it runs"
/** Calls no AI model at all. */
const NO_AI = "calls no AI model"

const JOB_JUDGE_EXEMPT: Readonly<Record<string, string>> = {
  "speech-to-video": OUTSIDE_CATALOG,
  "face-swap": OUTSIDE_CATALOG,
  "generate-mask": OUTSIDE_CATALOG,
  "ai-avatar": OUTSIDE_CATALOG,
  "cinematic-avatar": OUTSIDE_CATALOG,
  "switchx": OUTSIDE_CATALOG,
  "video-sfx": OUTSIDE_CATALOG,
  "generate-music": OUTSIDE_CATALOG,
  "audio-separation": OUTSIDE_CATALOG,
  "voice-remix": OUTSIDE_CATALOG,
  "suno-lyrics": OUTSIDE_CATALOG,
  "suno-separate": OUTSIDE_CATALOG,
  "suno-music-video": OUTSIDE_CATALOG,
  "suno-replace-section": OUTSIDE_CATALOG,
  "suno-convert-wav": OUTSIDE_CATALOG,
  "extract-youtube-audio": NO_AI,
  "llm-structured": ROUTE_ONLY,
  "web-scrape": ROUTE_ONLY,
  "site-capture": ROUTE_ONLY,
  "meta-ads-scrape": ROUTE_ONLY,
  "instagram-scrape": ROUTE_ONLY,
}

/**
 * Judged on the workflow lane, but whose default no allowlist can withhold:
 * it is outside the catalog, so only an explicit `models.deny` entry names it.
 */
const JUDGED_OUTSIDE_CATALOG: Readonly<Record<string, string>> = {
  "video-mask": "its default segmentation model is not a catalog id; an explicit `models.deny` entry still refuses it",
}

// ── 1. Jobs ──────────────────────────────────────────────────────────────────

/** Every job a worker runs whose lane calls an AI provider or an LLM. */
function modelRunningJobs(): string[] {
  const fromRegistry = Object.entries(JOB_LANE_CLASSES)
    .filter(([, cls]) => cls.kind === "leaf" && (cls.lane === "provider" || cls.lane === "llm"))
    .map(([key]) => key.slice(key.indexOf(":") + 1))
  const fromUnits = UNIT_NODE_DESCRIPTORS.filter((d) => d.execution.kind === "worker")
    .map((d) => d.type)
    .filter((t) => laneOf(t) === "provider" || laneOf(t) === "llm")
  return [...new Set([...fromRegistry, ...fromUnits])].sort()
}

describe("every job that can run a model is judged on the workflow lane, or says why not", () => {
  it("found the jobs (the lane registry and the judge are read)", () => {
    const jobs = modelRunningJobs()
    expect(jobs.length).toBeGreaterThan(50)
    expect(jobs).toEqual(expect.arrayContaining(["generate-image", "image-to-image", "image-to-video", "text-to-video"]))
    expect(Object.keys(RESOLVED_MODEL_OF_JOB).length).toBeGreaterThan(40)
  })

  it("each is judged or exempt with a reason", () => {
    expect(modelRunningJobs().filter((j) => !judgesJobRunModel(j) && !Object.hasOwn(JOB_JUDGE_EXEMPT, j))).toEqual([])
  })

  it("no exemption is stale: each names a model-running job the lane cannot judge", () => {
    const jobs = new Set(modelRunningJobs())
    expect(Object.keys(JOB_JUDGE_EXEMPT).filter((j) => !jobs.has(j) || judgesJobRunModel(j))).toEqual([])
  })

  it("every fixed-model job is a model-running job", () => {
    const jobs = new Set(modelRunningJobs())
    expect([...FIXED_MODEL_JOBS].filter((j) => !jobs.has(j))).toEqual([])
  })
})

// ── 2. Dispatchable node types ───────────────────────────────────────────────

const IMG = "https://cdn.example.com/a.png"
const VID = "https://cdn.example.com/a.mp4"
const AUD = "https://cdn.example.com/a.mp3"
/** What a wired graph hands a node: enough for most nodes to build. */
const WIRED = {
  prompt: "a quiet harbour at dawn", text: "Hello there.", imageUrl: IMG, videoUrl: VID, audioUrl: AUD,
  imageUrls: [IMG], startFrameUrl: IMG, referenceImageUrls: [IMG], sourceImageUrl: IMG, json: "{}",
}

/**
 * The editor's hand-written executable set: the node types a graph can carry
 * that the node registry no longer lists (Image to Image, the older video
 * nodes) still run. Read as payload-builder-cross-tree-registry.test.ts reads it.
 */
function editorExecutableTypes(): string[] {
  const source = readFileSync(join(__dirname, "..", "..", "..", "..", "..", "frontend/src/components/editor/workflow-editor/types.ts"), "utf8")
  const match = source.match(/export const EXECUTABLE_TYPES\s*=\s*(?:composeSet\([^,]*,\s*)?new Set\(\s*\[([\s\S]*?)\]\s*\)/)
  if (!match) throw new Error("Could not read EXECUTABLE_TYPES from the editor's workflow-editor/types.ts")
  return [...(match[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]!)
}

interface Built {
  readonly type: string
  readonly jobName: string
  readonly lane: string
  readonly judged: string | undefined
}

let built: Built[] = []

beforeAll(async () => {
  await __availabilityUniverseReadyForTests()
  const types = [...new Set([...GATEABLE_NODE_TYPES, ...UNIT_NODE_DESCRIPTORS.map((d) => d.type), ...editorExecutableTypes()])].sort()
  built = []
  for (const type of types) {
    // No model named: the node as a graph that leaves the choice to the platform hands it.
    const node: SimpleNode = { id: `${type}-1`, type, data: { label: "My Node" } }
    let result: ReturnType<typeof buildPayload>
    try {
      result = buildPayload(node, "job-census", { ...WIRED } as ResolvedInputs, undefined, { nodes: [node], edges: [], nodeStates: {} })
    } catch {
      // Not built by `buildPayload` (inline, sync-HTTP, source), or needs more
      // of its graph to build: its job, if it runs a model, is held by part 1.
      continue
    }
    const cls = laneClassOf(result.queueName, result.jobName, result.payload)
    built.push({
      type,
      jobName: result.jobName,
      lane: cls.kind === "leaf" ? cls.lane : cls.kind,
      judged: jobRunModelOfBuild(result.jobName, result.payload, result.modelIdentifier),
    })
  }
}, 60_000)

describe("every dispatchable node type that names no model resolves a default a restriction can name", () => {
  it("built enough node types to mean something, the image and video nodes among them", () => {
    const judged = built.filter((b) => (b.lane === "provider" || b.lane === "llm") && judgesJobRunModel(b.jobName))
    expect(judged.length).toBeGreaterThanOrEqual(30)
    expect(judged.map((b) => b.type)).toEqual(
      expect.arrayContaining(["generate-image", "image-to-image", "modify-image", "generate-video", "image-to-video", "text-to-video"]),
    )
  })

  it("a judged job's default is a model id a restriction can name, or is listed with a reason", () => {
    const vacuous = built
      .filter((b) => (b.lane === "provider" || b.lane === "llm") && judgesJobRunModel(b.jobName))
      .filter((b) => !Object.hasOwn(JUDGED_OUTSIDE_CATALOG, b.type))
      .filter((b) => b.judged === undefined || !GATEABLE_MODEL_IDS.has(b.judged))
      .map((b) => `${b.type} (job ${b.jobName}) → ${JSON.stringify(b.judged)}`)
    expect(vacuous).toEqual([])
  })

  it("a built node whose job runs a model but is not judged is one part 1 exempts", () => {
    const unheld = built
      .filter((b) => (b.lane === "provider" || b.lane === "llm") && !judgesJobRunModel(b.jobName))
      .filter((b) => !Object.hasOwn(JOB_JUDGE_EXEMPT, b.jobName))
      .map((b) => `${b.type} (job ${b.jobName})`)
    expect(unheld).toEqual([])
  })

  it("each node listed as judged outside the catalog still builds a judged job", () => {
    const byType = new Map(built.map((b) => [b.type, b]))
    expect(Object.keys(JUDGED_OUTSIDE_CATALOG).filter((t) => !byType.get(t) || !judgesJobRunModel(byType.get(t)!.jobName))).toEqual([])
  })
})
