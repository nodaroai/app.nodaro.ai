import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * A `view` answer that reaches a canvas while a Run is still waiting on its
 * confirm dialog (T97). Every Run awaits that dialog before it marks any node,
 * so nothing on the canvas shows a run yet and the canvas freezes at once. A
 * node's own Run used to carry on regardless: the node was marked `pending` on
 * the frozen canvas, every write the run made was a no-op, and the job it
 * still created was paid for while its result was dropped.
 *
 * Its own file because the dialog only opens on a credits edition with an
 * estimate over the line, and mocking that would change the paths the other
 * `workflow-viewer-mode-*` files drive. Otherwise the real thing: the real
 * store, the real `applyWorkflowAccess`, the real Run handlers, and for a
 * node's own Run the real `executeNode` down to `pollJobWithNodeUpdate`. Only
 * the network is mocked.
 */

const h = vi.hoisted(() => ({
  /** Every job a run created, in order: each one is paid for. */
  created: [] as string[],
  jobs: {} as Record<string, { status: string; output_data?: Record<string, unknown> }>,
}))

/** The image a job hands back when it completes. */
const url = (jobId: string) => `https://cdn/${jobId}.png`

/** The create request a node's own Run makes: a new job id. */
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
  getJobStatusLean: vi.fn(async (jobId: string) => ({ id: jobId, ...(h.jobs[jobId] ?? { status: "processing" }) })),
  getExecutionEstimate: vi.fn(async () => ({ estimatedMs: 0 })),
  cancelJob: vi.fn(async () => ({})),
  getUserCredits: vi.fn(async () => ({ data: { total: 1_000_000_000, tier: "pro" } })),
  generateImage: vi.fn(() => createJob()),
  // The whole-workflow runs start on the server. Refused here, so a Run that
  // got as far as asking would roll back instead of opening a stream.
  runWorkflow: vi.fn(async () => {
    throw new Error("refused")
  }),
}))

// The confirm dialog opens for a single node only on a credits edition, and
// only for an estimate over the line.
vi.mock("@/lib/edition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/edition")>()),
  hasCredits: () => true,
}))
vi.mock("@/components/editor/workflow-editor/estimate-run-credits", () => ({
  estimateRunCredits: vi.fn(),
}))

import { toast } from "sonner"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { applyWorkflowAccess, showsARunInFlight } from "@/hooks/workflow-access-mode"
import { isSaveRefused } from "@/hooks/workflow-save-refusal"
import { getWorkflowAccess, runWorkflow } from "@/lib/api"
import type { WorkflowAccessInfo } from "@/lib/api"
import { estimateRunCredits } from "@/components/editor/workflow-editor/estimate-run-credits"
import { pollJobWithNodeUpdate } from "@/components/editor/workflow-editor/poll-job"
import {
  handleRun,
  handleRunFromHere,
  handleRunSelected,
  handleRunSingleNode,
  RUN_CONFIRM_CREDITS,
} from "@/components/editor/workflow-editor/run-handlers"
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

function ctx(confirmRun?: ExecutionContext["confirmRun"]): ExecutionContext {
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
    ...(confirmRun ? { confirmRun } : {}),
  }
}

/** A confirm dialog the person has not answered yet. */
function heldConfirm() {
  let press: (run: boolean) => void = () => {}
  const confirmRun = vi.fn(() => new Promise<boolean>((resolve) => { press = resolve }))
  return { confirmRun, press: (run: boolean) => press(run) }
}

function node(id: string, extra: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id,
    type: "generate-image",
    position: { x: 0, y: 0 },
    data: { label: id, prompt: "a red fox in snow" },
    ...extra,
  } as unknown as WorkflowNode
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
const noneInFlight = () => !useWorkflowStore.getState().nodes.some(showsARunInFlight)

