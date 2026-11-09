/**
 * The admin side of the provider content-filter setting: the view the page
 * renders and the one write, with the rules a write must satisfy. Lives in ee/
 * like the admin routes that call it; the core chokepoints read the setting
 * through `lib/provider-safety.ts`.
 */
import { getModel } from "@nodaro/shared/model-catalog"
import { supabase } from "../../lib/supabase.js"
import { invalidateSettingsCache } from "../../lib/app-settings.js"
import { PROVIDER_SAFETY_OVERRIDES_KEY, parseProviderSafetyOverrides, type ProviderSafetyOverrides } from "../../lib/provider-safety-settings.js"
import { contentGuardRegistered } from "../../lib/provider-safety.js"
import { hasResultCheck } from "../../lib/result-check.js"
import { providerSafetyGroups, type ProviderSafetyEntry, type SafetyProviderId } from "../../providers/safety-entries.js"
import { isLeverValue, isLooserThanToday, leverToday, type SafetyLever, type SafetyValue } from "../../providers/safety-levers.js"

/** Why a value cannot be chosen. Shown as the reason on the page. */
export type LeverValueLock = "loosening-locked" | "never-loosen" | "wire-unconfirmed"

export interface ProviderSafetyValueOption {
  readonly value: SafetyValue
  /** How this value compares with today's request. */
  readonly relation: "today" | "stricter" | "looser"
  /** Present when this value cannot be chosen right now. */
  readonly lock?: LeverValueLock
}

export interface ProviderSafetyLeverView {
  readonly param: string
  readonly kind: SafetyLever["kind"]
  /** For a boolean lever: the value that means the filter is on. */
  readonly filterOnValue?: boolean
  readonly today: SafetyValue
  /** The saved value for this model, if any. */
  readonly override: SafetyValue | null
  readonly neverLoosen: boolean
  readonly wireUnconfirmed: boolean
  readonly probePending: boolean
  /** Every value this lever accepts, each marked against today's request. */
  readonly options: readonly ProviderSafetyValueOption[]
}

export interface ProviderSafetyModelView {
  readonly modelId: string
  readonly label: string
  readonly levers: readonly ProviderSafetyLeverView[]
}

export interface ProviderSafetyGroupView {
  readonly provider: SafetyProviderId
  readonly label: string
  readonly models: readonly ProviderSafetyModelView[]
  /** How many of this provider's models expose no filter setting, and which. */
  readonly withoutLever: readonly string[]
}

export interface ProviderSafetyView {
  /** Loosening is locked unless both of these are true. */
  readonly guardRegistered: boolean
  readonly resultCheckRegistered: boolean
  readonly groups: readonly ProviderSafetyGroupView[]
  readonly updatedAt: string | null
}

function valuesOf(lever: SafetyLever): readonly SafetyValue[] {
  if (lever.kind === "boolean") return [lever.filterOnValue, !lever.filterOnValue]
  const out: number[] = []
  for (let v = lever.min; v <= lever.max; v += 1) out.push(v)
  return out
}

function relationOf(lever: SafetyLever, value: SafetyValue): ProviderSafetyValueOption["relation"] {
  if (value === leverToday(lever)) return "today"
  return isLooserThanToday(lever, value) ? "looser" : "stricter"
}

function lockOf(lever: SafetyLever, value: SafetyValue, mayLoosen: boolean): LeverValueLock | undefined {
  if (value === leverToday(lever)) return undefined
  if (lever.wireUnconfirmed) return "wire-unconfirmed"
  if (!isLooserThanToday(lever, value)) return undefined
  if (lever.neverLoosen) return "never-loosen"
  return mayLoosen ? undefined : "loosening-locked"
}

function leverView(lever: SafetyLever, override: SafetyValue | undefined, mayLoosen: boolean): ProviderSafetyLeverView {
  return {
    param: lever.param,
    kind: lever.kind,
    ...(lever.kind === "boolean" ? { filterOnValue: lever.filterOnValue } : {}),
    today: leverToday(lever),
    override: override ?? null,
    neverLoosen: lever.neverLoosen === true,
    wireUnconfirmed: lever.wireUnconfirmed === true,
    probePending: lever.probePending === true,
    options: valuesOf(lever).map((value) => {
      const lock = lockOf(lever, value, mayLoosen)
      return { value, relation: relationOf(lever, value), ...(lock ? { lock } : {}) }
    }),
  }
}

function modelView(entry: ProviderSafetyEntry, overrides: ProviderSafetyOverrides, mayLoosen: boolean): ProviderSafetyModelView {
  const saved = overrides[entry.modelId] ?? {}
  return {
    modelId: entry.modelId,
    label: getModel(entry.modelId)?.label ?? entry.modelId,
    levers: entry.levers.map((lever) => leverView(lever, saved[lever.param], mayLoosen)),
  }
}

