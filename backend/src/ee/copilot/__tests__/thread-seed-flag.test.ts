/**
 * `createThread` records whether the handshake CREATED the workflow (#904).
 *
 * Two things are pinned here. The flag itself — without it the sweep cannot
 * tell a workflow the copilot made from one the user opened the copilot on,
 * and only the first is ever safe to delete. And the fallback: reads on this
 * table use a star select precisely because staging shares the production
 * database, but an INSERT names its columns, so between the dev merge and the
 * promotion a column-naming insert would take copilot thread creation down
 * entirely.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  /** Error returned for the FIRST insert only; a retry succeeds. */
  firstError: null as unknown,
}))

function makeChain() {
  const chain: Record<string, unknown> = {}
  chain.insert = vi.fn((row: Record<string, unknown>) => {
    state.inserts.push(row)
    return chain
  })
  chain.select = vi.fn(() => chain)
  chain.single = vi.fn(() => {
    const error = state.inserts.length === 1 ? state.firstError : null
    return Promise.resolve(error ? { data: null, error } : { data: { id: "th1" }, error: null })
  })
  return chain
}

vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: () => makeChain() } }))

const { createThread } = await import("../store.js")

beforeEach(() => {
  state.inserts = []
  state.firstError = null
})

describe("createThread — the seeded-workflow flag", () => {
  it("records the flag when the handshake created the workflow", async () => {
    await createThread("u1", "wf1", { createdWorkflow: true })
    expect(state.inserts).toEqual([{ user_id: "u1", workflow_id: "wf1", created_workflow: true }])
  })

  it("does NOT record it when the copilot was opened on an existing workflow", async () => {
    // This workflow is the user's own. Marking it would hand it to the sweep.
    await createThread("u1", "wf1")
    expect(state.inserts).toEqual([{ user_id: "u1", workflow_id: "wf1" }])
  })

  it("retries without the flag when the column is not on the database yet", async () => {
    state.firstError = { code: "42703", message: "column created_workflow does not exist" }
    await expect(createThread("u1", "wf1", { createdWorkflow: true })).resolves.toMatchObject({ id: "th1" })
    expect(state.inserts).toEqual([
      { user_id: "u1", workflow_id: "wf1", created_workflow: true },
      { user_id: "u1", workflow_id: "wf1" },
    ])
  })

  it("still throws on any other insert failure", async () => {
    state.firstError = { code: "23503", message: "workflow_id not present" }
    await expect(createThread("u1", "wf1", { createdWorkflow: true })).rejects.toThrow(/createThread/)
    expect(state.inserts).toHaveLength(1)
  })
})
