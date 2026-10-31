import { Loader2 } from "lucide-react"
import { formatDuration, formatPercent, lanePeaks, payerLabel, personLabel } from "./format"
import type { LiveView, ProvidersHistory, UserDay, UsersHistory } from "./types"
import { useLaneHistory } from "./use-live-usage"

const th = "px-3 py-2 text-start font-medium"
const td = "px-3 py-2 tabular-nums"

/** One user's days, newest first: each lane's peaks, waits and what timed out. */
export function UserHistoryTable({ rows }: { rows: UserDay[] }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">Nothing recorded in the last 30 days.</p>
  const days = [...rows].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.payer < b.payer ? -1 : 1))
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table aria-label="Last 30 days" className="w-full text-xs">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th className={th}>Day</th>
            <th className={th}>Line</th>
            <th className={th}>Peak running, per lane</th>
            <th className={th}>Peak queued, per lane</th>
            <th className={th}>Peak would wait, per lane</th>
            <th className={th}>Longest wait</th>
            <th className={th}>Minutes at limit</th>
            <th className={th}>Timed out</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={`${d.day}|${d.payer}`} className="border-t">
              <td className="px-3 py-2">{d.day}</td>
              <td className="px-3 py-2">{payerLabel(d.payer)}</td>
              <td className={td}>{lanePeaks(d.peakRunning)}</td>
              <td className={td}>{lanePeaks(d.peakQueued)}</td>
              <td className={td}>{lanePeaks(d.peakOverLimit)}</td>
              <td className={td}>{formatDuration(d.longestWaitMs)}</td>
              <td className={td}>{d.minutesAtLimit}</td>
              <td className={td}>{d.queueTimeouts + d.liveWaitExpiries}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UsersHistoryTable({ h, onOpenUser }: { h: UsersHistory; onOpenUser: (userId: string) => void }) {
  if (h.users.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">Nobody used a lane in this window.</p>
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table aria-label="Users, last 30 days" className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th className={th}>User</th>
            <th className={th}>Line</th>
            <th className={th}>Active days</th>
            <th className={th}>Peak running, per lane</th>
            <th className={th}>Peak queued, per lane</th>
            <th className={th}>Peak would wait, per lane</th>
            <th className={th}>Longest wait</th>
            <th className={th}>Minutes at limit</th>
            <th className={th}>Queue timeouts</th>
            <th className={th}>Live-wait expiries</th>
          </tr>
        </thead>
        <tbody>
          {h.users.map((u) => (
            <tr key={`${u.userId}|${u.payer}`} className="border-t">
              <td className="px-3 py-2">
                <button type="button" className="text-start font-medium hover:underline" onClick={() => onOpenUser(u.userId)} title={u.email ?? undefined}>
                  {personLabel(u)}
                </button>
              </td>
              <td className="px-3 py-2 text-xs">{payerLabel(u.payer)}</td>
              <td className={td}>{u.activeDays}</td>
              <td className={td}>{lanePeaks(u.peakRunning)}</td>
              <td className={td}>{lanePeaks(u.peakQueued)}</td>
              <td className={td}>{lanePeaks(u.peakOverLimit)}</td>
              <td className={td}>{formatDuration(u.longestWaitMs)}</td>
              <td className={td}>{u.minutesAtLimit}</td>
              <td className={td}>{u.queueTimeouts}</td>
              <td className={td}>{u.liveWaitExpiries}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface ProviderTotal { provider: string; peakRunning: number; ceiling: number | null; completed: number; failed: number; minutesAtCeiling: number; days: number }

/** Each provider over the window: its highest peak, the ceiling of its latest day, and its outcomes summed. */
function providerTotals(h: ProvidersHistory): ProviderTotal[] {
  const out = new Map<string, ProviderTotal & { lastDay: string }>()
  for (const r of h.rows) {
    const t = out.get(r.provider) ?? { provider: r.provider, peakRunning: 0, ceiling: null, completed: 0, failed: 0, minutesAtCeiling: 0, days: 0, lastDay: "" }
    t.peakRunning = Math.max(t.peakRunning, r.peakRunning)
    if (r.day >= t.lastDay) {
      t.ceiling = r.ceiling
      t.lastDay = r.day
    }
    t.completed += r.completed
    t.failed += r.failed
    t.minutesAtCeiling += r.minutesAtCeiling
    t.days += 1
    out.set(r.provider, t)
  }
  return [...out.values()].sort((a, b) => b.peakRunning - a.peakRunning || (a.provider < b.provider ? -1 : 1))
}

function ProvidersHistoryTable({ h }: { h: ProvidersHistory }) {
  const rows = providerTotals(h)
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">No provider was used in this window.</p>
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table aria-label="Providers, last 30 days" className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th className={th}>Provider</th>
            <th className={th}>Peak running</th>
            <th className={th}>Ceiling</th>
            <th className={th}>Completed</th>
            <th className={th}>Failed</th>
            <th className={th}>Failure rate</th>
            <th className={th}>Minutes at ceiling</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.provider} className="border-t">
              <td className="px-3 py-2 font-medium">{r.provider}</td>
              <td className={td}>{r.peakRunning}</td>
              <td className={td}>{r.ceiling ?? "—"}</td>
              <td className={td}>{r.completed}</td>
              <td className={td}>{r.failed}</td>
              <td className={td}>{formatPercent(r.completed + r.failed > 0 ? r.failed / (r.completed + r.failed) : null)}</td>
              <td className={td}>{r.minutesAtCeiling}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** "Last 30 days" of either view, from the daily rollup of this environment. */
export function HistoryTab({ view, onOpenUser }: { view: LiveView; onOpenUser: (userId: string) => void }) {
  const { data, isLoading, error } = useLaneHistory(view)
  if (isLoading && !data) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" /></div>
  if (!data) return <p className="text-sm text-destructive">{error?.message ?? "Failed to load the lane history."}</p>
  if (!data.available) return <p className="py-8 text-center text-sm text-muted-foreground">There is no lane history in this database yet.</p>
  const sampledDays = data.sampled.filter((d) => d.sampledMinutes > 0).length
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {data.env} · from {data.from} · {sampledDays} of {data.days} days sampled
        {data.truncated && " · Showing the newest rows only; the window holds more."}
      </p>
      {data.view === "users" ? <UsersHistoryTable h={data} onOpenUser={onOpenUser} /> : <ProvidersHistoryTable h={data} />}
    </div>
  )
}
