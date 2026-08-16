/**
 * A tiny in-memory stand-in for the ioredis client the catalog store uses:
 * get / set (NX, PX, EX) / del / ping / eval — where `eval` understands the
 * two Lua scripts the store ships (write-if-newer over snapshot + meta,
 * release-lock) by content. `down = true` makes every call reject, like a
 * broken connection.
 */
export interface FakeRedis {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ...args: Array<string | number>): Promise<"OK" | null>
  del(key: string): Promise<number>
  ping(): Promise<string>
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>
  /** Test knobs. */
  down: boolean
  readonly store: Map<string, string>
  reset(): void
  calls: string[]
}

function stampOf(raw: string | undefined): number | null {
  if (!raw) return null
  try {
    const decoded = JSON.parse(raw) as { filledAt?: unknown }
    return typeof decoded.filledAt === "number" ? decoded.filledAt : null
  } catch {
    return null
  }
}

export function makeFakeRedis(): FakeRedis {
  const store = new Map<string, string>()
  const fake: FakeRedis = {
    down: false,
    store,
    calls: [],
    reset() {
      store.clear()
      fake.down = false
      fake.calls = []
    },
    async get(key) {
      fake.calls.push(`get ${key}`)
      if (fake.down) throw new Error("ECONNREFUSED")
      return store.get(key) ?? null
    },
    async set(key, value, ...args) {
      fake.calls.push(`set ${key}`)
      if (fake.down) throw new Error("ECONNREFUSED")
      const flags = args.map(String)
      if (flags.includes("NX") && store.has(key)) return null
      store.set(key, value)
      return "OK"
    },
    async del(key) {
      fake.calls.push(`del ${key}`)
      if (fake.down) throw new Error("ECONNREFUSED")
      return store.delete(key) ? 1 : 0
    },
    async ping() {
      fake.calls.push("ping")
      if (fake.down) throw new Error("ECONNREFUSED")
      return "PONG"
    },
    async eval(script, numKeys, ...args) {
      fake.calls.push(`eval ${String(args[0])}`)
      if (fake.down) throw new Error("ECONNREFUSED")
      const all = args.map(String)
      const keys = all.slice(0, numKeys)
      const argv = all.slice(numKeys)
      if (script.includes("stampOf")) {
        // write-if-newer: KEYS = [snapshot, meta], ARGV = [json, filledAt, ttlSeconds, metaJson]
        const [snapshotKey, metaKey] = keys
        const [json, filledAt, , metaJson] = argv
        const cur = stampOf(store.get(metaKey)) ?? stampOf(store.get(snapshotKey))
        if (cur !== null && cur >= Number(filledAt)) return 0
        store.set(snapshotKey, json)
        store.set(metaKey, metaJson)
        return 1
      }
      // release-lock: KEYS = [lock], ARGV = [token]
      const [key] = keys
      const [token] = argv
      if (store.get(key) === token) { store.delete(key); return 1 }
      return 0
    },
  }
  return fake
}
