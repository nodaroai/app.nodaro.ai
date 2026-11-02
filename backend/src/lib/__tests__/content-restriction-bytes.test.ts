/**
 * lib/content-restriction-bytes.ts: after a restriction every key's bytes
 * move to evidence and the edge is asked to drop the key's addresses; after
 * a lift they move back. Each phase is recorded on its own, by a merge on
 * the record; a key under a kept prefix or one the relay target owns is
 * skipped and said so; "unknown" relay ownership, or an unreadable hold,
 * moves nothing; a key another restriction still holds stays in evidence;
 * a failed move or purge is recorded and never thrown.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const fake = vi.hoisted(() => ({
  moves: [] as Array<[string, string, string]>,
  merges: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  relay: new Set<string>(),
  relayFails: false,
  held: new Set<string>(),
  holdFails: false,
  failKey: null as string | null,
  alreadyThere: new Set<string>(),
  purge: { status: "done" } as { status: string; error?: string },
  purged: [] as string[],
}))

vi.mock("../supabase.js", () => ({
  supabase: {
    rpc: vi.fn(async (name: string, args: { p_id: string; p_patch: Record<string, unknown> }) => {
      if (name !== "merge_restriction_bytes") return { data: null, error: { message: "no such function" } }
      fake.merges.push({ id: args.p_id, patch: args.p_patch })
      return { data: {}, error: null }
    }),
    // The other active restrictions covering a key (a lift's question).
    from: () => ({
      select: () => ({
        is: () => ({
          neq: () => ({
            overlaps: async (_c: string, keys: string[]) =>
              fake.holdFails
                ? { data: null, error: { message: "down" } }
                : { data: [{ r2_keys: keys.filter((k) => fake.held.has(k)) }], error: null },
          }),
        }),
      }),
    }),
  },
}))
vi.mock("../config.js", () => ({ config: { R2_PUBLIC_URL: "https://cdn.example.test/", R2_PUBLIC_FALLBACK_DOMAIN: " fallback.example.test " } }))
vi.mock("../asset-delete.js", () => ({
  relayOwnedKeysStrict: vi.fn(async (keys: string[]) => {
    if (fake.relayFails) throw new Error("relay provenance could not be read")
    return new Set(keys.filter((k) => fake.relay.has(k)))
  }),
}))
vi.mock("../storage.js", () => ({
  moveObjectToEvidence: vi.fn(async (key: string, id: string) => {
    if (key === fake.failKey) throw new Error("copy refused")
    fake.moves.push(["to", key, id])
    if (fake.alreadyThere.has(key)) return "already_there"
    return key.endsWith("missing.png") ? "missing" : "moved"
  }),
  restoreObjectFromEvidence: vi.fn(async (key: string, id: string) => {
    fake.moves.push(["back", key, id])
    return fake.alreadyThere.has(key) ? "already_there" : "moved"
  }),
}))
vi.mock("../edge-purge.js", () => ({
  purgeEdgeUrls: vi.fn(async (urls: string[]) => {
    fake.purged.push(...urls)
    return fake.purge
  }),
}))

import { bytesSettled, publicAddressesOf, relocateRestrictedBytes, restoreRestrictedBytes, type RestrictionBytes, type RestrictionLike } from "../content-restriction-bytes.js"

const restriction: RestrictionLike = { id: "r-1", r2Keys: ["videos/a.mp4", "thumbs/a.jpg", "videos/a.mp4"], liftedAt: null, bytes: {} }

beforeEach(() => {
  fake.moves.length = 0
  fake.merges.length = 0
  fake.purged.length = 0
  fake.relay.clear()
  fake.relayFails = false
  fake.held.clear()
  fake.holdFails = false
  fake.failKey = null
  fake.alreadyThere.clear()
  fake.purge = { status: "done" }
  vi.spyOn(console, "error").mockImplementation(() => undefined)
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
})

describe("publicAddressesOf", () => {
  it("names the key, percent-encoded, on the public base and the trimmed fallback host, on both schemes", () => {
    expect(publicAddressesOf("videos/a b.mp4")).toEqual([
      "https://cdn.example.test/videos/a%20b.mp4",
      "http://cdn.example.test/videos/a%20b.mp4",
      "https://fallback.example.test/videos/a%20b.mp4",
      "http://fallback.example.test/videos/a%20b.mp4",
    ])
  })
})

describe("relocateRestrictedBytes", () => {
  it("moves each key once, purges every address of every key, records the restrict phase by a merge, and answers the record", async () => {
    const out = await relocateRestrictedBytes(restriction)
    expect(fake.moves).toEqual([["to", "videos/a.mp4", "r-1"], ["to", "thumbs/a.jpg", "r-1"]])
    expect(fake.purged).toHaveLength(8)
    expect(out.bytes.restrict?.keys["videos/a.mp4"]).toMatchObject({ state: "moved" })
    expect(out.bytes.restrict?.keys["thumbs/a.jpg"]).toMatchObject({ state: "moved" })
    expect(out.bytes.restrict?.purge).toMatchObject({ status: "done" })
    expect(out.bytes.lift).toBeUndefined()
    expect(fake.merges).toEqual([{ id: "r-1", patch: { restrict: out.bytes.restrict } }])
    expect(bytesSettled(out)).toBe(true)
  })

  it("skips a key under a kept prefix, a key the relay target owns and a key with nothing stored; records a failed move and a purge not done", async () => {
    fake.relay.add("videos/a.mp4")
    fake.failKey = "thumbs/a.jpg"
    fake.purge = { status: "not_configured" }
    const out = await relocateRestrictedBytes({ ...restriction, r2Keys: [...restriction.r2Keys, "uploads/missing.png", "evidence/r-0/x.png", "brand/makers/x.svg"] })
    expect(fake.moves).toEqual([["to", "uploads/missing.png", "r-1"]])
    const keys = out.bytes.restrict!.keys
    expect(keys["videos/a.mp4"]).toMatchObject({ state: "skipped", why: "the relay target owns the bytes" })
    expect(keys["thumbs/a.jpg"]).toMatchObject({ state: "failed", error: "copy refused" })
    expect(keys["uploads/missing.png"]).toMatchObject({ state: "skipped", why: "nothing was stored at the key" })
    expect(keys["evidence/r-0/x.png"]!.state).toBe("skipped")
    expect(keys["brand/makers/x.svg"]!.state).toBe("skipped")
    expect(out.bytes.restrict?.purge).toMatchObject({ status: "not_configured" })
    // The failed key is what is left; a purge the deployment cannot make is not.
    expect(bytesSettled(out)).toBe(false)

    fake.purge = { status: "failed", error: "403: no" }
    const again = await relocateRestrictedBytes(restriction)
    expect(again.bytes.restrict?.purge).toMatchObject({ status: "failed", error: "403: no" })
    expect(bytesSettled(again)).toBe(false)
  })

  it("a deployment without purge keys settles once its keys are moved: `not_configured` is a fact, not work left", async () => {
    fake.purge = { status: "not_configured" }
    expect(bytesSettled(await relocateRestrictedBytes(restriction))).toBe(true)
  })

  it("moves nothing when relay ownership cannot be read: every key is recorded failed", async () => {
    fake.relayFails = true
    const out = await relocateRestrictedBytes(restriction)
    expect(fake.moves).toEqual([])
    expect(out.bytes.restrict?.keys["videos/a.mp4"]).toMatchObject({ state: "failed", error: "relay ownership could not be read" })
  })

  it("run again, keeps the earlier record of a key already at the other end", async () => {
    const earlier: RestrictionBytes = { restrict: { keys: { "videos/a.mp4": { state: "skipped", at: "x", why: "earlier" } }, purge: { status: "failed", at: "x", error: "e" } } }
    fake.alreadyThere.add("videos/a.mp4")
    const out = await relocateRestrictedBytes({ ...restriction, bytes: earlier })
    expect(out.bytes.restrict?.keys["videos/a.mp4"]).toEqual({ state: "skipped", at: "x", why: "earlier" })
    expect(out.bytes.restrict?.keys["thumbs/a.jpg"]).toMatchObject({ state: "moved" })
    expect(out.bytes.restrict?.purge).toMatchObject({ status: "done" })
  })
})

describe("restoreRestrictedBytes", () => {
  it("moves each key back unless another active restriction still covers it (deferred, not settled), purges again, records the lift phase beside the restrict phase", async () => {
    fake.held.add("thumbs/a.jpg")
    const before: RestrictionBytes = { restrict: { keys: { "videos/a.mp4": { state: "moved", at: "x" } }, purge: { status: "done", at: "x" } } }
    const out = await restoreRestrictedBytes({ ...restriction, liftedAt: "2026-11-02T00:00:00Z", bytes: before })
    expect(fake.moves).toEqual([["back", "videos/a.mp4", "r-1"]])
    expect(out.bytes.restrict).toEqual(before.restrict)
    expect(out.bytes.lift?.keys["videos/a.mp4"]).toMatchObject({ state: "restored" })
    expect(out.bytes.lift?.keys["thumbs/a.jpg"]).toMatchObject({ state: "deferred", why: "another active restriction still covers the key" })
    expect(fake.purged).toHaveLength(8)
    expect(fake.merges).toEqual([{ id: "r-1", patch: { lift: out.bytes.lift } }])
    // Deferred is not done: the sweep brings the key back once the other restriction is lifted.
    expect(bytesSettled(out)).toBe(false)
    fake.held.clear()
    fake.moves.length = 0
    const later = await restoreRestrictedBytes({ ...out })
    expect(fake.moves).toEqual([["back", "videos/a.mp4", "r-1"], ["back", "thumbs/a.jpg", "r-1"]])
    expect(bytesSettled(later)).toBe(true)
  })

  it("moves nothing back when the other restrictions cannot be read", async () => {
    fake.holdFails = true
    const out = await restoreRestrictedBytes({ ...restriction, liftedAt: "2026-11-02T00:00:00Z" })
    expect(fake.moves).toEqual([])
    expect(out.bytes.lift?.keys["videos/a.mp4"]).toMatchObject({ state: "failed", error: "the other restrictions could not be read" })
    expect(bytesSettled(out)).toBe(false)
  })
})
