/** Operator events for Admin → Video route. Never delivered through user notifications. */
import { getRuntimeEnv } from "../../lib/runtime-env.js"
import { readSettingsRowValue, updateSettingsRow } from "../../lib/video-route-policy-store.js"

export interface VideoRouteAlert {
  key: string
  kind: "price-increase" | "settlement" | "balance" | "reconciliation" | "anomaly" | "route-unavailable"
  message: string
  jobId?: string
  model?: string
  factorKey?: string
  createdAt: string
  updatedAt: string
}

const rowKey = () => `video_route_alerts:${getRuntimeEnv()}`

function alertsOf(raw: unknown): VideoRouteAlert[] {
  return Array.isArray(raw) ? raw.filter((v): v is VideoRouteAlert =>
    v !== null && typeof v === "object" && typeof v.key === "string" && typeof v.message === "string",
  ) : []
}

/** Persist before acknowledging an alert; callers can retry a failed write by its stable key. */
export async function recordVideoRouteAlert(alert: Omit<VideoRouteAlert, "createdAt" | "updatedAt">): Promise<void> {
  const now = new Date().toISOString()
  await updateSettingsRow(rowKey(), (raw) => {
    const all = alertsOf(raw)
    const previous = all.find((a) => a.key === alert.key)
    return [
      { ...alert, message: alert.message.slice(0, 2000), createdAt: previous?.createdAt ?? now, updatedAt: now },
      ...all.filter((a) => a.key !== alert.key),
    ].slice(0, 200)
  })
}

/** app_settings is admin-only under RLS; the HTTP consumer also requires requireAdmin. */
export async function readVideoRouteAlerts(): Promise<VideoRouteAlert[]> {
  return alertsOf(await readSettingsRowValue(rowKey()))
}
