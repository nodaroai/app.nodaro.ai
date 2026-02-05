"use client"

import { useEffect, useState, useCallback } from "react"
import { Cpu, Plus, Trash2, Loader2, AlertTriangle, Check, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

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

const CATEGORY_LABELS: Record<string, string> = {
  image: "Image",
  video: "Video",
  tts: "Text-to-Speech",
  music: "Music",
  audio: "Audio",
  processing: "Processing",
  script: "Script",
}

const CATEGORY_COLORS: Record<string, string> = {
  image: "bg-blue-500/10 text-blue-500 border-blue-500/30",
  video: "bg-purple-500/10 text-purple-500 border-purple-500/30",
  tts: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  music: "bg-pink-500/10 text-pink-500 border-pink-500/30",
  audio: "bg-cyan-500/10 text-cyan-500 border-cyan-500/30",
  processing: "bg-slate-500/10 text-slate-500 border-slate-500/30",
  script: "bg-green-500/10 text-green-500 border-green-500/30",
}

const TIER_OPTIONS = ["free", "basic", "standard", "pro", "business"]

export default function AdminModelPricingPage() {
  const [models, setModels] = useState<ReadonlyArray<ModelPricing>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingModel, setEditingModel] = useState<ModelPricing | null>(null)

  // Form state
  const [formIdentifier, setFormIdentifier] = useState("")
  const [formDisplayName, setFormDisplayName] = useState("")
  const [formCategory, setFormCategory] = useState("image")
  const [formCreditCost, setFormCreditCost] = useState("5")
  const [formTierRestriction, setFormTierRestriction] = useState("free")
  const [formIsEnabled, setFormIsEnabled] = useState(true)

  const fetchModels = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE_URL}/v1/admin/model-pricing`)
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error(errData?.error?.message || `Request failed: ${res.status}`)
      }
      const json = await res.json()
      setModels(json.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch models")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  const resetForm = () => {
    setFormIdentifier("")
    setFormDisplayName("")
    setFormCategory("image")
    setFormCreditCost("5")
    setFormTierRestriction("free")
    setFormIsEnabled(true)
    setEditingModel(null)
  }

  const openEditDialog = (model: ModelPricing) => {
    setEditingModel(model)
    setFormIdentifier(model.model_identifier)
    setFormDisplayName(model.display_name)
    setFormCategory(model.category)
    setFormCreditCost(String(model.credit_cost))
    setFormTierRestriction(model.tier_restriction ?? "free")
    setFormIsEnabled(model.is_enabled)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE_URL}/v1/admin/model-pricing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelIdentifier: formIdentifier,
          displayName: formDisplayName,
          category: formCategory,
          creditCost: Number(formCreditCost) || 0,
          isEnabled: formIsEnabled,
          tierRestriction: formTierRestriction,
        }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error(errData?.error?.message || `Request failed: ${res.status}`)
      }
      setDialogOpen(false)
      resetForm()
      await fetchModels()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save model pricing")
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (model: ModelPricing) => {
    try {
      const res = await fetch(`${API_BASE_URL}/v1/admin/model-pricing/${model.id}/toggle`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: !model.is_enabled }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error(errData?.error?.message || `Request failed: ${res.status}`)
      }
      await fetchModels()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle model")
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/v1/admin/model-pricing/${id}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error(errData?.error?.message || `Request failed: ${res.status}`)
      }
      await fetchModels()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete model")
    }
  }

  // Group models by category
  const groupedModels = models.reduce<Record<string, ReadonlyArray<ModelPricing>>>((acc, model) => {
    const category = model.category
    return {
      ...acc,
      [category]: [...(acc[category] ?? []), model],
    }
  }, {})

  if (loading && models.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Cpu className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Model Pricing</h1>
        </div>

        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open)
            if (!open) resetForm()
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Model
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingModel ? "Edit Model Pricing" : "Add Model Pricing"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="model-id">Model Identifier</Label>
                <Input
                  id="model-id"
                  placeholder="e.g. nano-banana, veo3, kling"
                  value={formIdentifier}
                  onChange={(e) => setFormIdentifier(e.target.value)}
                  disabled={!!editingModel}
                />
                <p className="text-xs text-muted-foreground">
                  Must match the identifier used in API routes
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="display-name">Display Name</Label>
                <Input
                  id="display-name"
                  placeholder="e.g. Nano Banana, VEO 3"
                  value={formDisplayName}
                  onChange={(e) => setFormDisplayName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Select value={formCategory} onValueChange={setFormCategory}>
                    <SelectTrigger id="category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="credit-cost">Credit Cost</Label>
                  <Input
                    id="credit-cost"
                    type="number"
                    min={0}
                    value={formCreditCost}
                    onChange={(e) => setFormCreditCost(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tier">Minimum Tier Required</Label>
                <Select value={formTierRestriction} onValueChange={setFormTierRestriction}>
                  <SelectTrigger id="tier">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIER_OPTIONS.map((tier) => (
                      <SelectItem key={tier} value={tier}>
                        {tier.charAt(0).toUpperCase() + tier.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleSave}
                disabled={saving || !formIdentifier || !formDisplayName}
                className="w-full"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : editingModel ? (
                  "Update Model"
                ) : (
                  "Add Model"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {models.length === 0 ? (
        <div className="border rounded-lg p-8 bg-card text-center">
          <Cpu className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No model pricing configured.</p>
          <p className="text-sm text-muted-foreground mt-1">
            Add models to configure their credit costs and availability.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedModels).map(([category, categoryModels]) => (
            <div key={category}>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {CATEGORY_LABELS[category] ?? category}
              </h2>
              <div className="space-y-2">
                {categoryModels.map((model) => (
                  <div
                    key={model.id}
                    className="border rounded-lg p-4 bg-card flex items-center gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{model.display_name}</span>
                        <Badge
                          variant="outline"
                          className={CATEGORY_COLORS[model.category] ?? ""}
                        >
                          {model.category}
                        </Badge>
                        {!model.is_enabled && (
                          <Badge variant="secondary">Disabled</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1">
                        <p className="text-xs text-muted-foreground font-mono">
                          {model.model_identifier}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Cost: <span className="font-semibold text-foreground">{model.credit_cost}</span> credits
                        </p>
                        {model.tier_restriction && model.tier_restriction !== "free" && (
                          <p className="text-xs text-muted-foreground">
                            Min tier: <span className="font-semibold text-foreground">{model.tier_restriction}</span>
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(model)}
                        className="h-8 w-8 p-0"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggle(model)}
                        className="h-8"
                      >
                        {model.is_enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(model.id)}
                        className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