function complete(jobId: string) {
  h.jobs[jobId] = { status: "completed", output_data: { imageUrl: url(jobId) } }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  h.created.length = 0
  for (const id of Object.keys(h.jobs)) delete h.jobs[id]
  vi.mocked(estimateRunCredits).mockReturnValue(RUN_CONFIRM_CREDITS + 1)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("a Run still waiting on its confirm dialog when the canvas turns read-only", () => {
  it("a node's own Run does not start: no job is created and the node is not left pending", async () => {
    openAsEditor([node("n1")])
    const dialog = heldConfirm()
    const setIsRunning = vi.fn()

    const click = handleRunSingleNode("n1", ctx(dialog.confirmRun), "p1", vi.fn(async () => {}), setIsRunning, { current: new Set() })
    await vi.advanceTimersByTimeAsync(0)
    // The dialog is up, and nothing on the canvas shows a run yet.
    expect(dialog.confirmRun).toHaveBeenCalledTimes(1)
    expect(noneInFlight()).toBe(true)

    // So the `view` answer freezes the canvas at once.
    await lowerToView()
    expect(isFrozen()).toBe(true)

    // The dialog is still open, and the person presses Run in it.
    dialog.press(true)
    await click
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)

    expect(h.created).toEqual([])
    expect(dataOf("n1").executionStatus).toBeUndefined()
    expect(noneInFlight()).toBe(true)
    expect(setIsRunning).not.toHaveBeenCalledWith(true)
    expect(toast.error).toHaveBeenCalledWith(READ_ONLY_REASON)
  })

  it("with no downgrade, the same Run creates its job and lands its result", async () => {
    // The control: the case above reaches the job and stops short of it only
    // because the canvas froze.
    openAsEditor([node("n1")])
    const dialog = heldConfirm()

    const click = handleRunSingleNode("n1", ctx(dialog.confirmRun), "p1", vi.fn(async () => {}), vi.fn(), { current: new Set() })
    await vi.advanceTimersByTimeAsync(0)
    dialog.press(true)
    await click
    await vi.advanceTimersByTimeAsync(0)
    expect(h.created).toEqual(["job-0"])
    expect(dataOf("n1").currentJobId).toBe("job-0")

    complete("job-0")
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(dataOf("n1")).toMatchObject({ executionStatus: "completed", generatedImageUrl: url("job-0") })
    expect(isFrozen()).toBe(false)
  })

  // The three Runs that start on the server. The server refuses a `view`
  // reader's run and the canvas rolls back, so no result is at stake here;
  // they ask the same question so all four behave alike.
  it.each([
    ["Run (the whole workflow)", (c: ExecutionContext, setIsRunning: (v: boolean) => void) => handleRun(c, "p1", WF, vi.fn(async () => {}), setIsRunning)],
    ["Run from here", (c: ExecutionContext, setIsRunning: (v: boolean) => void) => handleRunFromHere("n1", c, "p1", vi.fn(async () => {}), setIsRunning)],
    ["Run selected", (c: ExecutionContext, setIsRunning: (v: boolean) => void) => handleRunSelected(c, "p1", vi.fn(async () => {}), setIsRunning)],
  ])("%s does not start either: nothing is asked of the server and no node is left pending", async (_run, start) => {
    openAsEditor([node("n1", { selected: true }), node("n2", { selected: true })])
    const dialog = heldConfirm()
    const setIsRunning = vi.fn()

    const click = start(ctx(dialog.confirmRun), setIsRunning)
    await vi.advanceTimersByTimeAsync(0)
    expect(dialog.confirmRun).toHaveBeenCalledTimes(1)

    await lowerToView()
    expect(isFrozen()).toBe(true)

    dialog.press(true)
    await click

    expect(runWorkflow).not.toHaveBeenCalled()
    expect(dataOf("n1").executionStatus).toBeUndefined()
    expect(dataOf("n2").executionStatus).toBeUndefined()
    expect(setIsRunning).not.toHaveBeenCalledWith(true)
    expect(toast.error).toHaveBeenCalledWith(READ_ONLY_REASON)
  })

  it("a Run confirmed while the freeze still waits for another node's run goes ahead, and holds the freeze until its own result lands", async () => {
    // Only a canvas already read-only stops a Run. One whose saves are refused
    // while its freeze waits for the runs out still runs: the new run's own
    // marks hold the freeze back, so its result lands like any other.
    openAsEditor([node("n0"), node("n1")])
    const run0 = pollJobWithNodeUpdate("n0", createJob, "generatedImageUrl", "Image generation", ctx())
    await vi.advanceTimersByTimeAsync(0)
    expect(dataOf("n0").currentJobId).toBe("job-0")

    const dialog = heldConfirm()
    const click = handleRunSingleNode("n1", ctx(dialog.confirmRun), "p1", vi.fn(async () => {}), vi.fn(), { current: new Set() })
    await vi.advanceTimersByTimeAsync(0)

    await lowerToView()
    expect(isFrozen()).toBe(false)

    dialog.press(true)
    await click
    await vi.advanceTimersByTimeAsync(0)
    expect(h.created).toEqual(["job-0", "job-1"])
    expect(dataOf("n1").currentJobId).toBe("job-1")

    // The first run lands; the second still holds the freeze back.
    complete("job-0")
    await vi.advanceTimersByTimeAsync(POLL_MS)
    await run0
    expect(dataOf("n0")).toMatchObject({ executionStatus: "completed", generatedImageUrl: url("job-0") })
    expect(isFrozen()).toBe(false)

    complete("job-1")
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(dataOf("n1")).toMatchObject({ executionStatus: "completed", generatedImageUrl: url("job-1") })
    expect(dataOf("n1").currentJobId).toBeUndefined()
    expect(isFrozen()).toBe(true)
    expect(useWorkflowStore.getState().readOnlyReason).toBe(READ_ONLY_REASON)
  })
})
