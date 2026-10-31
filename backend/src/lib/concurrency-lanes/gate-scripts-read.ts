// backend/src/lib/concurrency-lanes/gate-scripts-read.ts — the gate's
// read-only scripts, for Admin → Live usage: the snapshot of every line and
// provider, and one user's entries. They decide nothing: beyond the purge and
// settle every script runs first, the snapshot only drops a provider's expired
// outcome counts and a provider left with nothing. gate-scripts.ts lists them
// in LANE_GATE_SCRIPTS beside the deciding scripts; the JS twin mirrors them.
import { PRELUDE } from "./gate-scripts-prelude.js"

/**
 * → LaneSnapshot minus `ungated` / `notLimited` (in-process counters, not the gate's).
 * Each line's `sources` counts its entries by source; `mcpClients` counts its
 * MCP entries by client name (caller-chosen text: the live view caps and
 * cleans it, and the daily history never stores it).
 * Each line carries the size the gate last stored per lane (0 = no such line),
 * each provider its ceiling and its outcomes per minute of the 15-minute
 * window, oldest first (the daily history sums them).
 */
export const SNAPSHOT = `${PRELUDE}
purge()
settle()
local function zero() return { running = 0, overLimit = 0, queued = 0 } end
-- An MCP entry's client name (its source detail) is counted too, for the live
-- view only; every other source's detail is an id and is not read.
local function countSource(g, src, sdet)
  if not src then return end
  g.sources[src] = (g.sources[src] or 0) + 1
  if src == 'mcp' and sdet then g.mcpClients[sdet] = (g.mcpClients[sdet] or 0) + 1 end
end
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
      g = { userId = u, payer = py, lanes = { provider = zero(), llm = zero(), ['local'] = zero(), run = zero() },
        limits = { provider = 0, llm = 0, ['local'] = 0, run = 0 }, oldestWaitMs = 0, sources = {}, mcpClients = {} }
      groups[key] = g
      order[#order + 1] = key
    end
    local e = g.lanes[ln]
    g.limits[ln] = lineSize(line)
    for _, lid in ipairs(redis.call('ZRANGE', lk(line, 'run'), 0, -1)) do
      local lf = redis.call('HMGET', lsk(lid), 'over', 'src', 'sdet')
      e.running = e.running + 1
      if lf[1] == '1' then e.overLimit = e.overLimit + 1 end
      countSource(g, opt(lf[2]), opt(lf[3]))
    end
    for _, j in ipairs(redis.call('ZRANGE', lk(line, 'wait'), 0, -1)) do
      local wf = redis.call('HMGET', ek(j), 'enq', 'src', 'sdet')
      e.queued = e.queued + 1
      local enq = opt(wf[1])
      if enq and NOW - tonumber(enq) > g.oldestWaitMs then g.oldestWaitMs = NOW - tonumber(enq) end
      countSource(g, opt(wf[2]), opt(wf[3]))
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
  local perMinute, minutes = {}, {}
  local o = redis.call('HGETALL', pk(p, 'o'))
  for i = 1, #o, 2 do
    local mm, what = string.match(o[i], '^(%d+):(.+)$')
    mm = tonumber(mm)
    if mm >= minute - 14 and (what == 'completed' or what == 'failed') then
      local n = tonumber(o[i + 1])
      if what == 'completed' then done = done + n else failed = failed + n end
      local b = perMinute[mm]
      if not b then
        b = { minute = mm, completed = 0, failed = 0 }
        perMinute[mm] = b
        minutes[#minutes + 1] = mm
      end
      b[what] = b[what] + n
    end
  end
  if running > 0 or done > 0 or failed > 0 then
    table.sort(minutes)
    local byMinute = {}
    for _, mm in ipairs(minutes) do byMinute[#byMinute + 1] = perMinute[mm] end
    local c = ceilOf(p)
    outProvs[#outProvs + 1] = { provider = p, running = running, byUser = byUser, completed15m = done, failed15m = failed,
      ceiling = c or cjson.null, outcomesByMinute = byMinute }
  end
  if occ(p) == 0 and redis.call('HLEN', pk(p, 'wl')) == 0 and redis.call('HLEN', pk(p, 'o')) == 0 then
    redis.call('SREM', P .. 'provs', p)
  end
end
return reply({ lines = outLines, providers = outProvs, enforced = redis.call('GET', P .. 'enforced') == '1' })
`

/**
 * REQ: { userId } → { entries } — one user's leases and lane waiters on every
 * payer line, for the Live usage drill-down. A line is named
 * `<payer>:<userId>:<lane>`; one whose name holds `:<userId>:` is a candidate,
 * and its stored user decides (a workspace whose id is the user's id names it
 * too). A lease created before `at` was stored has no running time (null).
 * Server-share waiters that wait in no line are not listed. The caller orders
 * the entries.
 */
export const USER_ENTRIES = `${PRELUDE}
purge()
settle()
local U = REQ.userId
local needle = ':' .. U .. ':'
local out = {}
local function num(v) if v then return tonumber(v) end return nil end
local function entry(k, j, line, state)
  local f = redis.call('HMGET', k, 'payer', 'lane', 'prov', 'src', 'sdet', 'type', 'model')
  return { jobId = j, payer = f[1], lane = f[2], state = state, provider = opt(f[3]) or NULL, source = opt(f[4]) or NULL,
    sourceDetail = opt(f[5]) or NULL, jobType = opt(f[6]) or NULL, model = opt(f[7]) or NULL }
end
for _, line in ipairs(redis.call('SMEMBERS', P .. 'lines')) do
  if string.find(line, needle, 1, true) and hget(lk(line, 'm'), 'user') == U then
    for _, lid in ipairs(redis.call('ZRANGE', lk(line, 'run'), 0, -1)) do
      local k = lsk(lid)
      local job = hget(k, 'job')
      if job then
        local e = entry(k, job, line, 'running')
        local at = num(hget(k, 'at'))
        e.overLimit = hget(k, 'over') == '1'
        e.runningMs = at and (NOW - at) or NULL
        e.waitedMs = NULL
        e.position = NULL
        e.reason = NULL
        out[#out + 1] = e
      end
    end
    local rank = 0
    for _, j in ipairs(redis.call('ZRANGE', lk(line, 'wait'), 0, -1)) do
      rank = rank + 1
      local k = ek(j)
      local enq = num(hget(k, 'enq'))
      if enq then
        local e = entry(k, j, line, 'queued')
        e.overLimit = false
        e.runningMs = NULL
        e.waitedMs = NOW - enq
        e.position = rank
        if hget(k, 'held') then e.reason = 'server_busy' else e.reason = hget(k, 'why') or NULL end
        out[#out + 1] = e
      end
    end
  end
end
return reply({ entries = out })
`
