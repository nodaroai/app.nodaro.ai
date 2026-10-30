/**
 * A JS twin of the concurrency gate's Lua scripts (gate-scripts.ts) over an
 * in-memory store, for tests that must not need a Redis. It is a helper-for-
 * helper port: each function below has the same name and the same steps as the
 * Lua it mirrors, over a store that behaves like the Redis commands the Lua
 * calls (ZRANGE ties broken by member, SMEMBERS sorted by the caller). The
 * twin is only trusted because lane-gate.redis.test.ts runs the SAME contract
 * against a real Redis and the real scripts.
 *
 * Wakes are returned to the gate, which publishes them, so the twin's
 * `publish` only records.
 */
import { LANE_GATE_SCRIPTS, type LaneGateScriptName } from "../gate-scripts.js"
import type { LaneClient } from "../gate.js"

export interface FakeLaneStore {
  readonly strings: Map<string, string>
  readonly hashes: Map<string, Map<string, string>>
  readonly zsets: Map<string, Map<string, number>>
  readonly sets: Map<string, Set<string>>
  readonly published: Array<{ channel: string; message: string }>
}

export const makeFakeLaneStore = (): FakeLaneStore => ({ strings: new Map(), hashes: new Map(), zsets: new Map(), sets: new Map(), published: [] })

// ── the Redis commands the scripts use ────────────────────────────────────────
class Cmd {
  constructor(private readonly s: FakeLaneStore) {}
  private z(k: string) { return this.s.zsets.get(k) ?? this.s.zsets.set(k, new Map()).get(k)! }
  private h(k: string) { return this.s.hashes.get(k) ?? this.s.hashes.set(k, new Map()).get(k)! }
  private set_(k: string) { return this.s.sets.get(k) ?? this.s.sets.set(k, new Set()).get(k)! }
  private gcz(k: string) { if (this.s.zsets.get(k)?.size === 0) this.s.zsets.delete(k) }
  private gch(k: string) { if (this.s.hashes.get(k)?.size === 0) this.s.hashes.delete(k) }
  zadd(k: string, score: number, m: string) { this.z(k).set(m, score) }
  zrem(k: string, m: string) { this.s.zsets.get(k)?.delete(m); this.gcz(k) }
  zscore(k: string, m: string): number | null { return this.s.zsets.get(k)?.get(m) ?? null }
  zcard(k: string) { return this.s.zsets.get(k)?.size ?? 0 }
  /** Members by score, ties by member — Redis order. */
  zrange(k: string): string[] {
    return [...(this.s.zsets.get(k) ?? new Map<string, number>())]
      .sort(([am, as], [bm, bs]) => (as !== bs ? as - bs : am < bm ? -1 : am > bm ? 1 : 0))
      .map(([m]) => m)
  }
  zrank(k: string, m: string): number { return this.zrange(k).indexOf(m) }
  /** ZRANGEBYSCORE with optional exclusive bounds. */
  zrangeByScore(k: string, min: number, max: number, minExclusive = false, maxExclusive = false): string[] {
    const zs = this.s.zsets.get(k) ?? new Map<string, number>()
    return this.zrange(k).filter((m) => {
      const v = zs.get(m)!
      return (minExclusive ? v > min : v >= min) && (maxExclusive ? v < max : v <= max)
    })
  }
  zremRangeByScore(k: string, min: number, max: number) { for (const m of this.zrangeByScore(k, min, max)) this.zrem(k, m) }
  hget(k: string, f: string): string | null { return this.s.hashes.get(k)?.get(f) ?? null }
  hset(k: string, fields: Record<string, string | number>) { for (const [f, v] of Object.entries(fields)) this.h(k).set(f, String(v)) }
  hdel(k: string, f: string) { this.s.hashes.get(k)?.delete(f); this.gch(k) }
  hincrby(k: string, f: string, by: number): number { const v = Number(this.hget(k, f) ?? 0) + by; this.h(k).set(f, String(v)); return v }
  hkeys(k: string): string[] { return [...(this.s.hashes.get(k)?.keys() ?? [])] }
  hlen(k: string) { return this.s.hashes.get(k)?.size ?? 0 }
  hgetall(k: string): Array<[string, string]> { return [...(this.s.hashes.get(k) ?? new Map<string, string>())] }
  exists(k: string) { return this.s.hashes.has(k) || this.s.strings.has(k) || this.s.zsets.has(k) || this.s.sets.has(k) }
  del(k: string) { this.s.hashes.delete(k); this.s.strings.delete(k); this.s.zsets.delete(k); this.s.sets.delete(k) }
  sadd(k: string, m: string) { this.set_(k).add(m) }
  srem(k: string, m: string) { this.s.sets.get(k)?.delete(m); if (this.s.sets.get(k)?.size === 0) this.s.sets.delete(k) }
  smembers(k: string): string[] { return [...(this.s.sets.get(k) ?? [])] }
  get(k: string): string | null { return this.s.strings.get(k) ?? null }
  set(k: string, v: string) { this.s.strings.set(k, v) }
  incr(k: string): number { const v = Number(this.get(k) ?? 0) + 1; this.set(k, String(v)); return v }
}

