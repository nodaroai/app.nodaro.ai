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
// A line is `<payer>:<userId>:<lane>`. A job waits in at most ONE line: entering
// another drops it from the first. A reserved waiter stays in its line's wait
// ZSET until it converts; `passed` marks a waiter whose reservation lapsed — the
// pass-on skips it, and it blocks no one, until it is seen again.

const PRELUDE = `
local P = ARGV[1]
local NOW = tonumber(ARGV[2])
local RES_TTL = tonumber(ARGV[3])
local WAITER_TTL = tonumber(ARGV[4])
local RELEASED_TTL = tonumber(ARGV[5])
local REQ = cjson.decode(ARGV[6])
local NULL = cjson.null
local FRONT = 1000000000000

local touchedLines, touchedProvs, wakes, occCache = {}, {}, {}, {}

local function opt(v) if v == nil or v == false or v == NULL or v == '' then return nil end return v end
local function int(x) return string.format('%.0f', x) end
local function hget(k, f) return opt(redis.call('HGET', k, f)) end
local function lk(line, part) return P .. 'l:' .. line .. ':' .. part end
local function pk(p, part) return P .. 'p:' .. p .. ':' .. part end
local function ek(j) return P .. 'e:' .. j end
local function sk(j) return P .. 'se:' .. j end
local function lsk(l) return P .. 'lease:' .. l end
local function touchLine(line) if line then touchedLines[line] = true end end
local function touchProv(p) if p then touchedProvs[p] = true; occCache[p] = nil end end
local function isReserved(j) return redis.call('ZSCORE', P .. 'resv', j) ~= false end
local function ceilOf(p)
  if not p then return nil end
  local c = opt(redis.call('GET', pk(p, 'ceil')))
  if not c then return nil end
  return tonumber(c)
end
local function occ(p) return redis.call('ZCARD', pk(p, 'run')) + redis.call('ZCARD', pk(p, 'res')) end
local function lineSize(line) local s = hget(lk(line, 'm'), 'size') if not s then return 0 end return tonumber(s) end
local function lineRunning(line) return redis.call('ZCARD', lk(line, 'run')) end
local function lineReserved(line) return redis.call('ZCARD', lk(line, 'res')) end
local function lineOf(m) return m.payer .. ':' .. m.userId .. ':' .. m.lane end

local function userOcc(p, user)
  local t = occCache[p]
  if not t then
    t = {}
    for _, l in ipairs(redis.call('ZRANGE', pk(p, 'run'), 0, -1)) do
      local u = hget(lsk(l), 'user')
      if u then t[u] = (t[u] or 0) + 1 end
    end
    for _, j in ipairs(redis.call('ZRANGE', pk(p, 'res'), 0, -1)) do
      local u = hget(ek(j), 'user')
      if u then t[u] = (t[u] or 0) + 1 end
    end
    occCache[p] = t
  end
  return t[user] or 0
end

-- Fairness among heads waiting on provider p: fewer running on p (the user's,
-- across all payer lines), then older, then job id.
local function beats(p, aj, au, ae, bj, bu, be)
  local ao, bo = userOcc(p, au), userOcc(p, bu)
  if ao ~= bo then return ao < bo end
  if ae ~= be then return ae < be end
  return aj < bj
end

local function dropLease(lid)
  local k = lsk(lid)
  local line, p, job = hget(k, 'line'), hget(k, 'prov'), hget(k, 'job')
  redis.call('ZREM', P .. 'leases', lid)
  if line then redis.call('ZREM', lk(line, 'run'), lid); touchLine(line) end
  if p then redis.call('ZREM', pk(p, 'run'), lid); touchProv(p) end
  if job and hget(P .. 'jl', job) == lid then redis.call('HDEL', P .. 'jl', job) end
  redis.call('DEL', k)
end

local function extendLease(lid, ttl)
  local exp = NOW + ttl
  local k = lsk(lid)
  local line, p = hget(k, 'line'), hget(k, 'prov')
  redis.call('ZADD', P .. 'leases', exp, lid)
  if line then redis.call('ZADD', lk(line, 'run'), exp, lid) end
  if p then redis.call('ZADD', pk(p, 'run'), exp, lid) end
end

local function createLease(lid, line, m, ttl, over)
  local exp = NOW + ttl
  local k = lsk(lid)
  redis.call('HSET', k, 'job', m.jobId, 'line', line, 'user', m.userId, 'payer', m.payer, 'lane', m.lane, 'over', over, 'queue', m.queue)
  if opt(m.source) then redis.call('HSET', k, 'src', m.source) end
  if opt(m.bullJobId) then redis.call('HSET', k, 'bull', m.bullJobId) end
  local p = opt(m.provider)
  if p then
    redis.call('HSET', k, 'prov', p)
    redis.call('ZADD', pk(p, 'run'), exp, lid)
    redis.call('SADD', P .. 'provs', p)
    occCache[p] = nil
  end
  redis.call('ZADD', P .. 'leases', exp, lid)
  redis.call('ZADD', lk(line, 'run'), exp, lid)
  redis.call('HSET', P .. 'jl', m.jobId, lid)
  redis.call('HSET', lk(line, 'm'), 'user', m.userId, 'payer', m.payer, 'lane', m.lane)
  redis.call('SADD', P .. 'lines', line)
end

-- Drop a waiter's reservation; the waiter keeps its place.
local function unreserve(j)
  local k = ek(j)
  local line, p = hget(k, 'rline') or hget(k, 'line'), hget(k, 'rprov')
  redis.call('ZREM', P .. 'resv', j)
  if line then redis.call('ZREM', lk(line, 'res'), j); touchLine(line) end
  if p then redis.call('ZREM', pk(p, 'res'), j); touchProv(p) end
  redis.call('HDEL', k, 'rline', 'rprov')
end

local function dropWaiter(j)
  local k = ek(j)
  local line = hget(k, 'line')
  if not line then return end
  if isReserved(j) then unreserve(j) end
  local p = hget(k, 'prov')
  redis.call('ZREM', lk(line, 'wait'), j)
  redis.call('ZREM', P .. 'wseen', j)
  if p then
    if redis.call('HINCRBY', pk(p, 'wl'), line, -1) <= 0 then redis.call('HDEL', pk(p, 'wl'), line) end
    touchProv(p)
  end
  redis.call('DEL', k)
  touchLine(line)
end

local function dropServerWaiter(j)
  local k = sk(j)
  local pool = hget(k, 'pool')
  if pool then redis.call('ZREM', P .. 'sw:' .. pool, j) end
  redis.call('ZREM', P .. 'sseen', j)
  redis.call('DEL', k)
end

-- Expired leases and reservations, and waiters not seen for the waiter TTL.
local function purge()
  redis.call('ZREMRANGEBYSCORE', P .. 'rel', '-inf', NOW)
  for _, lid in ipairs(redis.call('ZRANGEBYSCORE', P .. 'leases', '-inf', NOW)) do dropLease(lid) end
  for _, j in ipairs(redis.call('ZRANGEBYSCORE', P .. 'resv', '-inf', NOW)) do
    unreserve(j)
    if hget(ek(j), 'line') then redis.call('HSET', ek(j), 'passed', '1') end
  end
  for _, j in ipairs(redis.call('ZRANGEBYSCORE', P .. 'wseen', '-inf', NOW - WAITER_TTL)) do dropWaiter(j) end
  for _, j in ipairs(redis.call('ZRANGEBYSCORE', P .. 'sseen', '-inf', NOW - WAITER_TTL)) do dropServerWaiter(j) end
end

-- The first waiter of a line with room that could start now: reserved and
-- passed-over waiters are skipped, and so is a waiter whose provider is at its
-- ceiling: a later waiter on another provider may go past it.
local function lineHead(line)
  if lineSize(line) - lineRunning(line) - lineReserved(line) <= 0 then return nil end
  local blocked = {}
  for _, j in ipairs(redis.call('ZRANGE', lk(line, 'wait'), 0, -1)) do
    if not isReserved(j) then
      local f = redis.call('HMGET', ek(j), 'prov', 'passed', 'enq')
      if not opt(f[3]) then
        redis.call('ZREM', lk(line, 'wait'), j) -- an entry with no hash is no waiter
      elseif opt(f[2]) ~= '1' then
        local p = opt(f[1])
        if not p then return j, nil end
        if not blocked[p] then
          local c = ceilOf(p)
          if not c or occ(p) < c then return j, p end
          blocked[p] = true
        end
      end
    end
  end
  return nil
end

local function reserve(j, line, p)
  local exp = NOW + RES_TTL
  redis.call('ZADD', lk(line, 'res'), exp, j)
  redis.call('ZADD', P .. 'resv', exp, j)
  if p then redis.call('ZADD', pk(p, 'res'), exp, j); occCache[p] = nil end
  redis.call('HSET', ek(j), 'rline', line)
  if p then redis.call('HSET', ek(j), 'rprov', p) end
  local f = redis.call('HMGET', ek(j), 'queue', 'bull')
  wakes[#wakes + 1] = { jobId = j, queue = opt(f[1]) or NULL, bullJobId = opt(f[2]) or NULL }
end

-- Reserve every slot freed in the touched lines, and every provider slot freed
-- for lines waiting on a touched provider: one head per line per round, the
-- fairest head per ceiling-bound provider, until a round reserves nothing.
local function passOn()
  local cand = {}
  for line in pairs(touchedLines) do cand[line] = true end
  for p in pairs(touchedProvs) do
    for _, line in ipairs(redis.call('HKEYS', pk(p, 'wl'))) do cand[line] = true end
  end
  local lines = {}
  for line in pairs(cand) do lines[#lines + 1] = line end
  table.sort(lines)
  while true do
    local groups, order, any = {}, {}, false
    for _, line in ipairs(lines) do
      local j, p = lineHead(line)
      if j then
        if not ceilOf(p) then
          reserve(j, line, p)
          any = true
        else
          if not groups[p] then groups[p] = {}; order[#order + 1] = p end
          local f = redis.call('HMGET', ek(j), 'user', 'enq')
          table.insert(groups[p], { j = j, line = line, u = f[1], e = tonumber(f[2]) })
        end
      end
    end
    table.sort(order)
    for _, p in ipairs(order) do
      local best = nil
      for _, h in ipairs(groups[p]) do
        if not best or beats(p, h.j, h.u, h.e, best.j, best.u, best.e) then best = h end
      end
      reserve(best.j, best.line, p)
      any = true
    end
    if not any then break end
  end
end

local function tidy()
  for line in pairs(touchedLines) do
    if lineRunning(line) + lineReserved(line) + redis.call('ZCARD', lk(line, 'wait')) == 0 then
      redis.call('SREM', P .. 'lines', line)
      redis.call('DEL', lk(line, 'm'))
    end
  end
  for p in pairs(touchedProvs) do
    if occ(p) == 0 and redis.call('HLEN', pk(p, 'wl')) == 0 and redis.call('HLEN', pk(p, 'o')) == 0 then
      redis.call('SREM', P .. 'provs', p)
    end
  end
end

local function settle() passOn(); tidy() end

local function reply(t)
  t.wake = wakes
  return cjson.encode(t)
end

local function waitInfo(j)
  local f = redis.call('HMGET', ek(j), 'line', 'lane', 'enq', 'why')
  local line, enq = f[1], tonumber(f[3])
  return { lane = f[2], position = redis.call('ZRANK', lk(line, 'wait'), j) + 1, limit = lineSize(line),
    running = lineRunning(line), reason = f[4], waitedMs = NOW - enq, enqueuedAtMs = enq }
end

local function serverWaitInfo(j)
  local f = redis.call('HMGET', sk(j), 'pool', 'lane', 'enq')
  local enq = tonumber(f[3])
  return { lane = f[2], position = redis.call('ZRANK', P .. 'sw:' .. f[1], j) + 1, limit = 0, running = 0,
    reason = 'server_busy', waitedMs = NOW - enq, enqueuedAtMs = enq }
end

local function pruneOutcomes(p, minute)
  for _, f in ipairs(redis.call('HKEYS', pk(p, 'o'))) do
    local mm = tonumber(string.match(f, '^(%d+):'))
    if not mm or mm < minute - 15 then redis.call('HDEL', pk(p, 'o'), f) end
  end
end
`

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
    return { granted = true, leaseId = held, overLimit = hget(lsk(held), 'over') == '1' }
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
    redis.call('HDEL', ek(J), 'passed')
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
  local tentative, blocked, reason = {}, {}, nil
  -- Every waiter ahead that could start takes a slot first; one blocked only
  -- by its provider's ceiling does not (it never holds back a waiter on
  -- another provider).
  for _, w in ipairs(redis.call('ZRANGEBYSCORE', wl, '-inf', '(' .. int(score))) do
    if reason then break end
    if not isReserved(w) then
      local f = redis.call('HMGET', ek(w), 'prov', 'passed')
      if opt(f[2]) ~= '1' then
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

