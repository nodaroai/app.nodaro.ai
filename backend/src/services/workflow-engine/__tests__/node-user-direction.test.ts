/**
 * The workflow lane's step for a node whose stored `direction` names the
 * caller's palette / moodboard (`userDirectionForNode`, called by the node
 * executor BEFORE any jobs row): it resolves through the SAME
 * `resolveUserDirection` the route uses, each value among the rows of whoever
 * SUPPLIED it — a value saved in the graph the run loaded is the workflow
 * owner's, anything else (a run request's override, a published app's input) the
 * runner's — and turns a refusal into a node error that names the key.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { argOf, type QueryResult, type RecordedQuery } from "../../../lib/__tests__/fake-supabase-query.js"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  respond: null as null | ((q: RecordedQuery) => QueryResult),
}))

vi.mock("../../../lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../../lib/__tests__/fake-supabase-query.js")
  return { supabase: { from: makeFakeFrom(db.log, (q) => db.respond!(q)) } }
})

import { savedUserDirectionRefs, userDirectionForNode } from "../node-user-direction.js"
import type { SimpleNode } from "../types.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const RUNNER = "00000000-0000-4000-8000-000000000002"
const PALETTE = "palette:0f9e8d7c-6b5a-4c3d-9e2f-1a2b3c4d5e6f"
const MOODBOARD = "moodboard:1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"

const node = (type: string, data: Record<string, unknown>): SimpleNode => ({ id: "n1", type, data })

beforeEach(() => {
  db.log.length = 0
  db.respond = (q) =>
    q.table === "color_palettes"
      ? { data: { id: "0f9e8d7c-6b5a-4c3d-9e2f-1a2b3c4d5e6f", name: "Harbour", colors: ["#000000", "#FFFFFF"] }, error: null }
      : { data: null, error: null }
})

describe("userDirectionForNode", () => {
  it("answers nothing, reading nothing, for a node that names no palette or moodboard", async () => {
    expect(await userDirectionForNode(node("generate-image", { direction: { style: "anime" } }), { userId: RUNNER })).toBeUndefined()
    expect(await userDirectionForNode(node("generate-video", { prompt: "x" }), { userId: RUNNER })).toBeUndefined()
    expect(db.log).toHaveLength(0)
  })

  it("resolves a value SAVED in the graph among the workflow owner's rows only", async () => {
    const saved = savedUserDirectionRefs([node("generate-image", { direction: { colorLook: PALETTE } })])
    const resolved = await userDirectionForNode(
      node("generate-image", { direction: { colorLook: PALETTE } }),
      { userId: RUNNER, workflowOwnerId: OWNER, savedDirectionRefs: saved },
    )
    expect(resolved?.refs.has(PALETTE)).toBe(true)
    expect(argOf(db.log[0], "in")).toEqual(["user_id", [OWNER]])
  })

  it("resolves a value the run SUPPLIED (an override) among the runner's rows only — never the owner's", async () => {
    // The app's snapshot saved no moodboard; the runner's override names one.
    const saved = savedUserDirectionRefs([node("generate-image", { direction: { colorLook: PALETTE } })])
    db.respond = (q) => q.table === "moodboards" && (argOf(q, "in")?.[1] as string[]).includes(OWNER)
      ? { data: { id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", name: "Creator's", description: "secret", images: [] }, error: null }
      : q.table === "color_palettes"
        ? { data: { id: "0f9e8d7c-6b5a-4c3d-9e2f-1a2b3c4d5e6f", name: "Harbour", colors: ["#000000", "#FFFFFF"] }, error: null }
        : { data: null, error: null }
    const err = await userDirectionForNode(
      node("generate-image", { direction: { colorLook: PALETTE, style: MOODBOARD } }),
      { userId: RUNNER, workflowOwnerId: OWNER, savedDirectionRefs: saved },
    ).catch((e: unknown) => e) as Error & { errorCode?: string }
    expect(err.errorCode).toBe("direction_not_found")
    expect(err.message).toContain("direction.style")
    const palette = db.log.find((q) => q.table === "color_palettes")!
    const moodboard = db.log.find((q) => q.table === "moodboards")!
    expect(argOf(palette, "in")).toEqual(["user_id", [OWNER]])
    expect(argOf(moodboard, "in")).toEqual(["user_id", [RUNNER]])
  })

  it("an overriding value that changes a saved one is the runner's too", async () => {
    const saved = savedUserDirectionRefs([node("generate-image", { direction: { colorLook: PALETTE } })])
    const other = "palette:2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e"
    await userDirectionForNode(
      node("generate-image", { direction: { colorLook: other } }),
      { userId: RUNNER, workflowOwnerId: OWNER, savedDirectionRefs: saved },
    )
    expect(argOf(db.log[0], "in")).toEqual(["user_id", [RUNNER]])
  })

  it("a node the run did not load at the top (an inline sub-workflow's, never overridden) is the owner's", async () => {
    const saved = savedUserDirectionRefs([node("text-prompt", { prompt: "x" })])
    await userDirectionForNode(
      { id: "inner-1", type: "generate-image", data: { direction: { colorLook: PALETTE } } },
      { userId: RUNNER, workflowOwnerId: OWNER, savedDirectionRefs: saved },
    )
    expect(argOf(db.log[0], "in")).toEqual(["user_id", [OWNER]])
  })

  it("with no record of what was saved, every value is the runner's (fails closed)", async () => {
    await userDirectionForNode(
      node("generate-image", { direction: { colorLook: PALETTE } }),
      { userId: RUNNER, workflowOwnerId: OWNER },
    )
    expect(argOf(db.log[0], "in")).toEqual(["user_id", [RUNNER]])
  })

  it("savedUserDirectionRefs records each node's own palette / moodboard values, and only those", () => {
    const saved = savedUserDirectionRefs([
      node("generate-image", { direction: { colorLook: PALETTE, style: [MOODBOARD], lighting: "golden-hour" } }),
      { id: "n2", type: "generate-image", data: { prompt: "x" } },
    ])
    expect([...saved.get("n1")!].sort()).toEqual([MOODBOARD, PALETTE].sort())
    expect(saved.get("n2")?.size).toBe(0)
  })

  it("is the runner alone when the run has no separate owner", async () => {
    await userDirectionForNode(node("generate-image", { direction: { colorLook: PALETTE } }), { userId: RUNNER })
    expect(argOf(db.log[0], "in")).toEqual(["user_id", [RUNNER]])
  })

  it("fails the node with direction_not_found when the palette is not theirs", async () => {
    db.respond = () => ({ data: null, error: null })
    const err = await userDirectionForNode(node("generate-image", { direction: { colorLook: PALETTE } }), { userId: RUNNER })
      .catch((e: unknown) => e) as Error & { errorCode?: string }
    expect(err).toBeInstanceOf(Error)
    expect(err.errorCode).toBe("direction_not_found")
    expect(err.message).toContain("direction.colorLook")
  })

  it("fails the node with a validation error for a malformed reference, reading nothing", async () => {
    const err = await userDirectionForNode(node("generate-image", { direction: { colorLook: "palette:warm" } }), { userId: RUNNER })
      .catch((e: unknown) => e) as Error & { errorCode?: string }
    expect(err.errorCode).toBe("validation_error")
    expect(db.log).toHaveLength(0)
  })

  it("refuses a palette on any other node type rather than folding nothing", async () => {
    const err = await userDirectionForNode(node("generate-video", { direction: { colorLook: PALETTE } }), { userId: RUNNER })
      .catch((e: unknown) => e) as Error & { errorCode?: string }
    expect(err.errorCode).toBe("validation_error")
    expect(err.message).toMatch(/generate-image only|Generate Image/i)
    expect(db.log).toHaveLength(0)
  })
})
