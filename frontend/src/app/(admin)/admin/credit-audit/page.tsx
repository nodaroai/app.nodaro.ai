import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { getAuthHeaders } from "@/lib/api"
import { Loader2, AlertTriangle, CheckCircle, HelpCircle, TrendingDown, TrendingUp, Download, Trash2 } from "lucide-react"

// ---------- Theoretical mode types ----------
interface AuditModel {
  kieModel: string
  ourKey: string | null
  category: string
  tasks: number
  providerCredits: number
  providerMin: number
  providerMax: number
  ourCredits: number | null
  providerCostInCredits: number
  diff: number | null
  diffPercent: number | null
  status: "OK" | "UNDERPRICED" | "OVERPRICED" | "UNMAPPED"
  variable: boolean
}

// ---------- Actual mode types ----------
interface ActualAuditModel {
  kieModel: string
  ourKey: string | null
  category: string
  kieTasks: number
  ourJobs: number
  avgKieCredits: number
  providerCostInCredits: number
  expectedCredits: number
  actualAvgCredits: number | null
  actualMin: number | null
  actualMax: number | null
  diff: number | null
  diffPercent: number | null
  status: "OK" | "UNDERCHARGED" | "OVERCHARGED" | "UNMAPPED" | "UNMATCHED"
  variable: boolean
}

interface AuditResult {
  mode: "theoretical" | "actual"
  lookbackMinutes: number
  totalRecords: number
  successRecords: number
  uniqueModels: number
  mismatches: number
  models: (AuditModel | ActualAuditModel)[]
  totalUsageLogs?: number
  timestamp?: string
}

const STORAGE_KEY = "nodaro-credit-audit-result"

