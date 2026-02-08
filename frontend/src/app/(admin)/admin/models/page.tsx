"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { Cpu, Loader2, Save, Check, ArrowLeft } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createClient } from "@/lib/supabase"

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

interface ModelPricing {
  readonly id: string
  readonly model_identifier: string
  readonly display_name: string
  readonly category: string
  readonly credit_cost: number
  readonly is_enabled: boolean
  readonly tier_restriction: string | null
  readonly updated_at: string
}

// ── Category detection by model ID pattern ──────────────────────────

type Category = "image" | "video" | "audio" | "processing" | "other"

const CATEGORY_PATTERNS: ReadonlyArray<readonly [Category, ReadonlyArray<string>]> = [
  ["image", ["nano", "flux", "grok", "gpt-image", "recraft"]],
  ["video", ["veo", "kling", "minimax", "wan", "sora", "grok-i2v", "runway", "pika"]],
  ["audio", ["suno", "elevenlabs", "infinitalk", "tango", "musicgen", "audioldm", "bark"]],
  ["processing", ["ffmpeg", "topaz"]],
]

function detectCategory(modelId: string): Category {
  const lower = modelId.toLowerCase()
  for (const [category, patterns] of CATEGORY_PATTERNS) {
    if (patterns.some((p) => lower.includes(p))) return category
  }
  return "other"
}

const CATEGORY_LABELS: Record<Category, string> = {
  image: "Image Generation",
  video: "Video Generation",
  audio: "Audio / TTS / Music",
  processing: "Processing",
  other: "Other",
}

const CATEGORY_HEADER_COLORS: Record<Category, string> = {
  image: "text-blue-500",
  video: "text-purple-500",
  audio: "text-amber-500",
  processing: "text-slate-500",
  other: "text-gray-500",
}

const TIER_OPTIONS = [
  { value: "none", label: "None" },
  { value: "free", label: "Free" },
  { value: "basic", label: "Basic" },
  { value: "standard", label: "Standard" },
  { value: "pro", label: "Pro" },
  { value: "business", label: "Business" },
]

// ── Auth headers helper ──────────────────────────────────────────────

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) {
    throw new Error("Not authenticated. Please sign in.")
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

// ── Summary Cards ────────────────────────────────────────────────────

function SummaryCards({ models }: { readonly models: ReadonlyArray<ModelPricing> }) {
  const totalModels = models.length
  const enabledModels = models.filter((m) => m.is_enabled).length
  const avgCost =
    totalModels > 0
      ? (models.reduce((sum, m) => sum + m.credit_cost, 0) / totalModels).toFixed(1)
      : "0"
  const tierRestricted = models.filter(
    (m) => m.tier_restriction && m.tier_restriction !== "none" && m.tier_restriction !== "free"
  ).length

  const cards = [
    { label: "Total Models", value: totalModels, color: "text-foreground" },
    { label: "Enabled", value: enabledModels, color: "text-green-500" },
    { label: "Avg Credit Cost", value: avgCost, color: "text-blue-500" },
    { label: "Tier-Restricted", value: tierRestricted, color: "text-amber-500" },
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

// ── Toggle Switch (custom, no Switch component) ─────────────────────

function ToggleSwitch({
  checked,
  onChange,
  disabled,
  label,
}: {
  readonly checked: boolean
  readonly onChange: (val: boolean) => void
  readonly disabled?: boolean
  readonly label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`
        relative inline-flex h-6 w-11 items-center rounded-full transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
        disabled:cursor-not-allowed disabled:opacity-50
        ${checked ? "bg-green-500" : "bg-gray-400 dark:bg-gray-600"}
      `}
    >
      <span
        className={`
          inline-block h-4 w-4 rounded-full bg-white transition-transform shadow-sm
          ${checked ? "translate-x-6" : "translate-x-1"}
        `}
      />
    </button>
  )
}

// ── Inline Editable Cell ─────────────────────────────────────────────

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

  const MAX_CREDIT_COST = 10000

  const commit = () => {
    const num = Number(draft)
    if (!Number.isNaN(num) && num >= 0 && num <= MAX_CREDIT_COST) {
      onSave(num)
    } else {
      toast.error(`Credit cost must be between 0 and ${MAX_CREDIT_COST}`)
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
      className="font-mono text-sm px-2 py-1 rounded hover:bg-muted transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
      title="Click to edit"
      aria-label={`Edit credit cost, current value ${value}`}
    >
      {value}
    </button>
  )
}

// ── Model Row ────────────────────────────────────────────────────────

interface PendingChange {
  creditCost?: number
  isEnabled?: boolean
  tierRestriction?: string | null
}

function ModelRow({
  model,
  pending,
  onFieldChange,
  onSave,
  saving,
}: {
  readonly model: ModelPricing
  readonly pending: PendingChange | undefined
  readonly onFieldChange: (identifier: string, field: keyof PendingChange, value: unknown) => void
  readonly onSave: (identifier: string, model: ModelPricing) => void
  readonly saving: boolean
}) {
  const hasPending = pending !== undefined
  const currentCost = pending?.creditCost ?? model.credit_cost
  const currentEnabled = pending?.isEnabled ?? model.is_enabled
  const currentTier = pending?.tierRestriction !== undefined
    ? (pending.tierRestriction ?? "none")
    : (model.tier_restriction ?? "none")

  return (
    <tr className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
      {/* Model ID */}
      <td className="py-3 px-4">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-sm">{model.model_identifier}</span>
          {model.display_name && model.display_name !== model.model_identifier && (
            <span className="text-xs text-muted-foreground">{model.display_name}</span>
          )}
        </div>
      </td>

      {/* Credit Cost (inline editable) */}
      <td className="py-3 px-4">
        <InlineEditableCell
          value={currentCost}
          onSave={(val) => onFieldChange(model.model_identifier, "creditCost", val)}
          disabled={saving}
        />
      </td>

      {/* Enabled toggle */}
      <td className="py-3 px-4">
        <ToggleSwitch
          checked={currentEnabled}
          onChange={(val) => onFieldChange(model.model_identifier, "isEnabled", val)}
          disabled={saving}
          label={`Enable ${model.model_identifier}`}
        />
      </td>

      {/* Tier Restriction */}
      <td className="py-3 px-4">
        <Select
          value={currentTier}
          onValueChange={(val) => onFieldChange(model.model_identifier, "tierRestriction", val === "none" ? null : val)}
          disabled={saving}
        >
          <SelectTrigger className="h-7 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIER_OPTIONS.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>

      {/* Actions */}
      <td className="py-3 px-4">
        {hasPending ? (
          <Button
            size="sm"
            onClick={() => onSave(model.model_identifier, model)}
            disabled={saving}
            className="h-7 px-3 text-xs"
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                <Save className="h-3 w-3 mr-1" />
                Save
              </>
            )}
          </Button>
        ) : (
          <Badge variant="outline" className="text-xs text-green-600 dark:text-green-400 border-green-500/30">
            <Check className="h-3 w-3 mr-1" />
            Saved
          </Badge>
        )}
      </td>
    </tr>
  )
}

