import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, TrendingDown, TrendingUp } from "lucide-react"

/**
 * The credit audit's LLM mode (`POST /v1/admin/credit-audit/llm`): per
 * (feature, model), the metered calls' real provider cost against what the
 * payers were charged. Admin-only — provider dollars are shown here and never
 * to users.
 */
export interface LlmAuditRow {
  feature: string
  model: string
  tasks: number
  providerCostUsd: number
  providerCostInCredits: number
  markupPercent: number
  expectedCredits: number
  chargedCredits: number
  shortfallCredits: number
  estimatedShare: number
  diff: number
  diffPercent: number | null
  status: "OK" | "UNDERPRICED" | "OVERPRICED"
  uncollectedOverruns: number
  unsettledHolds: number
  uncomputableTasks: number
  fixedCreditsExcluded: number
  /** The fields below arrived later: a result saved before them lacks them (read with `?? 0`). */
  /** Charged at different percents (a `:direct` lane's own margin): `markupPercent` is cost-weighted. */
  mixedMarkup?: boolean
  /** Charge minus the scrape's fixed price went negative (a reprice) — out of the comparison. */
  negativeRemainderTasks?: number
  /** Refunded usage logs whose ledger billed a call (D10) — never in diff or status. */
  refundedBilledTasks?: number
  /** Σ provider cost over the ones whose cost is known. */
  refundedBilledCostUsd?: number
  /** The part of `refundedBilledTasks` whose cost was uncomputable (not in the $). */
  refundedBilledUncomputableTasks?: number
  /** Committed metered usage logs whose job carries no ledger. */
  missingLedgers?: number
}

export interface LlmAuditResult {
  mode: "llm"
  lookbackMinutes: number
  markupPercent: number
  mismatches: number
  /** Settled metered jobs across the rows (compared + uncomputable + negative remainder). */
  totalJobs: number
  refundedBilled?: { tasks: number; costUsd: number; uncomputableTasks?: number }
  missingLedgers?: number
  truncated: boolean
  models: LlmAuditRow[]
  timestamp?: string
}

/** The lookbacks the LLM mode offers, in days (the route takes 1–90). */
export const LLM_AUDIT_DAYS = [1, 3, 7, 14, 30, 60, 90] as const

const STATUS: Record<LlmAuditRow["status"], { label: string; color: string; icon: typeof CheckCircle }> = {
  UNDERPRICED: { label: "Underpriced", color: "bg-red-500/10 text-red-400 border-red-500/20", icon: TrendingDown },
  OVERPRICED: { label: "Overpriced", color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20", icon: TrendingUp },
  OK: { label: "OK", color: "bg-green-500/10 text-green-400 border-green-500/20", icon: CheckCircle },
}

const tone = (s: LlmAuditRow["status"], fallback = ""): string =>
  s === "UNDERPRICED" ? "text-red-400" : s === "OVERPRICED" ? "text-yellow-400" : fallback

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n))

