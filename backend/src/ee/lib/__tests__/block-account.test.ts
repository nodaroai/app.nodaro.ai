/**
 * Blocking an account, every step (ee/lib/block-account.ts): a refusal writes
 * nothing; the refusals are asked again once the row exists and an account
 * that changed meanwhile has the row taken back; a block tells every
 * process's snapshot and the auth cache, then converges the sign-in ban, and
 * a ban that could not be converged is answered, not thrown (the block stands).
 * The same steps after a suspension was recorded (its row is the refusal, so
 * nothing is written here), and after one was lifted.
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

import { blockAccount, enforceSuspension, releaseSuspension } from "../block-account.js"

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

describe("enforceSuspension", () => {
  it("asks again, tells the snapshot and the auth cache, then converges the sign-in ban; writes no block", async () => {
    await expect(enforceSuspension("admin-1", "user-1")).resolves.toEqual({ refused: null, signInBlocked: true, signInError: null })
    expect(steps.log).toEqual(["refusal?:admin-1:user-1", "snapshot", "auth-cache:user-1", "converge:user-1"])
  })

  it("an account promoted since the check is refused: the snapshot is told, nothing else moves", async () => {
    steps.refusals = ["target_is_admin"]
    await expect(enforceSuspension("admin-1", "user-1")).resolves.toEqual({ refused: "target_is_admin" })
    expect(steps.log).toEqual(["refusal?:admin-1:user-1", "snapshot"])
  })

  it("a read that fails still tells every process, and the failure is thrown", async () => {
    steps.refusals = [new Error("profiles down")]
    await expect(enforceSuspension("admin-1", "user-1")).rejects.toThrow("profiles down")
    expect(steps.log).toEqual(["refusal?:admin-1:user-1", "snapshot"])
  })

  it("a sign-in ban that could not be converged is answered: the suspension stands", async () => {
    const failure = new Error("auth down")
    steps.converge = async () => {
      throw failure
    }
    await expect(enforceSuspension("admin-1", "user-1")).resolves.toEqual({ refused: null, signInBlocked: false, signInError: failure })
  })
})

describe("releaseSuspension", () => {
  it("tells the snapshot and the auth cache, then converges the sign-in ban", async () => {
    steps.converge = async () => ({ signInBlocked: false, ours: false })
    await expect(releaseSuspension("user-1")).resolves.toEqual({ signInBlocked: false, signInError: null })
    expect(steps.log).toEqual(["snapshot", "auth-cache:user-1", "converge:user-1"])
  })

  it("a sign-in ban that could not be converged is answered, unknown, not thrown", async () => {
    const failure = new Error("auth down")
    steps.converge = async () => {
      throw failure
    }
    await expect(releaseSuspension("user-1")).resolves.toEqual({ signInBlocked: null, signInError: failure })
  })
})
