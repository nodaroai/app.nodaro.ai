import { useState, useEffect } from "react"
import { Loader2, Settings, Server, Percent, Check, AlertCircle, Film } from "lucide-react"
import { useAdminSettings } from "@/hooks/queries/use-admin-queries"
import { useUpdateSettingMutation, type AppSettings } from "@/hooks/queries/use-app-settings-queries"
import { isFeatureEnabled, isCloud } from "@/lib/edition"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export default function AdminSettingsPage() {
  const { data: settings, isLoading: loading, error: queryError } = useAdminSettings()
  const updateSettingMut = useUpdateSettingMutation()
  const [provider, setProvider] = useState<"replicate" | "kie">("replicate")
  const [markup, setMarkup] = useState<number>(25)
  const [videoAutoplay, setVideoAutoplay] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (settings) {
      setProvider(settings.ai_provider)
      setMarkup(settings.cost_markup_percent)
      setVideoAutoplay(settings.apps_video_autoplay)
    }
  }, [settings])

  const handleSave = async () => {
    setSaving(true)
    setSaveSuccess(false)
    setError(null)

    const updates: Array<{ key: string; value: unknown }> = []

    if (isFeatureEnabled("providerSelection") && provider !== settings?.ai_provider) {
      updates.push({ key: "ai_provider", value: provider })
    }

    if (isFeatureEnabled("costMarkup") && markup !== settings?.cost_markup_percent) {
      updates.push({ key: "cost_markup_percent", value: markup })
    }

    if (videoAutoplay !== settings?.apps_video_autoplay) {
      updates.push({ key: "apps_video_autoplay", value: videoAutoplay })
    }

    let allSuccess = true
    for (const update of updates) {
      try {
        await updateSettingMut.mutateAsync({ key: update.key, value: update.value })
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update setting")
        allSuccess = false
        break
      }
    }

    if (allSuccess && updates.length > 0) {
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    }

    setSaving(false)
  }

  const hasChanges =
    (isFeatureEnabled("providerSelection") && provider !== settings?.ai_provider) ||
    (isFeatureEnabled("costMarkup") && markup !== settings?.cost_markup_percent) ||
    videoAutoplay !== settings?.apps_video_autoplay

  if (loading && !settings) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Self-hosted edition: show message that settings are pre-configured
  if (!isCloud()) {
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
                All AI requests use your configured API token.
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Configure your API token in the <code className="bg-muted px-1 rounded">.env</code> file.
              </p>
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

      {(error || queryError) && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm">
          {error || (queryError instanceof Error ? queryError.message : "Failed to load settings")}
        </div>
      )}

      <div className="space-y-6">
        {/* AI Provider Selection — Replicate disabled
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
        */}

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

        {/* Apps Video Autoplay */}
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center gap-2 mb-4">
            <Film className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-medium">Apps Display</h2>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="video-autoplay">Auto-play preview videos</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                When enabled, app preview videos play automatically in the carousel and app cards. Hovering always plays regardless.
              </p>
            </div>
            <Switch
              id="video-autoplay"
              checked={videoAutoplay}
              onCheckedChange={setVideoAutoplay}
            />
          </div>
        </div>

        {/* Save Button */}
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
      </div>
    </div>
  )
}
