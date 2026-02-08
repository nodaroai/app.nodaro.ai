"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import {
  DollarSign,
  Wrench,
  CreditCard,
  ShoppingCart,
  Zap,
  ChevronDown,
  ChevronRight,
  Search,
  Loader2,
  ExternalLink,
  Brain,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase"
import {
  SUBSCRIPTION_TIERS,
  TOPUP_PACKAGES,
  LLM_MODELS,
  FFMPEG_NODES,
  detectCategory,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  type DBCategory,
  type LLMPricing,
} from "./pricing-data"

// ── DB model type (same shape as /admin/models) ─────────────────────

interface DBModelPricing {
  readonly id: string
  readonly model_identifier: string
  readonly display_name: string
  readonly category: string
  readonly credit_cost: number
  readonly is_enabled: boolean
  readonly tier_restriction: string | null
}

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) {
    throw new Error("Not authenticated")
  }
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${session.access_token}`,
  }
}

function parseResponse<T>(json: unknown): ReadonlyArray<T> {
  if (Array.isArray(json)) return json as ReadonlyArray<T>
  if (json && typeof json === "object" && "data" in json && Array.isArray((json as Record<string, unknown>).data)) {
    return (json as Record<string, unknown>).data as ReadonlyArray<T>
  }
  return []
}

// ── Dynamic Quick Stats ─────────────────────────────────────────────

function computeQuickStats(models: ReadonlyArray<DBModelPricing>) {
  const videoModels = models.filter((m) => detectCategory(m.model_identifier) === "video" && m.is_enabled)
  const imageModels = models.filter((m) => detectCategory(m.model_identifier) === "image" && m.is_enabled)
  const enabledModels = models.filter((m) => m.is_enabled)

  const cheapestVideo = videoModels.length > 0
    ? videoModels.reduce((min, m) => m.credit_cost < min.credit_cost ? m : min, videoModels[0])
    : null
  const mostExpensiveVideo = videoModels.length > 0
    ? videoModels.reduce((max, m) => m.credit_cost > max.credit_cost ? m : max, videoModels[0])
    : null

  const imageRange = imageModels.length > 0
    ? (() => {
        const costs = imageModels.map((m) => m.credit_cost)
        const min = Math.min(...costs)
        const max = Math.max(...costs)
        return min === max ? `${min} credit${min !== 1 ? "s" : ""}` : `${min}-${max} credits`
      })()
    : "N/A"

  const avgCost = enabledModels.length > 0
    ? (enabledModels.reduce((sum, m) => sum + m.credit_cost, 0) / enabledModels.length).toFixed(1)
    : "0"

  return [
    {
      label: "Cheapest video",
      value: cheapestVideo
        ? `${cheapestVideo.display_name || cheapestVideo.model_identifier} = ${cheapestVideo.credit_cost} cr`
        : "N/A",
    },
    {
      label: "Most expensive video",
      value: mostExpensiveVideo
        ? `${mostExpensiveVideo.display_name || mostExpensiveVideo.model_identifier} = ${mostExpensiveVideo.credit_cost} cr`
        : "N/A",
    },
    { label: "Avg credit cost", value: `${avgCost} credits` },
    { label: "Enabled models", value: `${enabledModels.length} / ${models.length}` },
    { label: "All images", value: imageRange },
    { label: "FFmpeg nodes", value: "Always free" },
    { label: "Markup", value: "KIE 25% / Replicate 10%" },
    { label: "Credit value", value: "1 credit = $0.10 cost" },
  ] as const
}

function QuickStatsCard({ models }: { readonly models: ReadonlyArray<DBModelPricing> }) {
  const stats = computeQuickStats(models)

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center">
          <Zap className="h-5 w-5 text-primary" />
        </div>
        <h2 className="text-sm font-semibold uppercase tracking-wider">Quick Stats</h2>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-md bg-muted/40 px-3 py-2">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="text-sm font-medium mt-0.5">{stat.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Margin color helper ─────────────────────────────────────────────

function marginColor(margin: number | null): string {
  if (margin === null) return "text-zinc-400"
  if (margin > 40) return "text-green-600 dark:text-green-400"
  if (margin >= 25) return "text-yellow-600 dark:text-yellow-400"
  return "text-red-600 dark:text-red-400"
}

// ── Subscription Tiers (static) ─────────────────────────────────────

function SubscriptionTiersSection() {
  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b">
        <CreditCard className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wider">Subscription Tiers</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Tier</th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Price/mo</th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Credits</th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">$/Credit</th>
              <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">LLM Requests</th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Our Cost</th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Margin</th>
              <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Notes</th>
            </tr>
          </thead>
          <tbody>
            {SUBSCRIPTION_TIERS.map((tier) => (
              <tr key={tier.name} className="border-t hover:bg-muted/30 transition-colors">
                <td className="px-4 py-2.5 font-medium">{tier.name}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{tier.price === 0 ? "$0" : `$${tier.price}`}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{tier.credits.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{tier.perCredit !== null ? `$${tier.perCredit.toFixed(3)}` : "--"}</td>
                <td className="px-4 py-2.5 text-xs">{tier.llmRequests}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">~${tier.estimatedCost}</td>
                <td className={`px-4 py-2.5 text-right font-mono text-xs font-semibold ${marginColor(tier.margin)}`}>
                  {tier.margin !== null ? `${tier.margin}%` : "loss leader"}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{tier.notes ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Top-Up Credits (static) ─────────────────────────────────────────

function TopUpSection() {
  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b">
        <ShoppingCart className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wider">Top-Up Credits</h2>
        <span className="text-xs text-muted-foreground ml-2">Non-expiring (unlike subscription credits)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Package</th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Price</th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Credits</th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">$/Credit</th>
            </tr>
          </thead>
          <tbody>
            {TOPUP_PACKAGES.map((pkg) => (
              <tr key={pkg.name} className="border-t hover:bg-muted/30 transition-colors">
                <td className="px-4 py-2.5 font-medium">{pkg.name}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">${pkg.price}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{pkg.credits}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">${pkg.perCredit.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── AI Models from DB (grouped by category) ─────────────────────────

function DBModelTable({
  models,
  search,
}: {
  readonly models: ReadonlyArray<DBModelPricing>
  readonly search: string
}) {
  const filtered = search.trim()
    ? models.filter((m) => {
        const q = search.toLowerCase()
        return m.model_identifier.toLowerCase().includes(q) ||
          (m.display_name && m.display_name.toLowerCase().includes(q))
      })
    : models

  const categoryOrder: ReadonlyArray<DBCategory> = ["image", "video", "audio", "processing", "other"]

  const grouped = filtered.reduce<Record<DBCategory, ReadonlyArray<DBModelPricing>>>(
    (acc, model) => {
      const cat = detectCategory(model.model_identifier)
      return { ...acc, [cat]: [...(acc[cat] ?? []), model] }
    },
    { image: [], video: [], audio: [], processing: [], other: [] },
  )

  const hasResults = categoryOrder.some((cat) => (grouped[cat]?.length ?? 0) > 0)

  if (!hasResults) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        No models match &quot;{search}&quot;
      </div>
    )
  }

  return (
    <div className="divide-y">
      {categoryOrder.map((cat) => {
        const group = grouped[cat]
        if (!group || group.length === 0) return null

        return (
          <div key={cat}>
            {/* Category subheader */}
            <div className={`px-4 py-2 bg-muted/30 text-xs font-semibold uppercase tracking-wider ${CATEGORY_COLORS[cat]}`}>
              {CATEGORY_LABELS[cat]}
              <span className="ml-1.5 text-muted-foreground font-normal">({group.length})</span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {group.map((m) => (
                  <tr key={m.id} className="border-t hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 w-2/5">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-mono text-xs">{m.model_identifier}</span>
                        {m.display_name && m.display_name !== m.model_identifier && (
                          <span className="text-xs text-muted-foreground">{m.display_name}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold w-24">
                      {m.credit_cost} cr
                    </td>
                    <td className="px-4 py-2.5 w-20">
                      {m.is_enabled ? (
                        <Badge variant="outline" className="text-xs text-green-600 dark:text-green-400 border-green-500/30">
                          On
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-zinc-400 border-zinc-400/30">
                          Off
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground w-24">
                      {m.tier_restriction && m.tier_restriction !== "none" && m.tier_restriction !== "free"
                        ? <Badge variant="secondary" className="text-xs">{m.tier_restriction}+</Badge>
                        : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

// ── LLM Table (static) ──────────────────────────────────────────────

function filterLLMs(models: readonly LLMPricing[], query: string): readonly LLMPricing[] {
  if (!query.trim()) return models
  const q = query.toLowerCase()
  return models.filter((m) => m.model.toLowerCase().includes(q))
}

function LLMTable({ search }: { readonly search: string }) {
  const filtered = filterLLMs(LLM_MODELS, search)

  if (filtered.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        No models match &quot;{search}&quot;
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Model</th>
            <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Input $/M tokens</th>
            <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Output $/M tokens</th>
            <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">~Cost / request</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((m) => (
            <tr key={m.model} className="border-t hover:bg-muted/30 transition-colors">
              <td className="px-4 py-2.5 font-medium">{m.model}</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs">{m.inputCost}</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs">{m.outputCost}</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs">{m.perRequest}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── AI Models Section ───────────────────────────────────────────────

type ViewMode = "db" | "llm"

function AIModelsSection({ models, loading }: { readonly models: ReadonlyArray<DBModelPricing>; readonly loading: boolean }) {
  const [viewMode, setViewMode] = useState<ViewMode>("db")
  const [search, setSearch] = useState("")

  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b">
        <DollarSign className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wider">AI Model Pricing</h2>
        <span className="text-xs text-muted-foreground ml-1">from DB</span>
        <Link
          href="/admin/models"
          className="ml-auto text-xs text-[#ff0073] hover:underline inline-flex items-center gap-1"
        >
          Edit model pricing
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {/* View toggle + search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 px-4 py-3 border-b bg-muted/20">
        <div className="flex gap-1">
          <button
            onClick={() => setViewMode("db")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === "db"
                ? "bg-[#ff0073]/10 text-[#ff0073] border border-[#ff0073]/30"
                : "text-muted-foreground hover:bg-muted/50 border border-transparent"
            }`}
          >
            <DollarSign className="h-3.5 w-3.5" />
            All Models ({models.length})
          </button>
          <button
            onClick={() => setViewMode("llm")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === "llm"
                ? "bg-[#ff0073]/10 text-[#ff0073] border border-[#ff0073]/30"
                : "text-muted-foreground hover:bg-muted/50 border border-transparent"
            }`}
          >
            <Brain className="h-3.5 w-3.5" />
            LLM
          </button>
        </div>
        <div className="relative sm:ml-auto w-full sm:w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Filter models..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : viewMode === "llm" ? (
        <>
          <LLMTable search={search} />
          <div className="px-4 py-2.5 text-xs text-muted-foreground border-t bg-muted/20">
            Included free in tier quota. After quota exhausted: 1 credit per request.
          </div>
        </>
      ) : (
        <DBModelTable models={models} search={search} />
      )}
    </div>
  )
}

// ── FFmpeg Section (static) ─────────────────────────────────────────

function FFmpegSection() {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-2 px-5 py-4 w-full text-left border-b hover:bg-muted/30 transition-colors"
      >
        <Wrench className="h-4 w-4 text-green-600 dark:text-green-400" />
        <h2 className="text-sm font-semibold uppercase tracking-wider">FFmpeg Post-Processing</h2>
        <Badge className="ml-2 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border-0">
          FREE
        </Badge>
        {expanded ? (
          <ChevronDown className="h-4 w-4 ml-auto text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 ml-auto text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Node</th>
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Function</th>
                  <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Credits</th>
                </tr>
              </thead>
              <tbody>
                {FFMPEG_NODES.map((node) => (
                  <tr key={node.name} className="border-t hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 font-medium">{node.name}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{node.description}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border-0 text-xs">
                        0
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 text-xs text-muted-foreground border-t bg-muted/20">
            These run FFmpeg on our server. No external API. Zero cost.
          </div>
        </>
      )}
    </div>
  )
}

// ── Main Page ───────────────────────────────────────────────────────

export default function AdminPricingPage() {
  const [models, setModels] = useState<ReadonlyArray<DBModelPricing>>([])
  const [loading, setLoading] = useState(true)

  const fetchModels = useCallback(async () => {
    setLoading(true)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`${API}/v1/admin/models`, { headers })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error(errData?.error ?? `Request failed: ${res.status}`)
      }
      const json = await res.json()
      setModels(parseResponse<DBModelPricing>(json))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fetch model pricing")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
          <DollarSign className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Pricing Overview</h1>
          <p className="text-sm text-muted-foreground">Model costs, credit pricing, and subscription tiers</p>
        </div>
      </div>

      {/* 1. Quick Stats (dynamic from DB) */}
      <QuickStatsCard models={models} />

      {/* 2. Subscription Tiers (static) */}
      <SubscriptionTiersSection />

      {/* 3. Top-Up Credits (static) */}
      <TopUpSection />

      {/* 4. AI Model Pricing (from DB) */}
      <AIModelsSection models={models} loading={loading} />

      {/* 5. FFmpeg Post-Processing (static) */}
      <FFmpegSection />
    </div>
  )
}
