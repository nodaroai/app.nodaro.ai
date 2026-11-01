// backend/src/lib/concurrency-lanes/gate-scripts.ts — the Lua of the
// concurrency gate (decided 2026-10-30). The scripts are the source of truth:
// every decision is one script, atomic across processes; the JS twin
// (__tests__/fake-lane-redis.ts) mirrors them helper for helper, and one
// contract suite runs against both.
//
// CLUSTER NOTE: the scripts build their keys from the prefix and touch keys
// that are NOT passed as KEYS (a line's waiters, other lines' heads, the
// provider sets). That is fine on single-node Redis — what the platform runs —
// and not Redis-Cluster-safe.
//
// Every script is PRELUDE .. body. ARGV: prefix, now, reservation TTL, waiter
// TTL, tombstone TTL, request JSON. Time is the caller's clock (ARGV now), never
// Redis's: expiries are scores and values compared against it, so the contract
// can drive a fake clock and nothing depends on a key's PEXPIRE.
//
// Keys under the prefix (`cl:v1:` in production):
//   l:<line>:run   ZSET leaseId → expiry       l:<line>:res  ZSET jobId → expiry
//   l:<line>:wait  ZSET jobId → order          l:<line>:m    HASH size, user, payer, lane
//   p:<prov>:run   ZSET leaseId → expiry       p:<prov>:res  ZSET jobId → expiry
//   p:<prov>:wl    HASH line → its waiters on the provider
//   p:<prov>:ceil  the provider's ceiling (set only by setProviderCeilings; `ceils` lists them)
//   p:<prov>:o     HASH "<minute>:<outcome>" → count
//   lease:<id>     HASH of a lease             e:<job>       HASH of a lane waiter
//   se:<job>       HASH of a server waiter     sw:<pool>     ZSET jobId → order
//   leases, resv, wseen, sseen, rel            global expiry / last-seen ZSETs
//   jl             HASH jobId → its leaseId    lines, provs, pools, ceils  SETs
//   seq            order counter               enforced      "1" when on
//   enforced:v     the version of `enforced` (the setting row's updated_at, ms)
// A lease and a lane waiter also keep what the job is (`type`, `model`, `sdet`
// — its source detail), and a lease when it was created (`at`), only for the
// Live usage drill-down (userEntries); no decision reads them.
// A line is `<payer>:<userId>:<lane>`. A job waits in at most ONE line: entering
// another drops it from the first. A reserved waiter stays in its line's wait
// ZSET until it converts; `passed` marks a waiter whose reservation lapsed — the
// pass-on skips it, and it blocks no one, until it is seen again. `held` marks
// a waiter its server share holds back (SERVER_WAIT), and names that share's
// pool: it keeps its place, and the pass-on reserves nothing at or behind it
// for a waiter of the SAME pool — the same user on the same share — so a freed
// slot does not cycle through them. Waiters of another pool (one line can span
// two: the `local` lane runs on the video and the render workers) go past it
// in their own order, and so may an acquire that can start. Its next acquire
// clears the mark. A queue's pool is POOL_OF; a live or inline waiter has none
// and is never held back.

import { PRELUDE } from "./gate-scripts-prelude.js"
import { SNAPSHOT, USER_ENTRIES } from "./gate-scripts-read.js"

