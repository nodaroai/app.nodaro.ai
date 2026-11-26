import { getAuthHeaders } from "@/lib/api"

/** Admin → Video route (`/v1/admin/video-route`, backend/src/ee/routes/admin-video-route.ts). */
export type VideoRouteChoice = "default" | "alternate"

export interface VideoRoutePolicy {
  models: Record<string, { route: VideoRouteChoice; services?: Record<string, VideoRouteChoice> }>
  routeBalanceAlertUsd: number | null
  defaultProviderBalanceAlertCredits: number | null
  spendDriftAlertPercent: number
  failureAlert: { failures: number; windowMinutes: number }
}

export interface VideoRoutePriceFactor {
  factor: number
  updatedAt: string
  by: "auto" | "admin"
  reason?: string
}

export interface VideoRouteView {
  policy: VideoRoutePolicy
  updatedAt: string | null
  route: { present: boolean; v2: boolean }
  models: Array<{ id: string; name: string; capable: boolean }>
  services: { platform: string[]; plugin: string[] }
  /** Whether this build runs routed jobs; a model can be put on the alternate route only when it does. */
  routesPerModel: boolean
  prices: Record<string, Array<{ id: string; base: number; charged: number }>>
  factors: Record<string, VideoRoutePriceFactor>
  factorsUpdatedAt: string | null
}

const PATH = "/v1/admin/video-route"

async function send(url: string, init: RequestInit, fallback: string): Promise<VideoRouteView> {
  const res = await fetch(url, { ...init, headers: { ...(await getAuthHeaders()), ...(init.body ? { "Content-Type": "application/json" } : {}) } })
  const body = (await res.json().catch(() => null)) as { data?: VideoRouteView; error?: { message?: string } } | null
  if (!res.ok || !body?.data) throw new Error(body?.error?.message ?? fallback)
  return body.data
}

export function fetchVideoRoute(): Promise<VideoRouteView> {
  return send(PATH, { method: "GET" }, "Could not load the video route setting")
}

export function saveVideoRoutePolicy(policy: VideoRoutePolicy): Promise<VideoRouteView> {
  return send(PATH, { method: "PUT", body: JSON.stringify({ policy }) }, "Could not save the video route setting")
}

export function revertVideoRoutePolicy(): Promise<VideoRouteView> {
  return send(`${PATH}/revert`, { method: "POST" }, "Could not revert the video route setting")
}

/** Saves the whole factor table, as edited on the table read at `expectedUpdatedAt` (a newer one is refused: reload). */
export function saveVideoRouteFactors(args: { factors: Record<string, { factor: number; reason?: string }>; expectedUpdatedAt: string | null }): Promise<VideoRouteView> {
  return send(`${PATH}/factors`, { method: "PUT", body: JSON.stringify(args) }, "Could not save the price factors")
}
