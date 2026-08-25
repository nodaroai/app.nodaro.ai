import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Viewer mode: the server's answer, and what the canvas does with it.
 *
 * The lever (`isReadOnly`) predates this work and every write path already
 * consults it. What P10 adds is a SOURCE for it, and two sentences for the
 * states nobody can work out unaided.
 *
 * An earlier version of this file wrote the store and read it back, which
 * tested Zustand: deleting the entire feature left it green. So everything
 * below drives the real `applyWorkflowAccess`, and the only thing the store is
 * used for is observing what it did.
 */

vi.mock("@/lib/api", () => ({
  getWorkflowAccess: vi.fn(),
}))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { applyWorkflowAccess } from "@/hooks/workflow-access-mode"
import { getWorkflowAccess } from "@/lib/api"
import type { WorkflowAccessInfo } from "@/lib/api"

const WF = "wf-1"
const WS = "ws-1"

function answer(over: Partial<WorkflowAccessInfo> = {}): WorkflowAccessInfo {
  return {
    access: "own",
    workspaceId: null,
    visibility: "private",
    canChangeVisibility: true,
    canShare: true,
    canRun: true,
    ...over,
  }
}

/** Put the store where a freshly-loaded workflow leaves it. */
function loaded(id: string) {
  useWorkflowStore.getState().loadWorkflow(id, "W", [], [])
}

beforeEach(() => {
  vi.clearAllMocks()
  loaded(WF)
})

describe("what the server says, the canvas does", () => {
  it("`view` freezes the canvas", async () => {
    vi.mocked(getWorkflowAccess).mockResolvedValue({ data: answer({ access: "view" }) })
    await applyWorkflowAccess(WF)

    const s = useWorkflowStore.getState()
    expect(s.isReadOnly).toBe(true)
    expect(s.readOnlyReason).toBeTruthy()
  })

  it("the read-only sentence claims nothing about MEMBERSHIP", async () => {
    // The same `view` answer reaches an outside collaborator, a member of a
    // class whose settings only allow reading, and the CREATOR of a workflow in
    // an archived workspace. Telling that last person they are "not a member"
    // of their own class is false — so the sentence says the one thing true of
    // all three.
    vi.mocked(getWorkflowAccess).mockResolvedValue({
      data: answer({ access: "view", workspaceId: WS, visibility: "workspace" }),
    })
    await applyWorkflowAccess(WF)

    expect(useWorkflowStore.getState().readOnlyReason).not.toMatch(/not a member/i)
  })

  it("`own` leaves everything alone", async () => {
    vi.mocked(getWorkflowAccess).mockResolvedValue({ data: answer() })
    await applyWorkflowAccess(WF)

    const s = useWorkflowStore.getState()
    expect(s.isReadOnly).toBe(false)
    expect(s.readOnlyReason).toBeNull()
    expect(s.runBlockedReason).toBeNull()
  })

  it("EDIT but not RUN leaves the canvas writable and explains the Run button", async () => {
    // The state the reason field exists for, and the only one a person cannot
    // deduce: the canvas responds, saves land, and Run does nothing, because
    // running spends the workspace's credits and that takes membership.
    vi.mocked(getWorkflowAccess).mockResolvedValue({
      data: answer({ access: "edit", workspaceId: WS, canRun: false }),
    })
    await applyWorkflowAccess(WF)

    const s = useWorkflowStore.getState()
    expect(s.isReadOnly).toBe(false)
    expect(s.runBlockedReason).toMatch(/only members of its workspace can run it/i)
  })

  it("a LATE answer for another workflow is dropped", async () => {
    // Open two workflows quickly and the first verdict arrives after the second
    // has loaded. Without the guard it lands on the wrong workflow and freezes
    // work the person owns.
    let release: (v: { data: WorkflowAccessInfo }) => void = () => {}
    vi.mocked(getWorkflowAccess).mockReturnValue(
      new Promise((r) => { release = r }),
    )
    const inFlight = applyWorkflowAccess(WF)

    loaded("wf-2")
    release({ data: answer({ access: "view" }) })
    await inFlight

    const s = useWorkflowStore.getState()
    expect(s.isReadOnly).toBe(false)
    expect(s.readOnlyReason).toBeNull()
  })

  it("a FAILED check leaves the canvas usable", async () => {
    // Deliberate: the server refuses every write independently, so the worst
    // case here is somebody typing into a canvas that then will not save. The
    // opposite choice would freeze a person's own work on a network blip.
    vi.mocked(getWorkflowAccess).mockRejectedValue(new Error("offline"))
    await applyWorkflowAccess(WF)

    const s = useWorkflowStore.getState()
    expect(s.isReadOnly).toBe(false)
    expect(s.readOnlyReason).toBeNull()
    expect(s.runBlockedReason).toBeNull()
  })

  it("both reasons are cleared by loading another workflow", async () => {
    // A reason must never outlive its subject: opening your own work after
    // somebody else's would otherwise tell you it belongs to a class you are
    // not in.
    vi.mocked(getWorkflowAccess).mockResolvedValue({
      data: answer({ access: "view", workspaceId: WS }),
    })
    await applyWorkflowAccess(WF)
    expect(useWorkflowStore.getState().isReadOnly).toBe(true)

    loaded("wf-2")

    const s = useWorkflowStore.getState()
    expect(s.isReadOnly).toBe(false)
    expect(s.readOnlyReason).toBeNull()
    expect(s.runBlockedReason).toBeNull()
  })
})