/** REQ: { meta, size, mode, leaseId, leaseTtl } → { granted, leaseId?, overLimit?, wait? }. The ceiling is the stored one. */
const ACQUIRE = `${PRELUDE}
purge()
local m = REQ.meta
local J = m.jobId
local line = lineOf(m)
local p = opt(m.provider)
local size = tonumber(REQ.size)
redis.call('HSET', lk(line, 'm'), 'size', size, 'user', m.userId, 'payer', m.payer, 'lane', m.lane)
redis.call('SADD', P .. 'lines', line)
touchLine(line)
if p then
  redis.call('SADD', P .. 'provs', p)
  touchProv(p)
end
dropServerWaiter(J)

local function decide()
  -- One job waits in one line: entering this one leaves no trace in another.
  local was = hget(ek(J), 'line')
  if was and was ~= line then dropWaiter(J) end
  local held = hget(P .. 'jl', J)
  if held and hget(lsk(held), 'line') == line then
    extendLease(held, REQ.leaseTtl)
    dropWaiter(J)
    -- Foreign: another BullMQ entry of the job holds it (the captions render
    -- it was handed to). The caller runs under it but must never release it.
    local f = redis.call('HMGET', lsk(held), 'queue', 'bull')
    local foreign = opt(f[1]) ~= opt(m.queue) or opt(f[2]) ~= opt(m.bullJobId)
    return { granted = true, leaseId = held, overLimit = hget(lsk(held), 'over') == '1', foreign = foreign }
  end
  if REQ.mode == 'readmit' or isReserved(J) then
    dropWaiter(J)
    createLease(REQ.leaseId, line, m, REQ.leaseTtl, '0')
    return { granted = true, leaseId = REQ.leaseId, overLimit = false }
  end
  local wl = lk(line, 'wait')
  local cur = opt(redis.call('ZSCORE', wl, J))
  if cur and not hget(ek(J), 'enq') then
    redis.call('ZREM', wl, J) -- an entry with no hash: enter afresh
    cur = nil
  end
  local score, enq
  if cur then
    score = tonumber(cur)
    enq = tonumber(hget(ek(J), 'enq'))
    redis.call('HDEL', ek(J), 'passed', 'held')
  else
    local seq = redis.call('INCR', P .. 'seq')
    score = seq
    if REQ.mode == 'front' then score = seq - FRONT end
    enq = NOW
  end
  local running, resAll = lineRunning(line), lineReserved(line)
  -- Reservations held behind this job are slots it may take over.
  local behind = {}
  for _, w in ipairs(redis.call('ZRANGEBYSCORE', wl, '(' .. int(score), '+inf')) do
    if isReserved(w) then behind[#behind + 1] = w end
  end
  local free = size - running - (resAll - #behind)
  local tentative, blocked, reason, heldPools = {}, {}, nil, {}
  -- Every waiter ahead that could start takes a slot first; one blocked only
  -- by its provider's ceiling does not (it never holds back a waiter on
  -- another provider), nor does one held back by its server share or behind
  -- such a waiter of its pool.
  for _, w in ipairs(redis.call('ZRANGEBYSCORE', wl, '-inf', '(' .. int(score))) do
    if reason then break end
    if not isReserved(w) then
      local f = redis.call('HMGET', ek(w), 'prov', 'passed', 'held', 'queue')
      local wpool = POOL_OF[opt(f[4]) or '']
      if opt(f[3]) then heldPools[f[3]] = true end
      if opt(f[2]) ~= '1' and not opt(f[3]) and not (wpool and heldPools[wpool]) then
        if free <= 0 then
          reason = 'user_lane'
        else
          local wp = opt(f[1])
          local c = ceilOf(wp)
          if c and (blocked[wp] or occ(wp) + (tentative[wp] or 0) >= c) then
            blocked[wp] = true
          else
            free = free - 1
            if wp then tentative[wp] = (tentative[wp] or 0) + 1 end
          end
        end
      end
    end
  end
  if not reason and free <= 0 then reason = 'user_lane' end
  local victim = nil
  if not reason and free - #behind <= 0 then
    victim = behind[#behind]
    for i = #behind, 1, -1 do
      if p and hget(ek(behind[i]), 'rprov') == p then victim = behind[i]; break end
    end
  end
  if not reason and p then
    local c = ceilOf(p)
    if c then
      if blocked[p] then
        reason = 'provider_ceiling'
      else
        local freeP = c - occ(p) - (tentative[p] or 0)
        if victim and hget(ek(victim), 'rprov') == p then freeP = freeP + 1 end
        if freeP <= 0 then
          reason = 'provider_ceiling'
        else
          local favored = 0
          for _, other in ipairs(redis.call('HKEYS', pk(p, 'wl'))) do
            if other ~= line then
              local h, hp = lineHead(other)
              if h and hp == p then
                local f = redis.call('HMGET', ek(h), 'user', 'enq')
                if beats(p, h, f[1], tonumber(f[2]), J, m.userId, enq) then favored = favored + 1 end
              end
            end
          end
          if favored >= freeP then reason = 'provider_ceiling' end
        end
      end
    end
  end
  if not reason then
    if victim then unreserve(victim) end
    if cur then dropWaiter(J) end
    createLease(REQ.leaseId, line, m, REQ.leaseTtl, '0')
    return { granted = true, leaseId = REQ.leaseId, overLimit = false }
  end
  if redis.call('GET', P .. 'enforced') ~= '1' then
    local wi = { lane = m.lane, position = math.max(1, running + resAll - size + 1), limit = size, running = running,
      reason = reason, waitedMs = NOW - enq, enqueuedAtMs = enq }
    if cur then dropWaiter(J) end
    createLease(REQ.leaseId, line, m, REQ.leaseTtl, '1')
    return { granted = true, leaseId = REQ.leaseId, overLimit = true, wait = wi }
  end
  local k = ek(J)
  if not cur then
    redis.call('ZADD', wl, score, J)
    redis.call('HSET', k, 'line', line, 'user', m.userId, 'payer', m.payer, 'lane', m.lane, 'mode', REQ.mode, 'enq', enq, 'queue', m.queue)
    if opt(m.source) then redis.call('HSET', k, 'src', m.source) end
    if opt(m.bullJobId) then redis.call('HSET', k, 'bull', m.bullJobId) end
    describeEntry(k, m)
    if p then
      redis.call('HSET', k, 'prov', p)
      redis.call('HINCRBY', pk(p, 'wl'), line, 1)
    end
  end
  redis.call('HSET', k, 'seen', NOW, 'why', reason)
  redis.call('ZADD', P .. 'wseen', NOW, J)
  return { granted = false, wait = waitInfo(J) }
end

local out = decide()
settle()
if out.wait and not out.granted then out.wait = waitInfo(J) end
return reply(out)
`