type Json = Record<string, unknown>
interface Meta { jobId: string; userId: string; payer: string; lane: string; provider: string | null; source: string | null; queue: string; bullJobId: string | null }
interface WaitOut { lane: string; position: number; limit: number; running: number; reason: string; waitedMs: number; enqueuedAtMs: number }
interface Wake { jobId: string; queue: string | null; bullJobId: string | null }

const FRONT = 1_000_000_000_000
const opt = (v: string | null | undefined): string | null => (v === undefined || v === null || v === "" ? null : v)

// ── the prelude, ported ──────────────────────────────────────────────────────
class Run {
  readonly r: Cmd
  private readonly touchedLines = new Set<string>()
  private readonly touchedProvs = new Set<string>()
  readonly wakes: Wake[] = []
  private readonly occCache = new Map<string, Map<string, number>>()

  constructor(store: FakeLaneStore, readonly P: string, readonly NOW: number, readonly RES_TTL: number, readonly WAITER_TTL: number, readonly RELEASED_TTL: number) {
    this.r = new Cmd(store)
  }

  lk(line: string, part: string) { return `${this.P}l:${line}:${part}` }
  pk(p: string, part: string) { return `${this.P}p:${p}:${part}` }
  ek(j: string) { return `${this.P}e:${j}` }
  sk(j: string) { return `${this.P}se:${j}` }
  lsk(l: string) { return `${this.P}lease:${l}` }
  hget(k: string, f: string) { return opt(this.r.hget(k, f)) }
  touchLine(line: string | null) { if (line) this.touchedLines.add(line) }
  touchProv(p: string | null) { if (p) { this.touchedProvs.add(p); this.occCache.delete(p) } }
  isReserved(j: string) { return this.r.zscore(`${this.P}resv`, j) !== null }
  ceilOf(p: string | null): number | null { if (!p) return null; const c = opt(this.r.get(this.pk(p, "ceil"))); return c === null ? null : Number(c) }
  occ(p: string) { return this.r.zcard(this.pk(p, "run")) + this.r.zcard(this.pk(p, "res")) }
  lineSize(line: string) { const s = this.hget(this.lk(line, "m"), "size"); return s === null ? 0 : Number(s) }
  lineRunning(line: string) { return this.r.zcard(this.lk(line, "run")) }
  lineReserved(line: string) { return this.r.zcard(this.lk(line, "res")) }
  lineOf(m: Meta) { return `${m.payer}:${m.userId}:${m.lane}` }

  userOcc(p: string, user: string): number {
    let t = this.occCache.get(p)
    if (!t) {
      t = new Map()
      for (const l of this.r.zrange(this.pk(p, "run"))) { const u = this.hget(this.lsk(l), "user"); if (u) t.set(u, (t.get(u) ?? 0) + 1) }
      for (const j of this.r.zrange(this.pk(p, "res"))) { const u = this.hget(this.ek(j), "user"); if (u) t.set(u, (t.get(u) ?? 0) + 1) }
      this.occCache.set(p, t)
    }
    return t.get(user) ?? 0
  }

