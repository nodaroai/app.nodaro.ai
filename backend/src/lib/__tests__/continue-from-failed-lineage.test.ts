import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  calls: [] as Array<Array<[string, ...unknown[]]>>,
  /** The row the lineage read answers (the newest generation). */
  row: null as unknown,
  error: null as { message: string } | null,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      const calls: Array<[string, ...unknown[]]> = [["from", table]]
      db.calls.push(calls)
      const q: Record<string, unknown> = {}
      for (const m of ["select", "eq", "in", "not", "order", "limit"])
        q[m] = (...a: unknown[]) => {
          calls.push([m, ...a])
          return q
        }
      // The lane filter is honoured, as the database would: a row of another lane is not found.
      const laneOk = () =>
        calls.every(([m, col, vals]) => m !== "in" || col !== "trigger_type" || (vals as unknown[]).includes((db.row as { trigger_type?: unknown } | null)?.trigger_type))
      q.maybeSingle = async () => ({ data: db.error || !laneOk() ? null : db.row, error: db.error })
      return q
    },
  },
}))

import {
  continuationPointOf,
  newestGeneration,
  carriedHolds,
  previewPendingMessage,
  subsetJoinsLineage,
  supersedingRunOf,
  continueFromFailedStamp,
  continueFromFailedStampOf,
  lineageRootOf,
} from "../continue-from-failed-lineage.js"

beforeEach(() => {
  db.calls.length = 0
  db.row = null
  db.error = null
})

describe("continue-from-failed lineage stamp", () => {
  it("round-trips through trigger_data", () => {
    const data = continueFromFailedStamp({ from: "exec-b", root: "exec-a", all: true })
    expect(data).toEqual({ continueFromFailed: { from: "exec-b", root: "exec-a", all: true } })
    expect(continueFromFailedStampOf(data)).toEqual({ from: "exec-b", root: "exec-a", all: true })
  })

  it("names the run its states were seeded from when it is not the one continued", () => {
    const data = continueFromFailedStamp({ from: "exec-a", root: "exec-a", seededFrom: "exec-b", all: false })
    expect(data).toEqual({ continueFromFailed: { from: "exec-a", root: "exec-a", seededFrom: "exec-b", all: false } })
    expect(continueFromFailedStampOf(data)).toEqual({ from: "exec-a", root: "exec-a", seededFrom: "exec-b", all: false })
    // A stamp from before the field: none (it was `from`).
    expect(continueFromFailedStampOf({ continueFromFailed: { from: "exec-a", root: "exec-a", all: true } })).not.toHaveProperty("seededFrom")
  })

  it("a stamp written before `all` existed reads as not all", () => {
    expect(continueFromFailedStampOf({ continueFromFailed: { from: "exec-b", root: "exec-a" } })).toEqual({ from: "exec-b", root: "exec-a", all: false })
    expect(continueFromFailedStampOf({ continueFromFailed: { from: "exec-b", root: "exec-a", all: "true" } })?.all).toBe(false)
  })

  it("reads nothing from other stamps or malformed values", () => {
    expect(continueFromFailedStampOf(null)).toBeNull()
    expect(continueFromFailedStampOf([])).toBeNull()
    expect(continueFromFailedStampOf({ appRun: { appRunId: "r" } })).toBeNull()
    expect(continueFromFailedStampOf({ continueFromFailed: { from: "x" } })).toBeNull()
    expect(continueFromFailedStampOf({ continueFromFailed: { from: "", root: "y" } })).toBeNull()
    expect(continueFromFailedStampOf({ continueFromFailed: "x" })).toBeNull()
  })

  it("a subset continuation's stamp and a Preview stop round-trip", () => {
    const data = continueFromFailedStamp({ from: "exec-b", root: "exec-a", seededFrom: "exec-b", all: false, via: "subset", previewRenders: ["cut"] })
    expect(data).toEqual({ continueFromFailed: { from: "exec-b", root: "exec-a", seededFrom: "exec-b", all: false, via: "subset", previewRenders: ["cut"] } })
    expect(continueFromFailedStampOf(data)).toEqual({ from: "exec-b", root: "exec-a", seededFrom: "exec-b", all: false, via: "subset", previewRenders: ["cut"] })
    // No stop, no field; an unknown `via` or junk renders read as none.
    expect(continueFromFailedStamp({ from: "exec-a", root: "exec-a", all: true, previewRenders: [], reviewHolds: [] }).continueFromFailed).not.toHaveProperty("previewRenders")
    const junk = continueFromFailedStampOf({ continueFromFailed: { from: "exec-a", root: "exec-a", via: "other", previewRenders: [1, ""], reviewHolds: [null] } })
    expect(junk).toEqual({ from: "exec-a", root: "exec-a", all: false })
  })

  it("a review hold round-trips beside the renders, recorded the same way", () => {
    const data = continueFromFailedStamp({ from: "exec-a", root: "exec-a", all: false, previewRenders: ["cut"], reviewHolds: ["t"] })
    expect(data.continueFromFailed).toEqual({ from: "exec-a", root: "exec-a", all: false, previewRenders: ["cut"], reviewHolds: ["t"] })
    expect(continueFromFailedStampOf(data)).toEqual({ from: "exec-a", root: "exec-a", all: false, previewRenders: ["cut"], reviewHolds: ["t"] })
    expect(continueFromFailedStamp({ from: "exec-a", root: "exec-a", all: true, reviewHolds: [] }).continueFromFailed).not.toHaveProperty("reviewHolds")
  })

  it("carriedHolds: a generation's holds a subset continuation does not execute stay held", () => {
    const head = { previewRenders: ["cut1", "cut2"], reviewHolds: ["t"] }
    expect(carriedHolds(head, new Set(["cut1", "d1"]))).toEqual({ previewRenders: ["cut2"], reviewHolds: ["t"] })
    expect(carriedHolds(head, new Set(["cut1", "cut2", "t"]))).toEqual({ previewRenders: [], reviewHolds: [] })
    expect(carriedHolds(null, new Set())).toEqual({ previewRenders: [], reviewHolds: [] })
  })

  it("a lineage's root: the source's own root, else the source itself", () => {
    expect(lineageRootOf({ id: "exec-a" })).toBe("exec-a")
    expect(lineageRootOf({ id: "exec-a", continueFromFailed: null })).toBe("exec-a")
    expect(lineageRootOf({ id: "exec-c", continueFromFailed: { from: "exec-b", root: "exec-a", all: false } })).toBe("exec-a")
  })
})

