import { describe, it, expect } from "vitest"
import { resolveExtendVideoIdentifier } from "@/routes/extend-video.js"
import { buildPayload } from "@/services/workflow-engine/payload-builder.js"
import { CreditsService, STATIC_CREDIT_COSTS, getNodeModelIdentifier } from "@/ee/billing/credits.js"
import { grokExtendCreditId, pixverseExtendCreditId, tailExtendCreditId, tailExtendResolution } from "@nodaro/shared/credits"
import { EXTEND_VIDEO_PROVIDERS, RETIRED_VIDEO_PROVIDERS, canonicalVideoProvider, isTailExtendProvider } from "@nodaro/shared/models"
import { isSeedanceExtendPricedBySecondsSent, seedanceExtendPrice, seedanceExtendRateCreditId } from "@nodaro/render-rules"
import { quoteBaseCredits } from "@/lib/credit-base-cost.js"
import { tailRecipeSeconds } from "@/lib/extend-recipe.js"
import { resolveNodeInputs } from "@/services/workflow-engine/input-resolver.js"
import { stampGrokExtendSource } from "@/lib/grok-extend-stamp.js"
import { GROK_EXTEND_SOURCE_MESSAGE } from "@/lib/grok-extend-source.js"
import { withLegacyExtensionOutputs, type LegacyOutputJob } from "@/lib/legacy-extension-output.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "@/services/workflow-engine/types.js"

// ---------------------------------------------------------------------------
// THREE places name the credit identifier an Extend Video run is priced at:
// the HTTP route (guard + reservation), the workflow payload builder
// (orchestrator reservation), and the workflow estimate. If they disagree, a
// run reserves one price against a generation that costs another — and
// commit_credits only ever refunds a surplus, it never collects an upward
// delta, so a shortfall is permanent. Seedance 2.5 is charged per second sent
// and added, on its resolution's two-second row (`seedanceExtendRateCreditId`,
// decided 2026-11-12); every other tail-recipe provider (Seedance 2.0, Kling 4)
// on its own rows (`tailExtendCreditId`); the retired `seedance-2-extend` runs
// as Seedance 2.5 and is priced on its rows. Agreement alone is not enough:
// three producers naming the same UNPRICED id agree too, so every id must be a row.
// ---------------------------------------------------------------------------

const node = (data: Record<string, unknown>): SimpleNode => ({
  id: "n1",
  type: "extend-video",
  data,
})

/** The three producers' ids for one Extend Video request. */
function producers(data: Record<string, unknown>) {
  return {
    route: resolveExtendVideoIdentifier(data),
    run: buildPayload(node({ prompt: "keep going", ...data }), "job-1", { videoUrl: "https://cdn.example.com/source.mp4", kieTaskId: "task-1" }).modelIdentifier,
    estimate: getNodeModelIdentifier({ type: "extend-video", data }),
  }
}

// Unset, under the window, inside both windows, over Seedance 2.0's, over
// Seedance 2.5's, and a string.
const DURATIONS = [undefined, 1, 4, 6, 8, 12, 15, 16, 25, 30, 45, "12"] as const
const RESOLUTIONS = [undefined, "480p", "720p", "1080p", "4k"] as const
// Every tail-recipe provider and every retired id that runs as one of them.
const TAIL_PROVIDERS = [
  ...EXTEND_VIDEO_PROVIDERS.filter(isTailExtendProvider),
  ...Object.keys(RETIRED_VIDEO_PROVIDERS).filter((id) => isTailExtendProvider(RETIRED_VIDEO_PROVIDERS[id])),
]

