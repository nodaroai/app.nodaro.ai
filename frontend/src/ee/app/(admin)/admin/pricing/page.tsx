import { useState, useCallback } from "react"
import { Link } from "react-router-dom"
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
  Save,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { useAdminModels, useUpdateModelPricingMutation } from "@/ee/hooks/queries/use-admin-queries"
import {
  SUBSCRIPTION_TIERS,
  TOPUP_PACKAGES,
  FFMPEG_NODES,
  detectCategory,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  type DBCategory,
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
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Monthly</th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Annual</th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Credits</th>
              <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">$/Credit</th>
              <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">LLM Requests</th>
              <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wider text-muted-foreground">Notes</th>
            </tr>
          </thead>
          <tbody>
            {SUBSCRIPTION_TIERS.map((tier) => (
              <tr key={tier.name} className="border-t hover:bg-muted/30 transition-colors">
                <td className="px-4 py-2.5 font-medium">{tier.name}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{tier.priceMonthly === 0 ? "$0" : `$${tier.priceMonthly}`}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{tier.priceAnnual === 0 ? "$0" : `$${tier.priceAnnual}`}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{tier.credits.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{tier.perCredit !== null ? `$${tier.perCredit.toFixed(3)}` : "--"}</td>
                <td className="px-4 py-2.5 text-xs">{tier.llmRequests}</td>
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

// ── Inline Editable Credit Cost Cell ────────────────────────────────

function InlineEditableCell({
  value,
  onSave,
  disabled,
}: {
  readonly value: number
  readonly onSave: (val: number) => void
  readonly disabled?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))

  const commit = () => {
    const num = Number(draft)
    if (!Number.isNaN(num) && num >= 0 && num <= 10000) {
      onSave(num)
    } else {
      toast.error("Credit cost must be 0-10000")
      setDraft(String(value))
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <Input
        type="number"
        min={0}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
          if (e.key === "Escape") {
            setDraft(String(value))
            setEditing(false)
          }
        }}
        disabled={disabled}
        className="h-7 w-20 text-sm font-mono"
        autoFocus
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(String(value))
        setEditing(true)
      }}
      disabled={disabled}
      className="font-mono text-sm font-semibold px-2 py-1 rounded hover:bg-muted transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
      title="Click to edit"
    >
      {value}
    </button>
  )
}

// ── Detailed Model Table (editable per-model credit cost) ───────────

function DetailedModelTable({
  models,
  search,
  pendingCosts,
  onCostChange,
  onSave,
  savingId,
}: {
  readonly models: ReadonlyArray<DBModelPricing>
  readonly search: string
  readonly pendingCosts: Readonly<Record<string, number>>
  readonly onCostChange: (id: string, cost: number) => void
  readonly onSave: (id: string) => void
  readonly savingId: string | null
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
            <div className={`px-3 py-2 bg-muted/30 text-xs font-semibold uppercase tracking-wider ${CATEGORY_COLORS[cat]}`}>
              {CATEGORY_LABELS[cat]}
              <span className="ml-1.5 text-muted-foreground font-normal">({group.length})</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/20">
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left px-3 py-2 font-medium">Model</th>
                    <th className="text-right px-3 py-2 font-medium">Credits</th>
                    <th className="px-3 py-2 w-12" />
                  </tr>
                </thead>
                <tbody>
                  {group.map((m) => {
                    const creditCost = pendingCosts[m.model_identifier] ?? m.credit_cost
                    const hasPending = m.model_identifier in pendingCosts
                    const isSaving = savingId === m.model_identifier

                    return (
                      <tr key={m.id} className="border-t hover:bg-muted/30 transition-colors">
                        {/* Model ID + enabled dot */}
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${m.is_enabled ? "bg-green-500" : "bg-zinc-400"}`}
                              title={m.is_enabled ? "Enabled" : "Disabled"}
                            />
                            <div className="flex flex-col">
                              <span className="font-mono text-xs">{m.model_identifier}</span>
                              {m.display_name && m.display_name !== m.model_identifier && (
                                <span className="text-[10px] text-muted-foreground leading-tight">{m.display_name}</span>
                              )}
                            </div>
                          </div>
                        </td>
                        {/* Credit cost (editable) */}
                        <td className="px-3 py-2.5 text-right">
                          <InlineEditableCell
                            value={creditCost}
                            onSave={(val) => onCostChange(m.model_identifier, val)}
                            disabled={isSaving}
                          />
                        </td>
                        {/* Save */}
                        <td className="px-3 py-2.5">
                          {hasPending && (
                            <button
                              type="button"
                              onClick={() => onSave(m.model_identifier)}
                              disabled={isSaving}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                            >
                              {isSaving ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Save className="h-3 w-3" />
                              )}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── AI Models Section (with inline edit + save) ─────────────────────

function AIModelsSection({
  models,
  loading,
}: {
  readonly models: ReadonlyArray<DBModelPricing>
  readonly loading: boolean
}) {
  const [search, setSearch] = useState("")
  const [pendingCosts, setPendingCosts] = useState<Record<string, number>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const updatePricingMut = useUpdateModelPricingMutation()

  const handleCostChange = useCallback((identifier: string, cost: number) => {
    setPendingCosts((prev) => ({ ...prev, [identifier]: cost }))
  }, [])

  const handleSave = useCallback(
    async (identifier: string) => {
      const model = models.find((m) => m.model_identifier === identifier)
      if (!model) return

      const newCost = pendingCosts[identifier]
      if (newCost === undefined) return

      setSavingId(identifier)
      try {
        await updatePricingMut.mutateAsync({
          modelId: identifier,
          pricing: {
            creditCost: newCost,
            isEnabled: model.is_enabled,
            tierRestriction: model.tier_restriction ?? null,
          },
        })
        toast.success(`Updated ${identifier} to ${newCost} credits`)
        setPendingCosts((prev) => {
          const { [identifier]: _removed, ...rest } = prev
          return rest
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save")
      } finally {
        setSavingId(null)
      }
    },
    [models, pendingCosts, updatePricingMut],
  )

  const pendingCount = Object.keys(pendingCosts).length

  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b">
        <DollarSign className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wider">AI Model Pricing</h2>
        {pendingCount > 0 && (
          <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-[10px]">
            {pendingCount} unsaved
          </Badge>
        )}
        <Link
          to="/admin/models"
          className="ml-auto text-xs text-[#ff0073] hover:underline inline-flex items-center gap-1"
        >
          Edit model pricing
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {/* Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 px-4 py-3 border-b bg-muted/20">
        <span className="text-xs text-muted-foreground">{models.length} models</span>
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
      ) : (
        <>
          <DetailedModelTable
            models={models}
            search={search}
            pendingCosts={pendingCosts}
            onCostChange={handleCostChange}
            onSave={handleSave}
            savingId={savingId}
          />
          <div className="px-4 py-2.5 text-xs text-muted-foreground border-t bg-muted/20">
            Click any credit value to edit.
          </div>
        </>
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
  const { data: modelsResult, isLoading: loading } = useAdminModels()
  const models: ReadonlyArray<DBModelPricing> = (() => {
    const raw = modelsResult?.data ?? modelsResult
    return (Array.isArray(raw) ? raw : []) as ReadonlyArray<DBModelPricing>
  })()

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