// ── Main Page ────────────────────────────────────────────────────────

export default function AdminModelPricingPage() {
  const [models, setModels] = useState<ReadonlyArray<ModelPricing>>([])
  const [loading, setLoading] = useState(true)
  const [pendingChanges, setPendingChanges] = useState<Record<string, PendingChange>>({})
  const [savingId, setSavingId] = useState<string | null>(null)

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
      const data = parseResponse<ModelPricing>(json)
      setModels(data)
      setPendingChanges({})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fetch models")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  const handleFieldChange = useCallback(
    (identifier: string, field: keyof PendingChange, value: unknown) => {
      setPendingChanges((prev) => ({
        ...prev,
        [identifier]: {
          ...prev[identifier],
          [field]: value,
        },
      }))
    },
    []
  )

  const handleSave = useCallback(
    async (identifier: string, model: ModelPricing) => {
      const changes = pendingChanges[identifier]
      if (!changes) return

      setSavingId(identifier)
      try {
        const headers = await getAuthHeaders()
        const res = await fetch(`${API}/v1/admin/models/${encodeURIComponent(identifier)}/pricing`, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            creditCost: changes.creditCost ?? model.credit_cost,
            isEnabled: changes.isEnabled ?? model.is_enabled,
            tierRestriction: changes.tierRestriction !== undefined
              ? changes.tierRestriction
              : (model.tier_restriction ?? null),
          }),
        })
        if (!res.ok) {
          const errData = await res.json().catch(() => null)
          throw new Error(errData?.error ?? `Request failed: ${res.status}`)
        }
        toast.success(`Updated ${identifier}`)
        setPendingChanges((prev) => {
          const { [identifier]: _removed, ...rest } = prev
          return rest
        })
        await fetchModels()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save")
      } finally {
        setSavingId(null)
      }
    },
    [pendingChanges, fetchModels]
  )

  // ── Group models by detected category ──────────────────────────────

  const groupedModels = models.reduce<Record<Category, ReadonlyArray<ModelPricing>>>(
    (acc, model) => {
      const cat = detectCategory(model.model_identifier)
      return { ...acc, [cat]: [...(acc[cat] ?? []), model] }
    },
    { image: [], video: [], audio: [], processing: [], other: [] }
  )

  const categoryOrder: ReadonlyArray<Category> = ["image", "video", "audio", "processing", "other"]

  // ── Render ─────────────────────────────────────────────────────────

  if (loading && models.length === 0) {
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
        <Cpu className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Model Pricing</h1>
        <span className="text-xs text-muted-foreground ml-2">
          {models.length} models
        </span>
        <Link
          href="/admin/pricing"
          className="ml-auto text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Pricing overview
        </Link>
      </div>

      {/* Summary Cards */}
      <SummaryCards models={models} />

      {/* Empty state */}
      {models.length === 0 && (
        <div className="border rounded-lg p-8 bg-card text-center">
          <Cpu className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No model pricing configured.</p>
        </div>
      )}

      {/* Grouped tables */}
      {categoryOrder.map((cat) => {
        const group = groupedModels[cat]
        if (!group || group.length === 0) return null

        return (
          <div key={cat} className="mb-8">
            {/* Section header */}
            <h2 className={`text-sm font-semibold uppercase tracking-wider mb-3 ${CATEGORY_HEADER_COLORS[cat]}`}>
              {CATEGORY_LABELS[cat]}
              <span className="ml-2 text-muted-foreground font-normal normal-case">
                ({group.length})
              </span>
            </h2>

            {/* Table */}
            <div className="border rounded-lg bg-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs text-muted-foreground uppercase tracking-wider">
                    <th className="text-left py-2 px-4 font-medium">Model ID</th>
                    <th className="text-left py-2 px-4 font-medium">Credit Cost</th>
                    <th className="text-left py-2 px-4 font-medium">Enabled</th>
                    <th className="text-left py-2 px-4 font-medium">Tier Restriction</th>
                    <th className="text-left py-2 px-4 font-medium w-24">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {group.map((model) => (
                    <ModelRow
                      key={model.id}
                      model={model}
                      pending={pendingChanges[model.model_identifier]}
                      onFieldChange={handleFieldChange}
                      onSave={handleSave}
                      saving={savingId === model.model_identifier}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