describe("route, payload builder and estimate name one id for every tail-recipe extend provider × duration × resolution", () => {
  it("Kling 4 and the retired seedance-2-extend are among the providers checked", () => {
    expect(TAIL_PROVIDERS).toContain("kling-4-extend")
    expect(TAIL_PROVIDERS).toContain("seedance-2-extend")
  })

  it.each(TAIL_PROVIDERS)("%s: one priced row, the own row of the provider it runs as", (provider) => {
    const runsAs = canonicalVideoProvider(provider)
    if (!isTailExtendProvider(runsAs)) throw new Error(`${provider} runs as no tail-recipe extend provider`)
    for (const duration of DURATIONS) {
      for (const resolution of RESOLUTIONS) {
        const label = `${provider} ${String(duration)} ${String(resolution)}`
        const ids = producers({ provider, duration, resolution })
        const want = isSeedanceExtendPricedBySecondsSent(runsAs)
          ? seedanceExtendRateCreditId(resolution)
          : tailExtendCreditId(runsAs, duration, resolution)
        expect(ids, label).toEqual({ route: want, run: want, estimate: want })
        expect(STATIC_CREDIT_COSTS[want], label).toBeGreaterThan(0)
        // The workflow run queues exactly the length and resolution it reserved:
        // a stored value the model does not offer (4k, 45 s) never reaches the
        // worker, so the render can never cost more than the row.
        const queued = buildPayload(node({ prompt: "keep going", provider, duration, resolution }), "job-1", { videoUrl: "https://cdn.example.com/source.mp4" }).payload
        expect(queued.duration, label).toBe(tailRecipeSeconds(runsAs, duration))
        expect(queued.resolution, label).toBe(tailExtendResolution(runsAs, resolution))
        if (!isSeedanceExtendPricedBySecondsSent(runsAs)) {
          expect(`${runsAs}:${String(queued.duration)}s:${String(queued.resolution)}`, label).toBe(want)
        }
      }
    }
  })

  it("the retired seedance-2-extend is priced as seedance-2-5-extend, never on a 2.0 row", () => {
    expect(producers({ provider: "seedance-2-extend", duration: 12, resolution: "1080p" })).toEqual({
      route: "seedance-2-5-extend:1080p:per-2s",
      run: "seedance-2-5-extend:1080p:per-2s",
      estimate: "seedance-2-5-extend:1080p:per-2s",
    })
  })

  it("Seedance 2.0 is priced per second added, on its own rows", () => {
    expect(producers({ provider: "seedance-2-0-extend", duration: 6, resolution: "480p" }).run).toBe("seedance-2-0-extend:6s:480p")
    expect(producers({ provider: "seedance-2-0-extend" }).run).toBe("seedance-2-0-extend:8s:720p")
  })

  it("Kling 4 is priced per second added, on its own rows, its 5 s 720p by default", () => {
    expect(producers({ provider: "kling-4-extend" })).toEqual({
      route: "kling-4-extend:5s:720p",
      run: "kling-4-extend:5s:720p",
      estimate: "kling-4-extend:5s:720p",
    })
    expect(producers({ provider: "kling-4-extend", duration: 22, resolution: "1080p" }).run).toBe("kling-4-extend:22s:1080p")
  })
})

// PixVerse V6 is no tail recipe, but its price has the same three producers:
// its own rows (`pixverseExtendCreditId`), one per second added and quality,
// `:audio` with the sound on — on unless turned off.
describe("route, payload builder and estimate name one id for PixVerse V6 × duration × quality × sound", () => {
  const PIXVERSE_DURATIONS = [undefined, 1, 5, 7, 15, 16, 30, "12"] as const
  const PIXVERSE_QUALITIES = [undefined, "360p", "480p", "540p", "720p", "1080p", "4k"] as const
  const SOUNDS = [undefined, true, false] as const

  it("one priced row each, and the run queues exactly what it reserved", () => {
    for (const duration of PIXVERSE_DURATIONS) {
      for (const resolution of PIXVERSE_QUALITIES) {
        for (const generateAudio of SOUNDS) {
          const label = `${String(duration)} ${String(resolution)} ${String(generateAudio)}`
          const data = { provider: "pixverse-v6-extend", duration, resolution, generateAudio }
          const want = pixverseExtendCreditId(duration, resolution, generateAudio)
          expect(producers(data), label).toEqual({ route: want, run: want, estimate: want })
          expect(STATIC_CREDIT_COSTS[want], label).toBeGreaterThan(0)
          const queued = buildPayload(node({ prompt: "keep going", ...data }), "job-1", { videoUrl: "https://cdn.example.com/source.mp4" }).payload
          const sound = queued.generateAudio === false ? "" : ":audio"
          expect(`pixverse-v6-extend:${String(queued.duration)}s:${String(queued.resolution)}${sound}`, label).toBe(want)
        }
      }
    }
  })

  it("480p, which PixVerse V6 does not render, is priced and run at the nearest it does, 540p", () => {
    expect(producers({ provider: "pixverse-v6-extend", duration: 5, resolution: "480p", generateAudio: false })).toEqual({
      route: "pixverse-v6-extend:5s:540p",
      run: "pixverse-v6-extend:5s:540p",
      estimate: "pixverse-v6-extend:5s:540p",
    })
  })

  it("a node that says nothing is priced at 5 s, 720p, with sound", () => {
    expect(producers({ provider: "pixverse-v6-extend" })).toEqual({
      route: "pixverse-v6-extend:5s:720p:audio",
      run: "pixverse-v6-extend:5s:720p:audio",
      estimate: "pixverse-v6-extend:5s:720p:audio",
    })
  })
})

