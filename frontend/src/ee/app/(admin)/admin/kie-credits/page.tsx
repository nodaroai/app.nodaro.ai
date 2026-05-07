import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Loader2, RefreshCw, Wallet, TrendingDown, ArrowUp, ArrowDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { hasAdmin } from "@/lib/edition"
import { getAuthHeaders } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"

interface CreditSnapshot {
  credits: number
  recorded_at: string
}

interface KieCreditsResponse {
  currentCredits: number | null
  configured: boolean
  days: number
  history: CreditSnapshot[]
  stats: {
    totalConsumed: number
    peakCredits: number
    minCredits: number
    snapshotCount: number
  }
}

function useKieCredits(days: number) {
  return useQuery({
    queryKey: queryKeys.admin.kieCredits(days),
    queryFn: async (): Promise<KieCreditsResponse> => {
      const res = await fetch(`/v1/admin/kie-credits?days=${days}`, {
        headers: await getAuthHeaders(),
      })
      if (!res.ok) throw new Error("Failed to fetch KIE credits")
      return res.json()
    },
    enabled: hasAdmin(),
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

/** Simple SVG area chart */
function CreditChart({ history }: { history: CreditSnapshot[] }) {
  if (history.length < 2) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        Not enough data points yet. Snapshots are recorded hourly.
      </div>
    )
  }

  const values = history.map((s) => s.credits)
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1

  const W = 800
  const H = 200
  const PAD = 30

  const points = values.map((v, i) => {
    const x = PAD + (i / (values.length - 1)) * (W - PAD * 2)
    const y = PAD + (1 - (v - min) / range) * (H - PAD * 2)
    return { x, y }
  })

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")
  const areaPath = linePath +
    ` L ${points[points.length - 1].x} ${H - PAD} L ${points[0].x} ${H - PAD} Z`

  // Y-axis labels
  const yLabels = [max, Math.round((max + min) / 2), min]

  // X-axis labels (show ~5 evenly spaced)
  const xLabelCount = Math.min(5, history.length)
  const xLabels: { label: string; x: number }[] = []
  for (let i = 0; i < xLabelCount; i++) {
    const idx = Math.round((i / (xLabelCount - 1)) * (history.length - 1))
    const d = new Date(history[idx].recorded_at)
    xLabels.push({
      label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      x: points[idx].x,
    })
  }

  return (
    <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
      {/* Area fill */}
      <path d={areaPath} fill="url(#creditGradient)" opacity="0.3" />
      {/* Line */}
      <path d={linePath} fill="none" stroke="#ff0073" strokeWidth="2" />

      {/* Gradient def */}
      <defs>
        <linearGradient id="creditGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff0073" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#ff0073" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Y-axis labels */}
      {yLabels.map((v, i) => {
        const y = PAD + (1 - (v - min) / range) * (H - PAD * 2)
        return (
          <text key={i} x={PAD - 4} y={y + 4} textAnchor="end" fontSize="10" fill="currentColor" className="text-muted-foreground">
            {formatNumber(v)}
          </text>
        )
      })}

      {/* X-axis labels */}
      {xLabels.map((l, i) => (
        <text key={i} x={l.x} y={H + 12} textAnchor="middle" fontSize="10" fill="currentColor" className="text-muted-foreground">
          {l.label}
        </text>
      ))}

      {/* Data point dots */}
      {points.length <= 72 && points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#ff0073" />
      ))}
    </svg>
  )
}

export default function AdminKieCreditsPage() {
  const [days, setDays] = useState(7)
  const { data, isLoading, refetch, isRefetching } = useKieCredits(days)

  if (isLoading && !data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data) {
    return <div className="p-6 text-muted-foreground">Failed to load KIE credit data.</div>
  }

  if (!data.configured) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold mb-4">KIE.ai Provider Credits</h1>
        <div className="border rounded-lg p-6 bg-card text-muted-foreground">
          KIE_API_KEY is not configured. Set it in your environment to enable credit tracking.
        </div>
      </div>
    )
  }

  const consumption24h = (() => {
    const now = Date.now()
    const h24 = data.history.filter((s) => now - new Date(s.recorded_at).getTime() < 86400_000)
    if (h24.length < 2) return null
    const diff = h24[0].credits - h24[h24.length - 1].credits
    return diff > 0 ? diff : 0
  })()

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">KIE.ai Provider Credits</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isRefetching}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="border rounded-lg p-4 bg-card flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
            <Wallet className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Current Balance</p>
            <p className="text-2xl font-bold">
              {data.currentCredits !== null ? formatNumber(data.currentCredits) : "N/A"}
            </p>
          </div>
        </div>

        <div className="border rounded-lg p-4 bg-card flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-destructive/10 flex items-center justify-center">
            <TrendingDown className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Consumed ({days}d)</p>
            <p className="text-2xl font-bold">{formatNumber(data.stats.totalConsumed)}</p>
          </div>
        </div>

        <div className="border rounded-lg p-4 bg-card flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-green-500/10 flex items-center justify-center">
            <ArrowUp className="h-5 w-5 text-green-500" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Peak ({days}d)</p>
            <p className="text-2xl font-bold">{formatNumber(data.stats.peakCredits)}</p>
          </div>
        </div>

        <div className="border rounded-lg p-4 bg-card flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-orange-500/10 flex items-center justify-center">
            <ArrowDown className="h-5 w-5 text-orange-500" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">24h Consumption</p>
            <p className="text-2xl font-bold">{consumption24h !== null ? formatNumber(consumption24h) : "N/A"}</p>
          </div>
        </div>
      </div>

      {/* Time range selector */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm text-muted-foreground">Period:</span>
        {[1, 7, 14, 30, 90].map((d) => (
          <Button
            key={d}
            variant={days === d ? "default" : "outline"}
            size="sm"
            onClick={() => setDays(d)}
          >
            {d}d
          </Button>
        ))}
      </div>

      {/* Credit history chart */}
      <div className="border rounded-lg p-4 bg-card mb-6">
        <h2 className="text-sm font-medium mb-3">Credit Balance Over Time</h2>
        <CreditChart history={data.history} />
        <p className="text-xs text-muted-foreground mt-2">
          {data.stats.snapshotCount} snapshot{data.stats.snapshotCount !== 1 ? "s" : ""} in selected period
        </p>
      </div>

      {/* Recent snapshots table */}
      {data.history.length > 0 && (
        <div className="border rounded-lg p-4 bg-card">
          <h2 className="text-sm font-medium mb-3">Recent Snapshots</h2>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-left py-2 font-medium">Time</th>
                  <th className="text-right py-2 font-medium">Credits</th>
                  <th className="text-right py-2 font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {[...data.history].reverse().slice(0, 48).map((s, i, arr) => {
                  const prev = arr[i + 1]
                  const diff = prev ? s.credits - prev.credits : 0
                  return (
                    <tr key={s.recorded_at} className="border-b border-border/50">
                      <td className="py-1.5">{formatDate(s.recorded_at)}</td>
                      <td className="text-right font-mono">{formatNumber(s.credits)}</td>
                      <td className={`text-right font-mono ${diff > 0 ? "text-green-500" : diff < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        {diff > 0 ? `+${formatNumber(diff)}` : diff < 0 ? formatNumber(diff) : "-"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
