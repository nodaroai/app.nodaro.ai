import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * A `view` answer that reaches a canvas while a run is out (T97). The
 * controller's ruling of 2026-10-05: the record and the refusal of saves apply
 * at once, and read-only waits until NO node shows any running state, because
 * `updateNodeData` does nothing on a read-only canvas and would drop the
 * result of a job already paid for.
 *
 * Each case below drives the real thing: the real store, the real
 * `applyWorkflowAccess`, and the real executor or painter that owns the run.
 * Only the network is mocked. The fan-out case (a Run over a list) has its own
 * file, `workflow-viewer-mode-fan-out.test.ts`.
 */

const h = vi.hoisted(() => ({
  /** Every job a run created, in order: each one is paid for. */
  created: [] as string[],
  jobs: {} as Record<string, { status: string; output_data?: Record<string, unknown> }>,
  /** From the moment it is set, every job completes the first time it is asked about. */
  autoComplete: false,
}))

/** The image a job hands back when it completes. */
const url = (jobId: string) => `https://cdn/${jobId}.png`

/** The create request every paid run makes: a new job id. */
async function createJob(): Promise<{ jobId: string }> {
  const jobId = `job-${h.created.length}`
  h.created.push(jobId)
  return { jobId }
}

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getWorkflowAccess: vi.fn(),
  getJobStatusLean: vi.fn(async (jobId: string) => {
    if (h.autoComplete && !h.jobs[jobId]) return { id: jobId, status: "completed", output_data: { imageUrl: url(jobId) } }
    return { id: jobId, ...(h.jobs[jobId] ?? { status: "processing" }) }
  }),
  getExecutionEstimate: vi.fn(async () => ({ estimatedMs: 0 })),
  cancelJob: vi.fn(async () => ({})),
  generateCharacterAsset: vi.fn(() => createJob()),
  generateObjectAsset: vi.fn(() => createJob()),
  generateLocationAsset: vi.fn(() => createJob()),
  generateImage: vi.fn(() => createJob()),
}))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { applyWorkflowAccess, showsARunInFlight } from "@/hooks/workflow-access-mode"
import { isSaveRefused } from "@/hooks/workflow-save-refusal"
import { getWorkflowAccess } from "@/lib/api"
import type { WorkflowAccessInfo } from "@/lib/api"
import { pollJobWithNodeUpdate } from "@/components/editor/workflow-editor/poll-job"
import {
  handleGenerateCharacterAsset,
  handleGenerateObjectAsset,
  handleGenerateLocationAsset,
} from "@/components/editor/workflow-editor/asset-executors"
import { paintRunStates, type NodeExecutionState } from "@/components/editor/workflow-editor/run-handlers"
import { handleGenerateSceneImage } from "@/components/editor/workflow-editor/scene-story-handlers"
import type { ExecutionContext } from "@/components/editor/workflow-editor/types"
import type { WorkflowNode } from "@/types/nodes"

const WF = "wf-1"
const POLL_MS = 2000
const READ_ONLY_REASON = "This workflow is read-only for you."

function viewAnswer(): WorkflowAccessInfo {
  return {
    access: "view",
    workspaceId: null,
    visibility: "private",
    canChangeVisibility: false,
    canShare: false,
    canRun: false,
  }
}

function ctx(): ExecutionContext {
  return {
    userId: "u1",
    projectId: "p1",
    trackInterval: (interval) => interval,
    untrackInterval: (interval) => clearInterval(interval),
    save: vi.fn(),
    setIsRunning: vi.fn(),
    isWorkflowStale: () => false,
    isStorageError: () => false,
    setShowStorageExceeded: vi.fn(),
    setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(),
    setInsufficientCreditsData: vi.fn(),
  }
}

function node(id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } } as unknown as WorkflowNode
}

/** A canvas its `edit` collaborator has open: loaded, and the load's answer recorded. */
function openAsEditor(nodes: WorkflowNode[]) {
  useWorkflowStore.getState().loadWorkflow(WF, "W", nodes, [])
  useWorkflowStore.setState({ loadedAccess: { workflowId: WF, access: "edit" } })
}

/** A re-check answers `view`: at once the record says so and saves stop. */
async function lowerToView() {
  vi.mocked(getWorkflowAccess).mockResolvedValue({ data: viewAnswer() })
  await applyWorkflowAccess(WF)
  const s = useWorkflowStore.getState()
  expect(s.loadedAccess).toEqual({ workflowId: WF, access: "view" })
  expect(isSaveRefused(s)).toBe(true)
}

const dataOf = (id: string) => useWorkflowStore.getState().nodes.find((n) => n.id === id)!.data as Record<string, unknown>
const isFrozen = () => useWorkflowStore.getState().isReadOnly