describe("every Extend Video provider is priced on a row, by all three producers alike", () => {
  // The generic video builder names a bare, unpriced id for a provider whose
  // rows it does not know. An Extend Video run priced through it would have no
  // row to reserve and an estimate that falls back to the node-type price.
  const CASES: Array<Record<string, unknown>> = [
    ...EXTEND_VIDEO_PROVIDERS.map((provider) => ({ provider })),
    ...Object.keys(RETIRED_VIDEO_PROVIDERS)
      .filter((id) => (EXTEND_VIDEO_PROVIDERS as readonly string[]).includes(RETIRED_VIDEO_PROVIDERS[id]!))
      .map((provider) => ({ provider })),
    { provider: "veo-extend", model: "quality" },
    { provider: "ltx-2.3-pro", duration: 10 },
    // A node naming no provider runs on the default (VEO), and is quoted so.
    {},
    { model: "quality" },
  ]

  it.each(CASES)("%j", (data) => {
    const ids = producers(data)
    expect(ids.run, "the workflow run reserves what the route reserves").toBe(ids.route)
    expect(ids.estimate, "the estimate quotes what the route reserves").toBe(ids.route)
    expect(STATIC_CREDIT_COSTS[ids.route], ids.route).toBeGreaterThan(0)
  })
})

describe("workflow payload builder — the dispatched payload", () => {
  it("names the provider the run runs as, and carries the node's settings", () => {
    const result = buildPayload(
      node({ provider: "seedance-2-extend", prompt: "keep going", duration: 12, resolution: "1080p" }),
      "job-1",
      { videoUrl: "https://cdn.example.com/source.mp4" },
    )
    expect(result.payload).toMatchObject({
      provider: "seedance-2-5-extend",
      video: "https://cdn.example.com/source.mp4",
      duration: 12,
      resolution: "1080p",
    })
  })
})

describe("workflow payload builder — PixVerse V6", () => {
  it("queues the source, the prompt, the seconds, the quality and the sound it reserved", () => {
    const result = buildPayload(
      node({ provider: "pixverse-v6-extend", prompt: "keep going", duration: 9, resolution: "360p", generateAudio: false }),
      "job-1",
      { videoUrl: "https://cdn.example.com/source.mp4" },
    )
    expect(result.jobName).toBe("extend-video")
    expect(result.modelIdentifier).toBe("pixverse-v6-extend:9s:360p")
    expect(result.payload).toEqual({
      jobId: "job-1",
      provider: "pixverse-v6-extend",
      video: "https://cdn.example.com/source.mp4",
      prompt: "keep going",
      duration: 9,
      resolution: "360p",
      generateAudio: false,
      usageLogId: undefined,
    })
  })

  it.each(["", "ab", "  a  "])("refuses a prompt under 3 characters before anything is reserved (%j)", (prompt) => {
    expect(() =>
      buildPayload(node({ provider: "pixverse-v6-extend", prompt, duration: 5 }), "job-1", { videoUrl: "https://cdn.example.com/source.mp4" }),
    ).toThrow("prompt (what happens next) must be at least 3 characters for pixverse-v6-extend")
  })
})

// Grok extends only its own clips, by the upstream node's task, at the
// SOURCE's resolution: the route holds the source check's row, the workflow
// run the stamp's (node-executor). Before either answers, every producer names
// the dearer 720p row — never a resolution the node or the body names.
describe("route, payload builder and estimate name one id for Grok × duration, before its source is known", () => {
  it("the dearer 720p row at the seconds added, whatever resolution the node names", () => {
    for (const duration of [undefined, 6, 10, 8, 15, "10"] as const) {
      for (const resolution of [undefined, "480p", "720p", "1080p"] as const) {
        const label = `${String(duration)} ${String(resolution)}`
        const want = grokExtendCreditId(duration)
        expect(want, label).toMatch(/^grok-extend:(6|10)s:720p$/)
        expect(producers({ provider: "grok-extend", duration, resolution }), label).toEqual({ route: want, run: want, estimate: want })
        expect(STATIC_CREDIT_COSTS[want], label).toBeGreaterThan(0)
      }
    }
  })
})

