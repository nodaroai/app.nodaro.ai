import { describe, it, expect, vi, beforeEach } from "vitest"

// In-memory ioredis stand-in supporting exactly what state-store uses:
// set(key, val, "EX", ttl) and multi().get(key).del(key).exec().
const store = new Map<string, string>()
vi.mock("../../../lib/queue.js", () => ({
  redis: {
    async set(key: string, val: string) {
      store.set(key, val)
      return "OK"
    },
    multi() {
      const ops: Array<() => unknown> = []
      const chain = {
        get(key: string) {
          ops.push(() => store.get(key) ?? null)
          return chain
        },
        del(key: string) {
          ops.push(() => (store.delete(key) ? 1 : 0))
          return chain
        },
        async exec() {
          return ops.map((f) => [null, f()] as [null, unknown])
        },
      }
      return chain
    },
  },
}))

import {
  saveOAuthState,
  consumeOAuthState,
  savePendingSelection,
  consumePendingSelection,
} from "../state-store.js"

beforeEach(() => store.clear())

describe("social state-store (Redis-backed, one-time consume)", () => {
  it("round-trips OAuth state and consumes it exactly once", async () => {
    await saveOAuthState("st-1", { providerId: "tiktok", userId: "u1", codeVerifier: "ver" })

    const first = await consumeOAuthState("st-1")
    expect(first).toEqual({ providerId: "tiktok", userId: "u1", codeVerifier: "ver" })

    // Second consume must fail — the callback state is single-use (CSRF).
    expect(await consumeOAuthState("st-1")).toBeNull()
  })

  it("returns null for unknown or corrupted state", async () => {
    expect(await consumeOAuthState("missing")).toBeNull()
    store.set("social:state:bad", "{not json")
    expect(await consumeOAuthState("bad")).toBeNull()
  })

  it("round-trips a pending between-steps selection exactly once", async () => {
    const pending = {
      providerId: "facebook",
      userId: "u2",
      accessTokenEncrypted: "enc-access",
      refreshTokenEncrypted: "enc-refresh",
      expiresIn: 3600,
      scopes: ["pages_manage_posts"],
      accounts: [
        { id: "p1", name: "Page One", rootId: "fbu-9" },
        { id: "p2", name: "Page Two", rootId: "fbu-9" },
      ],
    }
    await savePendingSelection("tok-1", pending)

    expect(await consumePendingSelection("tok-1")).toEqual(pending)
    expect(await consumePendingSelection("tok-1")).toBeNull()
  })

  it("keys the two families separately", async () => {
    await saveOAuthState("same", { providerId: "x", userId: "u3" })
    expect(await consumePendingSelection("same")).toBeNull()
    expect(await consumeOAuthState("same")).not.toBeNull()
  })
})
