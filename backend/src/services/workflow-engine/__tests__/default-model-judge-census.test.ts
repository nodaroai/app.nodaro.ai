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
import { buildPayload, effectiveDispatchProvider } from "../payload-builder.js"
import type { ResolvedInputs, SimpleNode } from "../types.js"
import { JOB_LANE_CLASSES, laneClassOf } from "../../../lib/concurrency-lanes/registry.js"
import { UNIT_NODE_DESCRIPTORS, laneOf } from "../../../lib/unit-descriptors.js"
import { __availabilityUniverseReadyForTests, GATEABLE_MODEL_IDS, GATEABLE_NODE_TYPES } from "../../../lib/availability-override.js"
import { FIXED_MODEL_JOBS, jobRunModelOfBuild, judgesJobRunModel } from "../../../lib/run-model.js"
import { RESOLVED_MODEL_OF_JOB, resolvedModelOfJob } from "../../../lib/job-resolved-model.js"
import { T2I_TO_I2I_VARIANT } from "@nodaro/shared/models"
import { providerIsItsModel } from "../../../lib/provider-model.js"
import { nodeModelOptions } from "../../../lib/__tests__/model-option-vocabularies.js"

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
  // KIE's seedream-5-5-layer-decomposition, which has no catalog entry.
  "split-into-layers": OUTSIDE_CATALOG,
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

// ── 3. Every option a node accepts ───────────────────────────────────────────

/**
 * TOTALITY for "a node that runs catalog models runs no model a restriction
 * cannot name" (decided 2026-11-12) — the workflow lane's half of the rule the
 * route census holds for credit guards (src/__tests__/credit-guard-run-model-census.test.ts).
 * An allow list withholds only ids the catalog (and the LLM list) knows, so a
 * node that runs catalog models AND accepts an option with no catalog entry
 * runs that model wherever the list leaves it out, and the node is no lever:
 * withholding it withholds every other model with it.
 *
 * Every value a node type's model fields accept (lib/__tests__/model-option-vocabularies.ts:
 * the shared lists its route schema and its node are built from) is built as a
 * server-run workflow builds it, and judged as the build judges it — the named
 * provider where it is the node's model, else the model the built job runs. A
 * node whose every option is outside the catalog is exempt in part 1 (or judged
 * outside the catalog in part 2): its node is the lever.
 */
const PROBE = "zz-not-a-model"

/** Node types that run catalog models AND accept options with no catalog entry, each with what deciding it needs. Only shrinks. */
const MIXED_AWAITING_DECISION: Readonly<Record<string, string>> = {}

interface NodeOptionCensus {
  readonly type: string
  readonly jobName: string
  /** Catalog / LLM ids some accepted option runs. */
  readonly gateable: ReadonlySet<string>
  /** Options whose job runs a model no restriction can name (or none it can tell), with what it runs. */
  readonly outside: ReadonlyMap<string, string>
  /** Model fields whose value the built job runs verbatim. */
  readonly echoes: readonly string[]
  readonly probed: number
}

/** The node built with `data`, and the model the build judges it on; undefined when it does not build or calls no model. */
function judgedBuild(type: string, data: Record<string, unknown>): { jobName: string; judged: string | undefined; runsVerbatim: string | undefined } | undefined {
  const node: SimpleNode = { id: `${type}-1`, type, data: { label: "My Node", ...data } }
  let result: ReturnType<typeof buildPayload>
  try {
    result = buildPayload(node, "job-census", { ...WIRED } as ResolvedInputs, undefined, { nodes: [node], edges: [], nodeStates: {} })
  } catch {
    return undefined
  }
  const cls = laneClassOf(result.queueName, result.jobName, result.payload)
  const lane = cls.kind === "leaf" ? cls.lane : cls.kind
  if (lane !== "provider" && lane !== "llm") return undefined
  const runs = jobRunModelOfBuild(result.jobName, result.payload, result.modelIdentifier)
  const named = effectiveDispatchProvider(type, node.data, { provider: undefined })
  const judged = named && providerIsItsModel([type], named, node.data ?? {}) ? named : runs
  return { jobName: result.jobName, judged, runsVerbatim: runs }
}

let options: NodeOptionCensus[] = []