describe("workflow payload builder — Grok", () => {
  it("a workflow wires the upstream Grok job's task id", () => {
    // A Grok Imagine generation that ran in this workflow hands its task on, as it does to VEO's extend.
    const gen: SimpleNode = { id: "g", type: "generate-video", data: { provider: "grok-i2v", resolution: "480p" } }
    const ext: SimpleNode = { id: "x", type: "extend-video", data: { provider: "grok-extend", prompt: "the fox runs into the snow", duration: 10 } }
    const states: Record<string, NodeExecutionState> = {
      g: { status: "completed", output: { videoUrl: "https://cdn.example.com/grok.mp4", kieTaskId: "task-grok-src" } },
    }
    const inputs = resolveNodeInputs(ext, [{ id: "g->x", source: "g", target: "x", sourceHandle: "video", targetHandle: "video" }], states, [gen, ext])
    expect(inputs.kieTaskId).toBe("task-grok-src")
    const built = buildPayload(ext, "job-1", inputs)
    expect(built.jobName).toBe("extend-video")
    expect(built.payload).toEqual({
      jobId: "job-1",
      provider: "grok-extend",
      kieTaskId: "task-grok-src",
      prompt: "the fox runs into the snow",
      duration: 10,
      usageLogId: undefined,
    })
    // Recorded as a Grok Extend run, never as the Grok model it extends: an extension is no source to extend again.
    expect(built.payload.provider).toBe("grok-extend")
    // Held on the dearer row until the run's source check answers the source's (node-executor).
    expect(built.modelIdentifier).toBe("grok-extend:10s:720p")
  })

  it("a skipped or frozen upstream Grok node hands on the task its data holds", () => {
    const gen: SimpleNode = { id: "g", type: "generate-video", data: { provider: "grok", kieTaskId: "task-saved" } }
    const ext: SimpleNode = { id: "x", type: "extend-video", data: { provider: "grok-extend", prompt: "keep going" } }
    // Pre-completed from its saved result, which carries the video but not the task.
    const states: Record<string, NodeExecutionState> = { g: { status: "completed", output: { videoUrl: "https://cdn.example.com/grok.mp4" } } }
    const inputs = resolveNodeInputs(ext, [{ id: "g->x", source: "g", target: "x", sourceHandle: "video", targetHandle: "video" }], states, [gen, ext])
    expect(buildPayload(ext, "job-1", inputs).payload.kieTaskId).toBe("task-saved")
  })

  it("an extension wired into a second Grok Extend hands it no task, so the run is refused in the approved words", async () => {
    // An Extend Video node holds its SOURCE's task (as an MCP call writes it) — the task it works on, never its own.
    const gen: SimpleNode = { id: "g", type: "generate-video", data: { provider: "grok-i2v", kieTaskId: "orig-grok-task" } }
    const ext1: SimpleNode = { id: "x1", type: "extend-video", data: { provider: "grok-extend", prompt: "she runs", kieTaskId: "orig-grok-task" } }
    const ext2: SimpleNode = { id: "x2", type: "extend-video", data: { provider: "grok-extend", prompt: "she stops" } }
    const states: Record<string, NodeExecutionState> = {
      g: { status: "completed", output: { videoUrl: "https://cdn.example.com/grok.mp4", kieTaskId: "orig-grok-task" } },
      x1: { status: "completed", output: { videoUrl: "https://cdn.example.com/ext1.mp4" } },
    }
    const inputs = resolveNodeInputs(ext2, [{ id: "x1->x2", source: "x1", target: "x2", sourceHandle: "video", targetHandle: "video" }], states, [gen, ext1, ext2])
    expect(inputs.kieTaskId).toBeUndefined()
    const built = buildPayload(ext2, "job-2", inputs)
    expect(built.payload.kieTaskId).toBeUndefined()
    // The run's source check (node-executor) then refuses it before anything is reserved.
    await expect(stampGrokExtendSource("extend-video", built.payload, "user-1")).resolves.toEqual({
      ok: false,
      refusal: { code: "grok_extend_source", message: GROK_EXTEND_SOURCE_MESSAGE },
    })
  })

  it("queues the seconds it adds — 6 or 10, a length it does not add snapped to the nearer — and no resolution of the node's", () => {
    for (const [duration, want] of [[undefined, 6], [6, 6], [10, 10], [8, 6], [9, 10], [15, 10], ["10", 10]] as const) {
      const built = buildPayload(node({ provider: "grok-extend", prompt: "keep going", duration, resolution: "480p" }), "job-1", { kieTaskId: "t" })
      expect(built.payload.duration, String(duration)).toBe(want)
      expect(built.payload, String(duration)).not.toHaveProperty("resolution")
    }
  })

  it("refuses a run with no prompt before anything is reserved", () => {
    expect(() => buildPayload(node({ provider: "grok-extend", prompt: "  " }), "job-1", { kieTaskId: "t" })).toThrow(
      "prompt (what happens next) is required for grok-extend",
    )
  })
})

