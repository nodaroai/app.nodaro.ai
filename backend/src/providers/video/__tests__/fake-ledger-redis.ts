/**
 * A JS twin of the ffmpeg memory ledger's three Lua scripts over an in-memory
 * store, for tests that must not need a Redis. The twin is only trusted because
 * `ffmpeg-memory-ledger.redis.test.ts` runs the SAME contract against a real
 * Redis and the real scripts whenever one is reachable.
 *
 * `down` rejects every call, `hang` never answers, `delayMs` answers late (the
 * command still takes effect when it arrives, like a command stuck behind a
 * slow connection).
 */
import { FFMPEG_LEDGER_SCRIPTS, type LedgerClient } from "../ffmpeg-memory-ledger.js"

export interface FakeLedgerStore {
  readonly zsets: Map<string, Map<string, number>>
  readonly hashes: Map<string, Map<string, string>>
}

export const makeFakeStore = (): FakeLedgerStore => ({ zsets: new Map(), hashes: new Map() })

export interface FakeLedgerClient extends LedgerClient {
  down: boolean
  hang: boolean
  delayMs: number
  /** Every script name evaluated, in order. */
  readonly calls: string[]
}

export function makeFakeClient(store: FakeLedgerStore): FakeLedgerClient {
  const zset = (k: string) => store.zsets.get(k) ?? store.zsets.set(k, new Map()).get(k)!
  const hash = (k: string) => store.hashes.get(k) ?? store.hashes.set(k, new Map()).get(k)!
  const run = (script: string, args: Array<string | number>): unknown => {
    const [k1, k2, ...a] = args as [string, string, ...Array<string | number>]
    if (script === FFMPEG_LEDGER_SCRIPTS.reserve) {
      const [now, peak, budget, ttl] = [Number(a[0]), Number(a[2]), Number(a[3]), Number(a[4])] as const
      const leaseId = String(a[1])
      for (const [member, score] of [...zset(k1)]) {
        if (score <= now) {
          zset(k1).delete(member)
          hash(k2).delete(member)
        }
      }
      let total = 0
      for (const v of hash(k2).values()) total += Number(v)
      const fits = peak > budget ? total === 0 : total + peak <= budget
      if (!fits) return [0, total]
      zset(k1).set(leaseId, now + ttl)
      hash(k2).set(leaseId, String(peak))
      return [1, total + peak]
    }
    if (script === FFMPEG_LEDGER_SCRIPTS.renew) {
      const [now, ttl] = [Number(a[0]), Number(a[3])] as const
      zset(k1).set(String(a[1]), now + ttl)
      hash(k2).set(String(a[1]), String(a[2]))
      return 1
    }
    if (script === FFMPEG_LEDGER_SCRIPTS.release) {
      zset(k1).delete(String(a[0]))
      hash(k2).delete(String(a[0]))
      return 1
    }
    throw new Error("unknown script")
  }
  const client: FakeLedgerClient = {
    down: false,
    hang: false,
    delayMs: 0,
    calls: [],
    eval(script, _numKeys, ...args) {
      const name = script === FFMPEG_LEDGER_SCRIPTS.reserve ? "reserve" : script === FFMPEG_LEDGER_SCRIPTS.renew ? "renew" : "release"
      client.calls.push(name)
      if (client.down) return Promise.reject(new Error("ECONNREFUSED"))
      if (client.hang) return new Promise(() => undefined)
      if (client.delayMs > 0) {
        return new Promise((resolve) => setTimeout(() => resolve(run(script, args)), client.delayMs))
      }
      return Promise.resolve(run(script, args))
    },
  }
  return client
}

/** The live lease sizes the store holds for one container (expired ones included, as Redis would until purged). */
export function leasesOf(store: FakeLedgerStore, containerId: string): Map<string, string> {
  return store.hashes.get(`ffmpeg:mem:{${containerId}}:mib`) ?? new Map()
}
