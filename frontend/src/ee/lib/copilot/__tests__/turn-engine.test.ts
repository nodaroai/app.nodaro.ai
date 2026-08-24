/**
 * The engine is where a turn can cost money or lose work, so these tests cover
 * the decisions rather than the plumbing: does it refuse to send over unsaved
 * edits, does it stop when the editor moves to another workflow, does an
 * "auto" run actually respect the ceiling, and does declining a run stay free.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SseHttpError } from "@/lib/sse-client"
import type { CopilotStreamEvent } from "../types"

const streamRequest = vi.fn()
const getAuthHeaders = vi.fn(async () => ({ Authorization: "Bearer test" }))
const createCopilotThread = vi.fn()
const cancelCopilotTurn = vi.fn(async () => ({ cancelled: true }))
const updateCopilotThread = vi.fn()
const ensureCanvasVersion = vi.fn(async () => "realtime" as const)

const setNeedsAutoLayout = vi.fn()

const workflowState = {
  workflowId: "wf-1" as string | null,
  isDirty: false,
  isReadOnly: false,
  loadedVersion: 6 as number | null,
  setNeedsAutoLayout,
}

vi.mock("@/lib/sse-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sse-client")>("@/lib/sse-client")
  return { ...actual, streamRequest: (...args: unknown[]) => streamRequest(...args) }
})
vi.mock("@/lib/api", () => ({ getAuthHeaders: () => getAuthHeaders() }))
vi.mock("@/lib/query-client", () => ({
  queryClient: { setQueryData: vi.fn(), invalidateQueries: vi.fn() },
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => workflowState },
}))
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api")
  return {
    ...actual,
    createCopilotThread: (...a: unknown[]) => createCopilotThread(...a),
    cancelCopilotTurn: () => cancelCopilotTurn(),
    updateCopilotThread: (...a: unknown[]) => updateCopilotThread(...a),
  }
})
vi.mock("../canvas-sync", () => ({
  ensureCanvasVersion: (...a: unknown[]) => ensureCanvasVersion(...(a as [])),
  focusNodes: vi.fn(),
}))

const {
  abandonRunFollow,
  clearRunFollow,
  reportRunOutcome,
  sendCopilotMessage,
  skipProposedRun,
  startProposedRun,
  stopCopilotTurn,
  teardownCopilot,
} = await import("../turn-engine")
const { useCopilotStore } = await import("../turn-store")

function events(list: CopilotStreamEvent[]) {
  streamRequest.mockImplementation(async function* () {
    for (const event of list) yield event
  })
}

const metadata = (runMode: "ask" | "auto", limit: number): CopilotStreamEvent => ({
  type: "metadata",
  data: {
    threadId: "t1",
    turnId: "turn-1",
    jobId: "job-1",
    model: "claude-sonnet-5",
    baseVersion: 6,
    runMode,
    autoRunLimitCredits: limit,
  },
})

const proposal: CopilotStreamEvent = {
  type: "run_proposed",
  data: { workflowId: "wf-1", addedNodeTypes: ["generate-image"], note: null },
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(workflowState, { workflowId: "wf-1", isDirty: false, isReadOnly: false, loadedVersion: 6 })
  useCopilotStore.setState({
    threadId: "thread-1",
    workflowId: "wf-1",
    streaming: false,
    runMode: "ask",
    autoRunLimit: 100,
    runPhase: "idle",
    proposalDismissed: false,
    autoRunCount: 0,
    autoFixChain: 0,
    lastReportedExecutionId: null,
    executionId: null,
    mentions: [],
    draft: "",
    notice: null,
    insufficient: null,
  })
  useCopilotStore.getState().setBridge({
    save: null,
    run: null,
    projectId: "p1",
    creditEstimate: 12,
    estimateStale: false,
    estimateVersion: 6,
    isRunning: false,
    activeExecutionId: null,
  })
  createCopilotThread.mockResolvedValue({
    thread: {
      id: "thread-1",
      workflowId: "wf-1",
      runMode: "ask",
      autoRunLimitCredits: 100,
      userTurnCount: 0,
      lastMessageAt: null,
      createdAt: "now",
    },
    workflow: { id: "wf-1", projectId: "p1", name: "wf", version: 6 },
  })
  events([metadata("ask", 100), { type: "done", data: { turnId: "turn-1", messageId: "m1", status: "completed", finalVersion: 7 } }])
})

describe("the live timer's clock", () => {
  it("stamps the turn with a real send time, which is what the pill counts from", async () => {
    const before = Date.now()
    await sendCopilotMessage("add a video step")
    const startedAt = useCopilotStore.getState().turn.startedAt

    // A placeholder here (0, or the server's clock) shows the user a wildly
    // wrong elapsed time — the one number the pill exists to make trustworthy.
    expect(startedAt).not.toBeNull()
    expect(startedAt!).toBeGreaterThanOrEqual(before)
    expect(startedAt!).toBeLessThanOrEqual(Date.now())
  })
})

describe("the canvas after a build", () => {
  /** A turn that added nodes, the way the stream reports one. */
  const built = (addedNodeIds: string[]): CopilotStreamEvent => ({
    type: "workflow_updated",
    data: {
      workflowId: "wf-1",
      version: 7,
      updatedAt: "now",
      note: null,
      addedNodeIds,
      updatedNodeIds: [],
      removedNodeIds: [],
      addedNodeTypes: ["generate-image"],
      nodeCount: 12,
      edgeCount: 11,
      adjustments: [],
    },
  })

  const done: CopilotStreamEvent = {
    type: "done",
    data: { turnId: "turn-1", messageId: "m1", status: "completed", finalVersion: 7 },
  }

  it("asks for a size-aware layout once it has finished adding nodes", async () => {
    // The server positions new nodes on a fixed grid it cannot size correctly.
    // Only the browser knows the rendered heights, so the browser re-lays it
    // out — otherwise a big build arrives as the overlapping pile the user has
    // to untangle with Tidy Up by hand.
    events([metadata("ask", 100), built(["n1", "n2"]), done])
    await sendCopilotMessage("build me a product shot workflow")
    expect(setNeedsAutoLayout).toHaveBeenCalledWith(true)
  })

  it("still tidies when the LAST stage of a staged build only wired edges", async () => {
    // The doctrine asks a big graph to be written in stages, and the final call
    // is often edges-only. Reading just the last event would skip the layout on
    // exactly the twelve-node builds that need it most.
    events([metadata("ask", 100), built(["n1", "n2"]), built(["n3"]), built([]), done])
    await sendCopilotMessage("build me the whole ad pipeline")
    expect(setNeedsAutoLayout).toHaveBeenCalledWith(true)
  })

  it("leaves a hand-arranged canvas alone when the turn added nothing", async () => {
    events([metadata("ask", 100), built([]), done])
    await sendCopilotMessage("shorten the prompt on the video node")
    expect(setNeedsAutoLayout).not.toHaveBeenCalled()
  })

  it("does not rearrange a workflow the user has already left", async () => {
    events([metadata("ask", 100), built(["n1"]), done])
    const promise = sendCopilotMessage("build it")
    workflowState.workflowId = "wf-2"
    await promise
    expect(setNeedsAutoLayout).not.toHaveBeenCalled()
  })
})

