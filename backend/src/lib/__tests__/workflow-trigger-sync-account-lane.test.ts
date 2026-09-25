/**
 * The Telegram ACCOUNT lane is the owner's to arm. Trigger rows are always
 * written under the workflow's owner, whoever saved — so a save by anyone else
 * (an editor of a shared workflow) must leave the lane exactly as stored, and
 * even the owner can only point it at one of their OWN connected accounts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/telegram-trigger-activation.js", () => ({
  ensureBotRegistration: vi.fn(),
  syncBotRegistration: vi.fn(async () => undefined),
  TelegramActivationError: class TelegramActivationError extends Error {},
}))
vi.mock("@/lib/runtime-env.js", () => ({ getRuntimeEnv: () => "test" }))

import { reconcileWorkflowTriggers } from "../workflow-trigger-sync.js"
import { supabase } from "../supabase.js"

const OWNER = "00000000-0000-4000-8000-0000000000ff"
const WF = "00000000-0000-4000-8000-000000000020"
const OWN_ACCOUNT = "11111111-1111-4111-8111-111111111111"
const OTHER_ACCOUNT = "22222222-2222-4222-8222-222222222222"

const accountNode = (id: string, accountId: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "telegram-account-trigger",
  data: { accountId, isActive: true, ...extra },
})

function tables(existing: Array<Record<string, unknown>>, ownedAccountIds: string[]) {
  const writes = { inserts: [] as Array<Record<string, unknown>>, updates: [] as Array<Record<string, unknown>>, deletes: 0 }
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "eq", "in"]) chain[m] = vi.fn(() => chain)
    if (table === "plugin_account_secrets") {
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: ownedAccountIds.map((id) => ({ id })), error: null })
      return chain
    }
    if (table !== "workflow_triggers") throw new Error(`unexpected table ${table}`)
    chain.insert = vi.fn((rows: Array<Record<string, unknown>>) => {
      writes.inserts.push(...rows)
      return { then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }) }
    })
    chain.update = vi.fn((patch: Record<string, unknown>) => {
      writes.updates.push(patch)
      return chain
    })
    chain.delete = vi.fn(() => {
      writes.deletes += 1
      return chain
    })
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: existing, error: null })
    return chain
  }) as never)
  return writes
}

const storedRow = {
  id: "row-1",
  type: "telegram_account",
  config: { nodeId: "ta1", accountId: OWN_ACCOUNT, chatIds: ["-1001"], senderIds: [], messageTypeFilters: [], keywords: [], includeOutgoing: false },
  is_active: true,
  webhook_token: null,
}

beforeEach(() => vi.clearAllMocks())

describe("the account lane is the owner's to arm", () => {
  it("a save by anyone but the owner creates nothing on the lane", async () => {
    const writes = tables([], [OWN_ACCOUNT])
    await reconcileWorkflowTriggers({ workflowId: WF, userId: OWNER, nodes: [accountNode("ta1", OWN_ACCOUNT)] })
    expect(writes.inserts).toHaveLength(0)
  })

  it("a save by anyone but the owner cannot widen, re-point or remove a stored row", async () => {
    const widened = tables([storedRow], [OWN_ACCOUNT])
    await reconcileWorkflowTriggers({
      workflowId: WF,
      userId: OWNER,
      nodes: [accountNode("ta1", OWN_ACCOUNT, { chatIds: [], includeOutgoing: true })],
    })
    expect(widened).toEqual({ inserts: [], updates: [], deletes: 0 })

    const removed = tables([storedRow], [OWN_ACCOUNT])
    await reconcileWorkflowTriggers({ workflowId: WF, userId: OWNER, nodes: [] })
    expect(removed).toEqual({ inserts: [], updates: [], deletes: 0 })
  })

  it("the owner arms it on their own account", async () => {
    const writes = tables([], [OWN_ACCOUNT])
    await reconcileWorkflowTriggers({ workflowId: WF, userId: OWNER, nodes: [accountNode("ta1", OWN_ACCOUNT)], ownerActing: true })
    expect(writes.inserts).toEqual([
      expect.objectContaining({ type: "telegram_account", is_active: true, config: expect.objectContaining({ accountId: OWN_ACCOUNT, nodeId: "ta1" }) }),
    ])
  })

  it("even the owner cannot point it at an account that is not theirs", async () => {
    const writes = tables([], [OWN_ACCOUNT])
    await reconcileWorkflowTriggers({
      workflowId: WF,
      userId: OWNER,
      nodes: [accountNode("ta1", OTHER_ACCOUNT), accountNode("ta2", "not-a-uuid")],
      ownerActing: true,
    })
    expect(writes.inserts).toHaveLength(0)
  })
})
