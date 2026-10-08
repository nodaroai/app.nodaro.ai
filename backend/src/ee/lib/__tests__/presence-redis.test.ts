/**
 * The presence notes in Redis, bounded however a caller behaves: a note
 * replaces the last one for its user and surface; a user keeps at most
 * MAX_SURFACES_PER_USER surfaces (the least recent dropped) and expires with
 * the TTL; the user index is trimmed to the TTL and to MAX_USERS on every
 * write; a read returns the newest MAX_LISTED_USERS at most, skipping anything
 * that is not a note or is older than asked; a command's error is an error.
 */
import { describe, expect, it } from "vitest"
import { MAX_LISTED_USERS, MAX_SURFACES_PER_USER, MAX_USERS, RedisPresenceStore } from "../presence-redis.js"
import { PRESENCE_TTL_MS, type PresenceEntry } from "../presence.js"

const entry = (over: Partial<PresenceEntry> = {}): PresenceEntry => ({
  userId: "u1",
  source: "web",
  detail: "app.nodaro.ai",
  address: "203.0.113.7",
  country: "IL",
  userAgent: "Chrome",
  lastSeenAt: 1_000_000,
  ...over,
})
const stored = (e: PresenceEntry) => `${e.lastSeenAt}\t${JSON.stringify(e)}`

function fakeRedis(opts: { hlen?: number; hash?: Record<string, string>; users?: string[]; hashes?: Record<string, Record<string, string>>; failWith?: Error } = {}) {
  const commands: unknown[][] = []
  const record = (name: string) => (...args: unknown[]) => (commands.push([name, ...args]), undefined)
  const transaction = () => {
    const replies: Array<[Error | null, unknown]> = []
    const chain: Record<string, (...args: unknown[]) => unknown> = {}
    for (const name of ["hset", "pexpire", "hlen", "zadd", "zremrangebyscore", "zremrangebyrank", "hgetall"]) {
      chain[name] = (...args: unknown[]) => {
        commands.push([name, ...args])
        const reply = name === "hlen" ? (opts.hlen ?? 1) : name === "hgetall" ? (opts.hashes?.[String(args[0])] ?? {}) : 1
        replies.push([name === "zadd" && opts.failWith ? opts.failWith : null, reply])
        return chain
      }
    }
    chain.exec = async () => replies
    return chain
  }
  return {
    commands,
    multi: transaction,
    pipeline: transaction,
    zrevrangebyscore: async (...args: unknown[]) => (record("zrevrangebyscore")(...args), opts.users ?? []),
    hgetall: async (...args: unknown[]) => (record("hgetall")(...args), opts.hash ?? {}),
    hdel: async (...args: unknown[]) => (record("hdel")(...args), 1),
  }
}

describe("RedisPresenceStore.put", () => {
  it("writes the surface into the user's hash with the TTL, indexes the user, and trims the index by time and by count", async () => {
    const redis = fakeRedis()
    await new RedisPresenceStore(redis as never).put(entry())
    expect(redis.commands).toEqual([
      ["hset", "presence:v2:user:u1", "web|app.nodaro.ai", stored(entry())],
      ["pexpire", "presence:v2:user:u1", PRESENCE_TTL_MS],
      ["hlen", "presence:v2:user:u1"],
      ["zadd", "presence:v2:users", 1_000_000, "u1"],
      ["zremrangebyscore", "presence:v2:users", "-inf", 1_000_000 - PRESENCE_TTL_MS],
      ["zremrangebyrank", "presence:v2:users", 0, -(MAX_USERS + 1)],
    ])
  })

  it("past the cap, drops the user's least recent surfaces — however many names a caller invents", async () => {
    const hash = Object.fromEntries(
      Array.from({ length: MAX_SURFACES_PER_USER + 2 }, (_, i) => [`mcp|client-${i}`, stored(entry({ source: "mcp", detail: `client-${i}`, lastSeenAt: 1_000 + i }))]),
    )
    const redis = fakeRedis({ hlen: MAX_SURFACES_PER_USER + 2, hash })
    await new RedisPresenceStore(redis as never).put(entry())
    expect(redis.commands.at(-1)).toEqual(["hdel", "presence:v2:user:u1", "mcp|client-1", "mcp|client-0"])
  })

  it("a command Redis refuses is an error, not a silent success", async () => {
    const redis = fakeRedis({ failWith: new Error("WRONGTYPE Operation against a key holding the wrong kind of value") })
    await expect(new RedisPresenceStore(redis as never).put(entry())).rejects.toThrow(/WRONGTYPE/)
  })
})

describe("RedisPresenceStore.since", () => {
  it("reads the newest users since a moment, at most MAX_LISTED_USERS, skipping garbage, older notes and foreign sources", async () => {
    const fresh = entry({ lastSeenAt: 2_000 })
    const studio = entry({ detail: "studio.nodaro.ai", lastSeenAt: 3_000 })
    const older = entry({ detail: "voice.nodaro.ai", lastSeenAt: 500 })
    const redis = fakeRedis({
      users: ["u1", "u2"],
      hashes: {
        "presence:v2:user:u1": { a: stored(fresh), b: stored(studio), c: stored(older), d: "1\t{not json" },
        "presence:v2:user:u2": { a: stored(entry({ userId: "u2", source: "internal" as never, lastSeenAt: 2_500 })) },
      },
    })
    expect(await new RedisPresenceStore(redis as never).since(1_000)).toEqual([studio, fresh])
    expect(redis.commands[0]).toEqual(["zrevrangebyscore", "presence:v2:users", "+inf", 1_000, "LIMIT", 0, MAX_LISTED_USERS])
  })

  it("nobody since then asks nothing more", async () => {
    const redis = fakeRedis({ users: [] })
    expect(await new RedisPresenceStore(redis as never).since(1_000)).toEqual([])
    expect(redis.commands).toHaveLength(1)
  })
})