export async function readProviderSafetyRow(): Promise<{ overrides: ProviderSafetyOverrides; updatedAt: string | null }> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value, updated_at")
    .eq("key", PROVIDER_SAFETY_OVERRIDES_KEY)
    .maybeSingle()
  if (error) throw new Error(`Could not read ${PROVIDER_SAFETY_OVERRIDES_KEY}: ${error.message}`)
  const row = data as { value?: unknown; updated_at?: string | null } | null
  return { overrides: parseProviderSafetyOverrides(row?.value), updatedAt: row?.updated_at ?? null }
}

export async function providerSafetyView(): Promise<ProviderSafetyView> {
  const [{ overrides, updatedAt }, guardRegistered] = await Promise.all([readProviderSafetyRow(), contentGuardRegistered()])
  const resultCheckRegistered = hasResultCheck()
  const mayLoosen = guardRegistered && resultCheckRegistered
  return {
    guardRegistered,
    resultCheckRegistered,
    updatedAt,
    groups: providerSafetyGroups().map((group) => ({
      provider: group.provider,
      label: group.label,
      models: group.entries.map((entry) => modelView(entry, overrides, mayLoosen)),
      withoutLever: group.withoutLever,
    })),
  }
}

export class ProviderSafetyError extends Error {
  constructor(
    readonly code: "unknown_model" | "unknown_setting" | "invalid_value" | "loosening_locked" | "never_loosen" | "wire_unconfirmed",
    message: string,
  ) {
    super(message)
    this.name = "ProviderSafetyError"
  }
}

/**
 * The stored form of a save: every entry checked against the levers, values
 * equal to today's request dropped (they change nothing), and loosening refused
 * unless both a content guard and a result check are registered.
 */
export function validateProviderSafetySave(
  requested: Record<string, Record<string, unknown>>,
  mayLoosen: boolean,
): ProviderSafetyOverrides {
  const leversByModel = new Map(providerSafetyGroups().flatMap((g) => g.entries).map((e) => [e.modelId, e.levers] as const))
  const stored: ProviderSafetyOverrides = {}
  for (const [modelId, params] of Object.entries(requested)) {
    const levers = leversByModel.get(modelId)
    if (!levers) throw new ProviderSafetyError("unknown_model", `Model "${modelId}" has no content-filter setting.`)
    for (const [param, value] of Object.entries(params)) {
      const lever = levers.find((l) => l.param === param)
      if (!lever) throw new ProviderSafetyError("unknown_setting", `Model "${modelId}" has no "${param}" setting.`)
      if (!isLeverValue(lever, value)) throw new ProviderSafetyError("invalid_value", `That value is not allowed for ${param}.`)
      if (value === leverToday(lever)) continue
      if (lever.wireUnconfirmed) throw new ProviderSafetyError("wire_unconfirmed", `${param} on ${modelId} cannot be changed until a test run has confirmed it.`)
      if (isLooserThanToday(lever, value)) {
        if (lever.neverLoosen) throw new ProviderSafetyError("never_loosen", `${modelId} is never loosened.`)
        if (!mayLoosen) throw new ProviderSafetyError("loosening_locked", "Loosening a filter needs both a content guard and a result check, and this deployment does not have both.")
      }
      stored[modelId] = { ...stored[modelId], [param]: value }
    }
  }
  return stored
}

/** Every save of this deployment-wide setting is filed under this fixed id. */
export const PROVIDER_SAFETY_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a0f7"

/** One `admin_actions` row. Throws when it cannot be written, so a caller can refuse rather than let a change stand unaudited. */
export async function recordProviderSafetyChange(
  adminId: string,
  action: "update_provider_safety" | "update_provider_safety_failed",
  before: ProviderSafetyOverrides,
  after: ProviderSafetyOverrides,
): Promise<void> {
  const { error } = await supabase.from("admin_actions").insert({
    admin_user_id: adminId,
    action,
    target_type: "app_setting",
    target_id: PROVIDER_SAFETY_AUDIT_TARGET,
    payload: { key: PROVIDER_SAFETY_OVERRIDES_KEY, before, after },
  })
  if (error) throw new Error(`Could not write the audit row: ${error.message}`)
}

export async function saveProviderSafetyRow(overrides: ProviderSafetyOverrides, adminId: string): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: PROVIDER_SAFETY_OVERRIDES_KEY, value: overrides, updated_at: new Date().toISOString(), updated_by: adminId }, { onConflict: "key" })
  if (error) throw new Error(`Could not save ${PROVIDER_SAFETY_OVERRIDES_KEY}: ${error.message}`)
  invalidateSettingsCache()
}