describe("unsaved work", () => {
  it("flushes a dirty canvas before sending, so the copilot never writes over it", async () => {
    const save = vi.fn(async () => {
      workflowState.isDirty = false
      return { success: true }
    })
    workflowState.isDirty = true
    useCopilotStore.getState().setBridge({ save })

    await sendCopilotMessage("add a video step")

    expect(save).toHaveBeenCalledWith("p1")
    expect(streamRequest).toHaveBeenCalledOnce()
  })

  it("refuses to send when the save RESOLVES with a failure — it does not throw one", async () => {
    workflowState.isDirty = true
    useCopilotStore.getState().setBridge({ save: vi.fn(async () => ({ success: false, error: "remote_conflict" })) })

    await sendCopilotMessage("add a video step")

    expect(streamRequest).not.toHaveBeenCalled()
    expect(useCopilotStore.getState().notice).toMatch(/changed somewhere else/i)
  })

  it("refuses to send when the save throws", async () => {
    workflowState.isDirty = true
    useCopilotStore.getState().setBridge({
      save: vi.fn(async () => {
        throw new Error("offline")
      }),
    })

    await sendCopilotMessage("add a video step")

    expect(streamRequest).not.toHaveBeenCalled()
    expect(useCopilotStore.getState().notice).toMatch(/could not save/i)
  })

  it("refuses when the user typed again while the save was in flight", async () => {
    workflowState.isDirty = true
    // Resolves success but leaves the canvas dirty — the user kept editing.
    useCopilotStore.getState().setBridge({ save: vi.fn(async () => ({ success: true })) })

    await sendCopilotMessage("add a video step")

    expect(streamRequest).not.toHaveBeenCalled()
    expect(useCopilotStore.getState().notice).toMatch(/while it was saving/i)
  })

  it("does nothing at all on a read-only workflow", async () => {
    workflowState.isReadOnly = true
    await sendCopilotMessage("add a video step")
    expect(streamRequest).not.toHaveBeenCalled()
  })

  it("ignores a second send while a turn is already streaming", async () => {
    useCopilotStore.setState({ streaming: true })
    await sendCopilotMessage("again")
    expect(streamRequest).not.toHaveBeenCalled()
  })

  it("latches a double Enter that lands before the save has come back", async () => {
    // `streaming` is only raised AFTER the save and the thread handshake, so it
    // cannot be the re-entry guard: both presses would pass it and open two
    // paid turns on one thread.
    let releaseSave: (() => void) | null = null
    workflowState.isDirty = true
    useCopilotStore.getState().setBridge({
      save: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          releaseSave = resolve
        })
        workflowState.isDirty = false
        return { success: true }
      }),
    })

    const first = sendCopilotMessage("build it")
    await vi.waitFor(() => expect(releaseSave).not.toBeNull())
    const second = sendCopilotMessage("build it again")
    releaseSave!()
    await Promise.all([first, second])

    expect(streamRequest).toHaveBeenCalledOnce()
  })
})

