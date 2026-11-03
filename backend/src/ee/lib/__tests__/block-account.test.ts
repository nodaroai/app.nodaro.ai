/**
 * Blocking an account, every step (ee/lib/block-account.ts): a refusal writes
 * nothing; the refusals are asked again once the row exists and an account
 * that changed meanwhile has the row taken back; a block tells every
 * process's snapshot and the auth cache, then converges the sign-in ban, and
 * a ban that could not be converged is answered, not thrown (the block stands).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const steps = vi.hoisted(() => ({
  log: [] as string[],
  refusals: [] as Array<string | null | Error>,
  converge: async (): Promise<{ signInBlocked: boolean; ours: boolean }> => ({ signInBlocked: true, ours: true }),
}))

vi.mock("../account-blocking.js", () => ({
  blockRefusal: vi.fn(async (admin: string, user: string) => {
    steps.log.push(`refusal?:${admin}:${user}`)
    const answer = steps.refusals.shift() ?? null
    if (answer instanceof Error) throw answer
    return answer
  }),
  writeBlockRow: vi.fn(async (user: string, admin: string, reason: string | null) => {
    steps.log.push(`write:${user}:${admin}:${reason}`)
  }),
  deleteBlockRow: vi.fn(async (user: string) => {
    steps.log.push(`delete:${user}`)
    return true
  }),
  convergeSignInBan: vi.fn(async (user: string) => {
    steps.log.push(`converge:${user}`)
    return steps.converge()
  }),
}))
vi.mock("../../../lib/access-blocks.js", () => ({ invalidateAccessBlocks: vi.fn(() => steps.log.push("snapshot")) }))
vi.mock("../../../middleware/auth.js", () => ({ invalidateAuthCache: vi.fn((user: string) => steps.log.push(`auth-cache:${user}`)) }))

import { blockAccount } from "../block-account.js"

beforeEach(() => {
  steps.log = []
  steps.refusals = []
  steps.converge = async () => ({ signInBlocked: true, ours: true })
})

describe("blockAccount", () => {
  it("writes the row, asks again, tells the snapshot and the auth cache, then converges the sign-in ban", async () => {
    await expect(blockAccount("admin-1", "user-1", "Closed under the policy")).resolves.toEqual({ refused: null, signInBlocked: true, signInError: null })
    expect(steps.log).toEqual([
      "refusal?:admin-1:user-1",
      "write:user-1:admin-1:Closed under the policy",
      "refusal?:admin-1:user-1",
      "snapshot",
      "auth-cache:user-1",
      "converge:user-1",
    ])
  })

  it("a refusal writes nothing", async () => {
    steps.refusals = ["target_is_admin"]
    await expect(blockAccount("admin-1", "user-1", null)).resolves.toEqual({ refused: "target_is_admin" })
    expect(steps.log).toEqual(["refusal?:admin-1:user-1"])
  })

  it("an account promoted between the read and the write has the row taken back, and is refused", async () => {
    steps.refusals = [null, "target_is_admin"]
    await expect(blockAccount("admin-1", "user-1", null)).resolves.toEqual({ refused: "target_is_admin" })
    expect(steps.log).toEqual(["refusal?:admin-1:user-1", "write:user-1:admin-1:null", "refusal?:admin-1:user-1", "delete:user-1", "snapshot"])
  })

  it("a second read that fails still tells every process the row was written, and the failure is thrown", async () => {
    steps.refusals = [null, new Error("profiles down")]
    await expect(blockAccount("admin-1", "user-1", null)).rejects.toThrow("profiles down")
    expect(steps.log).toEqual(["refusal?:admin-1:user-1", "write:user-1:admin-1:null", "refusal?:admin-1:user-1", "snapshot"])
  })

  it("a sign-in ban that could not be converged is answered: the block stands", async () => {
    const failure = new Error("auth down")
    steps.converge = async () => {
      throw failure
    }
    await expect(blockAccount("admin-1", "user-1", null)).resolves.toEqual({ refused: null, signInBlocked: false, signInError: failure })
    expect(steps.log.at(-1)).toBe("converge:user-1")
  })
})
