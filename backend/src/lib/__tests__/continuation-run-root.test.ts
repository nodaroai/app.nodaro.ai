import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  /** The execution row's `trigger_data` the read answers. */
  triggerData: undefined as unknown,
  /** Its `trigger_type`: an app run's by default (a stamp is read only on a stamp-writing lane's row). */
  triggerType: "app_run" as string,
  selects: [] as string[],
  readError: null as { message: string } | null,
  writeError: null as { message: string } | null,
  updates: [] as Array<{ values: Record<string, unknown>; id: unknown }>,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: (columns: string) => {
        db.selects.push(columns)
        return {
        eq: () => ({
          maybeSingle: async () => ({ data: db.readError ? null : { trigger_type: db.triggerType, trigger_data: db.triggerData }, error: db.readError }),
        }),
        }
      },
      update: (values: Record<string, unknown>) => ({
        eq: async (_col: string, id: unknown) => {
          db.updates.push({ values, id })
          return { error: db.writeError }
        },
      }),
    }),
  },
}))

import { continuationRootOf, pinRunRoot, runRootOf } from "../continuation-run-root.js"
import { ugcClipRunKey } from "../../services/workflow-engine/ugc-sync-nodes.js"

beforeEach(() => {
  db.triggerData = undefined
  db.triggerType = "app_run"
  db.selects.length = 0
  db.readError = null
  db.writeError = null
  db.updates.length = 0
})

/** A generation continuing `source`, as the orchestrator builds it at pickup (root decided, then written). */
function continueFrom(id: string, source: { id: string; runRoot?: string | null }): { id: string; runRoot: string } {
  return { id, runRoot: continuationRootOf(source) }
}

describe("a continuation chain's root", () => {
  it("is the same for every generation: A -> B -> C -> D all name A", () => {
    const a = { id: "exec-a" }
    const b = continueFrom("exec-b", a)
    const c = continueFrom("exec-c", b)
    const d = continueFrom("exec-d", c)
    expect([b.runRoot, c.runRoot, d.runRoot]).toEqual(["exec-a", "exec-a", "exec-a"])
    const keys = [b, c, d].map((g) => ugcClipRunKey({ isAppRun: true, executionId: g.id, runRootExecutionId: g.runRoot }))
    expect(new Set(keys)).toEqual(new Set(["exec-a"]))
  })

  it("two unrelated runs have different roots, so their clips are never shared", () => {
    const one = continueFrom("exec-b1", { id: "exec-a1" })
    const two = continueFrom("exec-b2", { id: "exec-a2" })
    expect(ugcClipRunKey({ isAppRun: true, executionId: one.id, runRootExecutionId: one.runRoot }))
      .not.toBe(ugcClipRunKey({ isAppRun: true, executionId: two.id, runRootExecutionId: two.runRoot }))
  })

  it("follows a continue-from-failed lineage's root when the source carries no root of its own", () => {
    expect(continuationRootOf({ id: "exec-c", continueFromFailed: { root: "exec-a" } })).toBe("exec-a")
    // A written root wins over the lineage's (it was decided from the chain's first run).
    expect(continuationRootOf({ id: "exec-c", runRoot: "exec-r", continueFromFailed: { root: "exec-a" } })).toBe("exec-r")
  })

  it("reads only its own stamp out of trigger_data", () => {
    expect(runRootOf({ runRoot: { executionId: "exec-a" }, appRun: { appRunId: "run-1" } })).toBe("exec-a")
    for (const bad of [null, undefined, "x", [], {}, { runRoot: "exec-a" }, { runRoot: { executionId: "" } }, { appRun: { appRunId: "run-1" } }]) {
      expect(runRootOf(bad)).toBeNull()
    }
  })
})

describe("UGC Clip's runKey", () => {
  it("off an app run: none, continuation or not (unchanged)", () => {
    expect(ugcClipRunKey({ isAppRun: false, executionId: "exec-1" })).toBeUndefined()
    expect(ugcClipRunKey({ isAppRun: undefined, executionId: "exec-1", runRootExecutionId: "exec-a" })).toBeUndefined()
  })

  it("an app run that continues nothing: exactly its own execution (unchanged)", () => {
    expect(ugcClipRunKey({ isAppRun: true, executionId: "exec-1" })).toBe("exec-1")
  })

  it("an app run's continuation: the chain's root", () => {
    expect(ugcClipRunKey({ isAppRun: true, executionId: "exec-2", runRootExecutionId: "exec-1" })).toBe("exec-1")
  })
})

describe("pinRunRoot", () => {
  it("writes the root beside the stamps trigger_data already holds", async () => {
    db.triggerData = { appRenderFinal: { appRunId: "run-1" } }
    await pinRunRoot("exec-2", "exec-1")
    expect(db.updates).toEqual([{ values: { trigger_data: { appRenderFinal: { appRunId: "run-1" }, runRoot: { executionId: "exec-1" } } }, id: "exec-2" }])
  })

  it("a row with no trigger_data gets the root alone; one already holding it is left as it is", async () => {
    db.triggerData = null
    await pinRunRoot("exec-2", "exec-1")
    expect(db.updates[0]!.values).toEqual({ trigger_data: { runRoot: { executionId: "exec-1" } } })
    db.updates.length = 0
    db.triggerData = { runRoot: { executionId: "exec-1" } }
    await pinRunRoot("exec-2", "exec-1")
    expect(db.updates).toEqual([])
    expect(db.selects.every((c) => c.includes("trigger_type"))).toBe(true)
  })

  it("a root on a row no stamp-writing lane started is not taken as already written (lib/server-started-runs.ts)", async () => {
    db.triggerType = "webhook"
    db.triggerData = { runRoot: { executionId: "exec-1" } }
    await pinRunRoot("exec-2", "exec-1")
    expect(db.updates).toEqual([{ values: { trigger_data: { runRoot: { executionId: "exec-1" } } }, id: "exec-2" }])
  })

  it("never throws: a failed read writes nothing, a failed write is only logged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    db.readError = { message: "down" }
    await expect(pinRunRoot("exec-2", "exec-1")).resolves.toBeUndefined()
    expect(db.updates).toEqual([])
    db.readError = null
    db.writeError = { message: "down" }
    await expect(pinRunRoot("exec-2", "exec-1")).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})
