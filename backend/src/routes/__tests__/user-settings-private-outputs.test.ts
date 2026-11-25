/**
 * PATCH /v1/user/settings — switching outputs to private also takes the
 * person's existing items out of the public gallery, in the same action;
 * switching back republishes nothing.
 *
 * What the database function does (every public row of THAT user and no one
 * else's, at volume, idempotent, reports reviewed, later rows kept private) is
 * proven against a real Postgres in
 * supabase/tests/private-outputs-hide-existing.behavior.sql. This file pins
 * the route's side of the contract: when the function runs, in what order,
 * and that a failure is never answered as "private".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/config/prompt-templates.js", () => ({
  SYSTEM_PROMPT_TEMPLATES: {},
  applyTemplate: vi.fn(),
}))

import { userSettingsRoutes } from "../user-settings.js"
import { supabase } from "../../lib/supabase.js"

const USER = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance
let profileUpdate: ReturnType<typeof vi.fn>
/** The order the route touched the database in. */
let calls: string[]

function profile(row: Record<string, unknown>) {
  profileUpdate = vi.fn().mockImplementation(() => {
    calls.push("profiles.update")
    return { eq: vi.fn().mockResolvedValue({ error: null }) }
  })
  vi.mocked(supabase.from).mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: row, error: null }) }),
    }),
    update: profileUpdate,
  } as never)
}

function rpcAnswers(...answers: Array<{ data: unknown; error: unknown }>) {
  const queue = [...answers]
  vi.mocked(supabase.rpc).mockImplementation(((name: string) => {
    calls.push(`rpc:${name}`)
    return Promise.resolve(queue.shift() ?? { data: 0, error: null })
  }) as never)
}

const patch = (payload: Record<string, unknown>) =>
  app.inject({ method: "PATCH", url: "/v1/user/settings", payload: { userId: USER, ...payload } })

beforeEach(async () => {
  vi.clearAllMocks()
  calls = []
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const userId = (req.body as Record<string, unknown> | undefined)?.userId
    if (typeof userId === "string") req.userId = userId
  })
  await app.register(async (instance) => {
    await userSettingsRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("switching to private hides the existing items", () => {
  it("true → false runs the transaction for this user, then a second sweep after it committed, and answers the sum", async () => {
    profile({ tier: "pro", public_outputs: true })
    // The second answer is a generation that completed while the first
    // transaction was open: it read the old (public) preference, so only a
    // sweep after the commit can take it out.
    rpcAnswers({ data: 8221, error: null }, { data: 1, error: null })

    const res = await patch({ publicOutputs: false })

    expect(res.statusCode).toBe(200)
    expect(calls).toEqual(["rpc:make_outputs_private", "rpc:make_outputs_private"])
    expect(vi.mocked(supabase.rpc).mock.calls).toEqual([
      ["make_outputs_private", { p_user_id: USER }],
      ["make_outputs_private", { p_user_id: USER }],
    ])
    expect(res.json().data).toMatchObject({ publicOutputs: false, hiddenFromGallery: 8222 })
    // The preference is written INSIDE that transaction, never on its own.
    expect(profileUpdate).not.toHaveBeenCalled()
  })

  it("scopes the hide to the signed-in user, never one named in the body", async () => {
    profile({ tier: "pro", public_outputs: true })
    rpcAnswers({ data: 3, error: null })

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/user/settings",
      payload: { userId: USER, publicOutputs: false, user_id: "someone-else", p_user_id: "someone-else" },
    })

    expect(res.statusCode).toBe(200)
    expect(supabase.rpc).toHaveBeenCalledWith("make_outputs_private", { p_user_id: USER })
  })

  it("is safe to repeat: an already-private user sending false again runs it again and hides 0", async () => {
    profile({ tier: "pro", public_outputs: false })
    rpcAnswers({ data: 0, error: null }, { data: 0, error: null })

    const res = await patch({ publicOutputs: false })

    expect(res.statusCode).toBe(200)
    expect(supabase.rpc).toHaveBeenCalledWith("make_outputs_private", { p_user_id: USER })
    expect(res.json().data).toMatchObject({ publicOutputs: false, hiddenFromGallery: 0 })
  })

  it("runs before any other field in the same request is written", async () => {
    profile({ tier: "pro", public_outputs: true })
    rpcAnswers({ data: 5, error: null }, { data: 0, error: null })

    const res = await patch({ publicOutputs: false, showRecentNodes: true })

    expect(res.statusCode).toBe(200)
    expect(calls).toEqual(["rpc:make_outputs_private", "rpc:make_outputs_private", "profiles.update"])
    expect(profileUpdate).toHaveBeenCalledWith({ show_recent_nodes: true })
    expect(res.json().data).toMatchObject({ publicOutputs: false, showRecentNodes: true, hiddenFromGallery: 5 })
  })
})

