import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import type { PluginStageKey, PluginStageLease, PluginStageClaim, PluginStageToolkit } from "./scene3d-contract.js"

const keySchema = z.object({
  jobId: z.uuid(), userId: z.uuid(), attemptIndex: z.number().int().min(0).max(100),
  stage: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  engineVersion: z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/),
}).strict()
const leaseSchema = z.object({
  token: z.uuid(), fence: z.number().int().positive(), expiresAt: z.number().finite(),
}).strict()
const LEASE_MIN_MS = 1_000
const LEASE_MAX_MS = 120_000
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_RECORD_BYTES = 64 * 1024

interface JournalRedis {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>
}

// All mutations use Redis server time and a single script. A stale owner may
// neither renew nor commit, even if no successor has claimed its expired lease.
const SCRIPT = `
local key = KEYS[1]
local op = ARGV[1]
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local status = redis.call('HGET', key, 'status')
local expires = tonumber(redis.call('HGET', key, 'expires') or '0')
local retention = tonumber(ARGV[6])
if op == 'claim' then
  if status == 'completed' then
    return cjson.encode({status='completed', output=cjson.decode(redis.call('HGET', key, 'output'))})
  end
  if expires > now then return cjson.encode({status='busy', expiresAt=expires}) end
  local fence = redis.call('HINCRBY', key, 'fence', 1)
  local expiry = now + tonumber(ARGV[4])
  redis.call('HSET', key, 'status', 'active', 'token', ARGV[2], 'expires', expiry)
  redis.call('PEXPIRE', key, retention)
  local checkpoint = redis.call('HGET', key, 'checkpoint')
  return cjson.encode({status='claimed', lease={token=ARGV[2], fence=fence, expiresAt=expiry}, checkpoint=checkpoint and cjson.decode(checkpoint) or cjson.null})
end
if status ~= 'active' or expires <= now or
   redis.call('HGET', key, 'token') ~= ARGV[2] or
   redis.call('HGET', key, 'fence') ~= ARGV[3] then return 'null' end
if op == 'renew' then
  local expiry = now + tonumber(ARGV[4])
  redis.call('HSET', key, 'expires', expiry)
  redis.call('PEXPIRE', key, retention)
  return cjson.encode({token=ARGV[2], fence=tonumber(ARGV[3]), expiresAt=expiry})
elseif op == 'checkpoint' then
  redis.call('HSET', key, 'checkpoint', ARGV[5])
elseif op == 'complete' then
  redis.call('HSET', key, 'status', 'completed', 'output', ARGV[5], 'expires', 0)
  redis.call('HDEL', key, 'token', 'checkpoint')
elseif op == 'release' then
  redis.call('HSET', key, 'expires', 0)
  redis.call('HDEL', key, 'token')
else return redis.error_reply('invalid stage operation') end
redis.call('PEXPIRE', key, retention)
return 'true'
`

function redisKey(input: PluginStageKey): string {
  const key = keySchema.parse(input)
  const digest = createHash("sha256").update(JSON.stringify([
    key.userId, key.jobId, key.attemptIndex, key.stage, key.inputHash, key.engineVersion,
  ])).digest("hex")
  return `job-stage:v1:${digest}`
}

function boundedLease(ms: number): number {
  if (!Number.isInteger(ms) || ms < LEASE_MIN_MS || ms > LEASE_MAX_MS) throw new Error("Invalid stage lease duration")
  return ms
}

function boundedRecord(record: Record<string, unknown>): string {
  // Stage records carry IDs/usage/metadata, never meshes or native project bytes.
  if (!record || Array.isArray(record) || typeof record !== "object") throw new Error("Invalid stage record")
  const encoded = JSON.stringify(record)
  if (Buffer.byteLength(encoded) > MAX_RECORD_BYTES) throw new Error("Stage record exceeds its size limit")
  return encoded
}

/** Authorization is mandatory even for completed-stage replay and cancellation. */
export function createStageJournal(
  redis: JournalRedis,
  authorize: (key: PluginStageKey) => Promise<void>,
): PluginStageToolkit {
  async function run(op: string, key: PluginStageKey, lease?: PluginStageLease, leaseMs = LEASE_MIN_MS, value = "{}") {
    const storageKey = redisKey(key)
    if (lease) leaseSchema.parse(lease)
    await authorize(key)
    const raw = await redis.eval(SCRIPT, 1, storageKey, op, lease?.token ?? randomUUID(),
      lease?.fence ?? 0, leaseMs, value, RETENTION_MS)
    if (typeof raw !== "string") throw new Error("Invalid stage journal response")
    return JSON.parse(raw) as unknown
  }
  return {
    claim: async (key, leaseMs) => await run("claim", key, undefined, boundedLease(leaseMs)) as PluginStageClaim,
    renew: async (key, lease, leaseMs) => await run("renew", key, lease, boundedLease(leaseMs)) as PluginStageLease | null,
    checkpoint: async (key, lease, checkpoint) => await run("checkpoint", key, lease, undefined, boundedRecord(checkpoint)) === true,
    complete: async (key, lease, output) => await run("complete", key, lease, undefined, boundedRecord(output)) === true,
    release: async (key, lease) => await run("release", key, lease) === true,
  }
}
