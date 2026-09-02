import { supabase } from "../../lib/supabase.js"

/**
 * Admin-tunable knobs for the internal founder notifications, stored as
 * `notify_*` rows in `app_settings` (same table + admin route as the consent
 * knobs) and read here with a 60s cache. Cloud-only ee/ code.
 *
 * Everything is dormant-safe: with no Slack webhook URL set, the sender no-ops,
 * so a fresh install / staging pre-config never posts anything.
 */
export interface NotifyConfig {
  digestEnabled: boolean
  /** Hour (0-23) in Asia/Jerusalem at which the daily digest is sent. */
  digestHour: number
  milestonesEnabled: boolean
  everySignupEnabled: boolean
  /** Slack incoming-webhook URL (the routing target). Empty = notifications off. */
  slackWebhookUrl: string
}

export const NOTIFY_CONFIG_DEFAULTS: NotifyConfig = {
  digestEnabled: true,
  digestHour: 8,
  milestonesEnabled: true,
  everySignupEnabled: false,
  slackWebhookUrl: "",
}

const CACHE_TTL_MS = 60_000
let cached: NotifyConfig | null = null
let cachedAt = 0
let inflight: Promise<NotifyConfig> | null = null

const CONFIG_KEYS = [
  "notify_digest_enabled",
  "notify_digest_hour",
  "notify_milestones_enabled",
  "notify_every_signup_enabled",
  "notify_slack_webhook_url",
] as const

export async function getNotifyConfig(): Promise<NotifyConfig> {
  const now = Date.now()
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached
  if (inflight) return inflight
  inflight = refresh()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}

async function refresh(): Promise<NotifyConfig> {
  const cfg: NotifyConfig = { ...NOTIFY_CONFIG_DEFAULTS }
  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", CONFIG_KEYS as unknown as string[])
  if (error) {
    // Missing table / read error → dormant defaults (webhook empty = off).
    cached = cfg
    cachedAt = Date.now()
    return cfg
  }
  for (const row of data ?? []) {
    const v = row.value
    switch (row.key) {
      case "notify_digest_enabled":
        if (typeof v === "boolean") cfg.digestEnabled = v
        break
      case "notify_digest_hour":
        if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23) cfg.digestHour = v
        break
      case "notify_milestones_enabled":
        if (typeof v === "boolean") cfg.milestonesEnabled = v
        break
      case "notify_every_signup_enabled":
        if (typeof v === "boolean") cfg.everySignupEnabled = v
        break
      case "notify_slack_webhook_url":
        if (typeof v === "string") cfg.slackWebhookUrl = v.trim()
        break
    }
  }
  cached = cfg
  cachedAt = Date.now()
  return cfg
}

export function invalidateNotifyConfigCache(): void {
  cached = null
  cachedAt = 0
}

// ---------------------------------------------------------------------------
// Cursors + the digest-dedup date. These are STATE, not config: read fresh
// every tick (never cached) and written back as the poller advances. Stored in
// app_settings too, but kept out of NotifyConfig so a stale 60s cache can never
// re-process or double-send.
// ---------------------------------------------------------------------------
export type NotifyStateKey =
  | "notify_signup_cursor"
  | "notify_firstgen_cursor"
  | "notify_last_digest_date"

export async function readNotifyState(key: NotifyStateKey): Promise<string | null> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle()
  if (error) return null
  const v = (data as { value?: unknown } | null)?.value
  return typeof v === "string" ? v : null
}

export async function writeNotifyState(key: NotifyStateKey, value: string): Promise<void> {
  await supabase
    .from("app_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" })
}