  beats(p: string, aj: string, au: string, ae: number, bj: string, bu: string, be: number): boolean {
    const ao = this.userOcc(p, au), bo = this.userOcc(p, bu)
    if (ao !== bo) return ao < bo
    if (ae !== be) return ae < be
    return aj < bj
  }

  dropLease(lid: string) {
    const k = this.lsk(lid)
    const line = this.hget(k, "line"), p = this.hget(k, "prov"), job = this.hget(k, "job")
    this.r.zrem(`${this.P}leases`, lid)
    if (line) { this.r.zrem(this.lk(line, "run"), lid); this.touchLine(line) }
    if (p) { this.r.zrem(this.pk(p, "run"), lid); this.touchProv(p) }
    if (job && this.hget(`${this.P}jl`, job) === lid) this.r.hdel(`${this.P}jl`, job)
    this.r.del(k)
  }

  extendLease(lid: string, ttl: number) {
    const exp = this.NOW + ttl
    const k = this.lsk(lid)
    const line = this.hget(k, "line"), p = this.hget(k, "prov")
    this.r.zadd(`${this.P}leases`, exp, lid)
    if (line) this.r.zadd(this.lk(line, "run"), exp, lid)
    if (p) this.r.zadd(this.pk(p, "run"), exp, lid)
  }

  createLease(lid: string, line: string, m: Meta, ttl: number, over: string) {
    const exp = this.NOW + ttl
    const k = this.lsk(lid)
    this.r.hset(k, { job: m.jobId, line, user: m.userId, payer: m.payer, lane: m.lane, over, queue: m.queue })
    if (opt(m.source)) this.r.hset(k, { src: m.source! })
    if (opt(m.bullJobId)) this.r.hset(k, { bull: m.bullJobId! })
    const p = opt(m.provider)
    if (p) {
      this.r.hset(k, { prov: p })
      this.r.zadd(this.pk(p, "run"), exp, lid)
      this.r.sadd(`${this.P}provs`, p)
      this.occCache.delete(p)
    }
    this.r.zadd(`${this.P}leases`, exp, lid)
    this.r.zadd(this.lk(line, "run"), exp, lid)
    this.r.hset(`${this.P}jl`, { [m.jobId]: lid })
    this.r.hset(this.lk(line, "m"), { user: m.userId, payer: m.payer, lane: m.lane })
    this.r.sadd(`${this.P}lines`, line)
  }

  unreserve(j: string) {
    const k = this.ek(j)
    const line = this.hget(k, "rline") ?? this.hget(k, "line"), p = this.hget(k, "rprov")
    this.r.zrem(`${this.P}resv`, j)
    if (line) { this.r.zrem(this.lk(line, "res"), j); this.touchLine(line) }
    if (p) { this.r.zrem(this.pk(p, "res"), j); this.touchProv(p) }
    this.r.hdel(k, "rline")
    this.r.hdel(k, "rprov")
  }

  dropWaiter(j: string) {
    const k = this.ek(j)
    const line = this.hget(k, "line")
    if (!line) return
    if (this.isReserved(j)) this.unreserve(j)
    const p = this.hget(k, "prov")
    this.r.zrem(this.lk(line, "wait"), j)
    this.r.zrem(`${this.P}wseen`, j)
    if (p) {
      if (this.r.hincrby(this.pk(p, "wl"), line, -1) <= 0) this.r.hdel(this.pk(p, "wl"), line)
      this.touchProv(p)
    }
    this.r.del(k)
    this.touchLine(line)
  }

  dropServerWaiter(j: string) {
    const k = this.sk(j)
    const pool = this.hget(k, "pool")
    if (pool) this.r.zrem(`${this.P}sw:${pool}`, j)
    this.r.zrem(`${this.P}sseen`, j)
    this.r.del(k)
  }

  purge() {
    this.r.zremRangeByScore(`${this.P}rel`, -Infinity, this.NOW)
    for (const lid of this.r.zrangeByScore(`${this.P}leases`, -Infinity, this.NOW)) this.dropLease(lid)
    for (const j of this.r.zrangeByScore(`${this.P}resv`, -Infinity, this.NOW)) {
      this.unreserve(j)
      if (this.hget(this.ek(j), "line")) this.r.hset(this.ek(j), { passed: "1" })
    }
    for (const j of this.r.zrangeByScore(`${this.P}wseen`, -Infinity, this.NOW - this.WAITER_TTL)) this.dropWaiter(j)
    for (const j of this.r.zrangeByScore(`${this.P}sseen`, -Infinity, this.NOW - this.WAITER_TTL)) this.dropServerWaiter(j)
  }

