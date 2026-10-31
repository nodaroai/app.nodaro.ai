/**
 * A JS twin of the lane history's Lua scripts (history-scripts.ts) and of the
 * plain commands the history reads with (SSCAN, HGETALL, UNLINK, SET), over an
 * in-memory store, for tests that must not need a Redis. Each body below has
 * the same steps as the Lua it mirrors. The twin is only trusted because
 * history-scripts.redis.test.ts runs the SAME contract against a real Redis
 * and the real scripts.
 */
import { LANE_HISTORY_SCRIPTS, type LaneHistoryScriptName } from "../history-scripts.js"

export interface FakeHistoryStore {
  readonly strings: Map<string, string>
  readonly hashes: Map<string, Map<string, string>>
  readonly sets: Map<string, Set<string>>
  /** Key → its TTL in ms, as last set (PEXPIRE / SET PX). */
  readonly ttls: Map<string, number>
  /** Every command run, by name (to assert how a reader read). */
  readonly calls: string[]
}

export const makeFakeHistoryStore = (): FakeHistoryStore => ({ strings: new Map(), hashes: new Map(), sets: new Map(), ttls: new Map(), calls: [] })

type Req = Record<string, unknown>
interface X { s: FakeHistoryStore; H: string; TTL: number; REQ: Req }

const int = (v: unknown) => Math.round(Number(v)).toFixed(0)
const dk = (x: X, day: string, part: string) => `${x.H}d:${day}:${part}`
const touch = (x: X, k: string) => { x.s.ttls.set(k, x.TTL) }
const hash = (x: X, k: string) => x.s.hashes.get(k) ?? x.s.hashes.set(k, new Map()).get(k)!
const hincrby = (x: X, k: string, f: string, by: number) => { const h = hash(x, k); h.set(f, String(Number(h.get(f) ?? 0) + by)) }
const hmax = (x: X, k: string, f: string, v: unknown): boolean => {
  const n = Number(v)
  if (v === null || v === undefined || !Number.isFinite(n)) return false
  const c = x.s.hashes.get(k)?.get(f)
  if (c !== undefined && Number(c) >= n) return false
  hash(x, k).set(f, int(n))
  return true
}
const hput = (x: X, k: string, f: string, v: unknown): boolean => {
  const s = int(v)
  if (x.s.hashes.get(k)?.get(f) === s) return false
  hash(x, k).set(f, s)
  return true
}
const dirty = (x: X, day: string, kind: string, m: string) => {
  const k = dk(x, day, kind)
  ;(x.s.sets.get(k) ?? x.s.sets.set(k, new Set()).get(k)!).add(m)
  touch(x, k)
}
const exists = (x: X, k: string) => x.s.strings.has(k) || x.s.hashes.has(k) || x.s.sets.has(k)
const flat = (x: X, k: string): Record<string, string> => Object.fromEntries(x.s.hashes.get(k) ?? new Map())

const sample = (x: X): Req => {
  const R = x.REQ as {
    day: string; enforced?: boolean
    lines: Array<{ line: string; max: Record<string, number>; atLimit?: boolean }>
    providers: Array<{ p: string; running: number; ceiling: number | null; atCeiling?: boolean }>
    outcomes: Array<{ p: string; day: string; minute: number; completed: number; failed: number }>
  }
  const m = dk(x, R.day, "m")
  hincrby(x, m, "sampled", 1)
  if (R.enforced) hincrby(x, m, "enforced", 1)
  touch(x, m)
  x.s.strings.set(dk(x, R.day, "dm"), "1")
  touch(x, dk(x, R.day, "dm"))
  for (const l of R.lines) {
    const k = dk(x, R.day, `l:${l.line}`)
    let changed = false
    for (const [f, v] of Object.entries(l.max)) if (hmax(x, k, f, v)) changed = true
    if (l.atLimit) { hincrby(x, k, "mal", 1); changed = true }
    if (changed) { touch(x, k); dirty(x, R.day, "dl", l.line) }
  }
  for (const p of R.providers) {
    const k = dk(x, R.day, `p:${p.p}`)
    let changed = hmax(x, k, "pk", p.running)
    if (typeof p.ceiling === "number") { if (hput(x, k, "ceil", p.ceiling)) changed = true }
    else if (x.s.hashes.get(k)?.delete("ceil")) changed = true
    if (p.atCeiling) { hincrby(x, k, "mac", 1); changed = true }
    if (changed) { touch(x, k); dirty(x, R.day, "dp", p.p) }
  }
  for (const o of R.outcomes) {
    const k = dk(x, o.day, `p:${o.p}`)
    const a = hput(x, k, `o:${int(o.minute)}:c`, o.completed)
    const b = hput(x, k, `o:${int(o.minute)}:f`, o.failed)
    if (a || b) { touch(x, k); dirty(x, o.day, "dp", o.p) }
  }
  return {}
}

