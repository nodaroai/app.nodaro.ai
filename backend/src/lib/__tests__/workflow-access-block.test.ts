import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A blocked account runs nothing (`canRunWorkflow`).
 *
 * Every trigger lane — schedules, webhooks, Telegram, plugin triggers — asks
 * `canRunWorkflow` before it starts a run, so they all stop with the account
 * and resume when it is unblocked. The block is asked FIRST: no workflow read,
 * no plugin consulted, whatever either would have answered.
 */

const BLOCKED = "00000000-0000-4000-8000-0000000000b1"
const ME = "00000000-0000-4000-8000-000000000001"
const SOMEONE_ELSE = "00000000-0000-4000-8000-0000000000ff"
const WF = "00000000-0000-4000-8000-000000000020"

const access = vi.hoisted(() => {
  const blocked = new Set<string>()
  return {
    blocked,
    isUserBlocked: vi.fn(async (id: string | null | undefined) => (id ? blocked.has(id) : false)),
  }
})

vi.mock("../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../private-plugins/load.js", () => ({ getPluginServices: vi.fn(() => ({})) }))
vi.mock("../config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config.js")>()),
  hasOrganizations: vi.fn(() => true),
}))
vi.mock("../access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../access-blocks.js")>()),
  isUserBlocked: (id: string | null | undefined) => access.isUserBlocked(id),
  anyUserBlocked: async () => access.blocked.size > 0,
}))

import { canRunWorkflow } from "../workflow-access.js"
import { supabase } from "../supabase.js"
import { hasOrganizations } from "../config.js"
import { getPluginServices } from "../private-plugins/load.js"

/** `.from("workflows").select("user_id").eq("id", …).maybeSingle()` */
function ownerRow(row: { user_id: string } | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  vi.mocked(supabase.from).mockReturnValue({ select } as never)
}

/** A fully capable organizations plugin that would let anyone run anything. */
function permissivePlugin() {
  const orgs = {
    workflowAccess: vi.fn().mockResolvedValue("own"),
    workflowAccessFromRow: vi.fn().mockResolvedValue("own"),
    canDeleteWorkflow: vi.fn().mockResolvedValue(true),
    canRunWorkflow: vi.fn().mockResolvedValue(true),
    canChangeWorkflowVisibility: vi.fn().mockResolvedValue(true),
    canShareWorkflow: vi.fn().mockResolvedValue(true),
  }
  vi.mocked(getPluginServices).mockReturnValue({ orgs } as never)
  return orgs
}

beforeEach(() => {
  vi.clearAllMocks()
  access.blocked.clear()
  access.blocked.add(BLOCKED)
  vi.mocked(getPluginServices).mockReturnValue({} as never)
  vi.mocked(hasOrganizations).mockReturnValue(true)
})

describe("canRunWorkflow for a blocked account", () => {
  it("is false for the account's OWN workflow, without reading it", async () => {
    ownerRow({ user_id: BLOCKED })
    await expect(canRunWorkflow(BLOCKED, WF)).resolves.toBe(false)
    expect(access.isUserBlocked).toHaveBeenCalledWith(BLOCKED)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("is false even where the organizations plugin would say yes — it is never consulted", async () => {
    const orgs = permissivePlugin()
    await expect(canRunWorkflow(BLOCKED, WF)).resolves.toBe(false)
    expect(orgs.canRunWorkflow).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("…with organizations switched off too", async () => {
    vi.mocked(hasOrganizations).mockReturnValue(false)
    ownerRow({ user_id: BLOCKED })
    await expect(canRunWorkflow(BLOCKED, WF)).resolves.toBe(false)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("runs again once unblocked", async () => {
    ownerRow({ user_id: BLOCKED })
    await expect(canRunWorkflow(BLOCKED, WF)).resolves.toBe(false)
    access.blocked.delete(BLOCKED)
    await expect(canRunWorkflow(BLOCKED, WF)).resolves.toBe(true)
  })
})

describe("canRunWorkflow on a blocked OWNER's workflow", () => {
  // A teammate's schedule on it would otherwise start a run every tick, each
  // failing at pickup — and use up the schedule's run limit doing it.
  it("is false for everyone, whatever the organizations plugin would say", async () => {
    const orgs = permissivePlugin()
    ownerRow({ user_id: BLOCKED })
    await expect(canRunWorkflow(ME, WF)).resolves.toBe(false)
    expect(supabase.from).toHaveBeenCalledWith("workflows")
    expect(orgs.canRunWorkflow).not.toHaveBeenCalled()
  })

  it("runs again once the owner is unblocked", async () => {
    permissivePlugin()
    ownerRow({ user_id: BLOCKED })
    await expect(canRunWorkflow(ME, WF)).resolves.toBe(false)
    access.blocked.delete(BLOCKED)
    await expect(canRunWorkflow(ME, WF)).resolves.toBe(true)
  })

  it("reads nothing more while nobody at all is blocked", async () => {
    access.blocked.clear()
    const orgs = permissivePlugin()
    await expect(canRunWorkflow(ME, WF)).resolves.toBe(true)
    expect(supabase.from).not.toHaveBeenCalled()
    expect(orgs.canRunWorkflow).toHaveBeenCalledWith(ME, WF)
  })
})

describe("canRunWorkflow for an account that is not blocked — the existing rule, unchanged", () => {
  it("without a plugin: the creator runs, nobody else does", async () => {
    ownerRow({ user_id: ME })
    await expect(canRunWorkflow(ME, WF)).resolves.toBe(true)
    expect(supabase.from).toHaveBeenCalledWith("workflows")

    ownerRow({ user_id: SOMEONE_ELSE })
    await expect(canRunWorkflow(ME, WF)).resolves.toBe(false)

    ownerRow(null)
    await expect(canRunWorkflow(ME, WF)).resolves.toBe(false)
  })

  it("with a capable plugin: delegates, and does not second-guess the answer", async () => {
    access.blocked.clear() // nobody is blocked: the owner is not even read
    const orgs = permissivePlugin()
    await expect(canRunWorkflow(ME, WF)).resolves.toBe(true)
    expect(orgs.canRunWorkflow).toHaveBeenCalledWith(ME, WF)

    orgs.canRunWorkflow.mockResolvedValueOnce(false)
    await expect(canRunWorkflow(ME, WF)).resolves.toBe(false)
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