  lineHead(line: string): [string, string | null] | null {
    if (this.lineSize(line) - this.lineRunning(line) - this.lineReserved(line) <= 0) return null
    const blocked = new Set<string>()
    for (const j of this.r.zrange(this.lk(line, "wait"))) {
      if (this.isReserved(j)) continue
      if (!this.hget(this.ek(j), "enq")) {
        this.r.zrem(this.lk(line, "wait"), j) // an entry with no hash is no waiter
        continue
      }
      if (this.hget(this.ek(j), "passed") === "1") continue
      const p = this.hget(this.ek(j), "prov")
      if (!p) return [j, null]
      if (!blocked.has(p)) {
        const c = this.ceilOf(p)
        if (c === null || this.occ(p) < c) return [j, p]
        blocked.add(p)
      }
    }
    return null
  }

  reserve(j: string, line: string, p: string | null) {
    const exp = this.NOW + this.RES_TTL
    this.r.zadd(this.lk(line, "res"), exp, j)
    this.r.zadd(`${this.P}resv`, exp, j)
    if (p) { this.r.zadd(this.pk(p, "res"), exp, j); this.occCache.delete(p) }
    this.r.hset(this.ek(j), { rline: line })
    if (p) this.r.hset(this.ek(j), { rprov: p })
    this.wakes.push({ jobId: j, queue: this.hget(this.ek(j), "queue"), bullJobId: this.hget(this.ek(j), "bull") })
  }

  passOn() {
    const cand = new Set(this.touchedLines)
    for (const p of this.touchedProvs) for (const line of this.r.hkeys(this.pk(p, "wl"))) cand.add(line)
    const lines = [...cand].sort()
    for (;;) {
      const groups = new Map<string, Array<{ j: string; line: string; u: string; e: number }>>()
      let any = false
      for (const line of lines) {
        const head = this.lineHead(line)
        if (!head) continue
        const [j, p] = head
        if (this.ceilOf(p) === null) {
          this.reserve(j, line, p)
          any = true
        } else {
          const g = groups.get(p!) ?? groups.set(p!, []).get(p!)!
          g.push({ j, line, u: this.hget(this.ek(j), "user")!, e: Number(this.hget(this.ek(j), "enq")) })
        }
      }
      for (const p of [...groups.keys()].sort()) {
        let best: { j: string; line: string; u: string; e: number } | null = null
        for (const h of groups.get(p)!) if (!best || this.beats(p, h.j, h.u, h.e, best.j, best.u, best.e)) best = h
        this.reserve(best!.j, best!.line, p)
        any = true
      }
      if (!any) break
    }
  }

  tidy() {
    for (const line of this.touchedLines) {
      if (this.lineRunning(line) + this.lineReserved(line) + this.r.zcard(this.lk(line, "wait")) === 0) {
        this.r.srem(`${this.P}lines`, line)
        this.r.del(this.lk(line, "m"))
      }
    }
    for (const p of this.touchedProvs) {
      if (this.occ(p) === 0 && this.r.hlen(this.pk(p, "wl")) === 0 && this.r.hlen(this.pk(p, "o")) === 0) {
        this.r.srem(`${this.P}provs`, p)
      }
    }
  }

  settle() { this.passOn(); this.tidy() }

  reply(t: Json): string { return JSON.stringify({ ...t, wake: this.wakes }) }

  waitInfo(j: string): WaitOut {
    const k = this.ek(j)
    const line = this.hget(k, "line")!
    const enq = Number(this.hget(k, "enq"))
    return { lane: this.hget(k, "lane")!, position: this.r.zrank(this.lk(line, "wait"), j) + 1, limit: this.lineSize(line),
      running: this.lineRunning(line), reason: this.hget(k, "why")!, waitedMs: this.NOW - enq, enqueuedAtMs: enq }
  }

