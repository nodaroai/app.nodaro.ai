import { useCallback, useState } from "react"
import { Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { formatClock, formatDuration, personLabel } from "./format"
import { HistoryTab } from "./history-tab"
import { ProvidersView } from "./providers-view"
import { ServersStrip } from "./servers-strip"
import { SettingsTab } from "./settings-tab"
import type { LiveReport, LiveTab, LiveView } from "./types"
import { useLiveUsage } from "./use-live-usage"
import { UserDrawer } from "./user-drawer"
import { UsersView } from "./users-view"

export const VIEW_STORAGE_KEY = "nodaro-admin-live-usage-view"
const DEFAULT_VIEW: LiveView = "users"

/** The view this browser last chose, else Users. */
function readStoredView(): LiveView {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY)
    return stored === "users" || stored === "providers" ? stored : DEFAULT_VIEW
  } catch {
    return DEFAULT_VIEW
  }
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5 rounded-lg bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-colors",
            value === o.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const VIEWS = [{ value: "users", label: "Users" }, { value: "providers", label: "Providers" }] as const
const TABS = [{ value: "live", label: "Live" }, { value: "history", label: "Last 30 days" }, { value: "settings", label: "Settings" }] as const

/**
 * Limits are off: every job starts at once and nothing waits. A lease past its
 * limit is what WOULD have waited, so the page counts those instead.
 */
function MeasureOnlyBanner({ available }: { available: boolean }) {
  return (
    <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <p className="font-medium">Measure-only: limits are off in this environment.</p>
      <p className="text-muted-foreground">
        Every job starts at once and nothing waits. “Would wait” counts the jobs running past their user’s limit — the ones that would have waited with limits on.
        {!available && " Limits cannot be turned on in this release."}
      </p>
    </div>
  )
}

function Kpi({ value, label, warn }: { value: string | number; label: string; warn?: boolean }) {
  return (
    <div className="flex-1 rounded-lg border px-3 py-2">
      <div className={cn("text-xl font-semibold tabular-nums", warn && "text-amber-500")}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function Totals({ report }: { report: LiveReport }) {
  const t = report.totals
  return (
    <div className="flex flex-wrap gap-3">
      <Kpi value={t.activeUsers} label="active users" />
      <Kpi value={t.running} label="running" />
      <Kpi value={t.queued} label="queued" warn={t.queued > 0} />
      <Kpi value={formatDuration(t.longestWaitMs)} label="longest wait" warn={t.longestWaitMs > 0} />
      {!report.enforced && <Kpi value={t.overLimit} label="would wait" warn={t.overLimit > 0} />}
    </div>
  )
}

/**
 * Admin → Live usage: what this environment's concurrency lanes hold right
 * now, by user or by provider, the last 30 days of each, and the lanes'
 * settings with the switch. Settings reads the configuration only, so it
 * shows whether or not the live report answers.
 */
export default function AdminLiveUsagePage() {
  const [view, setViewRaw] = useState<LiveView>(() => readStoredView())
  const setView = useCallback((v: LiveView) => {
    setViewRaw(v)
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, v)
    } catch {
      // Private mode or blocked storage: the choice lasts the page's life.
    }
  }, [])
  const [tab, setTab] = useState<LiveTab>("live")
  const [openUser, setOpenUser] = useState<string | null>(null)
  const { data } = useLiveUsage()

  const labelOf = (userId: string): string | null => {
    const line = data?.lines.find((l) => l.userId === userId)
    return line ? personLabel(line) : null
  }

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Live usage</h1>
          <p className="text-sm text-muted-foreground">Who holds which concurrency lanes in this environment, refreshed every 3 seconds.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data && (
            <span className="text-xs text-muted-foreground">
              <Badge variant="outline" className="me-2 font-normal">{data.env}</Badge>
              as of {formatClock(data.checkedAt)}
            </span>
          )}
          {tab !== "settings" && <Segmented label="View" value={view} options={VIEWS} onChange={setView} />}
          <Segmented label="Tab" value={tab} options={TABS} onChange={setTab} />
        </div>
      </div>

      {tab === "settings" ? (
        <SettingsTab />
      ) : (
        <LiveTabs view={view} tab={tab} onOpenUser={setOpenUser} />
      )}

      <UserDrawer userId={openUser} label={openUser ? labelOf(openUser) : null} onClose={() => setOpenUser(null)} />
    </div>
  )
}

/** The Live and Last 30 days tabs: both read the live report for the banner and the totals. */
function LiveTabs({ view, tab, onOpenUser }: { view: LiveView; tab: Exclude<LiveTab, "settings">; onOpenUser: (userId: string) => void }) {
  const { data, error, isLoading } = useLiveUsage()
  return (
    <>
      {error && data && <p className="text-xs text-destructive">Refresh failed: {error.message}. Showing the last answer.</p>}

      {isLoading && !data ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">{error?.message ?? "Failed to load live usage."}</p>
      ) : (
        <>
          {!data.enforced && <MeasureOnlyBanner available={data.available} />}
          {data.undeclaredPluginTypes.length > 0 && (
            <p className="text-xs text-amber-600">
              Plugin job types with no declared lane ({data.undeclaredPluginTypes.length}): {data.undeclaredPluginTypes.join(", ")}
            </p>
          )}
          <Totals report={data} />
          {tab === "live" ? (
            <>
              {view === "users" ? <UsersView report={data} onOpenUser={onOpenUser} /> : <ProvidersView report={data} onOpenUser={onOpenUser} />}
              <ServersStrip servers={data.servers} complete={data.serversComplete} measureOnly={!data.enforced} />
            </>
          ) : (
            <HistoryTab view={view} onOpenUser={onOpenUser} />
          )}
        </>
      )}
    </>
  )
}
