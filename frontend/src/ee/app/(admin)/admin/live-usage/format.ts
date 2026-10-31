// Pure helpers of the Live usage page: labels, durations, the users' order,
// and which entries an admin may cancel.
import type { Bounds, Lane, LaneUserEntry, LiveLine, WaitReason } from "./types"

export const LANE_LABELS: Record<Lane, string> = { provider: "Provider", llm: "LLM", local: "Local", run: "Runs" }

/** Training is held at the provider for hours, so it never takes a lane: said so verbatim. */
export const TRAINING_NOT_LIMITED = "Not limited — runs for hours at the provider"

const NOT_LIMITED_LABELS: Record<string, string> = {
  training: TRAINING_NOT_LIMITED,
  copilot: "Not limited — Copilot turns",
}

export function notLimitedLabel(reason: string): string {
  return NOT_LIMITED_LABELS[reason] ?? `Not limited — ${reason}`
}

const REASON_LABELS: Record<WaitReason, string> = {
  user_lane: "their lane is full",
  provider_ceiling: "provider ceiling",
  server_busy: "server share",
}

export function reasonLabel(reason: WaitReason | null): string {
  return reason ? REASON_LABELS[reason] ?? reason : "waiting"
}

const SOURCE_LABELS: Record<string, string> = {
  mcp: "MCP",
  api: "API",
  web: "Editor",
  app: "App run",
  cli: "CLI",
  sdk: "SDK",
  extension: "Extension",
  internal: "Internal",
  webhook: "Webhook",
  schedule: "Schedule",
}

export function sourceLabel(source: string | null, detail?: string | null): string {
  if (!source) return "—"
  const base = SOURCE_LABELS[source] ?? source
  return detail ? `${base} · ${detail}` : base
}

/** "client-a 3, client-b 2", plus "others N" for MCP entries past the listed names; null with no name to list. */
export function mcpClientsText(total: number, clients: ReadonlyArray<{ name: string; count: number }>): string | null {
  if (clients.length === 0) return null
  const others = total - clients.reduce((n, c) => n + c.count, 0)
  return [...clients.map((c) => `${c.name} ${c.count}`), ...(others > 0 ? [`others ${others}`] : [])].join(", ")
}

/** "4m 12s", "1h 03m", "12s"; "—" for nothing. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms <= 0) return "—"
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, "0")}m`
}

export function formatClock(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString()
}

export function formatPercent(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return "—"
  return `${(rate * 100).toFixed(rate > 0 && rate < 0.1 ? 1 : 0)}%`
}

/** Whose line it is: the person's own, a workspace's, or the deployment's payer. */
export function payerLabel(payer: string): string {
  if (payer.startsWith("user:")) return "Personal"
  if (payer.startsWith("workspace:")) return "Workspace"
  return "Deployment"
}

/** A person's name or address; never their id. */
export function personLabel(p: { email: string | null; name?: string | null }): string {
  return p.name || p.email || "Unknown user"
}

export function tierLabel(tier: string | null): string {
  if (!tier) return "—"
  return tier.charAt(0).toUpperCase() + tier.slice(1)
}

const LANES: readonly Lane[] = ["provider", "llm", "local", "run"]
export const laneSum = (l: LiveLine, k: "running" | "queued" | "overLimit"): number =>
  LANES.reduce((n, lane) => n + l.lanes[lane][k], 0)

export interface UserGroup {
  userId: string
  email: string | null
  name: string | null
  lines: LiveLine[]
  queued: number
  overLimit: number
  running: number
}

/**
 * One group per user, holding their payer lines, most queued first; then the
 * most over their limit (what would have waited while limits are off), then
 * the most running. Lines keep the server's order within a user.
 */
export function groupByUser(lines: readonly LiveLine[]): UserGroup[] {
  const groups = new Map<string, UserGroup>()
  for (const line of lines) {
    const g = groups.get(line.userId) ?? { userId: line.userId, email: line.email, name: line.name, lines: [], queued: 0, overLimit: 0, running: 0 }
    g.lines.push(line)
    g.queued += laneSum(line, "queued")
    g.overLimit += laneSum(line, "overLimit")
    g.running += laneSum(line, "running")
    groups.set(line.userId, g)
  }
  return [...groups.values()].sort((a, b) => b.queued - a.queued || b.overLimit - a.overLimit || b.running - a.running
    || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Only a queued job entry can be cancelled here: its id is a job row's.
 * A call made inside a running job waits under `<jobId>:call:<uuid>`, which
 * has no row of its own, and a run waiting on the `run` lane is a workflow
 * run, not a job; the server refuses anything else it cannot cancel.
 */
export function isCancellable(entry: LaneUserEntry): boolean {
  return entry.state === "queued" && entry.lane !== "run" && UUID.test(entry.jobId)
}

/** Each lane's peak on its own (peaks of different lanes need not coincide, so they are never summed). */
export function lanePeaks(peaks: Record<Lane, number>): string {
  const parts = LANES.filter((l) => peaks[l] > 0).map((l) => `${LANE_LABELS[l]} ${peaks[l]}`)
  return parts.length > 0 ? parts.join(" · ") : "—"
}

/** A whole number typed into a field when it is inside the server's bounds; null when blank, not whole, or outside them. */
export function wholeIn(raw: string, bounds: Bounds): number | null {
  const text = raw.trim()
  if (text === "") return null
  const v = Number(text)
  return Number.isInteger(v) && v >= bounds.min && v <= bounds.max ? v : null
}

/** What a field outside its bounds says (the bounds are the server's, from GET /config). */
export function boundsMessage(label: string, bounds: Bounds, unit: "minutes" | null = null): string {
  return `${label}: a whole number${unit ? ` of ${unit}` : ""} from ${bounds.min} to ${bounds.max}.`
}
