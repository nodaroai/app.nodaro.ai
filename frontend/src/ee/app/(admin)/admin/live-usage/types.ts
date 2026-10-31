// The answers of the Live usage routes (GET /v1/admin/lanes/live, /users/:id,
// /history, /config), as the server sends them. Mirrored here by hand: the
// frontend never imports the backend.

export type Lane = "provider" | "llm" | "local" | "run"
export const LANES: readonly Lane[] = ["provider", "llm", "local", "run"]

export type ServerPool = "video" | "render" | "orchestrator" | "pipeline" | "director"
export const POOLS: readonly ServerPool[] = ["video", "render", "orchestrator", "pipeline", "director"]

export type LaneSizes = Record<Lane, number>

export interface LiveLane {
  running: number
  /** Running leases past the limit (a subset of `running`): what would have waited while limits are off. */
  overLimit: number
  queued: number
  /** null: the line has no stored size for this lane yet. */
  limit: number | null
}

export interface LiveLine {
  userId: string
  email: string | null
  name: string | null
  /** `user:<id>`, `workspace:<id>`, `deployment:<id>`, or `deployment` when the payer is hidden. */
  payer: string
  tier: string | null
  override: Partial<LaneSizes> | null
  lanes: Record<Lane, LiveLane>
  oldestWaitMs: number
  sources: Record<string, number>
  /** The line's MCP entries by client name (the caller's own text, cleaned), most first, at most five; the rest of `sources.mcp` are others. */
  mcpClients: Array<{ name: string; count: number }>
}

export interface LiveProvider {
  provider: string
  running: number
  ceiling: number | null
  topUsers: Array<{ userId: string; email: string | null; running: number }>
  completed15m: number
  failed15m: number
  failureRate15m: number | null
}

export interface LiveServer {
  processId: string
  at: number
  poolSize: number | null
  held: number
  userCap: number | null
  coordinators: number
  coordinatorCap: number | null
  overCapUsers: number
}

export interface LiveReport {
  checkedAt: string
  env: string
  enforced: boolean
  /** false: limits cannot be turned on in this release. */
  available: boolean
  totals: { activeUsers: number; running: number; queued: number; overLimit: number; longestWaitMs: number }
  lines: LiveLine[]
  providers: LiveProvider[]
  servers: Record<ServerPool, LiveServer[]>
  ungated: Record<string, number>
  notLimited: Record<string, number>
  failOpen: Record<string, number>
  counters: { processes: number; oldestStartedAt: string | null; newestStartedAt: string | null }
  serversComplete: boolean
  undeclaredPluginTypes: string[]
}

export type WaitReason = "user_lane" | "provider_ceiling" | "server_busy"

export interface LaneUserEntry {
  jobId: string
  payer: string
  lane: Lane
  state: "running" | "queued"
  provider: string | null
  source: string | null
  sourceDetail: string | null
  jobType: string | null
  model: string | null
  overLimit: boolean
  runningMs: number | null
  waitedMs: number | null
  position: number | null
  reason: WaitReason | null
}

export interface UserDay {
  day: string
  payer: string
  peakRunning: Record<Lane, number>
  peakQueued: Record<Lane, number>
  peakOverLimit: Record<Lane, number>
  longestWaitMs: number
  minutesAtLimit: number
  queueTimeouts: number
  liveWaitExpiries: number
  peakBySource: Record<string, number>
}

/** The user's own override row as stored (Cloud); `available: false` before its table is in this database. */
export interface StoredOverride {
  available: boolean
  override: Partial<LaneSizes> | null
  note: string | null
  updatedAt: string | null
}

export interface LaneUserReport {
  userId: string
  email: string | null
  name: string | null
  lines: Array<{ payer: string; tier: string | null; override: Partial<LaneSizes> | null; entries: LaneUserEntry[] }>
  env: string
  /** false: this environment's lanes could not be read; only the history is shown. */
  linesAvailable: boolean
  /** null off Cloud, or when it could not be read. */
  own: StoredOverride | null
  history: { days: number; available: boolean; rows: UserDay[] }
}