function expectFrozen() {
  const s = useWorkflowStore.getState()
  expect(s.isReadOnly).toBe(true)
  expect(s.readOnlyReason).toBe(READ_ONLY_REASON)
}

function complete(jobId: string) {
  h.jobs[jobId] = { status: "completed", output_data: { imageUrl: url(jobId) } }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  h.created.length = 0
  h.autoComplete = false
  for (const id of Object.keys(h.jobs)) delete h.jobs[id]
})

afterEach(() => {
  vi.useRealTimers()
})

describe("what counts as a run in flight", () => {
  it.each([
    ["a job's id", { currentJobId: "job-1" }],
    ["a Run over a list", { __listRunning: true }],
    ["a node queued by a Run (the optimistic flip, or a whole-workflow run's queue)", { executionStatus: "pending" }],
    ["a node running", { executionStatus: "running" }],
    ["a Character's expressions", { expressionStatus: "running" }],
    ["an Object's materials", { materialsStatus: "running" }],
    ["a Location's time of day", { timeOfDayStatus: "running" }],
    ["a scene node's video", { videoExecutionStatus: "running" }],
    ["a script's scene image", { generatedScript: { scenes: [{ imageStatus: "completed" }, { imageStatus: "running" }] } }],
    ["a paid run outside the executors (withRunInFlight)", { __runsInFlight: ["run-1"] }],
  ])("%s", (_mark, data) => {
    expect(showsARunInFlight({ data })).toBe(true)
  })

  it.each([
    ["an idle node", { executionStatus: "idle" }],
    ["a finished node", { executionStatus: "completed", expressionStatus: "completed", currentJobId: undefined }],
    ["a failed node", { executionStatus: "failed", anglesStatus: "failed" }],
    ["a Run over a list that has ended", { __listRunning: false }],
    ["a script whose scene images are done", { generatedScript: { scenes: [{ imageStatus: "completed" }] } }],
    ["a node whose paid runs have all ended", { __runsInFlight: [] }],
    ["a node with no data", undefined],
  ])("not %s", (_mark, data) => {
    expect(showsARunInFlight({ data })).toBe(false)
  })
})

