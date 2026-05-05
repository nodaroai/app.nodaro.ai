import { useState, useDeferredValue } from "react"
import { Loader2, CheckCircle, XCircle, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { hasAdmin } from "@/lib/edition"
import {
  useAdminCreditAnomaliesSummary,
  useAdminCreditAnomalies,
  usePatchCreditAnomalyMutation,
  useDeleteCreditAnomalyMutation,
  type CreditAnomaly,
} from "@/ee/hooks/queries/use-admin-queries"

const LIMIT = 50
const isAdmin = hasAdmin()

export default function AdminCreditAnomaliesPage() {
  const [offset, setOffset] = useState(0)
  const [status, setStatus] = useState("all")
  const [anomalyType, setAnomalyType] = useState("all")
  const [model, setModel] = useState("")
  const deferredModel = useDeferredValue(model)

  const summaryQuery = useAdminCreditAnomaliesSummary()
  const listQuery = useAdminCreditAnomalies(offset, status, anomalyType, deferredModel)
  const patchMutation = usePatchCreditAnomalyMutation()
  const deleteMutation = useDeleteCreditAnomalyMutation()

  if (!isAdmin) return null

  const summary = summaryQuery.data
  const anomalies = listQuery.data?.data ?? []
  const total = listQuery.data?.total ?? 0
  const loading = listQuery.isLoading && anomalies.length === 0

  function resetFilters() {
    setOffset(0)
    setStatus("all")
    setAnomalyType("all")
    setModel("")
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Credit Anomalies</h1>
        <p className="text-sm text-muted-foreground">
          Mismatches between estimated and actual credit charges
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-yellow-400">
              {summary?.pending ?? "--"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Overcharge
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-400">
              {summary ? `${summary.totalOvercharge} CR` : "--"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Undercharge
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-400">
              {summary ? `${summary.totalUndercharge} CR` : "--"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="w-40">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Status</label>
          <Select
            value={status}
            onValueChange={(v) => { setStatus(v); setOffset(0) }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="acknowledged">Acknowledged</SelectItem>
              <SelectItem value="dismissed">Dismissed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Type</label>
          <Select
            value={anomalyType}
            onValueChange={(v) => { setAnomalyType(v); setOffset(0) }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="overcharge">Overcharge</SelectItem>
              <SelectItem value="undercharge">Undercharge</SelectItem>
              <SelectItem value="unknown_model">Unknown Model</SelectItem>
              <SelectItem value="zero_cost">Zero Cost</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-48">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Model</label>
          <Input
            placeholder="Filter by model..."
            value={model}
            onChange={(e) => { setModel(e.target.value); setOffset(0) }}
            className="text-sm"
          />
        </div>
        <Button variant="outline" size="sm" onClick={resetFilters}>
          Reset
        </Button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Date</th>
                <th className="text-left px-3 py-2 font-medium">Job ID</th>
                <th className="text-left px-3 py-2 font-medium">Model</th>
                <th className="text-left px-3 py-2 font-medium">Provider</th>
                <th className="text-right px-3 py-2 font-medium">Estimated</th>
                <th className="text-right px-3 py-2 font-medium">Actual</th>
                <th className="text-right px-3 py-2 font-medium">Diff</th>
                <th className="text-left px-3 py-2 font-medium">Type</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {anomalies.map((a: CreditAnomaly) => (
                <tr key={a.id} className="border-t hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(a.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
                      title={a.job_id ?? "No job"}
                      onClick={() => a.job_id && navigator.clipboard.writeText(a.job_id)}
                    >
                      {a.job_id ? a.job_id.slice(0, 8) : "--"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-xs font-mono max-w-[140px] truncate" title={a.model_identifier}>
                    {a.model_identifier}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {a.provider ?? "--"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">
                    {a.credits_estimated}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">
                    {a.credits_actual}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums text-xs font-medium ${
                    a.anomaly_type === "overcharge" ? "text-green-400" : "text-red-400"
                  }`}>
                    {a.diff > 0 ? `+${a.diff}` : a.diff}
                  </td>
                  <td className="px-3 py-2">
                    <StyledBadge value={a.anomaly_type} styles={ANOMALY_TYPE_STYLES} />
                  </td>
                  <td className="px-3 py-2">
                    <StyledBadge value={a.status} styles={STATUS_STYLES} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      {a.status === "pending" && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Acknowledge"
                            disabled={patchMutation.isPending}
                            onClick={() => patchMutation.mutate({ id: a.id, status: "acknowledged" })}
                          >
                            <CheckCircle className="h-3.5 w-3.5 text-green-400" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Dismiss"
                            disabled={patchMutation.isPending}
                            onClick={() => patchMutation.mutate({ id: a.id, status: "dismissed" })}
                          >
                            <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Delete"
                        disabled={deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate(a.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-400" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {anomalies.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                    No anomalies found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <p className="text-xs text-muted-foreground">
          Showing {anomalies.length > 0 ? offset + 1 : 0}--{offset + anomalies.length} of {total}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + LIMIT >= total}
            onClick={() => setOffset((o) => o + LIMIT)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}

const ANOMALY_TYPE_STYLES: Record<string, { label: string; cls: string }> = {
  overcharge: { label: "Overcharge", cls: "bg-green-500/10 text-green-400 border-green-500/20" },
  undercharge: { label: "Undercharge", cls: "bg-red-500/10 text-red-400 border-red-500/20" },
  unknown_model: { label: "Unknown", cls: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  zero_cost: { label: "Zero Cost", cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" },
}

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  acknowledged: { label: "Ack'd", cls: "bg-green-500/10 text-green-400 border-green-500/20" },
  dismissed: { label: "Dismissed", cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" },
}

function StyledBadge({ value, styles }: { value: string; styles: Record<string, { label: string; cls: string }> }) {
  const s = styles[value]
  return <Badge variant="outline" className={`text-xs ${s?.cls ?? ""}`}>{s?.label ?? value}</Badge>
}