  serverWaitInfo(j: string): WaitOut {
    const k = this.sk(j)
    const enq = Number(this.hget(k, "enq"))
    return { lane: this.hget(k, "lane")!, position: this.r.zrank(`${this.P}sw:${this.hget(k, "pool")}`, j) + 1, limit: 0, running: 0,
      reason: "server_busy", waitedMs: this.NOW - enq, enqueuedAtMs: enq }
  }

  pruneOutcomes(p: string, minute: number) {
    for (const f of this.r.hkeys(this.pk(p, "o"))) {
      const mm = /^(\d+):/.exec(f)
      if (!mm || Number(mm[1]) < minute - 15) this.r.hdel(this.pk(p, "o"), f)
    }
  }
}

// ── the script bodies, ported ────────────────────────────────────────────────
type Body = (x: Run, req: Json) => string

const acquire: Body = (x, req) => {
  x.purge()
  const m = req.meta as Meta
  const J = m.jobId
  const line = x.lineOf(m)
  const p = opt(m.provider)
  const size = Number(req.size)
  x.r.hset(x.lk(line, "m"), { size, user: m.userId, payer: m.payer, lane: m.lane })
  x.r.sadd(`${x.P}lines`, line)
  x.touchLine(line)
  if (p) {
    x.r.sadd(`${x.P}provs`, p)
    x.touchProv(p)
  }
  x.dropServerWaiter(J)
  const leaseTtl = Number(req.leaseTtl)
  const leaseId = String(req.leaseId)

  const decide = (): Json => {
    const was = x.hget(x.ek(J), "line")
    if (was && was !== line) x.dropWaiter(J)
    const held = x.hget(`${x.P}jl`, J)
    if (held && x.hget(x.lsk(held), "line") === line) {
      x.extendLease(held, leaseTtl)
      x.dropWaiter(J)
      return { granted: true, leaseId: held, overLimit: x.hget(x.lsk(held), "over") === "1" }
    }
    if (req.mode === "readmit" || x.isReserved(J)) {
      x.dropWaiter(J)
      x.createLease(leaseId, line, m, leaseTtl, "0")
      return { granted: true, leaseId, overLimit: false }
    }
    const wl = x.lk(line, "wait")
    let cur = x.r.zscore(wl, J)
    if (cur !== null && !x.hget(x.ek(J), "enq")) {
      x.r.zrem(wl, J) // an entry with no hash: enter afresh
      cur = null
    }
    let score: number, enq: number
    if (cur !== null) {
      score = cur
      enq = Number(x.hget(x.ek(J), "enq"))
      x.r.hdel(x.ek(J), "passed")
    } else {
      const seq = x.r.incr(`${x.P}seq`)
      score = req.mode === "front" ? seq - FRONT : seq
      enq = x.NOW
    }
    const running = x.lineRunning(line), resAll = x.lineReserved(line)
    const behind = x.r.zrangeByScore(wl, score, Infinity, true).filter((w) => x.isReserved(w))
    let free = size - running - (resAll - behind.length)
    const tentative = new Map<string, number>()
    const blocked = new Set<string>()
    let reason: string | null = null
    for (const w of x.r.zrangeByScore(wl, -Infinity, score, false, true)) {
      if (reason) break
      if (x.isReserved(w)) continue
      if (x.hget(x.ek(w), "passed") === "1") continue
      if (free <= 0) {
        reason = "user_lane"
      } else {
        const wp = x.hget(x.ek(w), "prov")
        const c = x.ceilOf(wp)
        if (c !== null && (blocked.has(wp!) || x.occ(wp!) + (tentative.get(wp!) ?? 0) >= c)) {
          blocked.add(wp!)
        } else {
          free -= 1
          if (wp) tentative.set(wp, (tentative.get(wp) ?? 0) + 1)
        }
      }
    }
    if (!reason && free <= 0) reason = "user_lane"
    let victim: string | null = null
    if (!reason && free - behind.length <= 0) {
      victim = behind[behind.length - 1]!
      for (let i = behind.length - 1; i >= 0; i--) {
        if (p && x.hget(x.ek(behind[i]!), "rprov") === p) { victim = behind[i]!; break }
      }
    }
    if (!reason && p) {
      const c = x.ceilOf(p)
      if (c !== null) {
        if (blocked.has(p)) {
          reason = "provider_ceiling"
        } else {
          let freeP = c - x.occ(p) - (tentative.get(p) ?? 0)
          if (victim && x.hget(x.ek(victim), "rprov") === p) freeP += 1
          if (freeP <= 0) {
            reason = "provider_ceiling"
          } else {
            let favored = 0
            for (const other of x.r.hkeys(x.pk(p, "wl"))) {
              if (other === line) continue
              const head = x.lineHead(other)
              if (head && head[1] === p) {
                const h = head[0]
                if (x.beats(p, h, x.hget(x.ek(h), "user")!, Number(x.hget(x.ek(h), "enq")), J, m.userId, enq)) favored += 1
              }
            }
            if (favored >= freeP) reason = "provider_ceiling"
          }
        }
      }
    }
    if (!reason) {
      if (victim) x.unreserve(victim)
      if (cur !== null) x.dropWaiter(J)
      x.createLease(leaseId, line, m, leaseTtl, "0")
      return { granted: true, leaseId, overLimit: false }
    }
    if (x.r.get(`${x.P}enforced`) !== "1") {
      const wi: WaitOut = { lane: m.lane, position: Math.max(1, running + resAll - size + 1), limit: size, running, reason, waitedMs: x.NOW - enq, enqueuedAtMs: enq }
      if (cur !== null) x.dropWaiter(J)
      x.createLease(leaseId, line, m, leaseTtl, "1")
      return { granted: true, leaseId, overLimit: true, wait: wi }
    }
    const k = x.ek(J)
    if (cur === null) {
      x.r.zadd(wl, score, J)
      x.r.hset(k, { line, user: m.userId, payer: m.payer, lane: m.lane, mode: String(req.mode), enq, queue: m.queue })
      if (opt(m.source)) x.r.hset(k, { src: m.source! })
      if (opt(m.bullJobId)) x.r.hset(k, { bull: m.bullJobId! })
      if (p) {
        x.r.hset(k, { prov: p })
        x.r.hincrby(x.pk(p, "wl"), line, 1)
      }
    }
    x.r.hset(k, { seen: x.NOW, why: reason })
    x.r.zadd(`${x.P}wseen`, x.NOW, J)
    return { granted: false, wait: x.waitInfo(J) }
  }

  const out = decide()
  x.settle()
  if (out.wait && !out.granted) out.wait = x.waitInfo(J)
  return x.reply(out)
}

