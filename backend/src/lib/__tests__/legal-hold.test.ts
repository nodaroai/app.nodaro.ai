/**
 * The legal hold's question (lib/legal-hold.ts) asks the database fresh,
 * in chunks, and FAILS CLOSED: a question that cannot be answered THROWS
 * (the delete that asked fails and is recorded, never skipped as done), and
 * an account whose hold cannot be read counts as under hold. The one
 * exception reads as "nothing held": the functions do not exist yet.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const rpc = vi.hoisted(() => ({
  calls: [] as Array<[string, Record<string, unknown>]>,
  held: new Set<string>(),
  fail: null as null | { code?: string; message: string },
  user: false,
}))

vi.mock("../supabase.js", () => ({
  supabase: {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      rpc.calls.push([name, args])
      if (rpc.fail) return { data: null, error: rpc.fail }
      if (name === "held_storage_keys_among") return { data: (args.p_keys as string[]).filter((k) => rpc.held.has(k)), error: null }
      if (name === "user_has_held_content") return { data: rpc.user, error: null }
      return { data: null, error: { message: "no such function" } }
    }),
  },
}))

import { heldAmong, userHasHeldContent, LegalHoldUnavailableError } from "../legal-hold.js"

beforeEach(() => {
  rpc.calls.length = 0
  rpc.held.clear()
  rpc.fail = null
  rpc.user = false
  vi.spyOn(console, "error").mockImplementation(() => undefined)
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
})

describe("heldAmong", () => {
  it("answers the held keys among those asked, each asked once, in chunks of 500", async () => {
    rpc.held.add("k/1")
    rpc.held.add("k/700")
    const keys = Array.from({ length: 1200 }, (_, i) => `k/${i}`)
    const held = await heldAmong([...keys, "k/1"])
    expect([...held].sort()).toEqual(["k/1", "k/700"])
    expect(rpc.calls).toHaveLength(3)
    expect((rpc.calls[0]![1].p_keys as string[]).length).toBe(500)
  })

  it("asks nothing for no keys", async () => {
    expect((await heldAmong([])).size).toBe(0)
    expect(rpc.calls).toEqual([])
  })

  it("fails closed: a question that cannot be answered throws, so the delete that asked fails", async () => {
    rpc.fail = { message: "down" }
    await expect(heldAmong(["k/1", "k/2"])).rejects.toBeInstanceOf(LegalHoldUnavailableError)
  })

  it("reads a database without the hold's functions (ahead of migration 582) as holding nothing", async () => {
    rpc.fail = { code: "PGRST202", message: "Could not find the function public.held_storage_keys_among" }
    expect((await heldAmong(["k/1"])).size).toBe(0)
  })
})

describe("userHasHeldContent", () => {
  it("answers the database, counts an unanswerable account as held, and a database without the function as not", async () => {
    expect(await userHasHeldContent("u1")).toBe(false)
    rpc.user = true
    expect(await userHasHeldContent("u1")).toBe(true)
    rpc.fail = { message: "down" }
    expect(await userHasHeldContent("u1")).toBe(true)
    rpc.fail = { code: "42883", message: "function does not exist" }
    expect(await userHasHeldContent("u1")).toBe(false)
  })
})
