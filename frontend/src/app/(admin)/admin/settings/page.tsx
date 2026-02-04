"use client"

import { useEffect, useState } from "react"
import { Loader2, Settings, Server, Percent, Check, AlertCircle } from "lucide-react"
import { useAdmin, type AppSettings } from "@/hooks/use-admin"
import { isFeatureEnabled, EDITION } from "@/lib/edition"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export default function AdminSettingsPage() {
  const { fetchSettings, updateSetting, loading, error } = useAdmin()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [provider, setProvider] = useState<"replicate" | "kie">("replicate")
  const [markup, setMarkup] = useState<number>(25)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    fetchSettings().then((data) => {
      if (data) {
        setSettings(data)
        setProvider(data.ai_provider)
        setMarkup(data.cost_markup_percent)
      }
    })
  }, [fetchSettings])

  const handleSave = async () => {
    setSaving(true)
    setSaveSuccess(false)

    const updates: Array<{ key: string; value: unknown }> = []

    if (isFeatureEnabled("providerSelection") && provider !== settings?.ai_provider) {
      updates.push({ key: "ai_provider", value: provider })
    }

    if (isFeatureEnabled("costMarkup") && markup !== settings?.cost_markup_percent) {
      updates.push({ key: "cost_markup_percent", value: markup })
    }

    let allSuccess = true
    for (const update of updates) {
      const success = await updateSetting(update.key, update.value)
      if (!success) {
        allSuccess = false
        break
      }
    }

    if (allSuccess && updates.length > 0) {
      setSaveSuccess(true)
      // Refresh settings
      const newSettings = await fetchSettings()
      if (newSettings) {
        setSettings(newSettings)
      }
      setTimeout(() => setSaveSuccess(false), 3000)
    }

    setSaving(false)
  }

  const hasChanges =
    (isFeatureEnabled("providerSelection") && provider !== settings?.ai_provider) ||
    (isFeatureEnabled("costMarkup") && markup !== settings?.cost_markup_percent)

  if (loading && !settings) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Self-hosted edition: show message that settings are pre-configured
  if (EDITION === "self-hosted") {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <Settings className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Settings</h1>
        </div>

        <div className="border rounded-lg p-6 bg-card">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div>
              <p className="font-medium">Self-Hosted Edition</p>
              <p className="text-sm text-muted-foreground mt-1">
                Provider selection is not available in the self-hosted edition.
                All AI requests are routed through Replicate using your API token.
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Configure your Replicate API token in the <code className="bg-muted px-1 rounded">.env</code> file:
              </p>
              <pre className="mt-2 bg-muted p-2 rounded text-xs">
                REPLICATE_API_TOKEN=your_token_here
              </pre>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Settings className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Settings</h1>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* AI Provider Selection */}
        {isFeatureEnabled("providerSelection") && (
          <div className="border rounded-lg p-4 bg-card">
            <div className="flex items-center gap-2 mb-4">
              <Server className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-medium">AI Provider</h2>
            </div>

            <div className="space-y-2">
              <Label htmlFor="provider">Default Provider</Label>
              <Select value={provider} onValueChange={(v) => setProvider(v as "replicate" | "kie")}>
                <SelectTrigger id="provider" className="w-full max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="replicate">Replicate</SelectItem>
                  <SelectItem value="kie">KIE.ai</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Select the default AI provider for image and video generation.
              </p>
            </div>

            <div className="mt-4 p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground">
                <strong>Current status:</strong>{" "}
                <span className="text-foreground">
                  {settings?.ai_provider === "replicate" ? "Replicate" : "KIE.ai"}
                </span>
              </p>
            </div>
          </div>
        )}

        {/* Cost Markup */}
        {isFeatureEnabled("costMarkup") && (
          <div className="border rounded-lg p-4 bg-card">
            <div className="flex items-center gap-2 mb-4">
              <Percent className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-medium">Cost Markup</h2>
            </div>

            <div className="space-y-2">
              <Label htmlFor="markup">Markup Percentage</Label>
              <div className="flex items-center gap-2 max-w-xs">
                <Input
                  id="markup"
                  type="number"
                  min={0}
                  max={500}
                  value={markup}
                  onChange={(e) => setMarkup(Number(e.target.value))}
                  className="w-24"
                />
                <span className="text-muted-foreground">%</span>
              </div>
              <p className="text-xs text-muted-foreground">
                [formula removed]
              </p>
            </div>

            <div className="mt-4 p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground">
                <strong>Example:</strong> [formula removed] {markup}%,
                display cost will be ${(0.01 * (1 + markup / 100)).toFixed(4)}
              </p>
            </div>
          </div>
        )}

        {/* Save Button */}
        {(isFeatureEnabled("providerSelection") || isFeatureEnabled("costMarkup")) && (
          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving || !hasChanges}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
            {saveSuccess && (
              <span className="text-sm text-green-500 flex items-center gap-1">
                <Check className="h-4 w-4" />
                Settings saved
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
