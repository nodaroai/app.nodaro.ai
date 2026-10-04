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
  isNotFoundError: (err: unknown) => err instanceof Error && (err as { code?: unknown }).code === "not_found",
}))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { ACCESS_ASK_TIMEOUT_MS, applyWorkflowAccess } from "@/hooks/workflow-access-mode"
import { isSaveRefused } from "@/hooks/workflow-save-refusal"
import { getWorkflowAccess } from "@/lib/api"
import type { WorkflowAccessInfo, WorkflowAccessLevel } from "@/lib/api"
import type { WorkflowNode } from "@/types/nodes"

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
    expect(isSaveRefused(s)).toBe(false)
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
    expect(isSaveRefused(s)).toBe(false)
  })

  it("an ask that never answers fails after its deadline, and its request is aborted", async () => {
    // The open canvas coalesces its re-checks (one out, one queued), so an
    // ask that never settled would hold every later one behind it.
    vi.useFakeTimers()
    try {
      vi.mocked(getWorkflowAccess).mockReturnValue(new Promise(() => {}))
      let settled = false
      const inFlight = applyWorkflowAccess(WF).then(() => {
        settled = true
      })

      await vi.advanceTimersByTimeAsync(ACCESS_ASK_TIMEOUT_MS - 1)
      expect(settled).toBe(false)
      const signal = vi.mocked(getWorkflowAccess).mock.calls[0]?.[1]?.signal
      expect(signal?.aborted).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await inFlight
      expect(settled).toBe(true)
      expect(signal?.aborted).toBe(true)
      // A failed check, like any other: nothing changes.
      const s = useWorkflowStore.getState()
      expect(s.isReadOnly).toBe(false)
      expect(isSaveRefused(s)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
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

/**
 * T97: the same check runs again while the workflow stays open, and every
 * answer also lands in `loadedAccess` — the record that decides whether the
 * canvas subscribes to the row or polls for it. The triggers, and what the
 * canvas's Realtime does with the record, are pinned beside the Realtime hook
 * (use-workflow-realtime-sync.test.tsx).
 */
describe("a re-check writes its answer into the load's record (T97)", () => {
  /** Where a finished load leaves the store: the workflow, and the access it answered. */
  function loadedAs(id: string, access: WorkflowAccessLevel) {
    loaded(id)
    useWorkflowStore.setState({ loadedAccess: { workflowId: id, access } })
  }

  const notFound = () => Object.assign(new Error("Workflow not found"), { code: "not_found" })

  /** A canvas node waiting on `jobId`, as a run leaves it before its result lands. */
  function running(id: string, jobId: string): WorkflowNode {
    return {
      id,
      type: "generate-image",
      position: { x: 0, y: 0 },
      data: { label: id, executionStatus: "running", currentJobId: jobId },
    } as unknown as WorkflowNode
  }

  /** A run's last write: its result, and the job it no longer waits on (poll-job.ts). */
  function finishes(id: string, imageUrl: string) {
    useWorkflowStore.getState().updateNodeData(id, {
      executionStatus: "completed",
      generatedImageUrl: imageUrl,
      currentJobId: undefined,
    })
  }

  it("an `edit` collaborator lowered to `view` is recorded `view`, its saves stop, and the canvas freezes", async () => {
    loadedAs(WF, "edit")
    vi.mocked(getWorkflowAccess).mockResolvedValue({ data: answer({ access: "view" }) })
    await applyWorkflowAccess(WF)

    const s = useWorkflowStore.getState()
    expect(s.loadedAccess).toEqual({ workflowId: WF, access: "view" })
    expect(isSaveRefused(s)).toBe(true)
    expect(s.isReadOnly).toBe(true)
    expect(s.readOnlyReason).toBe("This workflow is read-only for you.")
  })

  it("the route's 404 is the answer `none` — recorded, and frozen exactly like `view`", async () => {
    loadedAs(WF, "edit")
    vi.mocked(getWorkflowAccess).mockRejectedValue(notFound())
    await applyWorkflowAccess(WF)

    const s = useWorkflowStore.getState()
    expect(s.loadedAccess).toEqual({ workflowId: WF, access: "none" })
    expect(isSaveRefused(s)).toBe(true)
    expect(s.isReadOnly).toBe(true)
    expect(s.readOnlyReason).toBe("This workflow is read-only for you.")
  })

  it("mid-run, a narrower answer stops the saves at once and freezes the canvas only once no node holds a job", async () => {
    // Read-only makes `updateNodeData` a no-op. Raised while a job is out, it
    // would drop the result of a job already paid for and leave the node
    // spinning (the store's `saveRefusedFor` doc).
    loadedAs(WF, "edit")
    useWorkflowStore.setState({ nodes: [running("n1", "job-1"), running("n2", "job-2")] })
    vi.mocked(getWorkflowAccess).mockResolvedValue({ data: answer({ access: "view" }) })
    await applyWorkflowAccess(WF)

    expect(useWorkflowStore.getState().loadedAccess).toEqual({ workflowId: WF, access: "view" })
    expect(isSaveRefused(useWorkflowStore.getState())).toBe(true)
    expect(useWorkflowStore.getState().isReadOnly).toBe(false)

    finishes("n1", "https://cdn/n1.png")
    expect(useWorkflowStore.getState().nodes[0]!.data).toMatchObject({ generatedImageUrl: "https://cdn/n1.png" })
    expect(useWorkflowStore.getState().isReadOnly).toBe(false)

    finishes("n2", "https://cdn/n2.png")
    const s = useWorkflowStore.getState()
    expect(s.nodes[1]!.data).toMatchObject({ executionStatus: "completed", generatedImageUrl: "https://cdn/n2.png" })
    expect(s.isReadOnly).toBe(true)
    expect(s.readOnlyReason).toBe("This workflow is read-only for you.")
  })

  it("a canvas already read-only (a `view` load) gets its sentence at once, a job held or not: there is nothing left to protect", async () => {
    loadedAs(WF, "view")
    useWorkflowStore.setState({ isReadOnly: true, readOnlyReason: null, nodes: [running("n1", "job-1")] })
    vi.mocked(getWorkflowAccess).mockResolvedValue({ data: answer({ access: "view" }) })
    await applyWorkflowAccess(WF)

    const s = useWorkflowStore.getState()
    expect(s.readOnlyReason).toBe("This workflow is read-only for you.")
    expect(isSaveRefused(s)).toBe(true)
  })

  it("a freeze still waiting for its runs is dropped when another workflow opens, or this one reloads", async () => {
    // The load that replaced it put its own verdict on the canvas.
    for (const next of ["wf-2", WF]) {
      loadedAs(WF, "edit")
      useWorkflowStore.setState({ nodes: [running("n1", "job-1")] })
      vi.mocked(getWorkflowAccess).mockResolvedValue({ data: answer({ access: "view" }) })
      await applyWorkflowAccess(WF)
      expect(useWorkflowStore.getState().isReadOnly).toBe(false)

      loadedAs(next, "edit")
      useWorkflowStore.setState({ nodes: [running("n1", "job-1")] })
      finishes("n1", "https://cdn/n1.png")

      const s = useWorkflowStore.getState()
      expect(s.nodes[0]!.data).toMatchObject({ generatedImageUrl: "https://cdn/n1.png" })
      expect(s.isReadOnly).toBe(false)
      expect(isSaveRefused(s)).toBe(false)
    }
  })

  it("a failed re-check keeps the current mode: the record, the subscription it allows, a writable canvas", async () => {
    // Decided, not defaulted. Failing closed to `view` would freeze every
    // collaborator's canvas on a network blip — and the re-check fires exactly
    // then, as a laptop wakes and its tab is shown again — while an error is
    // no evidence the access changed. An upgrade never lifts read-only, so a
    // canvas frozen that way would stay frozen until it was reloaded.
    loadedAs(WF, "edit")
    const before = useWorkflowStore.getState().loadedAccess
    vi.mocked(getWorkflowAccess).mockRejectedValue(new Error("offline"))
    await applyWorkflowAccess(WF)

    const s = useWorkflowStore.getState()
    expect(s.loadedAccess).toBe(before)
    expect(s.isReadOnly).toBe(false)
    expect(s.readOnlyReason).toBeNull()
    expect(isSaveRefused(s)).toBe(false)
  })

  it("the owner's own row stays `own` on a narrower answer; the saves still stop and the canvas still freezes", async () => {
    // The creator of a workflow in an archived workspace is answered `view`;
    // a suspended one, `none`. The row is still theirs: the load reads it on
    // the owner's branch and keeps the subscription, and so does a re-check.
    for (const narrower of [answer({ access: "view" }), notFound()]) {
      loadedAs(WF, "own")
      const before = useWorkflowStore.getState().loadedAccess
      if (narrower instanceof Error) vi.mocked(getWorkflowAccess).mockRejectedValue(narrower)
      else vi.mocked(getWorkflowAccess).mockResolvedValue({ data: narrower })
      await applyWorkflowAccess(WF)

      const s = useWorkflowStore.getState()
      expect(s.loadedAccess).toBe(before)
      expect(isSaveRefused(s)).toBe(true)
      expect(s.isReadOnly).toBe(true)
    }
  })

  it("a wider answer is recorded — the subscription may open again — and lifts neither read-only nor the refusal of saves", async () => {
    // The canvas a `view` answer reached may be holding the reader's
    // projection; saving, it would put that back over the owner's drafts.
    loadedAs(WF, "view")
    useWorkflowStore.setState({ isReadOnly: true, readOnlyReason: "This workflow is read-only for you.", saveRefusedFor: WF })
    vi.mocked(getWorkflowAccess).mockResolvedValue({ data: answer({ access: "edit" }) })
    await applyWorkflowAccess(WF)

    const s = useWorkflowStore.getState()
    expect(s.loadedAccess).toEqual({ workflowId: WF, access: "edit" })
    expect(s.isReadOnly).toBe(true)
    expect(isSaveRefused(s)).toBe(true)
  })

  it("an answer that changes nothing writes nothing: the record is the same object", async () => {
    // The canvas reads the record; a fresh object every minute would re-render it.
    loadedAs(WF, "edit")
    const before = useWorkflowStore.getState().loadedAccess
    vi.mocked(getWorkflowAccess).mockResolvedValue({ data: answer({ access: "edit" }) })
    await applyWorkflowAccess(WF)

    expect(useWorkflowStore.getState().loadedAccess).toBe(before)
  })

  it("an answer asked before a reload of the same workflow is dropped whole", async () => {
    loadedAs(WF, "edit")
    let release: (v: { data: WorkflowAccessInfo }) => void = () => {}
    vi.mocked(getWorkflowAccess).mockReturnValue(new Promise((r) => { release = r }))
    const inFlight = applyWorkflowAccess(WF)

    // The reload answered `edit` again, and asks its own question.
    loadedAs(WF, "edit")
    const reloaded = useWorkflowStore.getState().loadedAccess
    release({ data: answer({ access: "view" }) })
    await inFlight

    const s = useWorkflowStore.getState()
    expect(s.loadedAccess).toBe(reloaded)
    expect(s.isReadOnly).toBe(false)
  })

  it("with no record for the workflow (its load failed), an answer records nothing", async () => {
    loaded(WF)
    vi.mocked(getWorkflowAccess).mockResolvedValue({ data: answer({ access: "edit" }) })
    await applyWorkflowAccess(WF)

    expect(useWorkflowStore.getState().loadedAccess).toBeNull()
  })
})
