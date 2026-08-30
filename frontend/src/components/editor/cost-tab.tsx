import { useMemo, useState } from "react"
import { RefreshCw, Loader2, DollarSign, Coins, BarChart3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useAuth } from "@/hooks/use-auth"
import { useWorkflowCostSummary } from "@/hooks/queries/use-editor-queries"
import { isValidUuid } from "@/lib/uuid"
import { useT } from "@/lib/i18n"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const NODE_TYPE_LABELS: Record<string, string> = {
  "generate-script": "Generate Script",
  "generate-image": "Generate Image",
  "edit-image": "Edit Image",
  "image-to-image": "Image to Image",
  "image-to-video": "Image to Video",
  "video-to-video": "Video to Video",
  "text-to-video": "Text to Video",
  "text-to-speech": "Text to Speech",
  "qa-check": "QA Check",
  "generate-music": "Generate Music",
  "text-to-audio": "Text to Audio",
  "transcribe": "Transcribe",
  "ai-writer": "AI Agent",
  "llm-chat": "Generate Text",
  "combine-videos": "Combine Videos",
  "merge-video-audio": "Merge Video & Audio",
  "still-to-video": "Still to Video",
  "slideshow": "Slideshow",
  "add-captions": "Add Captions",
  "resize-video": "Resize Video",
  "trim-audio": "Trim Audio",
  "mix-audio": "Mix Audio",
  "adjust-volume": "Adjust Volume",
  "trim-video": "Trim Video",
  "generate-character": "Generate Character",
  "generate-character-asset": "Character Asset",
  "generate-object": "Generate Object",
  "generate-object-asset": "Object Asset",
  "generate-location": "Generate Location",
  "generate-location-asset": "Location Asset",
  "motion-transfer": "Motion Transfer",
  "video-upscale": "Upscale Video",
  "lip-sync": "Lip Sync",
  "text-to-dialogue": "Text to Dialogue",
}

