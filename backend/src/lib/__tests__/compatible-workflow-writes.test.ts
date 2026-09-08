import { describe, expect, it, vi } from "vitest"
const rpc = vi.hoisted(() => vi.fn())
vi.mock("../supabase.js", () => ({ supabase: { rpc } }))
import { writeCompatible } from "../compatible-workflow-writes.js"

describe("compatible workflow transport", () => {
  it("passes the reviewed revision and preserves a lost CAS as no row", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null })
    expect(await writeCompatible({ kind: "update", workflowId: "film", expectedVersion: 7, patch: { settings: {} } }))
      .toEqual({ data: null, error: null })
    expect(rpc).toHaveBeenLastCalledWith("compare_and_swap_compatible_workflow", {
      p_workflow_id: "film", p_expected_version: 7, p_patch: { settings: {} },
    })
  })
  it("returns the database-created identity and preserves refusals", async () => {
    rpc.mockResolvedValueOnce({ data: [{ id: "new", version: 1 }], error: null })
    expect(await writeCompatible({ kind: "create", row: { name: "Film" } })).toEqual({ data: { id: "new", version: 1 }, error: null })
    expect(rpc).toHaveBeenLastCalledWith("create_compatible_workflow", { p_row: { name: "Film" } })
    const error = { code: "PT409", message: "production_capability_required" }
    rpc.mockResolvedValueOnce({ data: null, error })
    expect(await writeCompatible({ kind: "update", workflowId: "film", expectedVersion: 1, patch: {} }))
      .toEqual({ data: null, error })
  })
})