const scope = { userId: "u1", workflowId: "wf-1" }

/** A generation as the executions table holds it. */
const gen = (id: string, status: string, all: boolean | undefined, root = "exec-a") => ({
  id,
  status,
  trigger_type: "manual",
  trigger_data: { continueFromFailed: { from: root, root, ...(all === undefined ? {} : { all }) } },
})

describe("newestGeneration", () => {
  it("asks once for the caller's newest started generation of this workflow's lineage that failed or completed", async () => {
    db.row = gen("exec-c", "failed", true)
    expect(await newestGeneration({ ...scope, root: "exec-a" })).toEqual({ id: "exec-c", status: "failed", all: true, previewRenders: [], reviewHolds: [] })
    expect(db.calls).toEqual([
      [
        ["from", "workflow_executions"],
        ["select", "id, status, trigger_type, trigger_data"],
        ["eq", "user_id", "u1"],
        ["eq", "workflow_id", "wf-1"],
        ["eq", "trigger_data->continueFromFailed->>root", "exec-a"],
        // Only among the runs a stamp-writing lane started (lib/server-started-runs.ts).
        ["in", "trigger_type", ["manual", "mcp", "app_run"]],
        ["in", "status", ["failed", "completed"]],
        ["not", "started_at", "is", null],
        ["order", "created_at", { ascending: false }],
        ["limit", 1],
      ],
    ])
  })

  it("reads `all` off its stamp (absent: not all)", async () => {
    db.row = gen("exec-c", "completed", undefined)
    expect(await newestGeneration({ ...scope, root: "exec-a" })).toEqual({ id: "exec-c", status: "completed", all: false, previewRenders: [], reviewHolds: [] })
  })

  it("reads the Preview renders it stopped at off its stamp", async () => {
    db.row = { id: "exec-c", status: "completed", trigger_type: "manual", trigger_data: { continueFromFailed: { from: "exec-a", root: "exec-a", all: false, previewRenders: ["cut"] } } }
    expect(await newestGeneration({ ...scope, root: "exec-a" })).toEqual({ id: "exec-c", status: "completed", all: false, previewRenders: ["cut"], reviewHolds: [] })
  })

  it("none: null", async () => {
    expect(await newestGeneration({ ...scope, root: "exec-a" })).toBeNull()
  })

  it("a read error throws (never read as none)", async () => {
    db.error = { message: "down" }
    await expect(newestGeneration({ ...scope, root: "exec-a" })).rejects.toThrow(/unreadable: down/)
  })
})