const renew: Body = (x, req) => {
  x.purge()
  const lid = String(req.leaseId)
  let status: string
  if (x.r.zscore(`${x.P}rel`, lid) !== null) {
    status = "released"
  } else if (x.r.zscore(`${x.P}leases`, lid) !== null) {
    x.extendLease(lid, Number(req.ttl))
    status = "renewed"
  } else if (x.hget(`${x.P}jl`, (req.meta as Meta).jobId)) {
    status = "released" // the job already holds a newer lease
  } else {
    const m = req.meta as Meta
    x.dropWaiter(m.jobId)
    x.dropServerWaiter(m.jobId)
    x.createLease(lid, x.lineOf(m), m, Number(req.ttl), "0")
    x.touchLine(x.lineOf(m))
    status = "readopted"
  }
  x.settle()
  return x.reply({ status })
}

const release: Body = (x, req) => {
  x.purge()
  const lid = String(req.leaseId)
  const k = x.lsk(lid)
  if (x.r.exists(k)) {
    const p = x.hget(k, "prov")
    x.dropLease(lid)
    if (p) {
      const minute = Math.floor(x.NOW / 60000)
      x.r.hincrby(x.pk(p, "o"), `${minute}:${String(req.outcome)}`, 1)
      x.pruneOutcomes(p, minute)
    }
  }
  x.r.zadd(`${x.P}rel`, x.NOW + x.RELEASED_TTL, lid)
  x.settle()
  return x.reply({})
}

const borrow: Body = (x, req) => {
  x.purge()
  x.settle()
  const lid = x.hget(`${x.P}jl`, String(req.jobId))
  return x.reply({ leaseId: lid && x.hget(x.lsk(lid), "lane") !== "run" ? lid : null })
}

