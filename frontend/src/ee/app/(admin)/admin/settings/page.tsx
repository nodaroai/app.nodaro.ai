import { useState, useEffect } from "react"
import { Loader2, Settings, Server, Percent, Check, AlertCircle, Film, Plus, Trash2, Bot, Mail, Bell } from "lucide-react"
import { useAdminSettings } from "@/ee/hooks/queries/use-admin-queries"
import { useUpdateSettingMutation, type AppSettings } from "@/hooks/queries/use-app-settings-queries"
import { isFeatureEnabled, isCloud } from "@/lib/edition"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/** The compiled per-tier defaults, mirrored for the input placeholders. The
 *  authority is `backend/ee/copilot/constants.ts`; a stale placeholder here
 *  only affects the greyed hint, never the runtime cap (the resolver clamps). */
const TIER_CAP_DEFAULTS = {
  economy: { maxIterations: 10, maxToolCalls: 20, wallClockMinutes: 6 },
  standard: { maxIterations: 12, maxToolCalls: 24, wallClockMinutes: 8 },
  premium: { maxIterations: 20, maxToolCalls: 40, wallClockMinutes: 13 },
} as const

/** Upper bounds, mirroring backend `CAP_BOUNDS` (tier-settings.ts). Clamp on
 *  the way in so a stored cap can never exceed the value the resolver will
 *  honour — otherwise the panel shows a number the runtime silently caps. */
const TIER_CAP_MAX = { maxIterations: 100, maxToolCalls: 400, wallClockMinutes: 30 } as const

const TIER_ROWS = [
  { key: "economy", label: "Fast" },
  { key: "standard", label: "Smart" },
  { key: "premium", label: "Max" },
] as const

type TierCapField = "maxIterations" | "maxToolCalls" | "wallClockMinutes"
type CopilotTierCaps = Record<string, Partial<Record<TierCapField, number>>>

