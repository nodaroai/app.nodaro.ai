/**
 * The stored shape of the provider content-filter setting
 * (`app_settings.provider_safety_overrides`). A leaf: read by `app-settings.ts`
 * (which `provider-safety.ts` itself reads), so it imports nothing but a type.
 */
import type { SafetyValue } from "../providers/safety-levers.js"

export const PROVIDER_SAFETY_OVERRIDES_KEY = "provider_safety_overrides"

/** The stored setting: model id → parameter → value. */
export type ProviderSafetyOverrides = Record<string, Record<string, SafetyValue>>

/** The stored value, or an empty object when it is not an object of objects of values. */
export function parseProviderSafetyOverrides(value: unknown): ProviderSafetyOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const out: ProviderSafetyOverrides = {}
  for (const [modelId, params] of Object.entries(value as Record<string, unknown>)) {
    if (!params || typeof params !== "object" || Array.isArray(params)) continue
    const kept: Record<string, SafetyValue> = {}
    for (const [param, v] of Object.entries(params as Record<string, unknown>)) {
      if (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) kept[param] = v
    }
    if (Object.keys(kept).length > 0) out[modelId] = kept
  }
  return out
}
