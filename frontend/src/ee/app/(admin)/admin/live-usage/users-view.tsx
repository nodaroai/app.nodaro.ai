import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { LANE_LABELS, formatDuration, groupByUser, laneSum, mcpClientsText, payerLabel, personLabel, sourceLabel, tierLabel } from "./format"
import { LANES, type LiveLane, type LiveLine, type LiveReport } from "./types"

/** Up to this many slots are drawn one by one; a bigger lane is drawn to scale. */
const MAX_SEGMENTS = 16

/**
 * One lane: running within the limit (blue), running over it (rose, only while
 * limits are off), waiting (amber) and free slots (grey).
 */
export function SlotBar({ lane, name }: { lane: LiveLane; name: string }) {
  const { running, overLimit, queued, limit } = lane
  const within = running - overLimit
  const free = limit === null ? 0 : Math.max(0, limit - running)
  const parts = [
    { n: within, cls: "bg-blue-500" },
    { n: overLimit, cls: "bg-rose-500" },
    { n: queued, cls: "bg-amber-500" },
    { n: free, cls: "bg-muted-foreground/25" },
  ]
  const total = parts.reduce((s, p) => s + p.n, 0)
  const summary = `${name}: ${running} running${limit !== null ? ` of ${limit}` : ""}${overLimit > 0 ? `, ${overLimit} over limit (would wait)` : ""}${queued > 0 ? `, ${queued} waiting` : ""}`
  if (total === 0) return <span className="text-xs text-muted-foreground" title={summary}>0{limit !== null ? `/${limit}` : ""}</span>
  return (
    <div className="flex flex-col gap-0.5" title={summary}>
      {total <= MAX_SEGMENTS ? (
        <span className="inline-flex gap-0.5" aria-hidden>
          {parts.flatMap((p, i) => Array.from({ length: p.n }, (_, j) => <i key={`${i}-${j}`} className={cn("h-3 w-2 rounded-sm", p.cls)} />))}
        </span>
      ) : (
        <span className="flex h-3 w-32 overflow-hidden rounded-sm" aria-hidden>
          {parts.map((p, i) => p.n > 0 && <i key={i} className={cn("h-full", p.cls)} style={{ width: `${(p.n / total) * 100}%` }} />)}
        </span>
      )}
      <span className="text-xs tabular-nums">
        {running}{limit !== null ? `/${limit}` : ""}
        {overLimit > 0 && <span className="ms-1 font-medium text-rose-500">{overLimit} would wait</span>}
        {queued > 0 && <span className="ms-1 font-medium text-amber-500">+{queued} queued</span>}
      </span>
    </div>
  )
}

export function SlotLegend({ measureOnly }: { measureOnly: boolean }) {
  const item = (cls: string, label: string) => (
    <span className="inline-flex items-center gap-1"><i className={cn("inline-block h-3 w-2 rounded-sm", cls)} />{label}</span>
  )
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
      {item("bg-blue-500", "running")}
      {measureOnly && item("bg-rose-500", "over limit (would wait)")}
      {item("bg-amber-500", "queued")}
      {item("bg-muted-foreground/25", "free slot")}
    </div>
  )
}

function Sources({ sources, mcpClients }: { sources: Record<string, number>; mcpClients: LiveLine["mcpClients"] }) {
  const entries = Object.entries(sources).filter(([, n]) => n > 0).sort(([, a], [, b]) => b - a)
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([s, n]) => (
        <Badge key={s} variant="secondary" className="max-w-full whitespace-normal break-words text-[11px] font-normal">
          {sourceLabel(s)} · {(s === "mcp" ? mcpClientsText(n, mcpClients ?? []) : null) ?? n}
        </Badge>
      ))}
    </div>
  )
}

/** The line's plan; an override badge only on a person's own line (a deployment payer's override is that account's). */
function Plan({ line }: { line: LiveLine }) {
  const o = line.payer.startsWith("user:") ? line.override : null
  const overridden = o ? LANES.filter((l) => typeof o[l] === "number") : []
  return (
    <div className="flex flex-col gap-0.5">
      <span>{tierLabel(line.tier)}</span>
      {overridden.length > 0 && (
        <Badge variant="outline" className="w-fit text-[11px] font-normal" title="Per-user override">
          override {overridden.map((l) => `${LANE_LABELS[l]} ${o?.[l]}`).join(" · ")}
        </Badge>
      )}
    </div>
  )
}

/** One row per user with anything running or waiting, a sub-row per payer line; most waiting first. */
export function UsersView({ report, onOpenUser }: { report: LiveReport; onOpenUser: (userId: string) => void }) {
  const measureOnly = !report.enforced
  const groups = groupByUser(report.lines)
  if (groups.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">Nobody has anything running or waiting right now.</p>
  return (
    <div className="space-y-2">
      <SlotLegend measureOnly={measureOnly} />
      <div className="overflow-x-auto rounded-lg border">
        <table aria-label="Users" className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start font-medium">User</th>
              <th className="px-3 py-2 text-start font-medium">Line</th>
              <th className="px-3 py-2 text-start font-medium">Plan</th>
              {LANES.map((l) => <th key={l} className="px-3 py-2 text-start font-medium">{LANE_LABELS[l]}</th>)}
              {measureOnly && <th className="px-3 py-2 text-start font-medium">Would wait</th>}
              <th className="px-3 py-2 text-start font-medium">Oldest wait</th>
              <th className="px-3 py-2 text-start font-medium">From</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => g.lines.map((line, i) => (
              <tr key={`${g.userId}|${line.payer}`} className={cn("align-top", i === 0 && "border-t")}>
                {i === 0 && (
                  <td rowSpan={g.lines.length} className="px-3 py-2">
                    <button type="button" className="text-start font-medium hover:underline" onClick={() => onOpenUser(g.userId)} title={g.email ?? undefined}>
                      {personLabel(g)}
                    </button>
                  </td>
                )}
                <td className="px-3 py-2 text-xs">{payerLabel(line.payer)}</td>
                <td className="px-3 py-2 text-xs"><Plan line={line} /></td>
                {LANES.map((l) => <td key={l} className="px-3 py-2"><SlotBar lane={line.lanes[l]} name={LANE_LABELS[l]} /></td>)}
                {measureOnly && (
                  <td className={cn("px-3 py-2 tabular-nums", laneSum(line, "overLimit") > 0 && "font-semibold text-rose-500")}>
                    {laneSum(line, "overLimit")}
                  </td>
                )}
                <td className={cn("px-3 py-2 tabular-nums", line.oldestWaitMs > 0 && "font-semibold text-amber-500")}>{formatDuration(line.oldestWaitMs)}</td>
                <td className="px-3 py-2"><Sources sources={line.sources} mcpClients={line.mcpClients} /></td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
