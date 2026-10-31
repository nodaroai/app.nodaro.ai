import { cn } from "@/lib/utils"
import { formatClock, formatPercent, notLimitedLabel, personLabel } from "./format"
import type { LiveProvider, LiveReport } from "./types"

/** In flight against the provider's platform ceiling, drawn to scale when there is one. */
function InFlight({ p }: { p: LiveProvider }) {
  const share = p.ceiling ? Math.min(1, p.running / p.ceiling) : null
  return (
    <div className="flex min-w-40 flex-col gap-1">
      {share !== null && (
        <span className="flex h-2.5 w-full overflow-hidden rounded bg-muted-foreground/20" aria-hidden>
          <i className={cn("h-full", share >= 1 ? "bg-rose-500" : "bg-blue-500")} style={{ width: `${share * 100}%` }} />
        </span>
      )}
      <span className="text-xs tabular-nums">{p.ceiling !== null ? `${p.running} / ${p.ceiling}` : `${p.running} · no ceiling`}</span>
    </div>
  )
}

function TopUsers({ p, onOpenUser }: { p: LiveProvider; onOpenUser: (userId: string) => void }) {
  if (p.topUsers.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
      {p.topUsers.map((u) => (
        <button key={u.userId} type="button" className="hover:underline" onClick={() => onOpenUser(u.userId)} title={u.email ?? undefined}>
          {personLabel(u)} {u.running}
        </button>
      ))}
    </div>
  )
}

/** Counts by key, largest first; nothing to show is said so. */
function Counts({ counts, label, empty }: { counts: Record<string, number>; label: (key: string) => string; empty: string }) {
  const rows = Object.entries(counts).filter(([, n]) => n > 0).sort(([, a], [, b]) => b - a)
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>
  return (
    <ul className="space-y-1 text-sm">
      {rows.map(([k, n]) => (
        <li key={k} className="flex justify-between gap-4"><span>{label(k)}</span><span className="tabular-nums">{n}</span></li>
      ))}
    </ul>
  )
}

/**
 * The counters are each process's own since it started, so all of them cover
 * the time since the newest process started; the oldest goes in the title.
 */
function CounterCoverage({ counters }: { counters: LiveReport["counters"] }) {
  if (counters.processes === 0 || !counters.newestStartedAt) return <p className="text-xs text-muted-foreground">No process has published its counters yet.</p>
  return (
    <p className="text-xs text-muted-foreground" title={`Each process counts from its own start; the earliest from ${formatClock(counters.oldestStartedAt)}.`}>
      Counted since {formatClock(counters.newestStartedAt)} by {counters.processes} {counters.processes === 1 ? "process" : "processes"}.
    </p>
  )
}

/** One row per provider: in flight vs its ceiling, who drives it, failures over the last 15 minutes. Unlimited and ungated work apart. */
export function ProvidersView({ report, onOpenUser }: { report: LiveReport; onOpenUser: (userId: string) => void }) {
  const providers = [...report.providers].sort((a, b) => b.running - a.running || (a.provider < b.provider ? -1 : 1))
  return (
    <div className="space-y-6">
      {providers.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No provider has anything in flight.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table aria-label="Providers" className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">Provider</th>
                <th className="px-3 py-2 text-start font-medium">In flight / ceiling</th>
                <th className="px-3 py-2 text-start font-medium">Top users</th>
                <th className="px-3 py-2 text-start font-medium">Failure rate, 15 min</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.provider} className="border-t align-top">
                  <td className="px-3 py-2 font-medium">{p.provider}</td>
                  <td className="px-3 py-2"><InFlight p={p} /></td>
                  <td className="px-3 py-2"><TopUsers p={p} onOpenUser={onOpenUser} /></td>
                  <td
                    className={cn("px-3 py-2 tabular-nums", (p.failureRate15m ?? 0) >= 0.05 && "font-semibold text-amber-500")}
                    title={`${p.failed15m} failed of ${p.completed15m + p.failed15m} finished`}
                  >
                    {formatPercent(p.failureRate15m)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-2 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">Not limited</h3>
          <p className="text-xs text-muted-foreground">Work that deliberately takes no lane slot, by kind.</p>
          <Counts counts={report.notLimited} label={notLimitedLabel} empty="None counted." />
        </section>
        <section className="space-y-2 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">Ungated</h3>
          <p className="text-xs text-muted-foreground">Calls that ran with no slot, by job type.</p>
          <Counts counts={report.ungated} label={(k) => k} empty="None counted." />
          {Object.keys(report.failOpen).length > 0 && (
            <>
              <p className="pt-2 text-xs text-muted-foreground">Ran without a slot because the lanes did not answer:</p>
              <Counts counts={report.failOpen} label={(k) => k} empty="None counted." />
            </>
          )}
        </section>
      </div>
      <CounterCoverage counters={report.counters} />
    </div>
  )
}
