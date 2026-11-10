import { describe, it, expect, vi } from "vitest"

/**
 * A failed node keeps two texts: the sentence the platform wrote (`errorMessage`) and the
 * provider's own words about that failure (`errorDetail`). The store's writes merge through one
 * rule (lib/node-data-merge.ts); these cases run it through the real store, the way the run
 * engine's writes reach it.
 */

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes: unknown[], nodes: unknown[]) => nodes),
  applyEdgeChanges: vi.fn((_changes: unknown[], edges: unknown[]) => edges),
  addEdge: vi.fn((connection: Record<string, unknown>, edges: Record<string, unknown>[]) => [
    ...edges,
    { ...connection, id: (connection.id as string) ?? "edge_mock" },
  ]),
}))

const localStorageStore: Record<string, string> = {}
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { localStorageStore[key] = value }),
    removeItem: vi.fn((key: string) => { delete localStorageStore[key] }),
    clear: vi.fn(() => { Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]) }),
    length: 0,
    key: vi.fn(() => null),
  },
  writable: true,
})

vi.mock("@/components/editor/workflow-editor/auto-execute", () => ({
  autoExecuteNode: vi.fn(),
  cascadeAutoExecute: vi.fn(),
}))

import { useWorkflowStore } from "../use-workflow-store"

const SENTENCE = "The model declined one of your pictures."
const WORDS = "Request blocked: The uploaded image may contain protected or restricted IP content."

/** A node that failed earlier, its two texts saved with it, now in the given status. */
function seed(status?: string) {
  useWorkflowStore.setState({
    nodes: [
      {
        id: "n1",
        type: "generate-image",
        position: { x: 0, y: 0 },
        data: { label: "Img", prompt: "a cat", errorMessage: SENTENCE, errorDetail: WORDS, ...(status ? { executionStatus: status } : {}) },
      } as never,
    ],
    edges: [],
    isDirty: false,
    isReadOnly: false,
  })
}

const data = () => useWorkflowStore.getState().nodes[0]!.data as Record<string, unknown>

describe("a failed node's sentence and the provider's words, through the store", () => {
  it("a caught failure with no words of its own takes the earlier failure's words away", () => {
    seed("running")
    useWorkflowStore.getState().updateNodeData("n1", { executionStatus: "failed", errorMessage: "Not enough credits." })
    expect(data().errorMessage).toBe("Not enough credits.")
    expect(data().errorDetail).toBeUndefined()
  })

  it("a failure with its own words shows those", () => {
    seed("running")
    useWorkflowStore.getState().updateNodeData("n1", {
      executionStatus: "failed",
      errorMessage: "The model had a problem on its side.",
      errorDetail: "Internal Error",
    })
    expect(data()).toMatchObject({ errorMessage: "The model had a problem on its side.", errorDetail: "Internal Error" })
  })

  it("a run's start, which clears the sentence, clears the words with it", () => {
    seed("failed")
    useWorkflowStore.getState().updateNodeData("n1", { executionStatus: "running", errorMessage: undefined })
    expect(data().errorMessage).toBeUndefined()
    expect(data().errorDetail).toBeUndefined()
  })

  it("a run stopped before its node wrote anything keeps the sentence and the words together, and dirties nothing", () => {
    seed("pending")
    useWorkflowStore.getState().markNodesStatus(["n1"], "failed")
    expect(data()).toMatchObject({ executionStatus: "failed", errorMessage: SENTENCE, errorDetail: WORDS })
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })
})
