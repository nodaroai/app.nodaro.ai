import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { getAuthHeaders } from "@/lib/api"
import { Loader2, AlertTriangle, CheckCircle, HelpCircle, TrendingDown, TrendingUp, Download, Trash2 } from "lucide-react"

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

interface AuditResult {
  days: number
  totalRecords: number
  successRecords: number
  uniqueModels: number
  mismatches: number
  models: AuditModel[]
  timestamp?: string
}

const STORAGE_KEY = "nodaro-credit-audit-result"

const STATUS_CONFIG = {
  UNDERPRICED: { label: "Underpriced", color: "bg-red-500/10 text-red-400 border-red-500/20", icon: TrendingDown },
  OVERPRICED: { label: "Overpriced", color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20", icon: TrendingUp },
  OK: { label: "OK", color: "bg-green-500/10 text-green-400 border-green-500/20", icon: CheckCircle },
  UNMAPPED: { label: "Unmapped", color: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20", icon: HelpCircle },
}

export default function AdminCreditAudit() {
  const [token, setToken] = useState("")
  const [days, setDays] = useState(7)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AuditResult | null>(null)
  const [filter, setFilter] = useState<"all" | "mismatches" | "variable">("all")

  // Load cached result from localStorage on mount
  useEffect(() => {
    try {
      const cached = localStorage.getItem(STORAGE_KEY)
      if (cached) setResult(JSON.parse(cached))
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
        body: JSON.stringify({ token: token.trim(), days }),
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
    a.download = `credit-audit-${result.timestamp?.slice(0, 10) ?? "export"}.json`
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
        Compare actual provider cost against what we charge users ([ratio wording removed])
      </p>

      {/* Config section */}
      <div className="rounded-lg border border-border bg-card p-4 mb-6">
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
          <div className="w-24">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Days
            </label>
            <Input
              type="number"
              min={1}
              max={30}
              value={days}
              onChange={e => setDays(Number(e.target.value) || 7)}
            />
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
            <p className="text-xs text-muted-foreground">
              Last run: {result.timestamp ? new Date(result.timestamp).toLocaleString() : "unknown"}
            </p>
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
            <StatCard label="Total Tasks" value={result.successRecords} sub={`of ${result.totalRecords} records`} />
            <StatCard label="Models" value={result.uniqueModels} />
            <StatCard
              label="Mismatches"
              value={result.mismatches}
              highlight={result.mismatches > 0}
            />
            <StatCard label="Period" value={`${result.days}d`} />
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
                  {filteredModels.map(m => {
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
                  {filteredModels.length === 0 && (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-muted-foreground">
                        No models match the current filter
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
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
