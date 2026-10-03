import { getAuthHeaders } from "@/lib/api"

/**
 * What an administrator must act on before a provider stops serving users
 * (for example, a search provider running out of credits). Served on Cloud
 * by a private plugin at `GET /v1/admin/provider-alerts`; the words come from
 * the server.
 */
export interface ProviderAlert {
  readonly id: string
  readonly severity: "warning" | "error"
  /** What is wrong. */
  readonly title: string
  /** What to do about it. */
  readonly action: string
  /** When the reading behind it was taken, ISO 8601. */
  readonly checkedAt: string
}

function isProviderAlert(value: unknown): value is ProviderAlert {
  if (typeof value !== "object" || value === null) return false
  const a = value as Record<string, unknown>
  return (
    typeof a.id === "string" &&
    (a.severity === "warning" || a.severity === "error") &&
    typeof a.title === "string" &&
    typeof a.action === "string" &&
    typeof a.checkedAt === "string"
  )
}

/** The current alerts. None on a server without the route (404) or for a non-admin (403). */
export async function getProviderAlerts(): Promise<ProviderAlert[]> {
  const res = await fetch("/v1/admin/provider-alerts", { headers: await getAuthHeaders() })
  if (res.status === 404 || res.status === 403) return []
  if (!res.ok) throw new Error(`Provider alerts failed: HTTP ${res.status}`)
  const body = (await res.json()) as { alerts?: unknown }
  return Array.isArray(body.alerts) ? body.alerts.filter(isProviderAlert) : []
}