describe("a lineage stamp is the platform's only on a run the run route started", () => {
  const started = "2026-10-17T10:00:00Z"
  /** A webhook's row whose posted body carried a lineage stamp: "everything is done", naming a lineage. */
  const forged = (all: boolean) => ({
    id: "exec-w",
    status: "completed",
    trigger_type: "webhook",
    trigger_data: { message: "hi", continueFromFailed: { from: "exec-a", root: "exec-a", seededFrom: "exec-a", all } },
  })

  it("a webhook row carrying a forged stamp is no generation: the run is continued, not answered done", async () => {
    db.row = forged(true)
    expect(await newestGeneration({ ...scope, root: "exec-a" })).toBeNull()
    expect(await continuationPointOf({ id: "exec-a", startedAt: started }, scope)).toEqual({ kind: "continue", seedFrom: "exec-a" })
    expect(await supersedingRunOf({ id: "exec-a", startedAt: started }, scope)).toBeNull()
  })

  it("nor is it built on: a forged partial generation does not narrow or re-seed the continuation", async () => {
    db.row = forged(false)
    expect(await continuationPointOf({ id: "exec-a", startedAt: started }, scope)).toEqual({ kind: "continue", seedFrom: "exec-a" })
    db.row = { ...forged(false), trigger_data: { continueFromFailed: { from: "exec-a", root: "exec-a", all: false, previewRenders: ["cut"] } } }
    expect(await continuationPointOf({ id: "exec-a", startedAt: started }, scope)).toEqual({ kind: "continue", seedFrom: "exec-a" })
  })

  it("every lane but the run route's and the app lanes' is ignored; theirs still count", async () => {
    for (const trigger_type of ["webhook", "schedule", "telegram", "telegram_account", "api", "use_case"]) {
      db.row = { ...forged(true), trigger_type }
      expect(await newestGeneration({ ...scope, root: "exec-a" }), trigger_type).toBeNull()
    }
    for (const trigger_type of ["manual", "mcp"]) {
      db.row = { ...forged(true), id: "exec-c", trigger_type }
      expect(await supersedingRunOf({ id: "exec-a", startedAt: started }, scope), trigger_type).toEqual({
        executionId: "exec-c",
        status: "completed",
        neverStarted: false,
      })
    }
  })
})