describe("a downgrade while a run is out lands the run's result, and only then freezes the canvas", () => {
  it("a node between its run-start reset and its job's id", async () => {
    // `RUN_START_RESET` clears the node's job id and marks it running before
    // the create request; the answer writes the new id. With the job id the
    // only mark counted, a freeze in between made that write a no-op, and the
    // poll then abandoned the paid result (`shouldAbandonNode`).
    openAsEditor([node("n1", "generate-image")])
    let answer: (created: { jobId: string }) => void = () => {}
    const run = pollJobWithNodeUpdate(
      "n1",
      () => new Promise((resolve) => { answer = resolve }),
      "generatedImageUrl",
      "Image generation",
      ctx(),
    )
    expect(dataOf("n1").executionStatus).toBe("running")
    expect(dataOf("n1").currentJobId).toBeUndefined()

    await lowerToView()
    expect(isFrozen()).toBe(false)

    answer(await createJob())
    await vi.advanceTimersByTimeAsync(0)
    expect(dataOf("n1").currentJobId).toBe("job-0")
    expect(isFrozen()).toBe(false)

    complete("job-0")
    await vi.advanceTimersByTimeAsync(POLL_MS)
    await run
    expect(dataOf("n1")).toMatchObject({ executionStatus: "completed", generatedImageUrl: url("job-0") })
    expect(dataOf("n1").currentJobId).toBeUndefined()
    expectFrozen()
  })

  it("a node a Run has queued, before its executor starts", async () => {
    // A node's own Run button flips it to `pending` at once, then awaits the
    // pre-run save before its executor writes `RUN_START_RESET`. A freeze in
    // that window would make the reset and the job-id write no-ops, while the
    // create request still goes out and is paid for.
    openAsEditor([node("n1", "generate-image")])
    useWorkflowStore.getState().markNodesStatus(["n1"], "pending")

    await lowerToView()
    expect(isFrozen()).toBe(false)

    const run = pollJobWithNodeUpdate("n1", createJob, "generatedImageUrl", "Image generation", ctx())
    await vi.advanceTimersByTimeAsync(0)
    expect(dataOf("n1").currentJobId).toBe("job-0")

    complete("job-0")
    await vi.advanceTimersByTimeAsync(POLL_MS)
    await run
    expect(dataOf("n1")).toMatchObject({ executionStatus: "completed", generatedImageUrl: url("job-0") })
    expectFrozen()
  })

  // The variant buttons run one paid job per variant, through a poll that owns
  // no node, so the node holds no job id and no batch flag: only its own
  // status key, set to `running` for the whole loop. Every button, so a loop
  // whose key the freeze did not count would fail here.
  type VariantHandler = (nodeId: string, assetType: never, ctx: ExecutionContext) => Promise<void>
  const VARIANT_RUNS: ReadonlyArray<{
    readonly button: string
    readonly handler: VariantHandler
    readonly type: string
    readonly name: Record<string, string>
    readonly assetType: string
    readonly statusKey: string
    readonly itemsKey: string
    readonly variants: number
  }> = [
    { button: "Character expressions", handler: handleGenerateCharacterAsset as VariantHandler, type: "character", name: { characterName: "Kira" }, assetType: "expressions", statusKey: "expressionStatus", itemsKey: "expressions", variants: 6 },
    { button: "Character poses", handler: handleGenerateCharacterAsset as VariantHandler, type: "character", name: { characterName: "Kira" }, assetType: "poses", statusKey: "poseStatus", itemsKey: "poses", variants: 4 },
    { button: "Character lighting", handler: handleGenerateCharacterAsset as VariantHandler, type: "character", name: { characterName: "Kira" }, assetType: "lighting", statusKey: "lightingStatus", itemsKey: "lightingVariations", variants: 3 },
    { button: "Character angles", handler: handleGenerateCharacterAsset as VariantHandler, type: "character", name: { characterName: "Kira" }, assetType: "angles", statusKey: "anglesStatus", itemsKey: "angles", variants: 3 },
    { button: "Object angles", handler: handleGenerateObjectAsset as VariantHandler, type: "object", name: { objectName: "Lamp" }, assetType: "angles", statusKey: "anglesStatus", itemsKey: "angles", variants: 5 },
    { button: "Object materials", handler: handleGenerateObjectAsset as VariantHandler, type: "object", name: { objectName: "Lamp" }, assetType: "materials", statusKey: "materialsStatus", itemsKey: "materials", variants: 6 },
    { button: "Object variations", handler: handleGenerateObjectAsset as VariantHandler, type: "object", name: { objectName: "Lamp" }, assetType: "variations", statusKey: "variationsStatus", itemsKey: "variations", variants: 5 },
    { button: "Location time of day", handler: handleGenerateLocationAsset as VariantHandler, type: "location", name: { locationName: "Harbor" }, assetType: "timeOfDay", statusKey: "timeOfDayStatus", itemsKey: "timeOfDay", variants: 6 },
    { button: "Location weather", handler: handleGenerateLocationAsset as VariantHandler, type: "location", name: { locationName: "Harbor" }, assetType: "weather", statusKey: "weatherStatus", itemsKey: "weather", variants: 6 },
    { button: "Location angles", handler: handleGenerateLocationAsset as VariantHandler, type: "location", name: { locationName: "Harbor" }, assetType: "angles", statusKey: "anglesStatus", itemsKey: "angles", variants: 5 },
  ]

  it.each(VARIANT_RUNS)("a variant run: $button", async (run) => {
    openAsEditor([node("e1", run.type, { ...run.name, sourceImageUrl: "https://cdn/main.png" })])
    const urlsOn = () => ((dataOf("e1")[run.itemsKey] ?? []) as Array<{ url: string }>).map((item) => item.url)

    const loop = run.handler("e1", run.assetType as never, ctx())
    await vi.advanceTimersByTimeAsync(0)
    // The first variant's job exists: it is paid for.
    expect(h.created).toEqual(["job-0"])
    expect(dataOf("e1")[run.statusKey]).toBe("running")
    expect(dataOf("e1").currentJobId).toBeUndefined()

    await lowerToView()
    expect(isFrozen()).toBe(false)

    // The first variant lands, and the loop goes on to request the next.
    complete("job-0")
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(urlsOn()).toEqual([url("job-0")])
    expect(isFrozen()).toBe(false)

    h.autoComplete = true
    await vi.advanceTimersByTimeAsync(POLL_MS * (run.variants + 1))
    await loop

    // Every variant it paid for is on the node, in order.
    expect(h.created).toHaveLength(run.variants)
    expect(urlsOn()).toEqual(h.created.map(url))
    expect(dataOf("e1")[run.statusKey]).toBe("completed")
    expectFrozen()
  })

  it("a whole-workflow run", async () => {
    // The orchestrator paints its node states without a job id on the node:
    // running, queued, done. Its results land whatever the canvas mode, but
    // the run is in flight until its last node is done, and read-only waits.
    openAsEditor([node("n1", "generate-image"), node("n2", "generate-image")])
    const paint = (n1: NodeExecutionState, n2: NodeExecutionState) => paintRunStates({ n1, n2 })
    const done = (jobId: string): NodeExecutionState => ({ status: "completed", jobId, output: { imageUrl: url(jobId) } }) as NodeExecutionState
    const running = (jobId: string): NodeExecutionState => ({ status: "running", jobId }) as NodeExecutionState
    const queued = { status: "pending" } as NodeExecutionState

    // What `handleRun` writes the moment Run is clicked: every node queued.
    useWorkflowStore.getState().markNodesStatus(["n1", "n2"], "pending")
    paint(running("job-a"), queued)
    expect(dataOf("n1").currentJobId).toBeUndefined()

    await lowerToView()
    expect(isFrozen()).toBe(false)

    paint(done("job-a"), queued)
    expect(dataOf("n1")).toMatchObject({ executionStatus: "completed", generatedImageUrl: url("job-a") })
    // The second node is still queued.
    expect(isFrozen()).toBe(false)

    paint(done("job-a"), running("job-b"))
    expect(isFrozen()).toBe(false)

    paint(done("job-a"), done("job-b"))
    expect(dataOf("n2")).toMatchObject({ executionStatus: "completed", generatedImageUrl: url("job-b") })
    expectFrozen()
  })

  it("a script's scene image", async () => {
    // Its only mark is the scene's own `imageStatus`, inside the script.
    const script = { title: "T", scenes: [{ sceneName: "Dock", imagePrompt: "a dock at dawn", characters: [] }] }
    openAsEditor([node("s1", "generate-script", { generatedScript: script, generatedResults: [{ script }], activeResultIndex: 0 })])
    const scene = () => (dataOf("s1").generatedScript as { scenes: Array<Record<string, unknown>> }).scenes[0]!

    const run = handleGenerateSceneImage("s1", 0, ctx())
    await vi.advanceTimersByTimeAsync(0)
    expect(h.created).toEqual(["job-0"])
    expect(scene().imageStatus).toBe("running")

    await lowerToView()
    expect(isFrozen()).toBe(false)

    complete("job-0")
    await vi.advanceTimersByTimeAsync(POLL_MS)
    await run
    expect(scene().imageStatus).toBe("completed")
    expect((scene().generatedImages as Array<{ url: string }>).map((image) => image.url)).toEqual([url("job-0")])
    expectFrozen()
  })
})