/** REQ: { leaseId, ttl, meta } → { status } */
const RENEW = `${PRELUDE}
purge()
local lid = REQ.leaseId
local status
if redis.call('ZSCORE', P .. 'rel', lid) then
  status = 'released'
elseif redis.call('ZSCORE', P .. 'leases', lid) then
  extendLease(lid, REQ.ttl)
  status = 'renewed'
elseif hget(P .. 'jl', REQ.meta.jobId) then
  status = 'released' -- the job already holds a newer lease
else
  local m = REQ.meta
  dropWaiter(m.jobId)
  dropServerWaiter(m.jobId)
  createLease(lid, lineOf(m), m, REQ.ttl, '0')
  touchLine(lineOf(m))
  status = 'readopted'
end
settle()
return reply({ status = status })
`

/** REQ: { leaseId, outcome } → {} */
const RELEASE = `${PRELUDE}
purge()
local lid = REQ.leaseId
local k = lsk(lid)
if redis.call('EXISTS', k) == 1 then
  local p = hget(k, 'prov')
  dropLease(lid)
  if p then
    local minute = math.floor(NOW / 60000)
    redis.call('HINCRBY', pk(p, 'o'), int(minute) .. ':' .. REQ.outcome, 1)
    pruneOutcomes(p, minute)
  end
end
redis.call('ZADD', P .. 'rel', NOW + RELEASED_TTL, lid)
settle()
return reply({})
`

/** REQ: { jobId } → { leaseId } — only a leaf lease is lent. */
const BORROW = `${PRELUDE}
purge()
settle()
local lid = hget(P .. 'jl', REQ.jobId)
local out = NULL
if lid and hget(lsk(lid), 'lane') ~= 'run' then out = lid end
return reply({ leaseId = out })
`

/**
 * REQ: { leaseId } → { lease } — who a live lease belongs to (its line's
 * user, payer and lane), or null for one that expired, was released or never
 * existed. Reads only: unlike renew, never re-creates a lease.
 */
const LEASE_LINE = `${PRELUDE}
purge()
settle()
local lid = REQ.leaseId
local out = NULL
local k = lsk(lid)
if redis.call('ZSCORE', P .. 'leases', lid) and redis.call('EXISTS', k) == 1 then
  out = { userId = hget(k, 'user') or '', payer = hget(k, 'payer') or '', lane = hget(k, 'lane') or '' }
end
return reply({ lease = out })
`

/**
 * REQ: { meta, pool } → { wait }. A job that also waits in a lane line keeps
 * its place there, marked `held`: a slot reserved for it is passed on, and its
 * line reserves nothing at or behind it until its next acquire.
 */
const SERVER_WAIT = `${PRELUDE}
purge()
local m = REQ.meta
local J = m.jobId
local k = sk(J)
local old = hget(k, 'pool')
if old ~= REQ.pool then
  if old then
    redis.call('ZREM', P .. 'sw:' .. old, J)
  else
    redis.call('HSET', k, 'enq', NOW, 'lane', m.lane, 'queue', m.queue)
    if opt(m.bullJobId) then redis.call('HSET', k, 'bull', m.bullJobId) end
  end
  redis.call('ZADD', P .. 'sw:' .. REQ.pool, redis.call('INCR', P .. 'seq'), J)
  redis.call('HSET', k, 'pool', REQ.pool)
  redis.call('SADD', P .. 'pools', REQ.pool)
end
redis.call('HSET', k, 'seen', NOW)
redis.call('ZADD', P .. 'sseen', NOW, J)
local held = hget(ek(J), 'line')
if held then
  if isReserved(J) then unreserve(J) end
  redis.call('HSET', ek(J), 'held', REQ.pool, 'seen', NOW)
  redis.call('ZADD', P .. 'wseen', NOW, J)
  touchLine(held)
end
settle()
return reply({ wait = serverWaitInfo(J) })
`

/** REQ: { jobId } → {} */
const WITHDRAW = `${PRELUDE}
purge()
dropWaiter(REQ.jobId)
dropServerWaiter(REQ.jobId)
settle()
return reply({})
`