describe("continuationPointOf: the lineage's newest generation decides", () => {
  const started = "2026-10-17T10:00:00Z"

  it("none: the run itself is continued", async () => {
    expect(await continuationPointOf({ id: "exec-a", startedAt: started }, scope)).toEqual({ kind: "continue", seedFrom: "exec-a" })
  })

  it("the newest is the run itself: it is continued", async () => {
    db.row = gen("exec-b", "failed", false)
    const source = { id: "exec-b", startedAt: started, continueFromFailed: { from: "exec-a", root: "exec-a", all: false } }
    expect(await continuationPointOf(source, scope)).toEqual({ kind: "continue", seedFrom: "exec-b" })
  })

  it("a later one that completed PART of what was left: the run is built on it", async () => {
    db.row = gen("exec-b", "completed", false)
    expect(await continuationPointOf({ id: "exec-a", startedAt: started }, scope)).toEqual({ kind: "continue", seedFrom: "exec-b" })
    // A stamp from before `all`: part, too.
    db.row = gen("exec-b", "completed", undefined)
    expect(await continuationPointOf({ id: "exec-a", startedAt: started }, scope)).toEqual({ kind: "continue", seedFrom: "exec-b" })
  })

  it("a later one that failed supersedes: continue that one", async () => {
    db.row = gen("exec-c", "failed", false)
    expect(await continuationPointOf({ id: "exec-a", startedAt: started }, scope)).toEqual({
      kind: "superseded",
      by: { executionId: "exec-c", status: "failed", neverStarted: false },
    })
  })

  it("a later one that completed all supersedes: the work is done there", async () => {
    db.row = gen("exec-c", "completed", true)
    expect(await continuationPointOf({ id: "exec-a", startedAt: started }, scope)).toEqual({
      kind: "superseded",
      by: { executionId: "exec-c", status: "completed", neverStarted: false },
    })
  })

  const neverStarted = { id: "exec-x", startedAt: null, continueFromFailed: { from: "exec-a", root: "exec-a", all: true } }

  it("never started, nothing later: the run it continued (failed, or it could not have been continued)", async () => {
    expect(await continuationPointOf(neverStarted, scope)).toEqual({
      kind: "superseded",
      by: { executionId: "exec-a", status: "failed", neverStarted: true },
    })
  })

  it("never started, a later failure in its lineage: that one, not the parent it superseded", async () => {
    db.row = gen("exec-c", "failed", true)
    expect(await continuationPointOf(neverStarted, scope)).toEqual({
      kind: "superseded",
      by: { executionId: "exec-c", status: "failed", neverStarted: true },
    })
  })

  it("never started, the newest completed only part: the run it continued — never a completed run to continue", async () => {
    db.row = gen("exec-b", "completed", false)
    expect(await continuationPointOf(neverStarted, scope)).toEqual({
      kind: "superseded",
      by: { executionId: "exec-a", status: "failed", neverStarted: true },
    })
  })

  // A Render final (or a run of named nodes) of a generation: its `from` COMPLETED.
  const neverStartedSubset = { id: "exec-f", startedAt: null, continueFromFailed: { from: "exec-b", root: "exec-a", all: false, via: "subset" as const } }

  it("a subset continuation that never started goes to the lineage's root (it failed), never to the completed run it continued", async () => {
    expect(await continuationPointOf(neverStartedSubset, scope)).toEqual({
      kind: "superseded",
      by: { executionId: "exec-a", status: "failed", neverStarted: true },
    })
    db.row = gen("exec-b", "completed", false)
    expect(await continuationPointOf(neverStartedSubset, scope)).toEqual({
      kind: "superseded",
      by: { executionId: "exec-a", status: "failed", neverStarted: true },
    })
  })

  const stoppedAtPreview = (id = "exec-b") => ({
    id,
    status: "completed",
    trigger_type: "manual",
    trigger_data: { continueFromFailed: { from: "exec-a", root: "exec-a", all: false, previewRenders: ["cut"] } },
  })

  it("the newest completed by stopping at a Preview: its Render final comes first (never a run that stops again)", async () => {
    db.row = stoppedAtPreview()
    expect(await continuationPointOf({ id: "exec-a", startedAt: started }, scope)).toEqual({
      kind: "preview-pending",
      at: "exec-b",
      renderNodeIds: ["cut"],
      reviewNodeIds: [],
    })
    // A continuation that never started is sent there too.
    expect(await continuationPointOf(neverStarted, scope)).toEqual({ kind: "preview-pending", at: "exec-b", renderNodeIds: ["cut"], reviewNodeIds: [] })
    expect(await supersedingRunOf({ id: "exec-a", startedAt: started }, scope)).toBeNull()
  })

  it("the newest completed by stopping at a Tighten Episode review: refused the same way, naming the node (never built on to stop again)", async () => {
    db.row = { id: "exec-b", status: "completed", trigger_type: "manual", trigger_data: { continueFromFailed: { from: "exec-a", root: "exec-a", all: false, reviewHolds: ["t"] } } }
    expect(await continuationPointOf({ id: "exec-a", startedAt: started }, scope)).toEqual({
      kind: "preview-pending",
      at: "exec-b",
      renderNodeIds: [],
      reviewNodeIds: ["t"],
    })
    expect(await continuationPointOf(neverStarted, scope)).toMatchObject({ kind: "preview-pending", reviewNodeIds: ["t"] })
  })

  it("its Render final completed (the newest now) and left nothing: the work is done", async () => {
    db.row = gen("exec-f", "completed", true)
    expect(await continuationPointOf({ id: "exec-a", startedAt: started }, scope)).toEqual({
      kind: "superseded",
      by: { executionId: "exec-f", status: "completed", neverStarted: false },
    })
  })

  it("its Render final left something: the run is built on the final", async () => {
    db.row = { id: "exec-f", status: "completed", trigger_type: "manual", trigger_data: { continueFromFailed: { from: "exec-b", root: "exec-a", all: false, via: "subset" } } }
    expect(await continuationPointOf({ id: "exec-a", startedAt: started }, scope)).toEqual({ kind: "continue", seedFrom: "exec-f" })
  })
})

