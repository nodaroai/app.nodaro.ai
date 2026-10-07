/**
 * Round 7 (decided 2026-10-06): MCP `plan_edit` on a self-hosted install
 * connected to nodaro.ai.
 *
 * When nodaro.ai can't be reached to learn its modes, that is a TEMPORARY
 * state: refusing an unsupported mode stays with nodaro.ai's own answer, so
 * the tool does not refuse a known mode it could not ask about. It dispatches,
 * and the job meets the video worker's gate, which takes the retryable path
 * ("could not reach nodaro.ai"). A mode nodaro.ai answered it does not plan is
 * still refused before dispatch, and an unknown mode always is.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { registerVerbs } from "../verbs.js"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession, stubRoute } from "./_helpers.js"
import {
  editPlanModeRefusalMessage,
  editPlanModesOf,
  type EditPlanModesAnswer,
} from "../../../private-plugins/edit-plan-mode-gate.js"

const answer = vi.hoisted(() => ({ current: null as unknown }))
vi.mock("../../../private-plugins/plannable-edit-plan-modes.js", () => ({
  plannableEditPlanModes: async () => answer.current,
}))
vi.mock("../../supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: { mcp_preferences: {} }, error: null }),
        }),
      }),
    }),
  },
}))

const transcript = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 500 }] }
const sources = [{ url: "https://a/ep.mp4" }]
const set = (a: EditPlanModesAnswer) => {
  answer.current = a
}

beforeEach(() => _resetRegistry())

describe("plan_edit on a connected self-host", () => {
  it("dispatches trailer when nodaro.ai can't be reached (the job retries; nothing is refused here)", async () => {
    set({ modes: editPlanModesOf({}), source: "nodaro.ai-unreachable" })
    const { fastify, received } = stubRoute("POST", "/v1/edit-plan", { jobId: "j-tr" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "plan_edit", { mode: "trailer", transcript, sources })
    expect(result.isError).toBeUndefined()
    expect(received.body?.mode).toBe("trailer")
  })

  it("still refuses an unknown mode before dispatch during an outage", async () => {
    set({ modes: editPlanModesOf({}), source: "nodaro.ai-unreachable" })
    const { fastify, received } = stubRoute("POST", "/v1/edit-plan", { jobId: "never" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "plan_edit", { mode: "montage", transcript, sources })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain(editPlanModeRefusalMessage("montage"))
    expect(received.body).toBeUndefined()
  })

  it("refuses trailer before dispatch when nodaro.ai answers that it does not plan it", async () => {
    set({ modes: editPlanModesOf({}), source: "nodaro.ai" })
    const { fastify, received } = stubRoute("POST", "/v1/edit-plan", { jobId: "never" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })
    const result = await callTool(server, "plan_edit", { mode: "trailer", transcript, sources })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain(editPlanModeRefusalMessage("trailer"))
    expect(received.body).toBeUndefined()
  })
})