/** REQ: { jobId } → { wait } — a server wait first: the share is checked before the lane. */
const DESCRIBE = `${PRELUDE}
purge()
settle()
local J = REQ.jobId
local out = NULL
if hget(sk(J), 'pool') then
  out = serverWaitInfo(J)
elseif hget(ek(J), 'line') then
  out = waitInfo(J)
end
return reply({ wait = out, payer = hget(ek(J), 'payer') or NULL })
`

const HAS_RESERVATION = `${PRELUDE}
purge()
settle()
return reply({ reserved = isReserved(REQ.jobId) })
`

/** → { waiters } — lane waiters, then server waiters. */
const ALL_WAITERS = `${PRELUDE}
purge()
settle()
local out, seen = {}, {}
for _, j in ipairs(redis.call('ZRANGE', P .. 'wseen', 0, -1)) do
  local f = redis.call('HMGET', ek(j), 'queue', 'bull')
  seen[j] = true
  out[#out + 1] = { jobId = j, queue = opt(f[1]) or NULL, bullJobId = opt(f[2]) or NULL }
end
for _, j in ipairs(redis.call('ZRANGE', P .. 'sseen', 0, -1)) do
  if not seen[j] then
    local f = redis.call('HMGET', sk(j), 'queue', 'bull')
    out[#out + 1] = { jobId = j, queue = opt(f[1]) or NULL, bullJobId = opt(f[2]) or NULL }
  end
end
return reply({ waiters = out })
`

/** → { heads } — the first waiter of every line. */
const HEADS = `${PRELUDE}
purge()
settle()
local lines = redis.call('SMEMBERS', P .. 'lines')
table.sort(lines)
local out = {}
for _, line in ipairs(lines) do
  local first = redis.call('ZRANGE', lk(line, 'wait'), 0, 0)[1]
  if first then
    local f = redis.call('HMGET', ek(first), 'queue', 'seen')
    local seen = opt(f[2])
    out[#out + 1] = { jobId = first, queue = opt(f[1]) or NULL, lastSeenMs = seen and tonumber(seen) or NULL }
  end
end
return reply({ heads = out })
`

/**
 * REQ: { on, version } → { was, enforced } — the flag before and after. A
 * version older than the stored one changes nothing (a mirror that read the
 * setting before a newer write); an equal or newer one applies. `was` lets
 * exactly one caller see an on→off edge.
 */
const SET_ENFORCED = `${PRELUDE}
purge()
local was = redis.call('GET', P .. 'enforced') == '1'
local v = tonumber(REQ.version) or 0
local stored = tonumber(opt(redis.call('GET', P .. 'enforced:v')) or '0')
if v >= stored then
  if REQ.on then redis.call('SET', P .. 'enforced', '1') else redis.call('SET', P .. 'enforced', '0') end
  redis.call('SET', P .. 'enforced:v', int(v))
end
settle()
return reply({ was = was, enforced = redis.call('GET', P .. 'enforced') == '1' })
`

/**
 * REQ: { ceilings: { [provider]: n } } — the providers' ceilings, whole: one
 * absent from the map has none. A ceiling that rose (or went) frees provider
 * slots, which are passed on to the heads waiting for them.
 */
const SET_CEILINGS = `${PRELUDE}
purge()
local want = REQ.ceilings
for _, p in ipairs(redis.call('SMEMBERS', P .. 'ceils')) do
  if want[p] == nil then
    redis.call('DEL', pk(p, 'ceil'))
    redis.call('SREM', P .. 'ceils', p)
    touchProv(p)
  end
end
for p, c in pairs(want) do
  local old = ceilOf(p)
  redis.call('SET', pk(p, 'ceil'), c)
  redis.call('SADD', P .. 'ceils', p)
  if old and c > old then touchProv(p) end
end
settle()
return reply({})
`

const IS_ENFORCED = `${PRELUDE}
purge()
settle()
return reply({ enforced = redis.call('GET', P .. 'enforced') == '1' })
`

/** The scripts, exported so the JS twin can recognise which one it was handed. */
export const LANE_GATE_SCRIPTS = {
  acquire: ACQUIRE,
  renew: RENEW,
  release: RELEASE,
  borrow: BORROW,
  leaseLine: LEASE_LINE,
  serverWait: SERVER_WAIT,
  withdraw: WITHDRAW,
  describe: DESCRIBE,
  hasReservation: HAS_RESERVATION,
  allWaiters: ALL_WAITERS,
  heads: HEADS,
  setEnforced: SET_ENFORCED,
  setProviderCeilings: SET_CEILINGS,
  isEnforced: IS_ENFORCED,
  snapshot: SNAPSHOT,
  userEntries: USER_ENTRIES,
} as const

export type LaneGateScriptName = keyof typeof LANE_GATE_SCRIPTS
