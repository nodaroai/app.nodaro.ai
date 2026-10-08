/**
 * A JS twin of the download-slot ledger's three Lua scripts over an in-memory
 * store, for tests that must not need a Redis. Only trusted because
 * `download-slot-ledger.redis.test.ts` runs the SAME contract against a real
 * Redis and the real scripts whenever one is reachable.
 *
 * `down` rejects every call, `hang` never answers, `delayMs` answers late (the
 * command still takes effect when it arrives, like a command stuck behind a
 * slow connection).
 */
import { DOWNLOAD_LEDGER_SCRIPTS, type DownloadLedgerClient } from "../download-slot-ledger.js"

export interface FakeDownloadStore {
  readonly zsets: Map<string, Map<string, number>>
}

export const makeFakeDownloadStore = (): FakeDownloadStore => ({ zsets: new Map() })

export interface FakeDownloadClient extends DownloadLedgerClient {
  down: boolean
  hang: boolean
  delayMs: number
  /** Every script name evaluated, in order. */
  readonly calls: string[]
}

export function makeFakeDownloadClient(store: FakeDownloadStore): FakeDownloadClient {
  const zset = (k: string) => store.zsets.get(k) ?? store.zsets.set(k, new Map()).get(k)!
  const run = (script: string, args: Array<string | number>): unknown => {
    const [key, ...a] = args as [string, ...Array<string | number>]
    if (script === DOWNLOAD_LEDGER_SCRIPTS.acquire) {
      const [now, leaseId, cap, ttl] = [Number(a[0]), String(a[1]), Number(a[2]), Number(a[3])] as const
      for (const [member, score] of [...zset(key)]) if (score <= now) zset(key).delete(member)
      const held = zset(key).size
      if (held >= cap) return [0, held]
      zset(key).set(leaseId, now + ttl)
      return [1, held + 1]
    }
    if (script === DOWNLOAD_LEDGER_SCRIPTS.renew) {
      zset(key).set(String(a[1]), Number(a[0]) + Number(a[2]))
      return 1
    }
    if (script === DOWNLOAD_LEDGER_SCRIPTS.release) {
      zset(key).delete(String(a[0]))
      return 1
    }
    throw new Error("unknown script")
  }
  const client: FakeDownloadClient = {
    down: false,
    hang: false,
    delayMs: 0,
    calls: [],
    eval(script, _numKeys, ...args) {
      const name =
        script === DOWNLOAD_LEDGER_SCRIPTS.acquire ? "acquire" : script === DOWNLOAD_LEDGER_SCRIPTS.renew ? "renew" : "release"
      client.calls.push(name)
      if (client.down) return Promise.reject(new Error("ECONNREFUSED"))
      if (client.hang) return new Promise(() => undefined)
      if (client.delayMs > 0) return new Promise((resolve) => setTimeout(() => resolve(run(script, args)), client.delayMs))
      return Promise.resolve(run(script, args))
    },
  }
  return client
}

/** The live lease ids the store holds for one account (expired ones included, as Redis would until purged). */
export function downloadLeasesOf(store: FakeDownloadStore, userId: string): string[] {
  return [...(store.zsets.get(`download:slots:{${userId}}`)?.keys() ?? [])]
}
