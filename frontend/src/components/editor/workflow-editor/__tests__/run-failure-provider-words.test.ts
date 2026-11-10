import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * A failed node shows two texts: the sentence the platform wrote and, under it, the provider's own
 * words about that failure. A run's failure reaches the canvas on two lanes, the live run's repaint
 * and a reopen of the run, and both name the words from the run's own state, absent ones included:
 * a failure the provider said nothing about must not sit over the words of an earlier one.
 */
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_c, nodes) => nodes),
  applyEdgeChanges: vi.fn((_c, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { applyBackendExecutionState } from "@/hooks/use-workflow-persistence"
import { paintRunStates } from "../run-handlers"

const SENTENCE = "The model declined one of your pictures."
const WORDS = "Request blocked: The uploaded image may contain protected or restricted IP content."
/** What an earlier failure left on the node: its sentence and the provider's words about it. */
const OLDER = { errorMessage: "The image model had a problem on its side.", errorDetail: "Internal Error" }
const REFUSED = { status: "failed", errorCode: "use_case_nothing_kept", error: "Every clip was dropped in the review: keep at least one clip to render the final." }

type Data = Record<string, unknown>
const node = (data: Data, type = "generate-image") => ({ id: "img", type, position: { x: 0, y: 0 }, data: { label: "Poster", ...data } })

/** Lands the run state `state` on `before` and returns the node's data as the lane leaves it. */
type Land = (before: ReturnType<typeof node>, state: Data, runId?: string) => Data

const LANES: Array<[string, Land]> = [
  [
    "the live run's repaint",
    (before, state, runId = "exec-1") => {
      useWorkflowStore.setState({ nodes: [before] as never, edges: [], isReadOnly: false })
      paintRunStates({ img: state } as never, { runId })
      return useWorkflowStore.getState().nodes[0]!.data as Data
    },
  ],
  [
    "a reopen of the run",
    (before, state, runId = "exec-1") => {
      const [out] = applyBackendExecutionState([before] as never, { img: state } as never, { runId })
      return out!.data as Data
    },
  ],
]

afterEach(() => useWorkflowStore.setState({ nodes: [], edges: [] }))

describe.each(LANES)("a run's failure on %s", (_lane, land) => {
  it("lands the provider's words beside the sentence", () => {
    const data = land(node({ executionStatus: "pending" }), { status: "failed", error: SENTENCE, errorDetail: WORDS })
    expect(data).toMatchObject({ executionStatus: "failed", errorMessage: SENTENCE, errorDetail: WORDS })
  })

  it("replaces an earlier failure's words with its own", () => {
    const data = land(node({ executionStatus: "pending", ...OLDER }), { status: "failed", error: SENTENCE, errorDetail: WORDS })
    expect(data).toMatchObject({ errorMessage: SENTENCE, errorDetail: WORDS })
  })

  it("a failure the provider said nothing about leaves no words, an earlier failure's included", () => {
    const data = land(node({ executionStatus: "pending", ...OLDER }), { status: "failed", error: SENTENCE })
    expect(data.executionStatus).toBe("failed")
    expect(data.errorMessage).toBe(SENTENCE)
    expect(data.errorDetail).toBeUndefined()
  })

  it.each([
    ["an empty string", ""],
    ["a null", null],
  ])("%s is no words", (_name, words) => {
    const data = land(node({ executionStatus: "pending", ...OLDER }), { status: "failed", error: SENTENCE, errorDetail: words })
    expect(data.errorMessage).toBe(SENTENCE)
    expect(data.errorDetail).toBeUndefined()
  })

  it("a failure with the very same sentence as the earlier one leaves that one's words behind", () => {
    const data = land(node({ executionStatus: "pending", ...OLDER }), { status: "failed", error: OLDER.errorMessage })
    expect(data.errorMessage).toBe(OLDER.errorMessage)
    expect(data.errorDetail).toBeUndefined()
  })

  it("a failure with no hint takes an earlier failure's policy hint away, so nothing covers its words", () => {
    const hint = { kind: "policy-block", policyId: "sai", reason: "Blocked by content policy", hookPoint: "result" }
    const data = land(node({ executionStatus: "pending", ...OLDER, errorHint: hint }), { status: "failed", error: SENTENCE, errorDetail: WORDS })
    expect(data.errorHint).toBeUndefined()
    expect(data).toMatchObject({ errorMessage: SENTENCE, errorDetail: WORDS })
  })

  it("a continuation refused before any work clears the sentence and the words with it", () => {
    const data = land(node({ executionStatus: "pending", ...OLDER }, "clip-pack"), REFUSED, "exec-refused")
    expect(data.executionStatus).toBe("completed")
    expect(data.errorMessage).toBeUndefined()
    expect(data.errorDetail).toBeUndefined()
  })

  it("a refused continuation clears words that had no sentence over them", () => {
    const data = land(node({ executionStatus: "pending", errorDetail: OLDER.errorDetail }, "clip-pack"), REFUSED, "exec-refused-bare")
    expect(data.executionStatus).toBe("completed")
    expect(data.errorDetail).toBeUndefined()
  })
})