describe("subsetJoinsLineage", () => {
  const stamped = { id: "exec-b", continueFromFailed: { from: "exec-a", root: "exec-a", all: false } }

  it("a run of no lineage never joins one (no read)", async () => {
    expect(await subsetJoinsLineage({ id: "exec-z" }, scope)).toBe(false)
    expect(await subsetJoinsLineage({ id: "exec-z", continueFromFailed: null }, scope)).toBe(false)
    expect(db.calls).toEqual([])
  })

  it("the lineage's newest generation: joins", async () => {
    db.row = gen("exec-b", "completed", false)
    expect(await subsetJoinsLineage(stamped, scope)).toBe(true)
    expect(db.calls[0]).toContainEqual(["eq", "trigger_data->continueFromFailed->>root", "exec-a"])
  })

  it("an older generation (a newer one exists): stays outside", async () => {
    db.row = gen("exec-c", "completed", false)
    expect(await subsetJoinsLineage(stamped, scope)).toBe(false)
  })
})

describe("previewPendingMessage", () => {
  it("names the run and the render, and the Render final that comes next", () => {
    const message = previewPendingMessage("exec-b", ["cut"])
    expect(message).toContain("exec-b")
    expect(message).toContain('renderFinal: { renderNodeId: "cut" }')
    expect(message).toContain('continueFromExecutionId "exec-b"')
  })

  it("two renders: every one is named, and the one run that finishes them together (renderFinal takes one)", () => {
    const message = previewPendingMessage("exec-b", ["cut1", "cut2"])
    expect(message).toContain('renders "cut1", "cut2"')
    expect(message).not.toContain("renderFinal: {")
    expect(message).toContain('"next"')
    expect(message).toContain("POST /v1/workflows/:id/run")
  })

  it("a review hold: names the node and the run that continues it, never a renderFinal", () => {
    const message = previewPendingMessage("exec-b", [], ["t"])
    expect(message).toContain('the review of "t"')
    expect(message).not.toContain("renderFinal: {")
    expect(message).toContain('"next"')
  })
})

describe("supersedingRunOf", () => {
  const started = "2026-10-17T10:00:00Z"

  it("null whenever the run is continued — on itself or built on a later partial one", async () => {
    expect(await supersedingRunOf({ id: "exec-a", startedAt: started }, scope)).toBeNull()
    db.row = gen("exec-b", "completed", false)
    expect(await supersedingRunOf({ id: "exec-a", startedAt: started }, scope)).toBeNull()
  })

  it("the run it goes to instead, otherwise", async () => {
    db.row = gen("exec-c", "completed", true)
    expect(await supersedingRunOf({ id: "exec-a", startedAt: started }, scope)).toEqual({ executionId: "exec-c", status: "completed", neverStarted: false })
  })
})