// An upstream task goes only to a node that works on that model's task: a VEO
// upscale wired to another model's clip gets none and keeps its build-time
// refusal (nothing reserved); wired to a VEO clip it gets the clip's task.
describe("workflow payload builder — VEO upscale's upstream task", () => {
  const upscale: SimpleNode = { id: "u", type: "video-upscale", data: { provider: "veo-1080p", label: "Upscale Video" } }
  const wire = [{ id: "g->u", source: "g", target: "u", sourceHandle: "video", targetHandle: "video" }]
  const run = (provider: string) => {
    const gen: SimpleNode = { id: "g", type: "generate-video", data: { provider } }
    const states: Record<string, NodeExecutionState> = { g: { status: "completed", output: { videoUrl: "https://cdn.example.com/clip.mp4", kieTaskId: "task-clip" } } }
    return buildPayload(upscale, "job-u", resolveNodeInputs(upscale, wire, states, [gen, upscale]))
  }

  it("wired to a Kling clip: refused at build, with the message that names the fix", () => {
    expect(() => run("kling-3.0")).toThrow(/is set to VEO upscale, which only works on a video generated by VEO earlier in this workflow/)
  })

  it("wired to a VEO clip: the clip's task", () => {
    expect(run("veo3.1").payload).toMatchObject({ provider: "veo-1080p", kieTaskId: "task-clip" })
  })

  it("wired to a VEO extension that ran: the extension's own output task, never the task it extended", () => {
    const ext: SimpleNode = { id: "x", type: "extend-video", data: { provider: "veo-extend", kieTaskId: "orig-veo-task" } }
    const states: Record<string, NodeExecutionState> = { x: { status: "completed", output: { videoUrl: "https://cdn.example.com/ext.mp4", kieTaskId: "task-ext1" } } }
    const edges = [{ id: "x->u", source: "x", target: "u", sourceHandle: "video", targetHandle: "video" }]
    expect(buildPayload(upscale, "job-u", resolveNodeInputs(upscale, edges, states, [ext, upscale])).payload).toMatchObject({ provider: "veo-1080p", kieTaskId: "task-ext1" })
  })
})

// A VEO or Runway extend with no task is refused at build — before anything is
// held — in the words the editor uses; and a node never runs against its own old
// output: wired to a source that fits, it takes that source's task or none.
describe("workflow payload builder — a VEO or Runway extend's task", () => {
  const NO_SOURCE = /^video_required: Node "Extend Video": no source generation found upstream\. Connect a VEO or Runway video node\.$/
  const ext = (data: Record<string, unknown>): SimpleNode => ({ id: "x", type: "extend-video", data: { label: "Extend Video", prompt: "keep going", ...data } })
  const build = (target: SimpleNode, nodes: SimpleNode[], edges: SimpleEdge[], states: Record<string, NodeExecutionState> = {}) =>
    buildPayload(target, "job-x", resolveNodeInputs(target, edges, states, nodes), undefined, { nodes, edges, nodeStates: states })

  it.each(["veo-extend", "runway-extend"])("%s wired to another model's clip (a video, no task) is refused at build, nothing held", (provider) => {
    const target = ext({ provider })
    const kling: SimpleNode = { id: "k", type: "generate-video", data: { provider: "kling-3.0", kieTaskId: "task-kling" } }
    const edges = [{ id: "k->x", source: "k", target: "x", sourceHandle: "video", targetHandle: "video" }]
    expect(() => build(target, [kling, target], edges, { k: { status: "completed", output: { videoUrl: "https://k.mp4", kieTaskId: "task-kling" } } })).toThrow(NO_SOURCE)
  })

  it.each(["veo-extend", "runway-extend"])("%s with nothing wired and no task is refused at build too (no video and no task)", (provider) => {
    const target = ext({ provider })
    expect(() => build(target, [target], [])).toThrow(/^video_required: /)
  })

  it("wired to a VEO generation that recorded no task, it never runs against its own old output", () => {
    // A saved node whose kieTaskId an old server run overwrote with its own output.
    const target = ext({ provider: "veo-extend", kieTaskId: "task-own-old" })
    const gen: SimpleNode = { id: "g", type: "generate-video", data: { provider: "veo3.1" } }
    const edges = [{ id: "g->x", source: "g", target: "x", sourceHandle: "video", targetHandle: "video" }]
    expect(() => build(target, [gen, target], edges, { g: { status: "completed", output: { videoUrl: "https://g.mp4" } } })).toThrow(NO_SOURCE)
    // Wired to one that has its task: that task, not its own.
    const withTask: SimpleNode = { id: "g", type: "generate-video", data: { provider: "veo3.1", kieTaskId: "task-gen" } }
    expect(build(target, [withTask, target], edges, { g: { status: "completed", output: { videoUrl: "https://g.mp4" } } }).payload.kieTaskId).toBe("task-gen")
  })

  it("unwired, it runs on the task it holds (an MCP call's)", () => {
    const target = ext({ provider: "veo-extend", kieTaskId: "task-mcp" })
    expect(build(target, [target], []).payload.kieTaskId).toBe("task-mcp")
  })

  it("a saved chain: a VEO extend after an extension whose task an old server run overwrote continues that extension", () => {
    const gen: SimpleNode = { id: "g", type: "generate-video", data: { provider: "veo3.1", kieTaskId: "task-gen" } }
    const first = ext({ provider: "veo-extend", kieTaskId: "task-ext1-old" })
    const second: SimpleNode = { id: "y", type: "extend-video", data: { label: "Extend Video", provider: "veo-extend", prompt: "and more" } }
    const edges = [
      { id: "g->x", source: "g", target: "x", sourceHandle: "video", targetHandle: "video" },
      { id: "x->y", source: "x", target: "y", sourceHandle: "video", targetHandle: "video" },
    ]
    const states: Record<string, NodeExecutionState> = { x: { status: "completed", output: { videoUrl: "https://e.mp4" } } }
    expect(build(second, [gen, first, second], edges, states).payload.kieTaskId).toBe("task-ext1-old")
  })
})