beforeAll(async () => {
  await __availabilityUniverseReadyForTests()
  const types = [...new Set([...GATEABLE_NODE_TYPES, ...UNIT_NODE_DESCRIPTORS.map((d) => d.type), ...editorExecutableTypes()])].sort()
  options = []
  for (const type of types) {
    const gateable = new Set<string>()
    const outside = new Map<string, string>()
    let jobName = ""
    let probed = 0
    const note = (option: string, built: ReturnType<typeof judgedBuild>) => {
      if (!built) return
      jobName ||= built.jobName
      probed += 1
      if (built.judged !== undefined && GATEABLE_MODEL_IDS.has(built.judged)) gateable.add(built.judged)
      else outside.set(option, built.judged ?? "(no model a restriction can tell)")
    }
    note("(no option)", judgedBuild(type, {}))
    const fields = nodeModelOptions(type)
    for (const [field, values] of fields) for (const value of values) note(`${field}=${value}`, judgedBuild(type, { [field]: value }))
    const echoes = ["provider", "model"].filter((field) => judgedBuild(type, { [field]: PROBE })?.runsVerbatim === PROBE)
    if (probed > 0) options.push({ type, jobName, gateable, outside, echoes, probed })
  }
}, 120_000)

describe("every option a workflow node accepts runs a model a restriction can name, or its node is the lever", () => {
  const byType = (type: string) => options.find((o) => o.type === type)

  it("built every option, and sees the case it guards: FLUX Fill Pro on Modify Image is a model a restriction names", () => {
    expect(options.reduce((n, o) => n + o.probed, 0)).toBeGreaterThan(300)
    for (const type of ["modify-image", "image-to-image"]) {
      expect(byType(type)!.gateable, type).toContain("flux-fill")
      expect(byType(type)!.outside.size, type).toBe(0)
    }
    // Wan Animate on Motion Transfer, beside the Kling motion models (decided 2026-11-12).
    expect([...byType("motion-transfer")!.gateable]).toEqual(expect.arrayContaining(["wan-animate-move", "wan-animate-replace", "motion-transfer", "kling-3.0-motion"]))
    expect(byType("motion-transfer")!.outside.size).toBe(0)
    // LatentSync, HeyGen Lipsync Precision and Lipsync 2 Pro on Lip Sync, listed; Wav2Lip,
    // VideoReTalking and SadTalker retired from it (both decided 2026-11-12): every option it
    // accepts runs a model a restriction names.
    const lipSync = byType("lip-sync")!
    expect([...lipSync.gateable]).toEqual(expect.arrayContaining(["latentsync", "heygen-lipsync-precision", "lipsync-2-pro", "kling-avatar"]))
    expect(lipSync.outside.size).toBe(0)
    // Suno V4_5PLUS, V4_5ALL and V4_5 on every Suno node that runs a version (decided 2026-11-12).
    for (const type of ["suno-generate", "suno-cover", "suno-extend", "suno-mashup", "suno-upload-extend", "suno-add-instrumental", "suno-add-vocals"]) {
      expect([...byType(type)!.gateable], type).toEqual(expect.arrayContaining(["suno-v4_5plus", "suno-v6"]))
      expect(byType(type)!.outside.size, type).toBe(0)
    }
  })

  it("a model field the built job runs verbatim has its accepted values declared", () => {
    const undeclared = options.flatMap((o) => o.echoes.filter((f) => !nodeModelOptions(o.type).has(f)).map((f) => `${o.type}: ${f}`))
    expect(undeclared).toEqual([])
  })

  it("no node runs both a catalog model and one no restriction can name, unless it awaits a decision listed above", () => {
    const mixed = options
      .filter((o) => o.gateable.size > 0 && o.outside.size > 0 && !Object.hasOwn(MIXED_AWAITING_DECISION, o.type))
      .map((o) => `${o.type} (job ${o.jobName}): ${[...o.outside].map(([option, runs]) => `${option} → ${runs}`).join(", ")} — give each a catalog entry`)
    expect(mixed).toEqual([])
  })

  it("a node whose every option is outside the catalog is one part 1 exempts as OUTSIDE_CATALOG, or judged outside the catalog", () => {
    const unlisted = options
      .filter((o) => o.gateable.size === 0 && o.outside.size > 0)
      .filter((o) => JOB_JUDGE_EXEMPT[o.jobName] !== OUTSIDE_CATALOG && !Object.hasOwn(JUDGED_OUTSIDE_CATALOG, o.type))
      .map((o) => `${o.type} (job ${o.jobName}): ${[...o.outside.values()].join(", ")}`)
    expect(unlisted).toEqual([])
  })

  it("no entry awaiting a decision is stale", () => {
    expect(Object.keys(MIXED_AWAITING_DECISION).filter((t) => {
      const o = byType(t)
      return !o || o.gateable.size === 0 || o.outside.size === 0
    })).toEqual([])
  })
})