describe("the wire message", () => {
  it("carries the base version so the server can reject a stale canvas", async () => {
    await sendCopilotMessage("hello")
    expect(streamRequest.mock.calls[0]?.[1]).toMatchObject({ body: { baseVersion: 6 } })
  })

  it("appends picked mentions as names, never as addresses", async () => {
    useCopilotStore.setState({ mentions: [{ id: "c1", name: "Maya", kind: "character" }] })
    await sendCopilotMessage("put her in the studio")
    const body = streamRequest.mock.calls[0]?.[1] as { body: { message: string } }
    expect(body.body.message).toContain('character "Maya"')
    expect(body.body.message).not.toMatch(/https?:/)
  })
})

describe("the editor's view of a turn", () => {
  it("raises and lowers the shared turn flag the canvas reads", async () => {
    const { useCopilotUiStore } = await import("@/hooks/use-copilot-ui-store")
    let seenDuring = false
    streamRequest.mockImplementation(async function* () {
      yield metadata("ask", 100)
      seenDuring = useCopilotUiStore.getState().turnActive
    })

    await sendCopilotMessage("build it")

    // The canvas hides "add your first node" while nodes are being added for you.
    expect(seenDuring).toBe(true)
    expect(useCopilotUiStore.getState().turnActive).toBe(false)
  })
})