// An extension saved before outputs were recorded apart, wired to no source
// that fits (an MCP-built node), holding its own old output in `kieTaskId`: the
// server's run reads it from the database (lib/legacy-extension-output.ts) —
// its output handed on, its own run on the task it really extended.
describe("workflow run — an MCP-built extension whose task an old server run overwrote", () => {
  const ext = (id: string, data: Record<string, unknown>): SimpleNode => ({ id, type: "extend-video", data: { label: "Extend Video", provider: "veo-extend", prompt: "keep going", ...data } })
  const USER = "user-a"
  const WORKFLOW = "wf-1"
  /** The run's jobs: the legacy node's own completed extension in this workflow (it extended `task-gen` and made `task-ext-own`). */
  const ownExtension: LegacyOutputJob = { userId: USER, status: "completed", jobType: "extend-video", taskId: "task-ext-own", nodeId: "x", workflowId: WORKFLOW, inputTask: "task-gen", deletedAt: null }
  const read = (nodes: SimpleNode[], edges: SimpleEdge[], jobs: LegacyOutputJob[]) =>
    withLegacyExtensionOutputs(nodes, edges, { userId: USER, workflowId: WORKFLOW }, { fetchJobs: async () => jobs }) as Promise<SimpleNode[]>
  const build = (target: SimpleNode, nodes: SimpleNode[], edges: SimpleEdge[], states: Record<string, NodeExecutionState> = {}) =>
    buildPayload(target, `job-${target.id}`, resolveNodeInputs(target, edges, states, nodes), undefined, { nodes, edges, nodeStates: states })
  // Refused at build, before anything is held (no video and no task to run on).
  const NO_SOURCE = /^video_required: /

  it("a VEO extend wired after it receives its own output task", async () => {
    // It ran before and does not run again in this run (Run from here on the next one): seeded from its saved video, no task.
    const legacy = ext("x", { kieTaskId: "task-ext-own", generatedVideoUrl: "https://cdn.example.com/ext-old.mp4" })
    const next = ext("y", { prompt: "and more" })
    const edges = [{ id: "x->y", source: "x", target: "y", sourceHandle: "video", targetHandle: "video" }]
    const seeded: Record<string, NodeExecutionState> = { x: { status: "completed", output: { videoUrl: "https://cdn.example.com/ext-old.mp4" } } }
    // As stored, the graph alone reads the task as the legacy node's input: nothing is handed on.
    expect(() => build(next, [legacy, next], edges, seeded)).toThrow(NO_SOURCE)
    const nodes = await read([legacy, next], edges, [ownExtension])
    expect(build(nodes[1]!, nodes, edges, seeded).payload.kieTaskId).toBe("task-ext-own")
  })

  it("the legacy node run again extends the task it extended, never its own old output", async () => {
    const legacy = ext("x", { kieTaskId: "task-ext-own" })
    expect(build(legacy, [legacy], []).payload.kieTaskId).toBe("task-ext-own")
    const [read1] = await read([legacy], [], [ownExtension])
    expect(build(read1!, [read1!], []).payload.kieTaskId).toBe("task-gen")
  })

  it("one that ran again since (newest output recorded apart, older output still in kieTaskId) runs on its input and hands on its newest output", async () => {
    const legacy = ext("x", { kieTaskId: "task-ext-own", outputKieTaskId: "task-ext-newest", generatedVideoUrl: "https://cdn.example.com/ext-new.mp4" })
    const next = ext("y", { prompt: "and more" })
    const edges = [{ id: "x->y", source: "x", target: "y", sourceHandle: "video", targetHandle: "video" }]
    // As stored, it would run again on its older output.
    expect(build(legacy, [legacy, next], edges).payload.kieTaskId).toBe("task-ext-own")
    const nodes = await read([legacy, next], edges, [ownExtension])
    expect(build(nodes[0]!, nodes, edges).payload.kieTaskId).toBe("task-gen")
    const seeded: Record<string, NodeExecutionState> = { x: { status: "completed", output: { videoUrl: "https://cdn.example.com/ext-new.mp4" } } }
    expect(build(nodes[1]!, nodes, edges, seeded).payload.kieTaskId).toBe("task-ext-newest")
  })

  it("a saved task that is a generation's (the node's input) is unchanged: it runs on it and hands nothing on", async () => {
    const mcp = ext("x", { kieTaskId: "task-gen" })
    const next = ext("y", { prompt: "and more" })
    const edges = [{ id: "x->y", source: "x", target: "y", sourceHandle: "video", targetHandle: "video" }]
    // The jobs behind `task-gen`: its generation, and a VEO 1080p upscale of it (whose provider task is that same input).
    const jobs: LegacyOutputJob[] = [
      { userId: USER, status: "completed", jobType: "generate-video", taskId: "task-gen", nodeId: "g", workflowId: WORKFLOW, inputTask: null, deletedAt: null },
      { userId: USER, status: "completed", jobType: "video-upscale", taskId: "task-gen", nodeId: "u", workflowId: WORKFLOW, inputTask: "task-gen", deletedAt: null },
    ]
    const nodes = await read([mcp, next], edges, jobs)
    expect(nodes[0]).toBe(mcp)
    expect(build(nodes[0]!, nodes, edges).payload.kieTaskId).toBe("task-gen")
    expect(() => build(nodes[1]!, nodes, edges)).toThrow(NO_SOURCE)
  })
})

