/**
 * A Telegram-started run on the canvas, through the real editor store:
 *   - one that ended unseen is painted at once with the same mapping a Run
 *     uses (a text answer lands on generatedText), on the nodes that ran only;
 *   - the trigger card never takes the message, a pass-through node is never
 *     touched, and the same run is never painted twice over later edits;
 *   - one still going is followed: its nodes start from "pending", the
 *     trigger card shows it is working, and once over the card settles and
 *     the nodes are marked as showing that run.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

const stream = vi.hoisted(() => ({ calls: [] as unknown[][], paints: [] as unknown[] }))
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock("../run-handlers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../run-handlers")>()),
  // Like the real stream: the paint is built once the stream starts.
  streamBackendExecution: vi.fn((...args: unknown[]) => {
    stream.calls.push(args)
    const opts = args[4] as { beginTriggered?: () => unknown } | undefined
    stream.paints.push(opts?.beginTriggered?.())
  }),
}))

import type { WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { ExecutionContext } from "../types"
import type { TriggeredRunPaint } from "../run-handlers"
import { followTriggeredRun, paintEndedTriggeredRun } from "../follow-triggered-run"

function node(id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } } as unknown as WorkflowNode
}
const dataOf = (id: string) => (useWorkflowStore.getState().nodes.find((n) => n.id === id)?.data ?? {}) as Record<string, unknown>

const STATES = {
  trig: { status: "completed", startedAt: "2026-10-03T10:00:00Z", output: { text: "https://youtu.be/dQw4w9WgXcQ" } },
  brand: { status: "completed", output: { text: "We sell matcha." } },
  llm: { status: "completed", startedAt: "2026-10-03T10:00:01Z", completedAt: "2026-10-03T10:00:15Z", output: { text: "Three ideas for this video" } },
}
const ENDED = { id: "run-1", status: "completed", triggerType: "telegram_account", completedAt: "2026-10-03T10:00:16Z", nodeStates: STATES }

beforeEach(() => {
  stream.calls = []
  stream.paints = []
  act(() => {
    useWorkflowStore.setState({
      nodes: [
        node("trig", "telegram-account-trigger", { isActive: true }),
        node("brand", "text-prompt", { text: "We sell matcha. Edited since." }),
        node("llm", "llm-chat", { executionStatus: "completed", generatedText: "an older answer" }),
      ],
      edges: [],
      isDirty: false,
      isReadOnly: false,
    })
  })
})

describe("paintEndedTriggeredRun", () => {
  it("puts the run's answer on the node that ran, the way a Run would, and marks it", () => {
    act(() => paintEndedTriggeredRun(ENDED))
    expect(dataOf("llm")).toMatchObject({ executionStatus: "completed", generatedText: "Three ideas for this video", resultsRunId: "run-1" })
  })

  it("never writes the message onto the trigger card, nor touches a node that only passed its data through", () => {
    act(() => paintEndedTriggeredRun(ENDED))
    expect(dataOf("trig").generatedText).toBeUndefined()
    expect(dataOf("trig").__triggerData).toBeUndefined()
    expect(dataOf("brand")).toMatchObject({ text: "We sell matcha. Edited since." })
    expect(dataOf("brand").generatedText).toBeUndefined()
  })

  it("does not paint the same run again over an edit made since (a reload)", () => {
    act(() => paintEndedTriggeredRun(ENDED))
    act(() => useWorkflowStore.getState().updateNodeData("llm", { generatedText: "my own edit" }))
    act(() => paintEndedTriggeredRun(ENDED))
    expect(dataOf("llm").generatedText).toBe("my own edit")
  })

  it("an MCP run's `inputs` override on a source node is never saved as its config", () => {
    // The orchestrator merges an override into the node before seeding, so the
    // seeded state carries the overridden text; only the nodes that RAN paint.
    const seeded = {
      ...STATES,
      brand: { status: "completed", fromSavedData: true, output: { text: "We sell coffee (override)." } },
    }
    act(() => paintEndedTriggeredRun({ ...ENDED, id: "run-mcp", triggerType: "mcp", nodeStates: seeded }))
    expect(dataOf("brand").text).toBe("We sell matcha. Edited since.")
    expect(dataOf("brand").generatedText).toBeUndefined()
    expect(dataOf("llm")).toMatchObject({ generatedText: "Three ideas for this video", resultsRunId: "run-mcp" })
  })

  it("a completed single-node run that settled a node after this run keeps that newer result", () => {
    const laterSingle = {
      id: "single-1",
      status: "completed",
      triggerType: "single-node",
      completedAt: "2026-10-03T10:00:30Z",
      nodeStates: { llm: { nodeId: "llm", status: "completed", completedAt: "2026-10-03T10:00:30Z", output: { text: "newer" } } },
    }
    act(() => paintEndedTriggeredRun(ENDED, [ENDED, laterSingle]))
    expect(dataOf("llm").generatedText).toBe("an older answer")
    expect(dataOf("llm").resultsRunId).toBeUndefined()
  })
})

describe("followTriggeredRun", () => {
  const ctx = {} as ExecutionContext

  function follow() {
    const setIsRunning = vi.fn()
    const onEnded = vi.fn()
    const live = { ...ENDED, status: "running", completedAt: undefined, nodeStates: { ...STATES, llm: { status: "running", startedAt: "2026-10-03T10:00:01Z" } } }
    act(() => followTriggeredRun(live, ctx, setIsRunning, onEnded))
    const [executionId, , , ended, opts] = stream.calls[0] as [string, unknown, unknown, unknown, { isRestore: boolean }]
    return { executionId, ended, onEnded, opts: { ...opts, triggered: stream.paints[0] as TriggeredRunPaint } }
  }

  it("follows it through the Run stream: its nodes start from pending, its trigger card shows it is working", () => {
    const { executionId, ended, onEnded, opts } = follow()
    expect(executionId).toBe("run-1")
    expect(ended).toBe(onEnded)
    expect(opts.isRestore).toBe(true)
    expect(dataOf("llm").executionStatus).toBe("pending")
    expect(dataOf("trig").executionStatus).toBe("running")
    expect(dataOf("brand").executionStatus).toBeUndefined()
  })

  it("lets only the nodes that ran reach the canvas, and settles the card and marks the nodes when over", () => {
    const { opts } = follow()
    const painted = opts.triggered.paintable(STATES as never)
    expect(Object.keys(painted)).toEqual(["llm"])
    act(() => opts.triggered.settle())
    expect(dataOf("trig").executionStatus).toBe("idle")
    expect(dataOf("llm").resultsRunId).toBe("run-1")
  })
})

describe("review round 1", () => {
  const ctx = {} as ExecutionContext

  function followWith(nodeStates: Record<string, unknown>) {
    const live = { id: "run-2", status: "running", triggerType: "telegram_account", nodeStates }
    act(() => followTriggeredRun(live, ctx, vi.fn(), vi.fn()))
    return stream.paints.at(-1) as TriggeredRunPaint
  }

  it("settle puts back to idle a node the run never reached (a Router skipped it)", () => {
    act(() => useWorkflowStore.setState({ nodes: [...useWorkflowStore.getState().nodes, node("va", "video-analysis")] }))
    const paint = followWith({ trig: STATES.trig, llm: { status: "running", startedAt: "2026-10-03T10:00:01Z" }, va: { status: "pending" } })
    expect(dataOf("va").executionStatus).toBe("pending")
    act(() => void paint.paintable({ llm: STATES.llm, va: { status: "skipped" } } as never))
    act(() => paint.settle())
    expect(dataOf("va").executionStatus).toBe("idle")
  })

  it("the trigger card's working mark leaves its saved fields alone (no reset, no save)", () => {
    act(() => useWorkflowStore.getState().updateNodeData("trig", { errorMessage: "an earlier problem" }))
    followWith({ trig: STATES.trig, llm: { status: "running", startedAt: "2026-10-03T10:00:01Z" } })
    expect(dataOf("trig")).toMatchObject({ executionStatus: "running", errorMessage: "an earlier problem" })
  })

  it("a node that ends is marked as showing the run in the same tick as its result", () => {
    const paint = followWith({ trig: STATES.trig, llm: { status: "running", startedAt: "2026-10-03T10:00:01Z" } })
    act(() => void paint.paintable({ llm: STATES.llm } as never))
    expect(dataOf("llm").resultsRunId).toBe("run-2")
  })
})