export default function AdminSettingsPage() {
  const { data: settings, isLoading: loading, error: queryError } = useAdminSettings()
  const updateSettingMut = useUpdateSettingMutation()
  const [provider, setProvider] = useState<"replicate" | "kie">("replicate")
  // Neutral placeholder matching the app_settings seed; the real value is
  // DB-synced on load (and Save is disabled until settings have loaded).
  const [markup, setMarkup] = useState<number>(0)
  // Per-service margin overrides, edited as rows. Which services carry their
  // own margin is runtime data (DB-only) — nothing here names a service.
  const [serviceMargins, setServiceMargins] = useState<Array<{ prefix: string; percent: number }>>([])
  const [carouselAutoplay, setCarouselAutoplay] = useState(true)
  const [appsPageAutoplay, setAppsPageAutoplay] = useState(true)
  // The copilot emergency stop. Defaults ON, matching the seed — an absent
  // row means enabled, so a fresh install shows it on.
  const [copilotEnabled, setCopilotEnabled] = useState(true)
  const [copilotDefaultTier, setCopilotDefaultTier] = useState("")
  // Sparse: only tiers/fields the admin actually changed. Blank means "use the
  // built-in default", which the backend resolver fills and clamps.
  const [tierCaps, setTierCaps] = useState<CopilotTierCaps>({})
  const setTierCap = (tier: string, field: TierCapField, value: number | undefined) =>
    setTierCaps((prev) => {
      const next: CopilotTierCaps = { ...prev, [tier]: { ...prev[tier] } }
      if (value === undefined || Number.isNaN(value)) delete next[tier]![field]
      else next[tier]![field] = Math.min(TIER_CAP_MAX[field], Math.max(1, value))
      if (Object.keys(next[tier]!).length === 0) delete next[tier]
      return next
    })
  const [appsLimit, setAppsLimit] = useState(20)
  const [autoScrollSeconds, setAutoScrollSeconds] = useState(4)
  // Marketing-email consent prompt knobs (Cloud-only).
  const [consentEnabled, setConsentEnabled] = useState(false)
  const [consentCadenceHours, setConsentCadenceHours] = useState(24)
  const [consentMaxAsks, setConsentMaxAsks] = useState(5)
  const [consentWithdrawnHours, setConsentWithdrawnHours] = useState(720)
  const [consentLoginDef, setConsentLoginDef] = useState<"session" | "app_open">("session")
  const [consentText, setConsentText] = useState("")
  const [consentVersion, setConsentVersion] = useState(1)
  // Internal founder notifications (Slack, one channel; Cloud-only).
  const [notifyDigestEnabled, setNotifyDigestEnabled] = useState(true)
  const [notifyDigestHour, setNotifyDigestHour] = useState(8)
  const [notifyMilestonesEnabled, setNotifyMilestonesEnabled] = useState(true)
  const [notifyEverySignupEnabled, setNotifyEverySignupEnabled] = useState(false)
  const [notifySlackWebhookUrl, setNotifySlackWebhookUrl] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (settings) {
      setProvider(settings.ai_provider)
      setMarkup(settings.cost_markup_percent)
      setServiceMargins(
        Object.entries(settings.service_margin_percent ?? {}).map(([prefix, percent]) => ({ prefix, percent })),
      )
      setCarouselAutoplay(settings.carousel_video_autoplay)
      setAppsPageAutoplay(settings.apps_page_video_autoplay)
      setCopilotEnabled(settings.copilot_enabled)
      setCopilotDefaultTier(settings.copilot_default_tier ?? "")
      setTierCaps((settings.copilot_tier_caps ?? {}) as CopilotTierCaps)
      setAppsLimit(settings.featured_apps_limit)
      setAutoScrollSeconds(settings.apps_auto_scroll_seconds)
      setConsentEnabled(settings.consent_enabled ?? false)
      setConsentCadenceHours(settings.consent_cadence_hours ?? 24)
      setConsentMaxAsks(settings.consent_max_asks ?? 5)
      setConsentWithdrawnHours(settings.consent_withdrawn_cadence_hours ?? 720)
      setConsentLoginDef(settings.consent_login_definition ?? "session")
      setConsentText(settings.consent_text ?? "")
      setConsentVersion(settings.consent_version ?? 1)
      setNotifyDigestEnabled(settings.notify_digest_enabled ?? true)
      setNotifyDigestHour(settings.notify_digest_hour ?? 8)
      setNotifyMilestonesEnabled(settings.notify_milestones_enabled ?? true)
      setNotifyEverySignupEnabled(settings.notify_every_signup_enabled ?? false)
      setNotifySlackWebhookUrl(settings.notify_slack_webhook_url ?? "")
    }
  }, [settings])

  // Canonical object form for diffing and saving (drops blank prefixes).
  const marginsAsObject = (rows: Array<{ prefix: string; percent: number }>) =>
    Object.fromEntries(rows.filter(r => r.prefix.trim().length > 0).map(r => [r.prefix.trim(), r.percent]))
  const marginsDirty =
    JSON.stringify(marginsAsObject(serviceMargins)) !== JSON.stringify(settings?.service_margin_percent ?? {})
  const tierCapsDirty =
    JSON.stringify(tierCaps) !== JSON.stringify(settings?.copilot_tier_caps ?? {})

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

    if (isFeatureEnabled("costMarkup") && marginsDirty) {
      updates.push({ key: "service_margin_percent", value: marginsAsObject(serviceMargins) })
    }

    if (carouselAutoplay !== settings?.carousel_video_autoplay) {
      updates.push({ key: "carousel_video_autoplay", value: carouselAutoplay })
    }

    if (appsPageAutoplay !== settings?.apps_page_video_autoplay) {
      updates.push({ key: "apps_page_video_autoplay", value: appsPageAutoplay })
    }

    if (copilotEnabled !== settings?.copilot_enabled) {
      updates.push({ key: "copilot_enabled", value: copilotEnabled })
    }

    if (copilotDefaultTier && copilotDefaultTier !== settings?.copilot_default_tier) {
      updates.push({ key: "copilot_default_tier", value: copilotDefaultTier })
    }

    if (tierCapsDirty) {
      updates.push({ key: "copilot_tier_caps", value: tierCaps })
    }

    if (appsLimit !== settings?.featured_apps_limit) {
      updates.push({ key: "featured_apps_limit", value: appsLimit })
    }

    if (autoScrollSeconds !== settings?.apps_auto_scroll_seconds) {
      updates.push({ key: "apps_auto_scroll_seconds", value: autoScrollSeconds })
    }

    if (consentEnabled !== (settings?.consent_enabled ?? false)) updates.push({ key: "consent_enabled", value: consentEnabled })
    if (consentCadenceHours !== (settings?.consent_cadence_hours ?? 24)) updates.push({ key: "consent_cadence_hours", value: consentCadenceHours })
    if (consentMaxAsks !== (settings?.consent_max_asks ?? 5)) updates.push({ key: "consent_max_asks", value: consentMaxAsks })
    if (consentWithdrawnHours !== (settings?.consent_withdrawn_cadence_hours ?? 720)) updates.push({ key: "consent_withdrawn_cadence_hours", value: consentWithdrawnHours })
    if (consentLoginDef !== (settings?.consent_login_definition ?? "session")) updates.push({ key: "consent_login_definition", value: consentLoginDef })
    if (consentText.trim() && consentText.trim() !== (settings?.consent_text ?? "")) updates.push({ key: "consent_text", value: consentText.trim() })
    if (consentVersion !== (settings?.consent_version ?? 1)) updates.push({ key: "consent_version", value: consentVersion })

    if (notifyDigestEnabled !== (settings?.notify_digest_enabled ?? true)) updates.push({ key: "notify_digest_enabled", value: notifyDigestEnabled })
    if (notifyDigestHour !== (settings?.notify_digest_hour ?? 8)) updates.push({ key: "notify_digest_hour", value: notifyDigestHour })
    if (notifyMilestonesEnabled !== (settings?.notify_milestones_enabled ?? true)) updates.push({ key: "notify_milestones_enabled", value: notifyMilestonesEnabled })
    if (notifyEverySignupEnabled !== (settings?.notify_every_signup_enabled ?? false)) updates.push({ key: "notify_every_signup_enabled", value: notifyEverySignupEnabled })
    // The webhook may legitimately be cleared to "" (turns notifications off), so
    // unlike consent_text this pushes even an empty value when it changed.
    if (notifySlackWebhookUrl.trim() !== (settings?.notify_slack_webhook_url ?? "")) updates.push({ key: "notify_slack_webhook_url", value: notifySlackWebhookUrl.trim() })

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

  // Guard on settings having loaded: before that there is nothing meaningful
  // to diff against, and saving would overwrite live values with local defaults.
  const hasChanges = settings != null && (
    (isFeatureEnabled("providerSelection") && provider !== settings.ai_provider) ||
    (isFeatureEnabled("costMarkup") && markup !== settings.cost_markup_percent) ||
    (isFeatureEnabled("costMarkup") && marginsDirty) ||
    carouselAutoplay !== settings.carousel_video_autoplay ||
    appsPageAutoplay !== settings.apps_page_video_autoplay ||
    copilotEnabled !== settings.copilot_enabled ||
    (copilotDefaultTier !== "" && copilotDefaultTier !== settings.copilot_default_tier) ||
    tierCapsDirty ||
    appsLimit !== settings.featured_apps_limit ||
    autoScrollSeconds !== settings.apps_auto_scroll_seconds ||
    consentEnabled !== (settings.consent_enabled ?? false) ||
    consentCadenceHours !== (settings.consent_cadence_hours ?? 24) ||
    consentMaxAsks !== (settings.consent_max_asks ?? 5) ||
    consentWithdrawnHours !== (settings.consent_withdrawn_cadence_hours ?? 720) ||
    consentLoginDef !== (settings.consent_login_definition ?? "session") ||
    (consentText.trim() !== "" && consentText.trim() !== (settings.consent_text ?? "")) ||
    consentVersion !== (settings.consent_version ?? 1) ||
    notifyDigestEnabled !== (settings.notify_digest_enabled ?? true) ||
    notifyDigestHour !== (settings.notify_digest_hour ?? 8) ||
    notifyMilestonesEnabled !== (settings.notify_milestones_enabled ?? true) ||
    notifyEverySignupEnabled !== (settings.notify_every_signup_enabled ?? false) ||
    notifySlackWebhookUrl.trim() !== (settings.notify_slack_webhook_url ?? "")
  )

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
                Applied to every priced model unless a service override below matches it.
              </p>
            </div>

            <div className="mt-5 space-y-2">
              <Label>Per-service margin overrides</Label>
              <p className="text-xs text-muted-foreground">
                A matching service uses its own margin <em>instead of</em> the global markup
                (longest prefix wins; a prefix matches the identifier itself or any
                <code className="bg-muted px-1 rounded mx-1">:</code>composite of it).
              </p>
              {serviceMargins.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    aria-label={`Service prefix ${i + 1}`}
                    placeholder="model identifier prefix"
                    value={row.prefix}
                    onChange={(e) =>
                      setServiceMargins(rows => rows.map((r, j) => (j === i ? { ...r, prefix: e.target.value } : r)))
                    }
                    className="flex-1 max-w-xs font-mono text-xs"
                  />
                  <Input
                    aria-label={`Service margin percent ${i + 1}`}
                    type="number"
                    min={0}
                    max={500}
                    value={row.percent}
                    onChange={(e) =>
                      setServiceMargins(rows =>
                        rows.map((r, j) =>
                          j === i ? { ...r, percent: Math.max(0, Math.min(500, Number(e.target.value) || 0)) } : r,
                        ),
                      )
                    }
                    className="w-24"
                  />
                  <span className="text-muted-foreground">%</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove service margin ${i + 1}`}
                    onClick={() => setServiceMargins(rows => rows.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setServiceMargins(rows => [...rows, { prefix: "", percent: 0 }])}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add service margin
              </Button>
            </div>
          </div>
        )}

        {/* Workflow Copilot — runtime pause. Its own card because it is not a
            display preference; it is the switch that stops an assistant that
            edits users' canvases and spends their credits, and it must read as
            a control an operator reaches for in an incident, not a checkbox
            buried among cosmetics. */}
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center gap-2 mb-4">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-medium">Workflow Copilot</h2>
          </div>

          <div className="flex items-center justify-between">
            <div className="pr-4">
              <Label htmlFor="copilot-enabled">Copilot enabled</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Turn off to stop the copilot for everyone — no restart needed.
                It takes effect within about a minute; a turn already running
                finishes, and new ones are refused with a clear message until
                you turn it back on.
              </p>
            </div>
            <Switch
              id="copilot-enabled"
              checked={copilotEnabled}
              onCheckedChange={setCopilotEnabled}
            />
          </div>

          <div className="mt-4">
            <Label htmlFor="copilot-default-tier">Default tier for new conversations</Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">
              What the copilot starts on before a user picks Fast / Smart / Max. Existing conversations keep their tier.
            </p>
            <Select value={copilotDefaultTier || "standard"} onValueChange={setCopilotDefaultTier}>
              <SelectTrigger id="copilot-default-tier" className="max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="economy">Fast (economy)</SelectItem>
                <SelectItem value="standard">Smart (standard)</SelectItem>
                <SelectItem value="premium">Max (premium)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mt-4">
            <Label>Per-tier limits</Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">
              How far one message may run on each tier before it pauses. Blank uses the built-in default. The hard cut-off is always one minute past the time limit.
            </p>
            <div className="overflow-x-auto">
              <table className="text-sm w-full max-w-lg">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="font-medium py-1 pr-3">Tier</th>
                    <th className="font-medium py-1 px-2">Steps</th>
                    <th className="font-medium py-1 px-2">Actions</th>
                    <th className="font-medium py-1 px-2">Minutes</th>
                  </tr>
                </thead>
                <tbody>
                  {TIER_ROWS.map(({ key, label }) => (
                    <tr key={key}>
                      <td className="py-1 pr-3">{label}</td>
                      {(["maxIterations", "maxToolCalls", "wallClockMinutes"] as const).map((field) => (
                        <td key={field} className="py-1 px-1">
                          <Input
                            type="number"
                            min={1}
                            max={TIER_CAP_MAX[field]}
                            aria-label={`${label} ${field}`}
                            className="h-8 w-20"
                            placeholder={String(TIER_CAP_DEFAULTS[key][field])}
                            value={tierCaps[key]?.[field] ?? ""}
                            onChange={(e) =>
                              setTierCap(key, field, e.target.value === "" ? undefined : Number(e.target.value))
                            }
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Apps Video Autoplay */}
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center gap-2 mb-4">
            <Film className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-medium">MiniApps Display</h2>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="carousel-autoplay">Auto-play videos in homepage carousel</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Hovering always plays regardless of this setting.
              </p>
            </div>
            <Switch
              id="carousel-autoplay"
              checked={carouselAutoplay}
              onCheckedChange={setCarouselAutoplay}
            />
          </div>

          <div className="flex items-center justify-between mt-3">
            <div>
              <Label htmlFor="apps-page-autoplay">Auto-play videos in MiniApps page</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Hovering always plays regardless of this setting.
              </p>
            </div>
            <Switch
              id="apps-page-autoplay"
              checked={appsPageAutoplay}
              onCheckedChange={setAppsPageAutoplay}
            />
          </div>

          <div className="mt-4 space-y-2">
            <Label htmlFor="apps-limit">MiniApps carousel limit</Label>
            <div className="flex items-center gap-2 max-w-xs">
              <Input
                id="apps-limit"
                type="number"
                min={1}
                max={50}
                value={appsLimit}
                onChange={(e) => setAppsLimit(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">MiniApps</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Maximum number of apps shown in the homepage carousel (1-50). Featured apps always appear first.
            </p>
          </div>

          <div className="mt-4 space-y-2">
            <Label htmlFor="auto-scroll">Auto-scroll interval</Label>
            <div className="flex items-center gap-2 max-w-xs">
              <Input
                id="auto-scroll"
                type="number"
                min={0}
                max={60}
                value={autoScrollSeconds}
                onChange={(e) => setAutoScrollSeconds(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">seconds</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Time between auto-scroll steps in the carousel (0 to disable). Pauses on hover.
            </p>
          </div>
        </div>

        {/* Marketing-email consent prompt (Cloud-only) */}
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center gap-2 mb-4">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-medium">Email consent prompt</h2>
          </div>

          <div className="flex items-center justify-between">
            <div className="pr-4">
              <Label htmlFor="consent-enabled">Show the consent prompt</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                When on, users who haven&apos;t answered see a dismissible prompt asking to opt in to marketing email. Off = never shown, anywhere.
              </p>
            </div>
            <Switch id="consent-enabled" checked={consentEnabled} onCheckedChange={setConsentEnabled} />
          </div>

          <div className="mt-4 space-y-2">
            <Label htmlFor="consent-text">Prompt text</Label>
            <Textarea
              id="consent-text"
              value={consentText}
              maxLength={500}
              rows={2}
              onChange={(e) => setConsentText(e.target.value)}
              placeholder="We'll email you when we ship something worth knowing about…"
            />
            <p className="text-xs text-muted-foreground">Shown under the heading. Plain text, up to 500 characters.</p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 max-w-md">
            <div className="space-y-1.5">
              <Label htmlFor="consent-cadence">Re-ask every (hours)</Label>
              <Input id="consent-cadence" type="number" min={1} max={8760} value={consentCadenceHours}
                onChange={(e) => setConsentCadenceHours(Math.max(1, Math.min(8760, Number(e.target.value) || 1)))} />
              <p className="text-xs text-muted-foreground">Users who haven&apos;t answered.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="consent-max">Max times to ask</Label>
              <Input id="consent-max" type="number" min={1} max={50} value={consentMaxAsks}
                onChange={(e) => setConsentMaxAsks(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
              <p className="text-xs text-muted-foreground">Lifetime cap, then stop. Raise it to re-open.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="consent-withdrawn">Re-ask unsubscribers (hours)</Label>
              <Input id="consent-withdrawn" type="number" min={1} max={8760} value={consentWithdrawnHours}
                onChange={(e) => setConsentWithdrawnHours(Math.max(1, Math.min(8760, Number(e.target.value) || 1)))} />
              <p className="text-xs text-muted-foreground">Users who opted out in Settings.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="consent-version">Text version</Label>
              <Input id="consent-version" type="number" min={1} value={consentVersion}
                onChange={(e) => setConsentVersion(Math.max(1, Number(e.target.value) || 1))} />
              <p className="text-xs text-muted-foreground">Bump when the copy changes materially.</p>
            </div>
          </div>

          <div className="mt-4 max-w-xs space-y-1.5">
            <Label htmlFor="consent-login-def">What counts as a &quot;login&quot;</Label>
            <Select value={consentLoginDef} onValueChange={(v) => setConsentLoginDef(v as "session" | "app_open")}>
              <SelectTrigger id="consent-login-def"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="session">Real sign-in</SelectItem>
                <SelectItem value="app_open">App open</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Cadence is time-based today; this is informational until a login counter exists.</p>
          </div>
        </div>

        {/* Internal founder notifications (Slack, one channel; Cloud-only) */}
        <div className="border rounded-lg p-4 bg-card">
          <div className="flex items-center gap-2 mb-4">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-medium">Founder notifications</h2>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notify-webhook">Slack incoming-webhook URL</Label>
            <Input
              id="notify-webhook"
              type="url"
              value={notifySlackWebhookUrl}
              onChange={(e) => setNotifySlackWebhookUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/…"
            />
            <p className="text-xs text-muted-foreground">
              All internal alerts post here — one channel. Leave empty to turn every notification below off. These never go through Loops.
            </p>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="pr-4">
              <Label htmlFor="notify-milestones">Milestone alerts</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Immediate: a user&apos;s first generation, first paid conversion, or a paid cancellation.
              </p>
            </div>
            <Switch id="notify-milestones" checked={notifyMilestonesEnabled} onCheckedChange={setNotifyMilestonesEnabled} />
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="pr-4">
              <Label htmlFor="notify-every-signup">Every signup</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Immediate ping on every new signup. Off by default — noisy once volume picks up.
              </p>
            </div>
            <Switch id="notify-every-signup" checked={notifyEverySignupEnabled} onCheckedChange={setNotifyEverySignupEnabled} />
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="pr-4">
              <Label htmlFor="notify-digest">Daily digest</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Once a day: yesterday&apos;s signups plus running totals. Silent on days with zero signups.
              </p>
            </div>
            <Switch id="notify-digest" checked={notifyDigestEnabled} onCheckedChange={setNotifyDigestEnabled} />
          </div>

          <div className="mt-4 max-w-xs space-y-1.5">
            <Label htmlFor="notify-digest-hour">Digest send hour</Label>
            <Input
              id="notify-digest-hour"
              type="number"
              min={0}
              max={23}
              value={notifyDigestHour}
              onChange={(e) => setNotifyDigestHour(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
            />
            <p className="text-xs text-muted-foreground">Hour of day, 0–23, Israel time (Asia/Jerusalem).</p>
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
