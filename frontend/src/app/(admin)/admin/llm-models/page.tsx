import { BrainCircuit, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  useAdminLlmModels,
  useToggleLlmModelMutation,
  type AdminLlmModel,
} from "@/hooks/queries/use-admin-queries"
import type { LlmTier } from "@nodaro/shared"

// ── Badge colors ────────────────────────────────────────────────────

const VENDOR_COLORS: Record<AdminLlmModel["vendor"], string> = {
  anthropic: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  google: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  openai: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
}

const TIER_COLORS: Record<LlmTier, string> = {
  economy: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20",
  standard: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  premium: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
}

// ── Credit Cost Cell ─────────────────────────────────────────────────

function CreditCostCell({ value }: { readonly value: number | null }) {
  if (value === null) {
    return <span className="text-muted-foreground text-xs">--</span>
  }
  return <span className="font-mono text-sm">{value}</span>
}

// ── Summary Cards ────────────────────────────────────────────────────

function SummaryCards({ models }: { readonly models: ReadonlyArray<AdminLlmModel> }) {
  const total = models.length
  const enabled = models.filter((m) => m.isEnabled).length
  const vendors = new Set(models.map((m) => m.vendor)).size
  const premiumCount = models.filter((m) => m.tier === "premium").length

  const cards = [
    { label: "Total Models", value: total, color: "text-foreground" },
    { label: "Enabled", value: enabled, color: "text-green-500" },
    { label: "Vendors", value: vendors, color: "text-blue-500" },
    { label: "Premium", value: premiumCount, color: "text-yellow-500" },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {cards.map((c) => (
        <div key={c.label} className="border rounded-lg p-4 bg-card">
          <p className="text-xs text-muted-foreground">{c.label}</p>
          <p className={`text-2xl font-bold font-mono ${c.color}`}>{c.value}</p>
        </div>
      ))}
    </div>
  )
}

// ── Model Row ────────────────────────────────────────────────────────

function ModelRow({
  model,
  onToggle,
  isToggling,
}: {
  readonly model: AdminLlmModel
  readonly onToggle: (id: string, enabled: boolean) => void
  readonly isToggling: boolean
}) {
  return (
    <tr className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
      <td className="py-3 px-4">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">{model.displayName}</span>
          <span className="text-xs text-muted-foreground font-mono">{model.id}</span>
        </div>
      </td>
      <td className="py-3 px-4">
        <Badge variant="outline" className={`text-xs capitalize ${VENDOR_COLORS[model.vendor]}`}>
          {model.vendor}
        </Badge>
      </td>
      <td className="py-3 px-4">
        <Badge variant="outline" className={`text-xs capitalize ${TIER_COLORS[model.tier]}`}>
          {model.tier}
        </Badge>
      </td>
      <td className="py-3 px-4">
        <Switch
          checked={model.isEnabled}
          onCheckedChange={(val) => onToggle(model.id, val)}
          disabled={isToggling}
          aria-label={`Enable ${model.displayName}`}
        />
      </td>
    </tr>
  )
}

// ── Main Page ────────────────────────────────────────────────────────

export default function AdminLlmModelsPage() {
  const { data, isLoading } = useAdminLlmModels()
  const models = data?.models ?? []
  const tierCosts = data?.tierCosts
  const featureCosts = data?.featureCosts
  const toggleMut = useToggleLlmModelMutation()

  const handleToggle = async (modelId: string, isEnabled: boolean) => {
    try {
      await toggleMut.mutateAsync({ modelId, isEnabled })
      toast.success(`${modelId} ${isEnabled ? "enabled" : "disabled"}`)
    } catch {
      toast.error("Failed to update model")
    }
  }

  if (isLoading && models.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <BrainCircuit className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">LLM Models</h1>
        <span className="text-xs text-muted-foreground ml-2">
          {models.length} models
        </span>
      </div>

      <SummaryCards models={models} />

      {models.length === 0 && (
        <div className="border rounded-lg p-8 bg-card text-center">
          <BrainCircuit className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No LLM models registered.</p>
        </div>
      )}

      {/* Models table */}
      {models.length > 0 && (
        <div className="border rounded-lg bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground uppercase tracking-wider">
                <th className="text-left py-2 px-4 font-medium">Model</th>
                <th className="text-left py-2 px-4 font-medium">Vendor</th>
                <th className="text-left py-2 px-4 font-medium">Tier</th>
                <th className="text-left py-2 px-4 font-medium">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  onToggle={handleToggle}
                  isToggling={toggleMut.isPending && toggleMut.variables?.modelId === model.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tier average costs */}
      {tierCosts && (
        <div className="mt-6 border rounded-lg bg-card p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Average Credit Cost by Tier
          </h2>
          <div className="grid grid-cols-3 gap-4 text-center">
            {(["economy", "standard", "premium"] as const).map((tier) => (
              <div key={tier}>
                <p className="text-xs text-muted-foreground capitalize">{tier}</p>
                <p className="text-lg font-bold font-mono">{tierCosts[tier] ?? "--"}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feature cost breakdown */}
      {featureCosts && Object.keys(featureCosts).length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Credit Costs by Feature
          </h2>
          <div className="border rounded-lg bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground uppercase tracking-wider">
                  <th className="text-left py-2 px-4 font-medium">Feature</th>
                  <th className="text-left py-2 px-4 font-medium">Economy</th>
                  <th className="text-left py-2 px-4 font-medium">Standard</th>
                  <th className="text-left py-2 px-4 font-medium">Premium</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(featureCosts).map(([feature, costs]) => (
                  <tr key={feature} className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                    <td className="py-2 px-4 font-mono text-sm">{feature}</td>
                    <td className="py-2 px-4"><CreditCostCell value={costs.economy} /></td>
                    <td className="py-2 px-4"><CreditCostCell value={costs.standard} /></td>
                    <td className="py-2 px-4"><CreditCostCell value={costs.premium} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