/** The base credits a Seedance 2.5 extend is charged on a source of `sourceSec` (undefined: not known), as every lane reads it. */
const charge25 = (duration: unknown, resolution: unknown, sourceSec: number | undefined): number => {
  const price = seedanceExtendPrice({ duration, resolution, sourcePictureSec: sourceSec })
  return quoteBaseCredits(STATIC_CREDIT_COSTS[price.rateId]!, price.units)
}

describe("workflow estimate — the quote the user is shown", () => {
  it("Seedance 2.0's default run (8 s, 720p) is quoted at its own row", () => {
    expect(CreditsService.estimateWorkflowBaseCredits([
      { type: "extend-video", data: { provider: "seedance-2-0-extend" } },
    ])).toBe(STATIC_CREDIT_COSTS["seedance-2-0-extend:8s:720p"])
  })

  // No source wired (or one not made yet): the whole 10 s window, the most a run sends.
  it("Seedance 2.5 with no known source is quoted at the whole 10 s window: (10 + 8) ÷ 2 of the 720p row", () => {
    expect(CreditsService.estimateWorkflowBaseCredits([
      { type: "extend-video", data: { provider: "seedance-2-5-extend" } },
    ])).toBe(1710)
    expect(charge25(undefined, undefined, undefined)).toBe(1710)
  })

  it("a stored node on the retired id is quoted as Seedance 2.5", () => {
    expect(CreditsService.estimateWorkflowBaseCredits([
      { type: "extend-video", data: { provider: "seedance-2-extend", duration: 12, resolution: "1080p" } },
    ])).toBe(charge25(12, "1080p", undefined))
  })

  // The source an upload gives (its measured length): the estimate counts
  // min(10, it), exactly what the route holds for it and the worker settles.
  it.each([2, 4, 6.04, 10, 25])("a %s s upload, 8 s added at 720p: the estimate is the charge", (sec) => {
    const nodes = [
      { id: "u", type: "upload-video", data: { url: "https://cdn.example.com/u.mp4", duration: sec, videoDurationSec: sec } },
      { id: "x", type: "extend-video", data: { provider: "seedance-2-5-extend", duration: 8, resolution: "720p" } },
    ]
    const edges = [{ source: "u", target: "x", targetHandle: "video" }]
    expect(CreditsService.estimateWorkflowBaseCredits(nodes, edges)).toBe(charge25(8, "720p", sec))
  })

  it("a generation that has made its video is read at the length it recorded; one not made yet, or run again, at the whole window", () => {
    const gen = (data: Record<string, unknown>) => [
      { id: "g", type: "generate-video", data: { provider: "seedance-2-5", duration: 5, ...data } },
      { id: "x", type: "extend-video", data: { provider: "seedance-2-5-extend", duration: 8, resolution: "720p" } },
    ]
    const edges = [{ source: "g", target: "x", targetHandle: "video" }]
    const extendOnly = (nodes: ReturnType<typeof gen>) => CreditsService.estimateWorkflowBaseCredits(nodes, edges) - CreditsService.estimateWorkflowBaseCredits([nodes[0]!])
    const made = gen({ generatedResults: [{ url: "https://cdn.example.com/g.mp4", duration: 5.04 }], activeResultIndex: 0 })
    // Only the extend runs: the generation hands on the video it made, at the length it recorded.
    expect(CreditsService.estimateWorkflowBaseCredits(made, edges, { runNodeIds: new Set(["x"]) })).toBe(charge25(8, "720p", 5.04))
    // The whole graph runs: the generation makes a new video, of a length not known yet — the whole window.
    expect(extendOnly(made)).toBe(charge25(8, "720p", undefined))
    // Recorded at a whole 8 s, its picture measured at 8.04 s by the run: the quote is exactly the charge.
    const made8 = gen({ duration: 8, generatedResults: [{ url: "https://cdn.example.com/g8.mp4", duration: 8 }], activeResultIndex: 0 })
    expect(CreditsService.estimateWorkflowBaseCredits(made8, edges, { runNodeIds: new Set(["x"]) })).toBe(charge25(8, "720p", 8.04))
    // Not made yet, at a set length or at Auto: the whole window.
    expect(extendOnly(gen({}))).toBe(charge25(8, "720p", undefined))
    expect(extendOnly(gen({ duration: -1 }))).toBe(charge25(8, "720p", undefined))
  })

  // The brief's brute force, through the real estimator: for every source
  // length from 1.8 s to 60 s (tenths), seconds added and resolution, a known
  // upload is quoted exactly the charge (the route's hold on that measured
  // length, `seedanceExtendBaseCredits` = the row × the units, rounded up
  // once), and a generation not made yet is never quoted below it.
  it("brute force through the run estimate: an upload is quoted its charge, a generation not made yet never below it", () => {
    const ADDED = [4, 8, 15, 22, 30]
    const RES = ["480p", "720p", "1080p"] as const
    const unmade = new Map<string, number>()
    for (const duration of ADDED) {
      for (const resolution of RES) {
        unmade.set(`${duration}:${resolution}`, CreditsService.estimateWorkflowBaseCredits([
          { id: "g", type: "generate-video", data: { provider: "seedance-2-5", duration: 5 } },
          { id: "x", type: "extend-video", data: { provider: "seedance-2-5-extend", duration, resolution } },
        ], [{ source: "g", target: "x", targetHandle: "video" }], { runNodeIds: new Set(["x"]) }))
      }
    }
    let cases = 0
    for (let tenths = 18; tenths <= 600; tenths++) {
      const sec = tenths / 10
      for (const duration of ADDED) {
        for (const resolution of RES) {
          const charge = charge25(duration, resolution, sec)
          const quote = CreditsService.estimateWorkflowBaseCredits([
            { id: "u", type: "upload-video", data: { url: "https://cdn.example.com/u.mp4", duration: sec, videoDurationSec: sec } },
            { id: "x", type: "extend-video", data: { provider: "seedance-2-5-extend", duration, resolution } },
          ], [{ source: "u", target: "x", targetHandle: "video" }])
          if (quote !== charge) throw new Error(`${sec} s + ${duration} s at ${resolution}: quote ${quote}, charge ${charge}`)
          if (unmade.get(`${duration}:${resolution}`)! < charge) throw new Error(`unmade ${sec} s + ${duration} s at ${resolution}`)
          cases++
        }
      }
    }
    expect(cases).toBe(583 * 5 * 3)
  })
})
