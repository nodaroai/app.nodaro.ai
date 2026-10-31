import type { LaneConfig, LanePreconditions, LaneUserReport, LiveLine, LiveReport, ProvidersHistory, StoredOverride, UsersHistory } from "../types"

export const AT = "2026-10-30T12:00:00.000Z"
export const DANA_ID = "00000000-0000-4000-8000-0000000000d1"
export const YOSSI_ID = "00000000-0000-4000-8000-0000000000d2"
export const MIA_ID = "00000000-0000-4000-8000-0000000000d3"
export const QUEUED_JOB = "11111111-1111-4111-8111-111111111111"
export const RUNNING_JOB = "22222222-2222-4222-8222-222222222222"
export const WAITING_RUN = "44444444-4444-4444-8444-444444444444"

export const STORED_OVERRIDE: StoredOverride = { available: true, override: { provider: 6 }, note: "studio account", updatedAt: "2026-10-29T10:00:00.000Z" }

const lane = (running: number, queued = 0, limit: number | null = 4, overLimit = 0) => ({ running, queued, limit, overLimit })

function line(over: Partial<LiveLine> & Pick<LiveLine, "userId">): LiveLine {
  return {
    email: null,
    name: null,
    payer: `user:${over.userId}`,
    tier: "basic",
    override: null,
    lanes: { provider: lane(0), llm: lane(0, 0, 8), local: lane(0, 0, 8), run: lane(0) },
    oldestWaitMs: 0,
    sources: {},
    mcpClients: [],
    ...over,
  }
}

/** Limits on: Yossi waits most, Dana second, Mia only runs. The server's order is deliberately not the queue order. */
export function enforcedReport(): LiveReport {
  return {
    checkedAt: AT,
    env: "production",
    enforced: true,
    available: true,
    totals: { activeUsers: 3, running: 13, queued: 55, overLimit: 0, longestWaitMs: 252_000 },
    lines: [
      line({ userId: MIA_ID, email: "mia@x.test", tier: "pro", lanes: { provider: lane(3, 0, 10), llm: lane(1, 0, 20), local: lane(0, 0, 20), run: lane(1, 0, 10) }, sources: { app: 4 } }),
      line({ userId: DANA_ID, email: "dana@x.test", name: "Dana Levi", lanes: { provider: lane(4, 9), llm: lane(1, 0, 8), local: lane(0, 0, 8), run: lane(0) }, oldestWaitMs: 252_000, sources: { mcp: 5 } }),
      line({ userId: YOSSI_ID, email: "yossi@x.test", tier: "free", lanes: { provider: lane(2, 46, 2), llm: lane(0, 0, 4), local: lane(1, 0, 4), run: lane(0, 0, 2) }, oldestWaitMs: 100_000, sources: { web: 3 } }),
      line({ userId: DANA_ID, email: "dana@x.test", name: "Dana Levi", payer: "workspace:ws000000-acme", tier: "business", lanes: { provider: lane(1, 0, 12), llm: lane(0, 0, 24), local: lane(0, 0, 24), run: lane(0, 0, 12) }, sources: { api: 1 } }),
    ],
    providers: [
      { provider: "kie", running: 9, ceiling: 100, topUsers: [{ userId: DANA_ID, email: "dana@x.test", running: 5 }, { userId: YOSSI_ID, email: "yossi@x.test", running: 2 }], completed15m: 47, failed15m: 3, failureRate15m: 0.06 },
      { provider: "elevenlabs", running: 0, ceiling: null, topUsers: [], completed15m: 0, failed15m: 0, failureRate15m: null },
    ],
    servers: {
      video: [{ processId: "video-1", at: Date.parse(AT), poolSize: 16, held: 9, userCap: 4, coordinators: 2, coordinatorCap: 6, overCapUsers: 1 }],
      render: [],
      orchestrator: [{ processId: "orch-1", at: Date.parse(AT), poolSize: 2, held: 1, userCap: 1, coordinators: 0, coordinatorCap: null, overCapUsers: 0 }],
      pipeline: [],
      director: [],
    },
    ungated: { "scene3d-render": 2 },
    notLimited: { training: 3, copilot: 1 },
    failOpen: {},
    counters: { processes: 2, oldestStartedAt: "2026-10-30T08:01:00.000Z", newestStartedAt: "2026-10-30T10:42:00.000Z" },
    serversComplete: true,
    undeclaredPluginTypes: [],
  }
}

/** Limits off (measure-only): nothing queues; over-limit leases are what would have waited. */
export function measureOnlyReport(): LiveReport {
  const r = enforcedReport()
  return {
    ...r,
    enforced: false,
    available: false,
    totals: { activeUsers: 2, running: 11, queued: 0, overLimit: 5, longestWaitMs: 0 },
    lines: [
      line({ userId: DANA_ID, email: "dana@x.test", name: "Dana Levi", lanes: { provider: lane(9, 0, 4, 5), llm: lane(0, 0, 8), local: lane(0, 0, 8), run: lane(0) }, sources: { mcp: 9 } }),
      line({ userId: MIA_ID, email: "mia@x.test", tier: "pro", lanes: { provider: lane(2, 0, 10), llm: lane(0, 0, 20), local: lane(0, 0, 20), run: lane(0, 0, 10) } }),
    ],
    serversComplete: false,
    undeclaredPluginTypes: ["mystery-job"],
  }
}

