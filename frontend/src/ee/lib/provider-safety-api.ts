import { getAuthHeaders } from "@/lib/api"

/** The server's view of provider content filters (`GET /v1/admin/provider-safety`). */

export type SafetyValue = boolean | number
export type LeverValueLock = "loosening-locked" | "never-loosen" | "wire-unconfirmed"

export interface ProviderSafetyValueOption {
  readonly value: SafetyValue
  readonly relation: "today" | "stricter" | "looser"
  readonly lock?: LeverValueLock
}

export interface ProviderSafetyLever {
  readonly param: string
  readonly kind: "boolean" | "scale"
  readonly filterOnValue?: boolean
  readonly today: SafetyValue
  readonly override: SafetyValue | null
  readonly neverLoosen: boolean
  readonly wireUnconfirmed: boolean
  readonly probePending: boolean
  readonly options: readonly ProviderSafetyValueOption[]
}

export interface ProviderSafetyModel {
  readonly modelId: string
  readonly label: string
  readonly levers: readonly ProviderSafetyLever[]
}

export interface ProviderSafetyGroup {
  readonly provider: string
  readonly label: string
  readonly models: readonly ProviderSafetyModel[]
  readonly withoutLever: readonly string[]
}

export interface ProviderSafetyView {
  readonly guardRegistered: boolean
  readonly resultCheckRegistered: boolean
  readonly updatedAt: string | null
  readonly groups: readonly ProviderSafetyGroup[]
}

export type ProviderSafetyOverrides = Record<string, Record<string, SafetyValue>>

const PATH = "/v1/admin/provider-safety"

export async function fetchProviderSafety(): Promise<ProviderSafetyView> {
  const res = await fetch(PATH, { headers: await getAuthHeaders() })
  if (!res.ok) throw new Error("Could not load the provider safety settings")
  const body = (await res.json()) as { data: ProviderSafetyView }
  return body.data
}

/** Saves the whole setting. Throws the server's own sentence when it refuses a value. */
export async function saveProviderSafety(overrides: ProviderSafetyOverrides): Promise<ProviderSafetyView> {
  const res = await fetch(PATH, {
    method: "PUT",
    headers: { ...(await getAuthHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ overrides }),
  })
  const body = (await res.json().catch(() => null)) as { data?: ProviderSafetyView; error?: { message?: string } } | null
  if (!res.ok || !body?.data) throw new Error(body?.error?.message ?? "Could not save the provider safety settings")
  return body.data
}