export interface SampledDay { day: string; sampledMinutes: number; enforcedMinutes: number }

export interface UsersHistory {
  view: "users"
  available: boolean
  env: string
  days: number
  from: string
  truncated: boolean
  sampled: SampledDay[]
  byDay: Array<{ day: string; lines: number; minutesAtLimit: number; queueTimeouts: number; liveWaitExpiries: number; peakOverLimit: number }>
  users: Array<{
    userId: string; email: string | null; name: string | null; payer: string; activeDays: number
    peakRunning: Record<Lane, number>; peakQueued: Record<Lane, number>; peakOverLimit: Record<Lane, number>
    longestWaitMs: number; minutesAtLimit: number; queueTimeouts: number; liveWaitExpiries: number
  }>
}

export interface ProvidersHistory {
  view: "providers"
  available: boolean
  env: string
  days: number
  from: string
  truncated: boolean
  sampled: SampledDay[]
  rows: Array<{ day: string; provider: string; peakRunning: number; ceiling: number | null; completed: number; failed: number; minutesAtCeiling: number }>
}

export type LaneHistory = UsersHistory | ProvidersHistory

/** An inclusive range a write accepts. */
export interface Bounds { min: number; max: number }

/** What the switch lists before limits are turned on (live values from this process and database). */
export interface LanePreconditions {
  /** false: limits cannot be turned on in this release, whatever else is met. */
  available: boolean
  columnsPresent: boolean
  /** Whether this process has recorded its plugin job types yet. */
  pluginTypesKnown: boolean
  undeclaredPluginTypes: string[]
  /** The plugins failed to load in this process, so its plugin job types were never checked. */
  pluginLoadFailed?: boolean
  liveCeilingMeasured: boolean
  measureDays: number
}

/** The preconditions not met, in the order the switch lists them ("available": not in this release). */
export type UnmetPrecondition = "available" | "columns" | "plugins" | "liveCeiling" | "measureDays"

export interface LaneSettings {
  queueTimeoutMinutes: number
  liveWaitMinutes: number
  liveWaitMaxMinutes: number
}

export interface LaneConfig {
  /** Sizes per plan tier (Cloud); empty elsewhere. */
  plans: Record<string, LaneSizes>
  envSizes: LaneSizes | null
  providerCeilings: Record<string, number>
  settings: LaneSettings
  /** This environment's switch. */
  enforced: boolean
  available: boolean
  preconditions: LanePreconditions
  unmet: UnmetPrecondition[]
  /** Whether per-plan sizes, overrides, ceilings and the waiting limits are edited here (Cloud only). */
  editable: boolean
  env: string
  /** Sizes, overrides, ceilings and the waiting limits are shared by every environment on this database; the switch is not. */
  sharedAcrossEnvironments: boolean
  /** What each write accepts. */
  bounds: { laneSize: Bounds; providerCeiling: Bounds; queueTimeoutMinutes: Bounds; liveWaitMinutes: Bounds }
}

/** PUT /v1/admin/lanes/enforced answered 409: limits not available yet, or preconditions unmet without a confirmation. */
export interface EnforcedRefusal {
  code: "not_available_yet" | "preconditions_unmet" | string
  preconditions?: LanePreconditions
  unmet?: UnmetPrecondition[]
}

/** POST /v1/admin/lanes/jobs/:jobId/cancel answered 200. */
export interface CancelAnswer { cancelled: boolean; inFlight: boolean; userId: string }

/** PUT /v1/admin/lanes/users/:id answered 200: the override as now stored (null: removed). */
export interface OverrideAnswer { userId: string; override: Partial<LaneSizes> | null; note: string | null }

/** The body of PUT /v1/admin/lanes/users/:id: a full replacement; a lane left null follows the plan. */
export type OverrideBody = Record<Lane, number | null> & { note: string | null }

export type LiveView = "users" | "providers"
export type LiveTab = "live" | "history" | "settings"
