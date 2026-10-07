import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The newer-run check (TA3 c), one function for Render final's precheck and
 * the inspector's open-time check (A3-2): did a run end that this canvas does
 * not show? A listing that fails answers "no".
 */
const mockList = vi.fn()
const mockPatches = vi.fn()
const mockUpdateNodeData = vi.fn()
const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
const store = vi.hoisted(() => ({ isReadOnly: false }))

vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => mockToastError(...a), success: (...a: unknown[]) => mockToastSuccess(...a) } }))
vi.mock("@/lib/api", () => ({ listWorkflowExecutions: (...a: unknown[]) => mockList(...a) }))
vi.mock("@/hooks/use-workflow-persistence", () => ({ TERMINAL_RESTORABLE_STATUSES: "completed,failed", restoreEndedEditorRun: vi.fn() }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => ({ isReadOnly: store.isReadOnly, updateNodeData: (...a: unknown[]) => mockUpdateNodeData(...a) }) },
}))
vi.mock("../render-final-checks", () => ({ newerRunPatches: (...a: unknown[]) => mockPatches(...a) }))

const { applyNewerRun, newerRunOnServer, refuseForNewerRun } = await import("../newer-run-check")

beforeEach(() => {
  mockList.mockReset()
  mockPatches.mockReset()
  mockUpdateNodeData.mockReset()
  mockToastError.mockReset()
  mockToastSuccess.mockReset()
  store.isReadOnly = false
})

describe("newerRunOnServer", () => {
  it("asks the newest ended editor runs, as reopening loads them", async () => {
    mockList.mockResolvedValue({ data: [{ id: "run-2" }] })
    mockPatches.mockReturnValue({ plan: { generatedJson: 1 } })
    expect(await newerRunOnServer("wf", [], [])).toEqual({ plan: { generatedJson: 1 } })
    expect(mockList).toHaveBeenCalledWith("wf", { limit: 10, status: "completed,failed", source: "editor" })
  })

  it("is null when the canvas shows the newest run", async () => {
    mockList.mockResolvedValue({ data: [] })
    mockPatches.mockReturnValue({})
    expect(await newerRunOnServer("wf", [], [])).toBeNull()
  })

  it("a listing that fails answers no: a check that cannot be made never stops anything", async () => {
    mockList.mockRejectedValue(new Error("offline"))
    expect(await newerRunOnServer("wf", [], [])).toBeNull()
  })
})

describe("loading the newer run", () => {
  it("applyNewerRun writes each node's data", () => {
    expect(applyNewerRun({ a: { x: 1 } as never, b: { y: 2 } as never })).toBe(true)
    expect(mockUpdateNodeData.mock.calls).toEqual([["a", { x: 1 }], ["b", { y: 2 }]])
  })

  it("applyNewerRun writes nothing on a read-only canvas, and says so", () => {
    store.isReadOnly = true
    expect(applyNewerRun({ a: { x: 1 } as never })).toBe(false)
    expect(mockUpdateNodeData).not.toHaveBeenCalled()
  })

  it("refuseForNewerRun claims no load on a read-only canvas", () => {
    store.isReadOnly = true
    refuseForNewerRun({ a: { x: 1 } as never })
    const action = (mockToastError.mock.calls[0]![1] as { action: { onClick: () => void } }).action
    action.onClick()
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })

  it("refuseForNewerRun offers the one click that loads it", () => {
    refuseForNewerRun({ a: { x: 1 } as never })
    const action = (mockToastError.mock.calls[0]![1] as { action: { onClick: () => void } }).action
    action.onClick()
    expect(mockUpdateNodeData).toHaveBeenCalledWith("a", { x: 1 })
    expect(mockToastSuccess).toHaveBeenCalled()
  })
})