const serverWait: Body = (x, req) => {
  x.purge()
  const m = req.meta as Meta
  const J = m.jobId
  const pool = String(req.pool)
  const k = x.sk(J)
  const old = x.hget(k, "pool")
  if (old !== pool) {
    if (old) {
      x.r.zrem(`${x.P}sw:${old}`, J)
    } else {
      x.r.hset(k, { enq: x.NOW, lane: m.lane, queue: m.queue })
      if (opt(m.bullJobId)) x.r.hset(k, { bull: m.bullJobId! })
    }
    x.r.zadd(`${x.P}sw:${pool}`, x.r.incr(`${x.P}seq`), J)
    x.r.hset(k, { pool })
    x.r.sadd(`${x.P}pools`, pool)
  }
  x.r.hset(k, { seen: x.NOW })
  x.r.zadd(`${x.P}sseen`, x.NOW, J)
  x.settle()
  return x.reply({ wait: x.serverWaitInfo(J) })
}

const withdraw: Body = (x, req) => {
  x.purge()
  x.dropWaiter(String(req.jobId))
  x.dropServerWaiter(String(req.jobId))
  x.settle()
  return x.reply({})
}

const describe: Body = (x, req) => {
  x.purge()
  x.settle()
  const J = String(req.jobId)
  let out: WaitOut | null = null
  if (x.hget(x.sk(J), "pool")) out = x.serverWaitInfo(J)
  else if (x.hget(x.ek(J), "line")) out = x.waitInfo(J)
  return x.reply({ wait: out })
}

const hasReservation: Body = (x, req) => {
  x.purge()
  x.settle()
  return x.reply({ reserved: x.isReserved(String(req.jobId)) })
}

const allWaiters: Body = (x) => {
  x.purge()
  x.settle()
  const out: Wake[] = []
  const seen = new Set<string>()
  for (const j of x.r.zrange(`${x.P}wseen`)) {
    seen.add(j)
    out.push({ jobId: j, queue: x.hget(x.ek(j), "queue"), bullJobId: x.hget(x.ek(j), "bull") })
  }
  for (const j of x.r.zrange(`${x.P}sseen`)) {
    if (!seen.has(j)) out.push({ jobId: j, queue: x.hget(x.sk(j), "queue"), bullJobId: x.hget(x.sk(j), "bull") })
  }
  return x.reply({ waiters: out })
}

const heads: Body = (x) => {
  x.purge()
  x.settle()
  const out: Json[] = []
  for (const line of x.r.smembers(`${x.P}lines`).sort()) {
    const first = x.r.zrange(x.lk(line, "wait"))[0]
    if (first) {
      const seen = x.hget(x.ek(first), "seen")
      out.push({ jobId: first, queue: x.hget(x.ek(first), "queue"), lastSeenMs: seen === null ? null : Number(seen) })
    }
  }
  return x.reply({ heads: out })
}

const setEnforced: Body = (x, req) => {
  x.purge()
  x.r.set(`${x.P}enforced`, req.on ? "1" : "0")
  x.settle()
  return x.reply({})
}

const setProviderCeilings: Body = (x, req) => {
  x.purge()
  const want = req.ceilings as Record<string, number>
  for (const p of x.r.smembers(`${x.P}ceils`)) {
    if (want[p] === undefined) {
      x.r.del(x.pk(p, "ceil"))
      x.r.srem(`${x.P}ceils`, p)
      x.touchProv(p)
    }
  }
  for (const [p, c] of Object.entries(want)) {
    const old = x.ceilOf(p)
    x.r.set(x.pk(p, "ceil"), String(c))
    x.r.sadd(`${x.P}ceils`, p)
    if (old !== null && c > old) x.touchProv(p)
  }
  x.settle()
  return x.reply({})
}

const isEnforced: Body = (x) => {
  x.purge()
  x.settle()
  return x.reply({ enforced: x.r.get(`${x.P}enforced`) === "1" })
}