/** REQ: { meta, pool } → { wait } */
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
return reply({ wait = out })
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

/** REQ: { on } */
const SET_ENFORCED = `${PRELUDE}
purge()
if REQ.on then redis.call('SET', P .. 'enforced', '1') else redis.call('SET', P .. 'enforced', '0') end
settle()
return reply({})
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

/** → LaneSnapshot minus `ungated` / `notLimited` (in-process counters, not the gate's). */
const SNAPSHOT = `${PRELUDE}
purge()
settle()
local function zero() return { running = 0, overLimit = 0, queued = 0 } end
local lines = redis.call('SMEMBERS', P .. 'lines')
table.sort(lines)
local groups, order = {}, {}
for _, line in ipairs(lines) do
  local f = redis.call('HMGET', lk(line, 'm'), 'user', 'payer', 'lane')
  local u, py, ln = opt(f[1]), opt(f[2]), opt(f[3])
  if u and py and ln then
    local key = py .. '|' .. u
    local g = groups[key]
    if not g then
      g = { userId = u, payer = py, lanes = { provider = zero(), llm = zero(), ['local'] = zero(), run = zero() }, oldestWaitMs = 0, sources = {} }
      groups[key] = g
      order[#order + 1] = key
    end
    local e = g.lanes[ln]
    for _, lid in ipairs(redis.call('ZRANGE', lk(line, 'run'), 0, -1)) do
      local lf = redis.call('HMGET', lsk(lid), 'over', 'src')
      e.running = e.running + 1
      if lf[1] == '1' then e.overLimit = e.overLimit + 1 end
      local src = opt(lf[2])
      if src then g.sources[src] = (g.sources[src] or 0) + 1 end
    end
    for _, j in ipairs(redis.call('ZRANGE', lk(line, 'wait'), 0, -1)) do
      local wf = redis.call('HMGET', ek(j), 'enq', 'src')
      e.queued = e.queued + 1
      local enq = opt(wf[1])
      if enq and NOW - tonumber(enq) > g.oldestWaitMs then g.oldestWaitMs = NOW - tonumber(enq) end
      local src = opt(wf[2])
      if src then g.sources[src] = (g.sources[src] or 0) + 1 end
    end
  end
end
local outLines = {}
for _, key in ipairs(order) do outLines[#outLines + 1] = groups[key] end
local minute = math.floor(NOW / 60000)
local provs = redis.call('SMEMBERS', P .. 'provs')
table.sort(provs)
local outProvs = {}
for _, p in ipairs(provs) do
  pruneOutcomes(p, minute)
  local byUser, running = {}, 0
  for _, lid in ipairs(redis.call('ZRANGE', pk(p, 'run'), 0, -1)) do
    running = running + 1
    local u = hget(lsk(lid), 'user')
    if u then byUser[u] = (byUser[u] or 0) + 1 end
  end
  local done, failed = 0, 0
  local o = redis.call('HGETALL', pk(p, 'o'))
  for i = 1, #o, 2 do
    local mm, what = string.match(o[i], '^(%d+):(.+)$')
    if tonumber(mm) >= minute - 14 then
      if what == 'completed' then done = done + tonumber(o[i + 1]) end
      if what == 'failed' then failed = failed + tonumber(o[i + 1]) end
    end
  end
  if running > 0 or done > 0 or failed > 0 then
    outProvs[#outProvs + 1] = { provider = p, running = running, byUser = byUser, completed15m = done, failed15m = failed }
  end
  if occ(p) == 0 and redis.call('HLEN', pk(p, 'wl')) == 0 and redis.call('HLEN', pk(p, 'o')) == 0 then
    redis.call('SREM', P .. 'provs', p)
  end
end
return reply({ lines = outLines, providers = outProvs, enforced = redis.call('GET', P .. 'enforced') == '1' })
`

/** The scripts, exported so the JS twin can recognise which one it was handed. */
export const LANE_GATE_SCRIPTS = {
  acquire: ACQUIRE,
  renew: RENEW,
  release: RELEASE,
  borrow: BORROW,
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
} as const

export type LaneGateScriptName = keyof typeof LANE_GATE_SCRIPTS
