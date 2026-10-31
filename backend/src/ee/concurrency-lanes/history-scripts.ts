// backend/src/ee/concurrency-lanes/history-scripts.ts — the Lua of the daily
// lane history's Redis aggregates (history.ts). Each script is atomic and
// O(touched keys): a sample merges one snapshot, a count one event, a take
// renames two sets. Reading the aggregates back is done OUTSIDE Lua, in
// batches (history.ts), so a large day never blocks the shared Redis.
//
// Every script is PRELUDE .. body. ARGV: the environment's history prefix
// (`cl:v1:hist:<env>:`), the key TTL in ms, the request JSON. Keys, under H:
//   claim:<name>           STRING  a minute / flush / prune claim (NX, own TTL)
//   d:<day>:l:<line>       HASH    r:<lane> q:<lane> o:<lane> (peak running /
//                                  queued / over-limit), lw (longest wait),
//                                  s:<source> (peak jobs of that source at
//                                  once), mal (minutes at limit), qt (queue
//                                  timeouts), lwe (live-wait expiries)
//   d:<day>:p:<provider>   HASH    pk (peak running), ceil (last ceiling seen;
//                                  absent = none), mac (minutes at ceiling),
//                                  o:<minute>:c / o:<minute>:f (completed /
//                                  failed in that minute, overwritten)
//   d:<day>:m              HASH    sampled, enforced (minutes)
//   d:<day>:dl, d:<day>:dp SET     lines / providers changed since the last
//                                  flush (dirty); the flush takes them as
//   d:<day>:dl:w, …:dp:w   SET     its work sets and deletes them once written
//   d:<day>:dm             STRING  the day's minutes changed since the flush
// Every key written gets the TTL (days, so yesterday is still there for the
// flushes after midnight). A line is identified as `<payer>|<user>`.

const PRELUDE = `
local H = ARGV[1]
local TTL = tonumber(ARGV[2])
local REQ = cjson.decode(ARGV[3])
local function dk(day, part) return H .. 'd:' .. day .. ':' .. part end
local function touch(k) redis.call('PEXPIRE', k, TTL) end
local function int(v) return string.format('%.0f', v) end
-- Raise field f of k to v; true when it rose.
local function hmax(k, f, v)
  v = tonumber(v)
  if not v then return false end
  local c = redis.call('HGET', k, f)
  if c and tonumber(c) >= v then return false end
  redis.call('HSET', k, f, int(v))
  return true
end
-- Set field f of k to v; true when it changed.
local function hput(k, f, v)
  v = int(v)
  if redis.call('HGET', k, f) == v then return false end
  redis.call('HSET', k, f, v)
  return true
end
local function dirty(day, kind, m) local s = dk(day, kind) redis.call('SADD', s, m) touch(s) end
local function flat(t)
  local out = {}
  for i = 1, #t, 2 do out[t[i]] = t[i + 1] end
  return out
end
`

/**
 * REQ: { day, enforced, lines: [{ line, max: {field: n}, atLimit }],
 * providers: [{ p, running, ceiling|null, atCeiling }], outcomes: [{ p, day,
 * minute, completed, failed }] } → {}. One call per sampled minute (the caller
 * claims the minute first): peaks merge by max, the minute counters move, and
 * every line or provider whose numbers changed is marked dirty.
 */