function formatNodeType(type: string): string {
  return NODE_TYPE_LABELS[type] ?? type.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

// Null-aware money formatters (§5.2 rule 1): `null` = the metering authority
// could not answer, and MUST render distinctly (an em dash) — never as $0 / 0 CR,
// which would tell someone a paid generation was free.
function formatCreditsN(credits: number | null): string {
  if (credits == null) return "—"
  // credit-gated: the Cost tab is mount-gated by the billing surface (mountCostTab).
  return `${credits} CR`
}

function formatDollarsN(usd: number | null): string {
  if (usd == null) return "—"
  if (usd === 0) return "$0"
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(3)}`
}

interface DialogueAudioResult {
  readonly jobId?: string
}

interface DialogueEntry {
  readonly generatedAudioResults?: readonly DialogueAudioResult[]
}

interface GeneratedResultLike {
  readonly jobId: string
}

/**
 * Walk all nodes in the workflow store and collect every jobId
 * from generatedResults, generatedVideoResults, and dialogue audio results.
 */
export function collectJobIds(nodes: readonly { data: Record<string, unknown> }[]): readonly string[] {
  const ids = new Set<string>()
  // Jobless orchestrator results carry synthetic exec-<node> ids; the route
  // casts ids to uuid and 500s on them, so keep only real job ids.
  const add = (jobId: string | undefined) => {
    if (jobId && isValidUuid(jobId)) ids.add(jobId)
  }

  for (const node of nodes) {
    const data = node.data

    // Standard generatedResults (most AI nodes)
    const results = data.generatedResults as readonly GeneratedResultLike[] | undefined
    if (Array.isArray(results)) {
      for (const r of results) {
        add(r.jobId)
      }
    }

    // Scene node video results
    const videoResults = data.generatedVideoResults as readonly GeneratedResultLike[] | undefined
    if (Array.isArray(videoResults)) {
      for (const r of videoResults) {
        add(r.jobId)
      }
    }

    // Scene node dialogue audio results
    const dialogue = data.dialogue as readonly DialogueEntry[] | undefined
    if (Array.isArray(dialogue)) {
      for (const line of dialogue) {
        if (Array.isArray(line.generatedAudioResults)) {
          for (const ar of line.generatedAudioResults) {
            add(ar.jobId)
          }
        }
      }
    }
  }

  return [...ids]
}

/**
 * Whether the Cost tab should render its "No Executions Yet" placeholder.
 * A failed request must never land here — an error takes priority so the
 * banner below can render instead of the workflow looking like it never ran.
 */
export function shouldShowEmptyState(params: {
  readonly loading: boolean
  readonly summary: { readonly total_jobs: number } | undefined
  readonly error: unknown
}): boolean {
  const { loading, summary, error } = params
  return !loading && error == null && (!summary || summary.total_jobs === 0)
}

interface CostTabProps {
  readonly className?: string
}

export function CostTab({ className = "" }: CostTabProps) {
  const t = useT()
  const { isAdmin } = useAuth()
  const nodes = useWorkflowStore((s) => s.nodes)
  const jobIds = useMemo(() => collectJobIds(nodes), [nodes])
  const { data: summary, isLoading: loading, error, refetch } = useWorkflowCostSummary(jobIds)
  // The ONE rule for showing a dollar figure (SAI-8 / A3, D4): an admin, and an
  // explicit toggle they turned on. `showDollars` used to be seeded from
  // `surface.displayUnit !== "credits"` while only the toggle BUTTON was
  // admin-gated — so any provider whose unit was not the literal "credits"
  // landed every user on the raw-USD view with no control to leave it. The
  // surface's unit is a label now, never a boolean seed; the route no longer
  // even sends USD to a non-admin (SAI-7), so `dollars` is belt-and-braces.
  const [showDollars, setShowDollars] = useState(false)
  const dollars = isAdmin && showDollars

  // Empty state - no executions at all (or no job IDs so query is disabled)
  if (shouldShowEmptyState({ loading, summary, error })) {
    return (
      <div className={`flex flex-col items-center justify-center h-full bg-[#F8FAFC] dark:bg-[#121212] ${className}`}>
        <BarChart3 className="w-16 h-16 text-gray-300 dark:text-[#2D2D2D] mb-4" />
        <h3 className="text-lg font-semibold text-gray-700 dark:text-[#E2E8F0] mb-2">{t("cost.empty.title")}</h3>
        <p className="text-sm text-gray-500 dark:text-[#94A3B8] text-center max-w-md">
          {t("cost.empty.body")}
        </p>
      </div>
    )
  }

  return (
    <div className={`flex flex-col h-full bg-[#F8FAFC] dark:bg-[#121212] ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-3">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-[#E2E8F0] uppercase tracking-wider">
          {t("cost.title")}
        </h2>
        <div className="flex items-center gap-2">
          {/* Admin toggle: credits vs dollars */}
          {isAdmin && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDollars((prev) => !prev)}
                    className={`h-8 px-2.5 dark:border-[#2D2D2D] ${dollars ? "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30" : ""}`}
                  >
                    {dollars ? (
                      <DollarSign className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Coins className="w-4 h-4 text-[#ff0073]" />
                    )}
                    <span className="ml-1.5 text-xs font-medium">
                      {dollars ? "$" : "CR"}
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>{dollars ? t("cost.toggleDollars") : t("cost.toggleCredits")}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={loading}
            className="h-8 px-2.5 dark:border-[#2D2D2D]"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Loading state */}
      {loading && !summary && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400 dark:text-[#64748B]" />
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="mx-6 mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30">
          <p className="text-sm text-red-600 dark:text-red-400">{error instanceof Error ? error.message : t("cost.loadError")}</p>
        </div>
      )}

      {/* Content */}
      {summary && summary.total_jobs > 0 && (
        <div className="flex-1 overflow-auto px-6 pb-6">
          {/* Total cost card */}
          <div className="mb-6 p-5 rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E]">
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-bold text-[#ff0073] font-mono">
                {dollars ? formatDollarsN(summary.total_cost_usd ?? null) : formatCreditsN(summary.total_credits)}
              </span>
              <span className="text-sm text-gray-500 dark:text-[#94A3B8]">
                {summary.total_jobs === 1 ? t("cost.totalFromRun") : t("cost.totalFromRuns", { n: summary.total_jobs })}
              </span>
              {summary.unavailable > 0 && (
                <span className="text-sm text-amber-600 dark:text-amber-400">
                  {t("cost.unavailable", { n: summary.unavailable })}
                </span>
              )}
            </div>
          </div>

          {/* Breakdown table */}
          <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-[#2D2D2D]">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                    {t("cost.col.type")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                    {t("cost.col.model")}
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                    {t("cost.col.runs")}
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                    {dollars ? t("cost.col.perRunDollars") : t("cost.col.perRunCredits")}
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                    {t("cost.col.total")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.breakdown.map((item) => (
                  <tr
                    key={`${item.node_type}::${item.model}`}
                    className="border-b border-gray-50 dark:border-[#2D2D2D]/50 last:border-0"
                  >
                    <td className="px-4 py-3 text-gray-700 dark:text-[#E2E8F0]">
                      {formatNodeType(item.node_type)}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-[#94A3B8] font-mono text-xs">
                      {item.model}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500 dark:text-[#94A3B8] font-mono">
                      {item.runs}
                      {item.failed > 0 && (
                        <span className="ml-1 text-red-400 text-xs">({item.failed}f)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500 dark:text-[#94A3B8] font-mono">
                      {dollars
                        ? formatDollarsN(item.runs > 0 && item.total_cost_usd != null ? item.total_cost_usd / item.runs : null)
                        : item.avg_credits_per_run == null
                          ? "—"
                          : `${item.avg_credits_per_run} CR` /* credit-gated: Cost tab mounts behind the billing-surface gate */}
                    </td>
                    <td className="px-4 py-3 text-right text-[#ff0073] font-mono font-medium">
                      {dollars ? formatDollarsN(item.total_cost_usd ?? null) : formatCreditsN(item.total_credits)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 dark:border-[#2D2D2D]">
                  <td className="px-4 py-3 font-semibold text-gray-700 dark:text-[#E2E8F0]">
                    {t("cost.col.total")}
                  </td>
                  <td />
                  <td className="px-4 py-3 text-right font-mono font-semibold text-gray-700 dark:text-[#E2E8F0]">
                    {summary.total_jobs}
                  </td>
                  <td />
                  <td className="px-4 py-3 text-right text-[#ff0073] font-mono font-bold">
                    {dollars ? formatDollarsN(summary.total_cost_usd ?? null) : formatCreditsN(summary.total_credits)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