const usd = (n: number): string => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`

export function LlmAuditTable({ result }: { result: LlmAuditResult }) {
  const [filter, setFilter] = useState<"all" | "mismatches">("all")
  const rows = filter === "mismatches" ? result.models.filter((m) => m.status !== "OK") : result.models
  const shortfall = result.models.reduce((s, m) => s + m.shortfallCredits, 0)
  const unsettled = result.models.reduce((s, m) => s + m.unsettledHolds, 0)
  const refundedTasks = result.refundedBilled?.tasks ?? 0
  const refundedUsd = result.refundedBilled?.costUsd ?? 0
  const refundedUncomputable = result.refundedBilled?.uncomputableTasks ?? 0
  const missing = result.missingLedgers ?? 0

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <Stat
          label="Settled Jobs"
          title="Settled metered jobs across the rows: compared, plus uncomputable and negative-remainder ones"
          value={result.totalJobs}
          sub={result.truncated ? "truncated — narrow the range" : undefined}
        />
        <Stat label="Feature × Model" value={result.models.length} />
        <Stat label="Mismatches" value={result.mismatches} highlight={result.mismatches > 0} />
        <Stat
          label="Absorbed"
          title="Unsettled holds count only a scrape's unconfirmed settles (metered_settle_unconfirmed); a single-call settle left unconfirmed goes to the reconcile sweep"
          value={shortfall}
          sub={unsettled > 0 ? `${unsettled} unsettled scrape holds` : "credits uncollected"}
          highlight={shortfall > 0 || unsettled > 0}
        />
        <Stat
          label="Refunded but Billed"
          title="Refunded usage logs whose ledger records a billed call (a billed metered call must never be refunded) — kept out of diff and status"
          value={refundedTasks}
          sub={
            refundedTasks > 0
              ? `${usd(refundedUsd)} provider cost${refundedUncomputable > 0 ? ` + ${refundedUncomputable} uncomputable` : ""}`
              : undefined
          }
          highlight={refundedTasks > 0}
        />
        <Stat
          label="Missing Ledgers"
          title="Committed metered usage logs whose job carries no billing ledger — invisible to the comparison"
          value={missing}
          highlight={missing > 0}
        />
      </div>

      <div className="flex gap-2 mb-4">
        {(["all", "mismatches"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              filter === f
                ? "bg-[#ff0073]/10 text-[#ff0073] border border-[#ff0073]/20"
                : "text-muted-foreground hover:text-foreground border border-transparent"
            }`}
          >
            {f === "all" ? `All (${result.models.length})` : `Mismatches (${result.mismatches})`}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Feature</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Model</th>
                <th className="text-right p-3 font-medium text-muted-foreground">Tasks</th>
                <th className="text-right p-3 font-medium text-muted-foreground" title="Provider cost (admin only)">Cost $</th>
                <th className="text-right p-3 font-medium text-muted-foreground" title="Provider cost converted into our credit units">Converted</th>
                <th className="text-right p-3 font-medium text-muted-foreground" title="The markup this feature and model are charged at">Markup</th>
                <th className="text-right p-3 font-medium text-muted-foreground">Expected</th>
                <th className="text-right p-3 font-medium text-muted-foreground" title="What the payers were charged (collected)">Charged</th>
                <th className="text-right p-3 font-medium text-muted-foreground" title="Overruns the platform absorbed (uncollected + workspace variance)">Shortfall</th>
                <th className="text-right p-3 font-medium text-muted-foreground" title="Share of tasks whose cost was estimated, not stated by the provider">Est.</th>
                <th className="text-right p-3 font-medium text-muted-foreground">Diff</th>
                <th className="text-right p-3 font-medium text-muted-foreground">%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const cfg = STATUS[m.status]
                const Icon = cfg.icon
                return (
                  <tr key={`${m.feature}:${m.model}`} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="p-3">
                      <Badge variant="outline" className={`${cfg.color} text-xs`}>
                        <Icon className="h-3 w-3 mr-1" />
                        {cfg.label}
                      </Badge>
                    </td>
                    <td className="p-3 font-mono text-xs">{m.feature}</td>
                    <td className="p-3">
                      <span className="font-mono text-xs">{m.model}</span>
                      {m.unsettledHolds > 0 && (
                        <Badge
                          variant="outline"
                          className="ml-1.5 text-[10px] bg-orange-500/10 text-orange-400 border-orange-500/20"
                          title="A scrape's unconfirmed settles only (metered_settle_unconfirmed); a single-call settle left unconfirmed goes to the reconcile sweep"
                        >
                          {m.unsettledHolds} unsettled
                        </Badge>
                      )}
                      {(m.refundedBilledTasks ?? 0) > 0 && (
                        <Badge variant="outline" className="ml-1.5 text-[10px] bg-red-500/10 text-red-400 border-red-500/20" title={`Refunded, yet the ledger billed a call (${usd(m.refundedBilledCostUsd ?? 0)} provider cost${(m.refundedBilledUncomputableTasks ?? 0) > 0 ? `, plus ${m.refundedBilledUncomputableTasks} of uncomputable cost` : ""}) — kept out of diff and status`}>
                          {m.refundedBilledTasks} refunded billed{(m.refundedBilledUncomputableTasks ?? 0) > 0 ? ` (${m.refundedBilledUncomputableTasks} cost unknown)` : ""}
                        </Badge>
                      )}
                      {(m.missingLedgers ?? 0) > 0 && (
                        <Badge variant="outline" className="ml-1.5 text-[10px] bg-red-500/10 text-red-400 border-red-500/20" title="Committed, but the job carries no billing ledger — out of the comparison">
                          {m.missingLedgers} no ledger
                        </Badge>
                      )}
                      {(m.negativeRemainderTasks ?? 0) > 0 && (
                        <Badge variant="outline" className="ml-1.5 text-[10px] bg-zinc-500/10 text-zinc-400 border-zinc-500/20" title="Charged less than today's fixed scrape price (repriced in the window) — left out of the comparison">
                          {m.negativeRemainderTasks} repriced
                        </Badge>
                      )}
                      {m.uncomputableTasks > 0 && (
                        <Badge variant="outline" className="ml-1.5 text-[10px] bg-zinc-500/10 text-zinc-400 border-zinc-500/20" title="Billed, but the cost could not be computed — left out of the comparison">
                          {m.uncomputableTasks} uncomputable
                        </Badge>
                      )}
                      {m.fixedCreditsExcluded > 0 && (
                        <Badge variant="outline" className="ml-1.5 text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/20" title="The scrape's fixed price, taken out of the charge">
                          −{m.fixedCreditsExcluded} fixed
                        </Badge>
                      )}
                    </td>
                    <td className="p-3 text-right tabular-nums">{m.tasks}</td>
                    <td className="p-3 text-right tabular-nums text-muted-foreground">{usd(m.providerCostUsd)}</td>
                    <td className="p-3 text-right tabular-nums">{Math.round(m.providerCostInCredits * 100) / 100}</td>
                    <td className="p-3 text-right tabular-nums text-muted-foreground" title={m.mixedMarkup ? "Tasks charged at different percents (a :direct lane's own margin) — cost-weighted" : undefined}>
                      {m.mixedMarkup ? "~" : ""}{m.markupPercent}%
                    </td>
                    <td className="p-3 text-right tabular-nums">{m.expectedCredits}</td>
                    <td className="p-3 text-right tabular-nums font-medium">{m.chargedCredits}</td>
                    <td className={`p-3 text-right tabular-nums ${m.shortfallCredits > 0 ? "text-red-400" : "text-muted-foreground"}`}>
                      {m.shortfallCredits > 0 ? (
                        <span title={`${m.uncollectedOverruns} job(s) with an uncollected overrun`}>{m.shortfallCredits}</span>
                      ) : "—"}
                    </td>
                    <td className="p-3 text-right tabular-nums text-xs text-muted-foreground">{Math.round(m.estimatedShare * 100)}%</td>
                    <td className={`p-3 text-right tabular-nums font-medium ${tone(m.status)}`}>{signed(m.diff)}</td>
                    <td className={`p-3 text-right tabular-nums text-xs ${tone(m.status, "text-muted-foreground")}`}>
                      {m.diffPercent != null ? `${signed(m.diffPercent)}%` : "—"}
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={13} className="p-8 text-center text-muted-foreground">
                    No metered LLM calls match the current filter
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function Stat({ label, value, sub, highlight, title }: { label: string; value: string | number; sub?: string; highlight?: boolean; title?: string }) {
  return (
    <div title={title} className={`rounded-lg border p-3 ${highlight ? "border-red-500/30 bg-red-500/5" : "border-border bg-card"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold ${highlight ? "text-red-400" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}