const SAMPLE = `${PRELUDE}
local day = REQ.day
local m = dk(day, 'm')
redis.call('HINCRBY', m, 'sampled', 1)
if REQ.enforced then redis.call('HINCRBY', m, 'enforced', 1) end
touch(m)
redis.call('SET', dk(day, 'dm'), '1', 'PX', TTL)
for _, l in ipairs(REQ.lines) do
  local k = dk(day, 'l:' .. l.line)
  local changed = false
  for f, v in pairs(l.max) do if hmax(k, f, v) then changed = true end end
  if l.atLimit then redis.call('HINCRBY', k, 'mal', 1) changed = true end
  if changed then touch(k) dirty(day, 'dl', l.line) end
end
for _, p in ipairs(REQ.providers) do
  local k = dk(day, 'p:' .. p.p)
  local changed = hmax(k, 'pk', p.running)
  if type(p.ceiling) == 'number' then
    if hput(k, 'ceil', p.ceiling) then changed = true end
  elseif redis.call('HDEL', k, 'ceil') == 1 then
    changed = true
  end
  if p.atCeiling then redis.call('HINCRBY', k, 'mac', 1) changed = true end
  if changed then touch(k) dirty(day, 'dp', p.p) end
end
for _, o in ipairs(REQ.outcomes) do
  local k = dk(o.day, 'p:' .. o.p)
  local mm = int(o.minute)
  local a = hput(k, 'o:' .. mm .. ':c', o.completed)
  local b = hput(k, 'o:' .. mm .. ':f', o.failed)
  if a or b then touch(k) dirty(o.day, 'dp', o.p) end
end
return cjson.encode({})
`

/** REQ: { day, line, field: 'qt' | 'lwe', waitedMs } → {}: one more of `field`, the wait into the longest; the line is dirty. */
const COUNT = `${PRELUDE}
local k = dk(REQ.day, 'l:' .. REQ.line)
redis.call('HINCRBY', k, REQ.field, 1)
hmax(k, 'lw', REQ.waitedMs)
touch(k)
dirty(REQ.day, 'dl', REQ.line)
return cjson.encode({})
`

/**
 * REQ: { day } → { lines, providers, minutes|null }: the day's dirty sets become
 * its work sets (`…:w`, a rename; merged into a work set a failed flush left),
 * and the day's minutes when they changed. `lines` / `providers` say whether
 * a work set exists. The caller reads the work sets in batches, writes them,
 * then deletes them.
 */
const TAKE = `${PRELUDE}
local out = { lines = false, providers = false, minutes = cjson.null }
for kind, name in pairs({ dl = 'lines', dp = 'providers' }) do
  local k, w = dk(REQ.day, kind), dk(REQ.day, kind .. ':w')
  if redis.call('EXISTS', k) == 1 then
    if redis.call('EXISTS', w) == 1 then
      redis.call('SUNIONSTORE', w, w, k)
      redis.call('DEL', k)
    else
      redis.call('RENAME', k, w)
    end
  end
  if redis.call('EXISTS', w) == 1 then
    touch(w)
    out[name] = true
  end
end
if redis.call('GET', dk(REQ.day, 'dm')) then
  redis.call('DEL', dk(REQ.day, 'dm'))
  out.minutes = flat(redis.call('HGETALL', dk(REQ.day, 'm')))
end
return cjson.encode(out)
`

/** REQ: { name, ttlMs } → { claimed }: the first caller of `name` within its TTL. */
const CLAIM = `${PRELUDE}
local claimed = redis.call('SET', H .. 'claim:' .. REQ.name, '1', 'NX', 'PX', tonumber(REQ.ttlMs)) ~= false
return cjson.encode({ claimed = claimed })
`

/** The scripts, exported so the JS twin can recognise which one it was handed. */
export const LANE_HISTORY_SCRIPTS = { sample: SAMPLE, count: COUNT, take: TAKE, claim: CLAIM } as const

export type LaneHistoryScriptName = keyof typeof LANE_HISTORY_SCRIPTS

/** The keys of a day under a history prefix, for the batch reads outside Lua. */
export const historyKeys = {
  line: (h: string, day: string, line: string) => `${h}d:${day}:l:${line}`,
  provider: (h: string, day: string, p: string) => `${h}d:${day}:p:${p}`,
  linesWork: (h: string, day: string) => `${h}d:${day}:dl:w`,
  providersWork: (h: string, day: string) => `${h}d:${day}:dp:w`,
  minutesDirty: (h: string, day: string) => `${h}d:${day}:dm`,
}
