// The queue's controls: status, search, platform, first-seen site, views,
// age, sort, and gallery or table. Every change is a new filters object
// (the page keeps them in its address).

import type { TrendCandidatePlatform, TrendRadarSummary } from "@nodaro/sdk/trend-radar"
import { LayoutGrid, Search, Table2, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { formatPlays, platformName } from "./format"
import { DEFAULT_FILTERS, MAX_AGE_OPTIONS, MIN_CREATORS_OPTIONS, MIN_PLAYS_OPTIONS, QUEUE_PLATFORMS, QUEUE_SORTS, QUEUE_SORT_LABELS, type QueueFilters, type QueueSort, type QueueStatus } from "./queue-view"
import { QUEUE_FILTERS } from "./use-trend-radar"

function Pill({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm min-h-8 whitespace-nowrap",
        pressed ? "bg-foreground text-background border-foreground" : "bg-card hover:bg-accent",
      )}
    >
      {children}
    </button>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <span className="whitespace-nowrap">{label}</span>
      {children}
    </label>
  )
}

interface ToolbarProps {
  filters: QueueFilters
  onChange: (next: QueueFilters) => void
  counts: TrendRadarSummary["counts"] | undefined
  platformCounts: Record<TrendCandidatePlatform, number>
  total: number
  sources: readonly string[]
  shown: number
}

export function QueueToolbar({ filters, onChange, counts, platformCounts, total, sources, shown }: ToolbarProps) {
  const set = <K extends keyof QueueFilters>(key: K, value: QueueFilters[K]) => onChange({ ...filters, [key]: value })
  const narrowed =
    filters.platform !== "all" || filters.source !== "all" || filters.minPlays > 0 || filters.minCreators > 0 || filters.maxAgeDays !== null || filters.q.trim() !== ""

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status">
          {QUEUE_FILTERS.map((f) => {
            const count = f.key === "candidate" ? counts?.candidates : f.key === "watching" ? counts?.watching : f.key === "slowing" ? counts?.slowing : undefined
            return (
              <Pill key={f.key} pressed={filters.status === f.key} onClick={() => set("status", f.key as QueueStatus)}>
                {f.label}
                {count !== undefined && <span className="tabular-nums opacity-70">· {count}</span>}
              </Pill>
            )
          })}
        </div>
        <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="View">
          {([["gallery", LayoutGrid, "Gallery"], ["table", Table2, "Table"]] as const).map(([view, Icon, label]) => (
            <button
              key={view}
              type="button"
              aria-pressed={filters.view === view}
              onClick={() => set("view", view)}
              className={cn("inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm", filters.view === view ? "bg-foreground text-background" : "hover:bg-accent")}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder="Search name or sound" aria-label="Search" className="h-8 w-[210px] ps-8" />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Platform">
          <Pill pressed={filters.platform === "all"} onClick={() => set("platform", "all")}>All platforms</Pill>
          {QUEUE_PLATFORMS.map((p) => (
            <Pill key={p} pressed={filters.platform === p} onClick={() => set("platform", p)}>
              {platformName(p)}
              <span className="tabular-nums opacity-70">· {platformCounts[p]}</span>
            </Pill>
          ))}
        </div>
        <Labeled label="People">
          <Select value={String(filters.minCreators)} onValueChange={(v) => set("minCreators", Number(v))}>
            <SelectTrigger className="h-8 w-[100px]" aria-label="People at least"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MIN_CREATORS_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>{n === 0 ? "Any" : `${n}+`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Labeled>
        <Labeled label="Views">
          <Select value={String(filters.minPlays)} onValueChange={(v) => set("minPlays", Number(v))}>
            <SelectTrigger className="h-8 w-[110px]" aria-label="Views at least"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MIN_PLAYS_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>{n === 0 ? "Any" : `${formatPlays(n)}+`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Labeled>
        <Labeled label="Age">
          <Select value={filters.maxAgeDays === null ? "any" : String(filters.maxAgeDays)} onValueChange={(v) => set("maxAgeDays", v === "any" ? null : Number(v))}>
            <SelectTrigger className="h-8 w-[130px]" aria-label="Trend age"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MAX_AGE_OPTIONS.map((d) => (
                <SelectItem key={String(d)} value={d === null ? "any" : String(d)}>{d === null ? "Any age" : `Last ${d} days`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Labeled>
        <Labeled label="Found on">
          <Select value={filters.source} onValueChange={(v) => set("source", v)}>
            <SelectTrigger className="h-8 w-[160px]" aria-label="Found on"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Every site</SelectItem>
              {sources.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Labeled>
        <Labeled label="Sort">
          <Select value={filters.sort} onValueChange={(v) => set("sort", v as QueueSort)}>
            <SelectTrigger className="h-8 w-[180px]" aria-label="Sort"><SelectValue /></SelectTrigger>
            <SelectContent>
              {QUEUE_SORTS.map((s) => (
                <SelectItem key={s} value={s}>{QUEUE_SORT_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Labeled>
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>Showing {shown} of {total}</span>
        {narrowed && (
          <button
            type="button"
            className="inline-flex items-center gap-1 hover:text-foreground"
            onClick={() => onChange({ ...DEFAULT_FILTERS, view: filters.view, status: filters.status, sort: filters.sort })}
          >
            <X className="h-3 w-3" aria-hidden="true" />
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}