/**
 * The test reads the marks by convention, not from a list: any status key that
 * reads `running`. So this holds the executors to that convention. Every key an
 * executor writes as `running` onto a node, written literally or looked up in a
 * key map, must be one the test counts; a new loop that marks its run some other
 * way fails here instead of losing its result to a freeze.
 */
describe("every mark an executor writes for a run in flight is one the freeze counts", () => {
  const src = join(__dirname, "..", "..")
  const inDir = (dir: string, keep: (name: string) => boolean) =>
    readdirSync(join(src, dir))
      .filter((name) => /\.tsx?$/.test(name) && !name.includes(".test.") && keep(name))
      .map((name) => join(src, dir, name))
  const files = [
    ...inDir("components/editor/workflow-editor", () => true),
    ...inDir("components/editor/reference-sheet", () => true),
    ...inDir("components/nodes", (name) => name.endsWith("-run-state.ts")),
  ]

  /** The string values of every key map `name` is read from (`const name = map[…]`). */
  function lookedUp(source: string, name: string): string[] {
    const maps = [...source.matchAll(new RegExp(`const\\s+${name}\\s*=\\s*([A-Za-z_$][\\w$]*)\\[`, "g"))].map((m) => m[1]!)
    const values = maps.flatMap((map) =>
      [...source.matchAll(new RegExp(`const\\s+${map}\\b[^=]*=\\s*\\{([^}]*)\\}`, "g"))].flatMap((m) =>
        [...m[1]!.matchAll(/"([^"]+)"/g)].map((v) => v[1]!),
      ),
    )
    // Fails closed: a computed key this scan cannot resolve is not counted.
    return values.length > 0 ? values : [`<unresolved [${name}]>`]
  }

  it("each is counted", () => {
    const written = new Set<string>()
    for (const file of files) {
      const source = readFileSync(file, "utf8")
      for (const m of source.matchAll(/(?:\[\s*([A-Za-z_$][\w$]*)\s*\]|\b([A-Za-z_$][\w$]*))\s*:\s*"running"/g)) {
        // A view model's own discriminant (`*-run-state.ts`), never node data.
        if (m[2] === "kind") continue
        for (const key of m[1] ? lookedUp(source, m[1]) : [m[2]!]) written.add(key)
      }
    }

    // The scan finds the writes it exists for: the run-start reset, the
    // orchestrator's tick, the three variant loops' key maps, the scene image.
    expect([...written]).toEqual(expect.arrayContaining([
      "executionStatus", "expressionStatus", "materialsStatus", "timeOfDayStatus", "imageStatus",
    ]))
    const uncounted = [...written].filter((key) => !showsARunInFlight({ data: { [key]: "running" } }))
    expect(uncounted).toEqual([])
  })
})