describe("a failed hide is never answered as private", () => {
  it("a database error answers 500 and writes nothing else", async () => {
    profile({ tier: "pro", public_outputs: true })
    rpcAnswers({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } })

    const res = await patch({ publicOutputs: false, showRecentNodes: true })

    expect(res.statusCode).toBe(500)
    expect(res.json().data).toBeUndefined()
    expect(res.json().error).toMatch(/try again/)
    expect(profileUpdate).not.toHaveBeenCalled()
    // No second sweep after a failed first call.
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
  })

  it("a failed second sweep is an error too, never a saved \"private\"", async () => {
    profile({ tier: "pro", public_outputs: true })
    rpcAnswers({ data: 7, error: null }, { data: null, error: { code: "57014", message: "statement timeout" } })

    const res = await patch({ publicOutputs: false, showRecentNodes: true })

    expect(res.statusCode).toBe(500)
    expect(res.json().data).toBeUndefined()
    expect(profileUpdate).not.toHaveBeenCalled()
  })

  it("a database without the function yet (staging before main deploys) answers 503 and writes nothing", async () => {
    profile({ tier: "pro", public_outputs: true })
    rpcAnswers({ data: null, error: { code: "PGRST202", message: "Could not find the function public.make_outputs_private(p_user_id) in the schema cache" } })

    const res = await patch({ publicOutputs: false })

    expect(res.statusCode).toBe(503)
    expect(res.json().data).toBeUndefined()
    expect(profileUpdate).not.toHaveBeenCalled()
  })

  it("a retry after a failure goes through", async () => {
    profile({ tier: "pro", public_outputs: true })
    rpcAnswers(
      { data: null, error: { code: "40P01", message: "deadlock detected" } },
      { data: 42, error: null },
      { data: 0, error: null },
    )

    expect((await patch({ publicOutputs: false })).statusCode).toBe(500)
    const retry = await patch({ publicOutputs: false })

    expect(retry.statusCode).toBe(200)
    expect(retry.json().data).toMatchObject({ publicOutputs: false, hiddenFromGallery: 42 })
  })

  it("a plan below Standard is refused before anything runs", async () => {
    profile({ tier: "free", public_outputs: true })
    rpcAnswers()

    const res = await patch({ publicOutputs: false })

    expect(res.statusCode).toBe(403)
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(profileUpdate).not.toHaveBeenCalled()
  })
})

describe("switching back to public republishes nothing", () => {
  it("false → true is a plain preference write: no gallery change at all", async () => {
    profile({ tier: "pro", public_outputs: false })
    rpcAnswers()

    const res = await patch({ publicOutputs: true })

    expect(res.statusCode).toBe(200)
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(profileUpdate).toHaveBeenCalledWith({ public_outputs: true })
    // No write to jobs: `from` is only ever asked for the profile.
    expect(vi.mocked(supabase.from).mock.calls.every(([table]) => table === "profiles")).toBe(true)
    expect(res.json().data).toMatchObject({ publicOutputs: true, hiddenFromGallery: 0 })
  })

  it("a request that does not send publicOutputs touches no gallery item", async () => {
    profile({ tier: "pro", public_outputs: true })
    rpcAnswers()

    const res = await patch({ showRecentNodes: false })

    expect(res.statusCode).toBe(200)
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(res.json().data.hiddenFromGallery).toBe(0)
  })

  it("an empty patch is still refused", async () => {
    profile({ tier: "pro", public_outputs: true })
    rpcAnswers()

    const res = await patch({})

    expect(res.statusCode).toBe(400)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})