// ── 4. A build that switches to another model ────────────────────────────────

/**
 * TOTALITY for "a build is judged on the model it runs" (decided 2026-11-12):
 * a build may end on a different model than the one its node names — the
 * trained-character model a Generate Image run switches to when its one wired
 * character has a succeeded trained model. Such a job must be judged on the
 * model it runs, or a deployment that withholds that model still runs it.
 *
 * Every option of every node type (part 3), and the Generate Image and
 * Reference Board nodes wired to a trained character, is built; the model its
 * handler runs (`resolvedModelOfJob`, decided as the handler decides) is held
 * to the model the build is judged on (`jobRunModelOfBuild`). The one allowed
 * difference is a declared image-to-image sibling (`T2I_TO_I2I_VARIANT`): the
 * named model is judged, by design. Anything else is listed below with why.
 */
const JUDGED_APART_FROM_RUN: Readonly<Record<string, string>> = {}

const TRAINED_CHARACTER: SimpleNode = {
  id: "c1",
  type: "character",
  data: {
    label: "Kira",
    characterName: "Kira",
    sourceImageUrl: IMG,
    loraReplicateVersion: "owner/char-kira:abc123",
    loraTriggerWord: "TOK_kira",
    loraTrainingStatus: "succeeded",
  },
}

/** The model a node's build runs and the one it is judged on; undefined when it does not build or calls no model. */
function runAndJudge(type: string, data: Record<string, unknown>, trained: boolean): { jobName: string; runs: string | undefined; judged: string | undefined } | undefined {
  const node: SimpleNode = { id: `${type}-1`, type, data: { label: "My Node", prompt: "Kira at the beach", ...data } }
  const nodes = trained ? [TRAINED_CHARACTER, node] : [node]
  const edges = trained ? [{ id: "e1", source: "c1", target: node.id, sourceHandle: "character" }] : []
  let result: ReturnType<typeof buildPayload>
  try {
    result = buildPayload(node, "job-census", (trained ? {} : { ...WIRED }) as ResolvedInputs, undefined, { nodes, edges, nodeStates: {} } as never)
  } catch {
    return undefined
  }
  const cls = laneClassOf(result.queueName, result.jobName, result.payload)
  const lane = cls.kind === "leaf" ? cls.lane : cls.kind
  if (lane !== "provider" && lane !== "llm") return undefined
  return {
    jobName: result.jobName,
    runs: resolvedModelOfJob(result.jobName, result.payload),
    judged: jobRunModelOfBuild(result.jobName, result.payload, result.modelIdentifier),
  }
}

describe("a build is judged on the model it runs, a declared image-to-image sibling aside", () => {
  let checked = 0
  const apart: string[] = []

  beforeAll(async () => {
    await __availabilityUniverseReadyForTests()
    const types = [...new Set([...GATEABLE_NODE_TYPES, ...UNIT_NODE_DESCRIPTORS.map((d) => d.type), ...editorExecutableTypes()])].sort()
    const note = (label: string, b: ReturnType<typeof runAndJudge>) => {
      if (!b || !judgesJobRunModel(b.jobName)) return
      checked += 1
      if (b.runs === b.judged) return
      if (b.judged !== undefined && T2I_TO_I2I_VARIANT[b.judged] === b.runs) return
      if (Object.hasOwn(JUDGED_APART_FROM_RUN, label.split(" ")[0]!)) return
      apart.push(`${label}: runs ${String(b.runs)}, judged ${String(b.judged)}`)
    }
    for (const type of types) {
      note(`${type} (no option)`, runAndJudge(type, {}, false))
      for (const [field, values] of nodeModelOptions(type)) for (const value of values) note(`${type} ${field}=${value}`, runAndJudge(type, { [field]: value }, false))
    }
    for (const type of ["generate-image", "reference-board"]) {
      note(`${type} with a trained character`, runAndJudge(type, {}, true))
      for (const value of nodeModelOptions(type).get("provider") ?? []) note(`${type} provider=${value} with a trained character`, runAndJudge(type, { provider: value }, true))
    }
  }, 120_000)

  it("built enough to mean something, the trained-character switch among them", () => {
    expect(checked).toBeGreaterThan(300)
    const switched = runAndJudge("generate-image", { provider: "gpt-image-2" }, true)!
    expect(switched.runs).toBe("flux-lora-character")
    expect(switched.judged).toBe("flux-lora-character")
  })

  it("no build runs one model and is judged on another, unless listed", () => {
    expect(apart).toEqual([])
  })
})