const count = (x: X): Req => {
  const R = x.REQ as { day: string; line: string; field: string; waitedMs: number }
  const k = dk(x, R.day, `l:${R.line}`)
  hincrby(x, k, R.field, 1)
  hmax(x, k, "lw", R.waitedMs)
  touch(x, k)
  dirty(x, R.day, "dl", R.line)
  return {}
}

const take = (x: X): Req => {
  const R = x.REQ as { day: string }
  const out: Req = { lines: false, providers: false, minutes: null }
  for (const [kind, name] of [["dl", "lines"], ["dp", "providers"]] as const) {
    const k = dk(x, R.day, kind)
    const w = dk(x, R.day, `${kind}:w`)
    const src = x.s.sets.get(k)
    if (src) {
      const work = x.s.sets.get(w) ?? x.s.sets.set(w, new Set()).get(w)!
      for (const m of src) work.add(m)
      x.s.sets.delete(k)
    }
    if (x.s.sets.has(w)) { touch(x, w); out[name] = true }
  }
  if (x.s.strings.has(dk(x, R.day, "dm"))) {
    x.s.strings.delete(dk(x, R.day, "dm"))
    out.minutes = flat(x, dk(x, R.day, "m"))
  }
  return out
}

const claim = (x: X): Req => {
  const R = x.REQ as { name: string; ttlMs: number }
  const k = `${x.H}claim:${R.name}`
  if (exists(x, k)) return { claimed: false }
  x.s.strings.set(k, "1")
  x.s.ttls.set(k, Number(R.ttlMs))
  return { claimed: true }
}

const BODIES: Record<LaneHistoryScriptName, (x: X) => Req> = { sample, count, take, claim }
const BY_SOURCE = new Map<string, (x: X) => Req>(Object.entries(LANE_HISTORY_SCRIPTS).map(([name, src]) => [src, BODIES[name as LaneHistoryScriptName]]))

export interface FakeHistoryClient {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>
  sscan(key: string, cursor: string, countToken: "COUNT", count: number): Promise<[string, string[]]>
  hgetall(key: string): Promise<Record<string, string>>
  unlink(...keys: string[]): Promise<number>
  set(key: string, value: string, px: "PX", ms: number): Promise<unknown>
  status?: string
}

/** A client whose `eval` runs the twin of whichever history script it is handed. */
export function fakeHistoryClient(store: FakeHistoryStore = makeFakeHistoryStore()): FakeHistoryClient & { store: FakeHistoryStore } {
  return {
    store,
    async eval(script, _numKeys, ...args) {
      store.calls.push("eval")
      const body = BY_SOURCE.get(script)
      if (!body) throw new Error("fake-history-redis: unknown script")
      const [H, ttl, req] = args
      // The same JSON round trip the Lua's cjson does.
      return JSON.stringify(body({ s: store, H: String(H), TTL: Number(ttl), REQ: JSON.parse(String(req)) as Req }))
    },
    /** Pages of `count` members in insertion order; the cursor is the next offset ("0" = done). */
    async sscan(key, cursor, _countToken, count) {
      store.calls.push("sscan")
      const members = [...(store.sets.get(key) ?? [])]
      const from = Number(cursor)
      const next = from + count
      return [next >= members.length ? "0" : String(next), members.slice(from, next)]
    },
    async hgetall(key) {
      store.calls.push("hgetall")
      return Object.fromEntries(store.hashes.get(key) ?? new Map())
    },
    async unlink(...keys) {
      store.calls.push("unlink")
      let n = 0
      for (const k of keys) {
        if (store.strings.delete(k) || store.hashes.delete(k) || store.sets.delete(k)) n++
        store.ttls.delete(k)
      }
      return n
    },
    async set(key, value, _px, ms) {
      store.calls.push("set")
      store.strings.set(key, value)
      store.ttls.set(key, ms)
      return "OK"
    },
  }
}
