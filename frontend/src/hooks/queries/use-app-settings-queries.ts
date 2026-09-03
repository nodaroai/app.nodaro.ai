import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { isCommunity } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { getAuthHeaders } from "@/lib/api"

export interface AppSettings {
  readonly ai_provider: "replicate" | "kie"
  readonly cost_markup_percent: number
  /** Per-service margin overrides (identifier-prefix -> percent); replaces the global markup for matching identifiers. */
  readonly service_margin_percent?: Readonly<Record<string, number>>
  readonly carousel_video_autoplay: boolean
  readonly apps_page_video_autoplay: boolean
  /** The copilot runtime pause. True = serving turns. Absent row reads as true. */
  readonly copilot_enabled: boolean
  /** Which tier a new copilot thread starts on. Empty string = compiled default. */
  readonly copilot_default_tier: string
  /** Admin per-tier cap overrides: tier -> { maxIterations, maxToolCalls, wallClockMinutes }. */
  readonly copilot_tier_caps: Record<string, { maxIterations?: number; maxToolCalls?: number; wallClockMinutes?: number }>
  readonly featured_app_ids: readonly string[]
  readonly featured_apps_limit: number
  readonly apps_auto_scroll_seconds: number
  /** Marketing-email consent prompt knobs (Cloud-only). Absent on non-cloud. */
  readonly consent_enabled?: boolean
  readonly consent_cadence_hours?: number
  readonly consent_max_asks?: number
  readonly consent_withdrawn_cadence_hours?: number
  readonly consent_login_definition?: "session" | "app_open"
  readonly consent_text?: string
  readonly consent_version?: number
  /** Internal founder-notification knobs (Cloud-only). Absent on non-cloud. */
  readonly notify_digest_enabled?: boolean
  readonly notify_digest_hour?: number
  readonly notify_milestones_enabled?: boolean
  readonly notify_every_signup_enabled?: boolean
  readonly notify_slack_webhook_url?: string
  /** Admin -> user email: sends allowed per admin per UTC day (Cloud-only). */
  readonly admin_messages_daily_limit?: number
}

const DEFAULT_SETTINGS: AppSettings = {
  ai_provider: "kie",
  cost_markup_percent: 0,
  carousel_video_autoplay: true,
  apps_page_video_autoplay: true,
  copilot_enabled: true,
  copilot_default_tier: "",
  copilot_tier_caps: {},
  featured_app_ids: [],
  featured_apps_limit: 20,
  apps_auto_scroll_seconds: 4,
}

async function fetchAppSettings(): Promise<AppSettings> {
  if (isCommunity()) return DEFAULT_SETTINGS
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`/v1/admin/settings`, { headers: authHeaders })
  if (!res.ok) return DEFAULT_SETTINGS
  const data = await res.json()
  const settings = data.settings as Record<string, unknown>
  return {
    ai_provider: (settings.ai_provider as "replicate" | "kie") ?? "kie",
    cost_markup_percent: (settings.cost_markup_percent as number) ?? 0,
    carousel_video_autoplay: (settings.carousel_video_autoplay as boolean) ?? true,
    apps_page_video_autoplay: (settings.apps_page_video_autoplay as boolean) ?? true,
    copilot_enabled: (settings.copilot_enabled as boolean) ?? true,
    copilot_default_tier: (settings.copilot_default_tier as string) ?? "",
    copilot_tier_caps: (settings.copilot_tier_caps && typeof settings.copilot_tier_caps === "object"
      ? settings.copilot_tier_caps
      : {}) as AppSettings["copilot_tier_caps"],
    featured_app_ids: (Array.isArray(settings.featured_app_ids) ? settings.featured_app_ids : []) as string[],
    featured_apps_limit: (settings.featured_apps_limit as number) ?? 20,
    apps_auto_scroll_seconds: (settings.apps_auto_scroll_seconds as number) ?? 4,
    consent_enabled: (settings.consent_enabled as boolean | undefined) ?? false,
    consent_cadence_hours: (settings.consent_cadence_hours as number | undefined) ?? 24,
    consent_max_asks: (settings.consent_max_asks as number | undefined) ?? 5,
    consent_withdrawn_cadence_hours: (settings.consent_withdrawn_cadence_hours as number | undefined) ?? 720,
    consent_login_definition: (settings.consent_login_definition as "session" | "app_open" | undefined) ?? "session",
    consent_text: (settings.consent_text as string | undefined) ?? "",
    consent_version: (settings.consent_version as number | undefined) ?? 1,
    notify_digest_enabled: (settings.notify_digest_enabled as boolean | undefined) ?? true,
    notify_digest_hour: (settings.notify_digest_hour as number | undefined) ?? 8,
    notify_milestones_enabled: (settings.notify_milestones_enabled as boolean | undefined) ?? true,
    notify_every_signup_enabled: (settings.notify_every_signup_enabled as boolean | undefined) ?? false,
    notify_slack_webhook_url: (settings.notify_slack_webhook_url as string | undefined) ?? "",
    admin_messages_daily_limit: (settings.admin_messages_daily_limit as number | undefined) ?? 50,
  }
}

export function useAppSettings() {
  return useQuery({
    queryKey: queryKeys.appSettings.all,
    queryFn: fetchAppSettings,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: DEFAULT_SETTINGS,
  })
}


export function useUpdateSettingMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      const res = await fetch(`/v1/admin/settings/${key}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...await getAuthHeaders(),
        },
        body: JSON.stringify({ value }),
      })
      if (!res.ok) throw new Error("Failed to update setting")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.appSettings.all })
      qc.invalidateQueries({ queryKey: queryKeys.admin.settings() })
    },
  })
}