const TIME_RANGES = [
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "3 hours", minutes: 180 },
  { label: "6 hours", minutes: 360 },
  { label: "12 hours", minutes: 720 },
  { label: "1 day", minutes: 1440 },
  { label: "3 days", minutes: 4320 },
  { label: "7 days", minutes: 10080 },
  { label: "14 days", minutes: 20160 },
  { label: "30 days", minutes: 43200 },
]

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  UNDERPRICED: { label: "Underpriced", color: "bg-red-500/10 text-red-400 border-red-500/20", icon: TrendingDown },
  OVERPRICED: { label: "Overpriced", color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20", icon: TrendingUp },
  UNDERCHARGED: { label: "Undercharged", color: "bg-red-500/10 text-red-400 border-red-500/20", icon: TrendingDown },
  OVERCHARGED: { label: "Overcharged", color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20", icon: TrendingUp },
  UNMATCHED: { label: "Unmatched", color: "bg-orange-500/10 text-orange-400 border-orange-500/20", icon: AlertTriangle },
  OK: { label: "OK", color: "bg-green-500/10 text-green-400 border-green-500/20", icon: CheckCircle },
  UNMAPPED: { label: "Unmapped", color: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20", icon: HelpCircle },
}

function formatPeriod(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}

export default function AdminCreditAudit() {
  const [token, setToken] = useState("")
  const [lookbackMinutes, setLookbackMinutes] = useState(10080) // 7 days
  const [auditMode, setAuditMode] = useState<"theoretical" | "actual">("theoretical")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AuditResult | null>(null)
  const [filter, setFilter] = useState<"all" | "mismatches" | "variable">("all")

  // Load cached result from localStorage on mount (normalize legacy format)
  useEffect(() => {
    try {
      const cached = localStorage.getItem(STORAGE_KEY)
      if (cached) {
        const parsed = JSON.parse(cached)
        if (!parsed.mode) parsed.mode = "theoretical"
        if (!parsed.lookbackMinutes && parsed.days) parsed.lookbackMinutes = parsed.days * 1440
        else if (!parsed.lookbackMinutes) parsed.lookbackMinutes = 10080
        setResult(parsed)
      }
    } catch { /* ignore */ }
  }, [])

  async function runAudit() {
    if (!token.trim()) {
      setError("Paste the authorization header value from the provider logs Network tab")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/v1/admin/credit-audit/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...await getAuthHeaders(),
        },
        body: JSON.stringify({
          token: token.trim(),
          lookbackMinutes,
          mode: auditMode,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? `Failed: ${res.status}`)
        return
      }
      const resultWithTimestamp = { ...data, timestamp: new Date().toISOString() }
      setResult(resultWithTimestamp)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(resultWithTimestamp))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function clearResult() {
    setResult(null)
    localStorage.removeItem(STORAGE_KEY)
  }

  function downloadJson() {
    if (!result) return
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `credit-audit-${result.mode}-${result.timestamp?.slice(0, 10) ?? "export"}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filteredModels = result?.models.filter(m => {
    if (filter === "mismatches") return m.status !== "OK"
    if (filter === "variable") return m.variable
    return true
  }) ?? []

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold mb-1">Credit Audit</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Compare provider costs against what we charge users ([ratio wording removed])
      </p>

      {/* Config section */}
      <div className="rounded-lg border border-border bg-card p-4 mb-6">
        {/* Mode toggle */}
        <div className="flex gap-1 p-0.5 rounded-lg bg-muted/50 w-fit mb-4">
          {(["theoretical", "actual"] as const).map(m => (
            <button
              key={m}
              onClick={() => setAuditMode(m)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                auditMode === m
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "theoretical" ? "Pricing Table" : "Actual Charges"}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          {auditMode === "theoretical"
            ? "Compares KIE provider costs against our STATIC pricing table. Catches stale prices."
            : "Compares KIE provider costs against what we ACTUALLY charged users. Catches code bugs (wrong duration estimates, wrong credit identifiers)."}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1 min-w-0">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Provider Session Token
            </label>
            <Input
              type="password"
              placeholder="Paste authorization header from provider logs"
              value={token}
              onChange={e => setToken(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <div className="w-36">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Time Range
            </label>
            <select
              value={lookbackMinutes}
              onChange={e => setLookbackMinutes(Number(e.target.value))}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {TIME_RANGES.map(r => (
                <option key={r.minutes} value={r.minutes}>{r.label}</option>
              ))}
            </select>
          </div>
          <Button onClick={runAudit} disabled={loading} className="shrink-0">
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Run Audit
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Open provider dashboard logs → DevTools → Network → copy the <code className="text-[#ff0073]">authorization</code> header value from any request
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 mb-6 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {result && (
        <>
          {/* Summary stats + actions */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <p className="text-xs text-muted-foreground">
                Last run: {result.timestamp ? new Date(result.timestamp).toLocaleString() : "unknown"}
              </p>
              <Badge variant="outline" className="text-[10px]">
                {result.mode === "actual" ? "Actual Charges" : "Pricing Table"}
              </Badge>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={downloadJson}>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export JSON
              </Button>
              <Button variant="outline" size="sm" onClick={clearResult}>
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Clear
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard label="KIE Tasks" value={result.successRecords} sub={`of ${result.totalRecords} records`} />
            {result.mode === "actual"
              ? <StatCard label="Our Jobs" value={result.totalUsageLogs ?? 0} />
              : <StatCard label="Models" value={result.uniqueModels} />
            }
            <StatCard
              label="Mismatches"
              value={result.mismatches}
              highlight={result.mismatches > 0}
            />
            <StatCard label="Period" value={formatPeriod(result.lookbackMinutes)} />
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2 mb-4">
            {(["all", "mismatches", "variable"] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  filter === f
                    ? "bg-[#ff0073]/10 text-[#ff0073] border border-[#ff0073]/20"
                    : "text-muted-foreground hover:text-foreground border border-transparent"
                }`}
              >
                {f === "all" ? `All (${result.models.length})` :
                 f === "mismatches" ? `Mismatches (${result.mismatches})` :
                 `Variable (${result.models.filter(m => m.variable).length})`}
              </button>
            ))}
          </div>

          {/* Results table */}
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="overflow-x-auto">
              {result.mode === "actual" ? (
                <ActualTable models={filteredModels as ActualAuditModel[]} />
              ) : (
                <TheoreticalTable models={filteredModels as AuditModel[]} />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function TheoreticalTable({ models }: { models: AuditModel[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border bg-muted/30">
          <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
          <th className="text-left p-3 font-medium text-muted-foreground">Provider Model</th>
          <th className="text-left p-3 font-medium text-muted-foreground">Our Key</th>
          <th className="text-right p-3 font-medium text-muted-foreground">Tasks</th>
          <th className="text-right p-3 font-medium text-muted-foreground">Provider CR</th>
          <th className="text-right p-3 font-medium text-muted-foreground">÷4</th>
          <th className="text-right p-3 font-medium text-muted-foreground">We Charge</th>
          <th className="text-right p-3 font-medium text-muted-foreground">Diff</th>
          <th className="text-right p-3 font-medium text-muted-foreground">%</th>
        </tr>
      </thead>
      <tbody>
        {models.map(m => {
          const cfg = STATUS_CONFIG[m.status]
          const Icon = cfg.icon
          return (
            <tr key={m.kieModel} className="border-b border-border/50 hover:bg-muted/20">
              <td className="p-3">
                <Badge variant="outline" className={`${cfg.color} text-xs`}>
                  <Icon className="h-3 w-3 mr-1" />
                  {cfg.label}
                </Badge>
              </td>
              <td className="p-3 font-mono text-xs">{m.kieModel}</td>
              <td className="p-3">
                <span className="text-xs">{m.ourKey ?? <span className="text-muted-foreground">—</span>}</span>
                {m.variable && (
                  <Badge variant="outline" className="ml-1.5 text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/20">
                    variable
                  </Badge>
                )}
              </td>
              <td className="p-3 text-right tabular-nums">{m.tasks}</td>
              <td className="p-3 text-right tabular-nums text-muted-foreground">
                {m.providerMin === m.providerMax
                  ? m.providerCredits
                  : `${m.providerMin}–${m.providerMax}`
                }
              </td>
              <td className="p-3 text-right tabular-nums">
                {m.providerCostInCredits}
              </td>
              <td className="p-3 text-right tabular-nums font-medium">
                {m.ourCredits ?? "—"}
              </td>
              <td className={`p-3 text-right tabular-nums font-medium ${
                m.status === "UNDERPRICED" ? "text-red-400" :
                m.status === "OVERPRICED" ? "text-yellow-400" : ""
              }`}>
                {m.diff != null ? (m.diff > 0 ? `+${m.diff}` : m.diff) : "—"}
              </td>
              <td className={`p-3 text-right tabular-nums text-xs ${
                m.status === "UNDERPRICED" ? "text-red-400" :
                m.status === "OVERPRICED" ? "text-yellow-400" : "text-muted-foreground"
              }`}>
                {m.diffPercent != null ? `${m.diffPercent > 0 ? "+" : ""}${m.diffPercent}%` : "—"}
              </td>
            </tr>
          )
        })}
        {models.length === 0 && (
          <tr>
            <td colSpan={9} className="p-8 text-center text-muted-foreground">
              No models match the current filter
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

function ActualTable({ models }: { models: ActualAuditModel[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border bg-muted/30">
          <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
          <th className="text-left p-3 font-medium text-muted-foreground">Provider Model</th>
          <th className="text-left p-3 font-medium text-muted-foreground">Our Key</th>
          <th className="text-right p-3 font-medium text-muted-foreground">KIE Tasks</th>
          <th className="text-right p-3 font-medium text-muted-foreground">Our Jobs</th>
          <th className="text-right p-3 font-medium text-muted-foreground">KIE CR</th>
          <th className="text-right p-3 font-medium text-muted-foreground">Expected</th>
          <th className="text-right p-3 font-medium text-muted-foreground">Charged</th>
          <th className="text-right p-3 font-medium text-muted-foreground">Diff</th>
          <th className="text-right p-3 font-medium text-muted-foreground">%</th>
        </tr>
      </thead>
      <tbody>
        {models.map(m => {
          const cfg = STATUS_CONFIG[m.status]
          const Icon = cfg.icon
          return (
            <tr key={m.kieModel} className="border-b border-border/50 hover:bg-muted/20">
              <td className="p-3">
                <Badge variant="outline" className={`${cfg.color} text-xs`}>
                  <Icon className="h-3 w-3 mr-1" />
                  {cfg.label}
                </Badge>
              </td>
              <td className="p-3 font-mono text-xs">{m.kieModel}</td>
              <td className="p-3">
                <span className="text-xs">{m.ourKey ?? <span className="text-muted-foreground">—</span>}</span>
                {m.variable && (
                  <Badge variant="outline" className="ml-1.5 text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/20">
                    variable
                  </Badge>
                )}
              </td>
              <td className="p-3 text-right tabular-nums">{m.kieTasks}</td>
              <td className="p-3 text-right tabular-nums">
                {m.ourJobs > 0 ? m.ourJobs : <span className="text-muted-foreground">—</span>}
              </td>
              <td className="p-3 text-right tabular-nums text-muted-foreground">
                {m.avgKieCredits}
              </td>
              <td className="p-3 text-right tabular-nums">
                {m.expectedCredits}
              </td>
              <td className="p-3 text-right tabular-nums font-medium">
                {m.actualAvgCredits != null ? (
                  <>
                    {m.actualAvgCredits}
                    {m.actualMin != null && m.actualMax != null && m.actualMin !== m.actualMax && (
                      <span className="text-muted-foreground text-[10px] ml-1">
                        ({m.actualMin}–{m.actualMax})
                      </span>
                    )}
                  </>
                ) : "—"}
              </td>
              <td className={`p-3 text-right tabular-nums font-medium ${
                m.status === "UNDERCHARGED" ? "text-red-400" :
                m.status === "OVERCHARGED" ? "text-yellow-400" : ""
              }`}>
                {m.diff != null ? (m.diff > 0 ? `+${m.diff}` : m.diff) : "—"}
              </td>
              <td className={`p-3 text-right tabular-nums text-xs ${
                m.status === "UNDERCHARGED" ? "text-red-400" :
                m.status === "OVERCHARGED" ? "text-yellow-400" : "text-muted-foreground"
              }`}>
                {m.diffPercent != null ? `${m.diffPercent > 0 ? "+" : ""}${m.diffPercent}%` : "—"}
              </td>
            </tr>
          )
        })}
        {models.length === 0 && (
          <tr>
            <td colSpan={10} className="p-8 text-center text-muted-foreground">
              No models match the current filter
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

function StatCard({ label, value, sub, highlight }: {
  label: string
  value: string | number
  sub?: string
  highlight?: boolean
}) {
  return (
    <div className={`rounded-lg border p-3 ${
      highlight ? "border-red-500/30 bg-red-500/5" : "border-border bg-card"
    }`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold ${highlight ? "text-red-400" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}
