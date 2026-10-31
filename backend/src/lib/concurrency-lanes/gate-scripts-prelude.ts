// backend/src/lib/concurrency-lanes/gate-scripts-prelude.ts — the Lua every
// gate script starts with (gate-scripts.ts: "Every script is PRELUDE .. body"):
// the request and clock, the key helpers, and the shared steps (purge,
// settle, the pass-on, the provider and server-share checks). Its own module
// only so the read-only scripts (gate-scripts-read.ts) and the deciding ones
// share it without an import cycle; the key layout is documented in
// gate-scripts.ts.

export const PRELUDE = `
local P = ARGV[1]
local NOW = tonumber(ARGV[2])
local RES_TTL = tonumber(ARGV[3])
local WAITER_TTL = tonumber(ARGV[4])
local RELEASED_TTL = tonumber(ARGV[5])
local REQ = cjson.decode(ARGV[6])
local NULL = cjson.null
local FRONT = 1000000000000

local touchedLines, touchedProvs, wakes, occCache = {}, {}, {}, {}
-- The server pool each worker queue runs on (server-share.ts).
local POOL_OF = { ['video-generation'] = 'video', ['video-render'] = 'render', ['workflow-orchestration'] = 'orchestrator',
  ['pipeline-orchestration'] = 'pipeline', ['video-director'] = 'director' }

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

-- What the Live usage drill-down shows of an entry (userEntries): its job type, model and source detail.
local function describeEntry(k, m)
  if opt(m.jobType) then redis.call('HSET', k, 'type', m.jobType) end
  if opt(m.model) then redis.call('HSET', k, 'model', m.model) end
  if opt(m.sourceDetail) then redis.call('HSET', k, 'sdet', m.sourceDetail) end
end

local function createLease(lid, line, m, ttl, over)
  local exp = NOW + ttl
  local k = lsk(lid)
  redis.call('HSET', k, 'job', m.jobId, 'line', line, 'user', m.userId, 'payer', m.payer, 'lane', m.lane, 'over', over, 'queue', m.queue, 'at', NOW)
  if opt(m.source) then redis.call('HSET', k, 'src', m.source) end
  if opt(m.bullJobId) then redis.call('HSET', k, 'bull', m.bullJobId) end
  describeEntry(k, m)
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
-- ceiling: a later waiter on another provider may go past it. A waiter held
-- back by its server share is skipped, and so is every later waiter of its pool.
local function lineHead(line)
  if lineSize(line) - lineRunning(line) - lineReserved(line) <= 0 then return nil end
  local blocked, heldPools = {}, {}
  for _, j in ipairs(redis.call('ZRANGE', lk(line, 'wait'), 0, -1)) do
    if not isReserved(j) then
      local f = redis.call('HMGET', ek(j), 'prov', 'passed', 'enq', 'held', 'queue')
      local wpool = POOL_OF[opt(f[5]) or '']
      if not opt(f[3]) then
        redis.call('ZREM', lk(line, 'wait'), j) -- an entry with no hash is no waiter
      elseif opt(f[4]) then
        heldPools[f[4]] = true
      elseif opt(f[2]) ~= '1' and not (wpool and heldPools[wpool]) then
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