describe("runs", () => {
  it("asks first in Ask mode, even when the estimate is tiny", async () => {
    const run = vi.fn(async () => ({ executionId: "exec-1" }))
    useCopilotStore.getState().setBridge({ run, creditEstimate: 1 })
    events([metadata("ask", 100), proposal])

    await sendCopilotMessage("build it")

    expect(run).not.toHaveBeenCalled()
    expect(useCopilotStore.getState().runPhase).toBe("proposed")
  })

  it("runs on its own in Auto mode when the estimate fits the ceiling", async () => {
    // A run that really starts flips the editor to running; the mock says so too.
    const run = vi.fn(async () => {
      useCopilotStore.getState().setBridge({ isRunning: true, activeExecutionId: "exec-1" })
      return { executionId: "exec-1" }
    })
    useCopilotStore.getState().setBridge({ run, creditEstimate: 12 })
    events([metadata("auto", 100), proposal])

    await sendCopilotMessage("build it")

    // skipConfirm: the proposal card already IS the confirmation.
    expect(run).toHaveBeenCalledWith({ skipConfirm: true })
    expect(useCopilotStore.getState().runPhase).toBe("running")
  })

  it("falls back to asking when the estimate is over the ceiling", async () => {
    const run = vi.fn(async () => ({ executionId: "exec-1" }))
    useCopilotStore.getState().setBridge({ run, creditEstimate: 250 })
    events([metadata("auto", 100), proposal])

    await sendCopilotMessage("build it")

    expect(run).not.toHaveBeenCalled()
    expect(useCopilotStore.getState().runPhase).toBe("proposed")
  })

  it("starts ONE run however many proposals arrive while it is in flight", async () => {
    // One assistant message can carry two run_workflow calls, and the loop
    // dispatches every tool block before ending the turn — so the proposals
    // land a microtask apart, far too fast for the editor's isRunning to have
    // come back. A second execution here is billed, invisible, and unreachable
    // by Stop, which follows only one execution id.
    const run = vi.fn(async () => ({ executionId: "exec-1" }))
    useCopilotStore.getState().setBridge({ run, creditEstimate: 5 })
    events([metadata("auto", 100), proposal, proposal, proposal])

    await sendCopilotMessage("build it")

    expect(run).toHaveBeenCalledTimes(1)
  })

  it("ignores a second click on the card's Run button", () => {
    const run = vi.fn(async () => ({ executionId: "exec-1" }))
    useCopilotStore.getState().setBridge({ run })

    startProposedRun()
    startProposedRun()

    expect(run).toHaveBeenCalledTimes(1)
  })

  it("never starts a run when the editor has not registered one", async () => {
    useCopilotStore.getState().setBridge({ run: null, creditEstimate: 5 })
    events([metadata("auto", 100), proposal])

    await sendCopilotMessage("build it")

    expect(useCopilotStore.getState().runPhase).toBe("proposed")
  })

  it("refuses to auto-run against an estimate it knows is stale", async () => {
    const run = vi.fn(async () => ({ executionId: "exec-1" }))
    // The copilot proposes right after it adds nodes, which is exactly when the
    // editor is refetching model costs — the number on hand is the OLD graph's.
    useCopilotStore.getState().setBridge({ run, creditEstimate: 0, estimateStale: true })
    events([metadata("auto", 100), proposal])

    await sendCopilotMessage("build it")

    expect(run).not.toHaveBeenCalled()
    expect(useCopilotStore.getState().runPhase).toBe("proposed")
  })

  it("does not start a second run while one is already in flight", async () => {
    const run = vi.fn(async () => ({ executionId: "exec-1" }))
    useCopilotStore.getState().setBridge({ run, creditEstimate: 5, isRunning: true })
    events([metadata("auto", 100), proposal])

    await sendCopilotMessage("build it")

    expect(run).not.toHaveBeenCalled()
  })

  it("hands the decision back when the run bails instead of showing Running forever", async () => {
    // The editor SAYS it started nothing. Inferring it from `isRunning` would
    // fail here: the bail's setIsRunning(false) has not been flushed yet, so
    // the mirror still reads true — exactly the insufficient-credits case.
    useCopilotStore.getState().setBridge({
      run: vi.fn(async () => {
        // handleRun flips the editor to running optimistically, THEN bails —
        // and React has not flushed the setIsRunning(false) when we resolve.
        useCopilotStore.getState().setBridge({ isRunning: true })
        return { executionId: null }
      }),
    })

    startProposedRun()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useCopilotStore.getState().runPhase).toBe("proposed")
  })

  it("adopts the execution the editor reports, without waiting for a re-render", async () => {
    useCopilotStore.getState().setBridge({ run: vi.fn(async () => ({ executionId: "exec-7" })) })

    startProposedRun()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useCopilotStore.getState()).toMatchObject({ runPhase: "running", executionId: "exec-7" })
  })

  it("refuses to auto-run against an estimate computed for a different graph", async () => {
    // The copilot just wrote v7; the estimate on hand still describes v6. The
    // boolean flag races here — the version comparison cannot.
    useCopilotStore.getState().setBridge({ run: vi.fn(async () => ({ executionId: "exec-1" })), creditEstimate: 0, estimateVersion: 5 })
    events([metadata("auto", 100), proposal])

    await sendCopilotMessage("build it")

    expect(useCopilotStore.getState().runPhase).toBe("proposed")
  })

  it("declining is free — Skip dismisses locally and sends no message", async () => {
    events([metadata("ask", 100), proposal])
    await sendCopilotMessage("build it")
    streamRequest.mockClear()

    skipProposedRun()
    // Let any accidental fire-and-forget send reach streamRequest before we
    // assert it did not happen — the call sits behind an await.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useCopilotStore.getState().proposalDismissed).toBe(true)
    expect(useCopilotStore.getState().runPhase).toBe("idle")
    expect(streamRequest).not.toHaveBeenCalled()
  })

  it("Run from the card starts the execution without a second confirm dialog", () => {
    const run = vi.fn(async () => ({ executionId: "exec-1" }))
    useCopilotStore.getState().setBridge({ run })
    startProposedRun()
    expect(run).toHaveBeenCalledWith({ skipConfirm: true })
  })
})