export function userReport(over: Partial<LaneUserReport> = {}): LaneUserReport {
  return {
    userId: DANA_ID,
    email: "dana@x.test",
    name: "Dana Levi",
    env: "production",
    linesAvailable: true,
    lines: [{
      payer: `user:${DANA_ID}`,
      tier: "basic",
      override: { provider: 6 },
      entries: [
        { jobId: RUNNING_JOB, payer: `user:${DANA_ID}`, lane: "provider", state: "running", provider: "kie", source: "mcp", sourceDetail: "client-a", jobType: "generate-image", model: "flux", overLimit: false, runningMs: 30_000, waitedMs: null, position: null, reason: null },
        { jobId: QUEUED_JOB, payer: `user:${DANA_ID}`, lane: "provider", state: "queued", provider: "kie", source: "mcp", sourceDetail: "client-a", jobType: "image-to-video", model: "kling", overLimit: false, runningMs: null, waitedMs: 252_000, position: 1, reason: "user_lane" },
        { jobId: WAITING_RUN, payer: `user:${DANA_ID}`, lane: "run", state: "queued", provider: null, source: "web", sourceDetail: null, jobType: "workflow", model: null, overLimit: false, runningMs: null, waitedMs: 9_000, position: 1, reason: "user_lane" },
        { jobId: `${RUNNING_JOB}:call:33333333-3333-4333-8333-333333333333`, payer: `user:${DANA_ID}`, lane: "llm", state: "queued", provider: "anthropic", source: "mcp", sourceDetail: null, jobType: "llm-chat", model: null, overLimit: false, runningMs: null, waitedMs: 4_000, position: 1, reason: "user_lane" },
      ],
    }],
    own: STORED_OVERRIDE,
    history: {
      days: 30,
      available: true,
      rows: [{
        day: "2026-10-29",
        payer: `user:${DANA_ID}`,
        peakRunning: { provider: 4, llm: 2, local: 0, run: 1 },
        peakQueued: { provider: 46, llm: 0, local: 0, run: 0 },
        peakOverLimit: { provider: 0, llm: 0, local: 0, run: 0 },
        longestWaitMs: 312_000,
        minutesAtLimit: 87,
        queueTimeouts: 2,
        liveWaitExpiries: 0,
        peakBySource: { mcp: 50 },
      }],
    },
    ...over,
  }
}

/** Every precondition met, as in a release that allows limits. */
export const MET_PRECONDITIONS: LanePreconditions = {
  available: true,
  columnsPresent: true,
  pluginTypesKnown: true,
  undeclaredPluginTypes: [],
  liveCeilingMeasured: true,
  measureDays: 9,
}

export function config(editable: boolean, over: Partial<LaneConfig> = {}): LaneConfig {
  return {
    plans: editable ? { basic: { provider: 4, llm: 8, local: 8, run: 4 }, free: { provider: 2, llm: 4, local: 4, run: 2 } } : {},
    envSizes: editable ? null : { provider: 12, llm: 24, local: 24, run: 12 },
    providerCeilings: { kie: 100 },
    settings: { queueTimeoutMinutes: 120, liveWaitMinutes: 10, liveWaitMaxMinutes: 60 },
    enforced: true,
    available: true,
    preconditions: MET_PRECONDITIONS,
    unmet: [],
    editable,
    env: "production",
    sharedAcrossEnvironments: true,
    bounds: {
      laneSize: { min: 1, max: 500 },
      providerCeiling: { min: 1, max: 100_000 },
      queueTimeoutMinutes: { min: 5, max: 1440 },
      liveWaitMinutes: { min: 1, max: 60 },
    },
    ...over,
  }
}

/** This release: limits cannot be turned on; the switch reads off and lists what it would need. */
export function lockedConfig(): LaneConfig {
  const preconditions: LanePreconditions = {
    available: false,
    columnsPresent: true,
    pluginTypesKnown: true,
    undeclaredPluginTypes: ["mystery-job", "other-job"],
    liveCeilingMeasured: false,
    measureDays: 3,
  }
  return config(true, { enforced: false, available: false, preconditions, unmet: ["available", "plugins", "liveCeiling", "measureDays"] })
}

/** A later release: limits can be turned on, but two items are unmet. */
export function unmetConfig(over: Partial<LanePreconditions> = {}): LaneConfig {
  const preconditions: LanePreconditions = { ...MET_PRECONDITIONS, undeclaredPluginTypes: ["mystery-job"], measureDays: 3, ...over }
  return config(true, { enforced: false, preconditions, unmet: ["plugins", "measureDays"] })
}

export function usersHistory(): UsersHistory {
  return {
    view: "users", available: true, env: "production", days: 30, from: "2026-10-01", truncated: false,
    sampled: [{ day: "2026-10-29", sampledMinutes: 1440, enforcedMinutes: 0 }],
    byDay: [{ day: "2026-10-29", lines: 1, minutesAtLimit: 87, queueTimeouts: 2, liveWaitExpiries: 0, peakOverLimit: 3 }],
    users: [{
      userId: DANA_ID, email: "dana@x.test", name: "Dana Levi", payer: `user:${DANA_ID}`, activeDays: 4,
      peakRunning: { provider: 4, llm: 2, local: 0, run: 1 }, peakQueued: { provider: 0, llm: 0, local: 0, run: 0 }, peakOverLimit: { provider: 3, llm: 0, local: 0, run: 0 },
      longestWaitMs: 0, minutesAtLimit: 87, queueTimeouts: 2, liveWaitExpiries: 0,
    }],
  }
}

export function providersHistory(): ProvidersHistory {
  return {
    view: "providers", available: true, env: "production", days: 30, from: "2026-10-01", truncated: true,
    sampled: [],
    rows: [
      { day: "2026-10-28", provider: "kie", peakRunning: 60, ceiling: 100, completed: 900, failed: 20, minutesAtCeiling: 0 },
      { day: "2026-10-29", provider: "kie", peakRunning: 71, ceiling: 100, completed: 1000, failed: 40, minutesAtCeiling: 5 },
    ],
  }
}

export const answer = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }))