const snapshot: Body = (x) => {
  x.purge()
  x.settle()
  const zero = () => ({ running: 0, overLimit: 0, queued: 0 })
  type Group = { userId: string; payer: string; lanes: Record<string, ReturnType<typeof zero>>; oldestWaitMs: number; sources: Record<string, number> }
  const groups = new Map<string, Group>()
  for (const line of x.r.smembers(`${x.P}lines`).sort()) {
    const mk = x.lk(line, "m")
    const u = x.hget(mk, "user"), py = x.hget(mk, "payer"), ln = x.hget(mk, "lane")
    if (!u || !py || !ln) continue
    const key = `${py}|${u}`
    let g = groups.get(key)
    if (!g) {
      g = { userId: u, payer: py, lanes: { provider: zero(), llm: zero(), local: zero(), run: zero() }, oldestWaitMs: 0, sources: {} }
      groups.set(key, g)
    }
    const e = g.lanes[ln]!
    for (const lid of x.r.zrange(x.lk(line, "run"))) {
      e.running += 1
      if (x.hget(x.lsk(lid), "over") === "1") e.overLimit += 1
      const src = x.hget(x.lsk(lid), "src")
      if (src) g.sources[src] = (g.sources[src] ?? 0) + 1
    }
    for (const j of x.r.zrange(x.lk(line, "wait"))) {
      e.queued += 1
      const enq = x.hget(x.ek(j), "enq")
      if (enq !== null && x.NOW - Number(enq) > g.oldestWaitMs) g.oldestWaitMs = x.NOW - Number(enq)
      const src = x.hget(x.ek(j), "src")
      if (src) g.sources[src] = (g.sources[src] ?? 0) + 1
    }
  }
  const minute = Math.floor(x.NOW / 60000)
  const providers: Json[] = []
  for (const p of x.r.smembers(`${x.P}provs`).sort()) {
    x.pruneOutcomes(p, minute)
    const byUser: Record<string, number> = {}
    let running = 0
    for (const lid of x.r.zrange(x.pk(p, "run"))) {
      running += 1
      const u = x.hget(x.lsk(lid), "user")
      if (u) byUser[u] = (byUser[u] ?? 0) + 1
    }
    let done = 0, failed = 0
    for (const [f, v] of x.r.hgetall(x.pk(p, "o"))) {
      const mm = /^(\d+):(.+)$/.exec(f)!
      if (Number(mm[1]) >= minute - 14) {
        if (mm[2] === "completed") done += Number(v)
        if (mm[2] === "failed") failed += Number(v)
      }
    }
    if (running > 0 || done > 0 || failed > 0) providers.push({ provider: p, running, byUser, completed15m: done, failed15m: failed })
    if (x.occ(p) === 0 && x.r.hlen(x.pk(p, "wl")) === 0 && x.r.hlen(x.pk(p, "o")) === 0) {
      x.r.srem(`${x.P}provs`, p)
    }
  }
  return x.reply({ lines: [...groups.values()], providers, enforced: x.r.get(`${x.P}enforced`) === "1" })
}

const BODIES: Record<LaneGateScriptName, Body> = { acquire, renew, release, borrow, serverWait, withdraw, describe, hasReservation, allWaiters, heads, setEnforced, setProviderCeilings, isEnforced, snapshot }
const BY_SOURCE = new Map<string, Body>(Object.entries(LANE_GATE_SCRIPTS).map(([name, src]) => [src, BODIES[name as LaneGateScriptName]]))

export interface FakeLaneClient {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>
  publish(channel: string, message: string): Promise<number>
}

/** A client over `store` that runs the twin of whichever gate script it is handed. */
export function makeFakeLaneClient(store: FakeLaneStore): LaneClient {
  const client: FakeLaneClient = {
    async eval(script, _numKeys, ...args) {
      const body = BY_SOURCE.get(script)
      if (!body) throw new Error("fake-lane-redis: unknown script")
      const [prefix, now, resTtl, waiterTtl, releasedTtl, json] = args
      const run = new Run(store, String(prefix), Number(now), Number(resTtl), Number(waiterTtl), Number(releasedTtl))
      return body(run, JSON.parse(String(json)) as Json)
    },
    async publish(channel, message) {
      store.published.push({ channel, message })
      return 0
    },
  }
  return client as unknown as LaneClient
}