describe("the unattended fix loop", () => {
  // A turn takes a few microtasks to drain; the chain only advances once the
  // previous one has settled, exactly as it would in the browser.
  const settle = async () => {
    await vi.waitFor(() => expect(useCopilotStore.getState().streaming).toBe(false))
  }
  beforeEach(() => {
    useCopilotStore.setState({ runMode: "auto" })
    // The stream reports the server-side mode back on every turn; without this
    // the first auto-fix would flip the client to Ask and end the chain.
    events([
      metadata("auto", 100),
      { type: "done", data: { turnId: "turn-1", messageId: "m1", status: "completed", finalVersion: 7 } },
    ])
  })

  it("continues on its own after a failure — that is the loop the feature exists for", async () => {
    reportRunOutcome("exec-1", "failed")
    await settle()
    expect(streamRequest).toHaveBeenCalledOnce()
  })

  it("says nothing after a success — a paid turn to confirm it worked buys nothing", async () => {
    reportRunOutcome("exec-1", "succeeded")
    await settle()
    expect(streamRequest).not.toHaveBeenCalled()
    expect(useCopilotStore.getState().runPhase).toBe("succeeded")
  })

  it("stops after two attempts instead of chaining paid turns forever", async () => {
    // Each auto "Fix it" opens a NEW turn, which resets the per-turn run cap —
    // so the chain, not that cap, is what bounds unattended spend.
    for (let i = 1; i <= 3; i += 1) {
      reportRunOutcome(`exec-${i}`, "failed")
      await settle()
    }

    expect(streamRequest).toHaveBeenCalledTimes(2)
    expect(useCopilotStore.getState().notice).toMatch(/auto-fix stopped/i)
  })

  it("a message the user sent themselves reopens the budget", async () => {
    for (let i = 1; i <= 3; i += 1) {
      reportRunOutcome(`exec-${i}`, "failed")
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    streamRequest.mockClear()

    await sendCopilotMessage("try a different model")
    reportRunOutcome("exec-9", "failed")
    await settle()

    expect(streamRequest).toHaveBeenCalledTimes(2)
  })

  it("reports one execution once, however many times the panel remounts", async () => {
    reportRunOutcome("exec-1", "failed")
    await settle()
    reportRunOutcome("exec-1", "failed")
    await settle()

    expect(streamRequest).toHaveBeenCalledOnce()
  })

  it("forgets an execution the user discarded", () => {
    useCopilotStore.setState({ runPhase: "running", executionId: "exec-1" })
    clearRunFollow()
    expect(useCopilotStore.getState()).toMatchObject({ runPhase: "idle", executionId: null })
  })
})

describe("a run that outlives its turn", () => {
  it("keeps following it when the user sends another message", async () => {
    useCopilotStore.setState({ runPhase: "running", executionId: "exec-1" })

    await sendCopilotMessage("also add a music node")

    // Its outcome is what Auto's fix loop reacts to, and its card carries the
    // only Stop the panel offers.
    expect(useCopilotStore.getState()).toMatchObject({ runPhase: "running", executionId: "exec-1" })
  })

  it("clears a settled run when the next message starts", async () => {
    useCopilotStore.setState({ runPhase: "succeeded", executionId: "exec-1" })

    await sendCopilotMessage("now make it longer")

    expect(useCopilotStore.getState()).toMatchObject({ runPhase: "idle", executionId: null })
  })

  it("stops following an execution that no longer exists", async () => {
    useCopilotStore.setState({ runPhase: "running", executionId: "exec-1" })
    abandonRunFollow("gone")
    expect(useCopilotStore.getState()).toMatchObject({ runPhase: "idle", executionId: null, notice: "gone" })
  })
})

describe("switching workflow mid-turn", () => {
  it("does not paint the aborted turn onto the workflow the user just opened", async () => {
    // Model a real abort: the fetch inside `streamRequest` rejects with an
    // AbortError once the signal fires, so the engine's error path runs — the
    // mock parking on a plain promise would never reach it.
    let parked: ((reason: unknown) => void) | null = null
    streamRequest.mockImplementation(async function* (_url: string, opts: { signal?: AbortSignal }) {
      yield metadata("ask", 100)
      await new Promise<void>((_resolve, reject) => {
        parked = reject
        opts.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
      })
    })

    const inFlight = sendCopilotMessage("build it")
    await vi.waitFor(() => expect(parked).not.toBeNull())

    teardownCopilot("wf-2")
    await inFlight

    // The AbortError lands a microtask AFTER the teardown has already reset the
    // panel for the new workflow. A stray "Stopped." here would also suppress
    // that workflow's empty state, so it never gets its greeting.
    expect(useCopilotStore.getState().turn.status).toBe("idle")
  })
})

describe("canvas safety", () => {
  it("waits for the canvas to reach the version the copilot wrote", async () => {
    events([
      metadata("ask", 100),
      {
        type: "workflow_updated",
        data: {
          workflowId: "wf-1",
          version: 7,
          addedNodeIds: ["n1"],
          updatedNodeIds: [],
          removedNodeIds: [],
          addedNodeTypes: ["generate-image"],
          nodeCount: 1,
          edgeCount: 0,
          adjustments: [],
        },
      },
    ])

    await sendCopilotMessage("add a node")

    expect(ensureCanvasVersion).toHaveBeenCalledWith("wf-1", 7, expect.anything())
  })

  it("warns instead of pretending when the canvas could not catch up", async () => {
    ensureCanvasVersion.mockResolvedValueOnce("failed" as never)
    events([
      metadata("ask", 100),
      {
        type: "workflow_updated",
        data: {
          workflowId: "wf-1",
          version: 7,
          addedNodeIds: ["n1"],
          updatedNodeIds: [],
          removedNodeIds: [],
          addedNodeTypes: [],
          nodeCount: 1,
          edgeCount: 0,
          adjustments: [],
        },
      },
    ])

    await sendCopilotMessage("add a node")

    expect(useCopilotStore.getState().notice).toMatch(/canvas is behind/i)
  })

  it("stops the turn when the editor navigates to a different workflow mid-stream", async () => {
    const seen: string[] = []
    streamRequest.mockImplementation(async function* () {
      yield metadata("ask", 100)
      workflowState.workflowId = "wf-2"
      seen.push("switched")
      yield proposal
    })

    await sendCopilotMessage("build it")

    // The proposal arrived AFTER the switch and must not have been acted on.
    expect(seen).toEqual(["switched"])
    expect(useCopilotStore.getState().runPhase).toBe("idle")
  })
})

describe("failures", () => {
  it("turns a 402 into a credit prompt rather than a raw error", async () => {
    streamRequest.mockImplementation(async function* () {
      yield* []
      throw new SseHttpError(402, JSON.stringify({ error: { code: "insufficient_credits", required: 20, balance: 4 } }))
    })

    await sendCopilotMessage("build it")

    expect(useCopilotStore.getState().insufficient).toEqual({ required: 20, balance: 4 })
  })

  it("reports a dropped connection instead of locking the composer forever", async () => {
    streamRequest.mockImplementation(async function* () {
      yield metadata("ask", 100)
      throw new TypeError("network down")
    })

    await sendCopilotMessage("build it")

    expect(useCopilotStore.getState().streaming).toBe(false)
    expect(useCopilotStore.getState().turn.error?.code).toBe("network_error")
  })

  it("settles a stream that ends with no terminal event", async () => {
    events([metadata("ask", 100)])
    await sendCopilotMessage("build it")
    expect(useCopilotStore.getState().turn.status).toBe("cancelled")
    expect(useCopilotStore.getState().streaming).toBe(false)
  })

  it("cancels on the server too, so another replica's loop also stops", async () => {
    let release: (() => void) | null = null
    streamRequest.mockImplementation(async function* () {
      yield metadata("ask", 100)
      await new Promise<void>((resolve) => {
        release = resolve
      })
    })

    const inFlight = sendCopilotMessage("build it")
    // Wait for the stream to actually park, not just for the flag to flip —
    // the flag is set before the first pull.
    await vi.waitFor(() => expect(release).not.toBeNull())
    await stopCopilotTurn()
    release!()
    await inFlight

    expect(cancelCopilotTurn).toHaveBeenCalled()
  })
})
