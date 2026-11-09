/**
 * What an admin has changed about a provider's content filters, and the one
 * place it is applied (`applyProviderSafety`, called at each provider's request
 * chokepoint: `createKieTask`, `runFluxKontextTask`, `runImagePrediction`,
 * `falLipSync`).
 *
 * The setting is `app_settings.provider_safety_overrides`:
 * `{ [modelId]: { [param]: value } }`. A model with no entry is left alone, and
 * so is a request whose setting has no effect (the value is the one the request
 * already carries): with nothing changed the request is byte-identical to one
 * made before this module existed.
 *
 * LOOSENING HAS PRECONDITIONS, because a provider's filter can be all that
 * stands between a request and content that must never be made. A value looser
 * than today's request is applied only when:
 *   - a content guard is registered in this process (`lib/content-guard.ts`),
 *     which is what refuses the requests no setting may allow, AND so is a
 *     result check (`lib/result-check.ts`), because the guard reads only what
 *     was asked for and something has to look at what came back;
 *   - the model is not one that works from a real person's face or body, or
 *     that always takes an input image or video (`neverLoosen`);
 *   - this request carries no input image or video: a text check cannot see
 *     one, so such a request keeps today's filter whatever the setting says.
 * Tightening is always applied.
 */
import { kieSafetyEntryByWireModel, kieSafetyEntryByModelId, type ProviderSafetyEntry } from "../providers/kie/models.js"
import { isLooserThanToday, isLeverValue, leverToday, type SafetyLever, type SafetyValue } from "../providers/safety-levers.js"
import type { ProviderSafetyOverrides } from "./provider-safety-settings.js"
import { contentGuardRegistered } from "./provider-safety-guard-probe.js"
import { hasResultCheck } from "./result-check.js"

export { contentGuardRegistered }

/** Whether a filter may be loosened in this process at all: a guard for what is asked, and a check of what is made. */
export async function looseningAllowed(): Promise<boolean> {
  return hasResultCheck() && (await contentGuardRegistered())
}

/** A call a provider sends without our doing: not media a request carries. */
const NOT_INPUT_MEDIA_FIELD = /callback|webhook|notify/i
/** How deep a request body or job payload is read. */
const MAX_DEPTH = 8
const isMediaAddress = (value: string): boolean => /^(?:https?:|data:)/i.test(value)

/** True when a request body or job payload carries an input image, video or audio file. */
export function requestCarriesInputMedia(request: Record<string, unknown> | null | undefined): boolean {
  const walk = (value: unknown, key: string, depth: number): boolean => {
    if (typeof value === "string") return !NOT_INPUT_MEDIA_FIELD.test(key) && isMediaAddress(value)
    if (depth >= MAX_DEPTH || value === null || typeof value !== "object") return false
    if (Array.isArray(value)) return value.some((item) => walk(item, key, depth + 1))
    return Object.entries(value as Record<string, unknown>).some(([field, item]) => walk(item, field, depth + 1))
  }
  return request ? walk(request, "", 0) : false
}

/** What applying `value` to this lever means for this request: `{ apply }`, or null to keep today's request. */
export function resolveLeverChange(input: {
  readonly lever: SafetyLever
  readonly value: SafetyValue | undefined
  readonly hasInputMedia: boolean
  readonly looseningAllowed: boolean
}): { readonly apply: SafetyValue } | null {
  const { lever, value, hasInputMedia, looseningAllowed: mayLoosen } = input
  if (value === undefined || !isLeverValue(lever, value)) return null
  if (lever.wireUnconfirmed) return null
  if (value === leverToday(lever)) return null
  if (isLooserThanToday(lever, value) && (lever.neverLoosen || hasInputMedia || !mayLoosen)) return null
  return { apply: value }
}

/**
 * The stored overrides, through the settings cache. Loaded here rather than at
 * the top: a provider client sits in the import graph of a great many modules,
 * and the settings module pulls in the database client, which only a request
 * for a model with a lever ever needs.
 */
async function fromSettings(): Promise<ProviderSafetyOverrides> {
  const { getAppSettings } = await import("./app-settings.js")
  return (await getAppSettings()).provider_safety_overrides ?? {}
}

/** Where the overrides are read from. Inert until a process wires it, so a module that merely imports a provider client reads nothing. */
let overridesSource: () => Promise<ProviderSafetyOverrides> = async () => ({})

/** Every process that can send a provider request wires the real source at boot; `providers/__tests__/safety-levers.test.ts` holds it. */
export function useProviderSafetySettings(): void {
  overridesSource = fromSettings
}

/** Test hook: back to reading nothing. */
export function resetProviderSafetySourceForTests(): void {
  overridesSource = async () => ({})
}

async function overrides(): Promise<ProviderSafetyOverrides> {
  return overridesSource()
}

/**
 * Apply the admin's setting to one provider request. Returns the same object
 * when nothing applies (no copy), a copy with the changed parameter otherwise.
 *
 * Never throws: a settings hiccup keeps today's request. A failed read of the
 * row hands out empty overrides (`getAppSettings`' own fallback), the same
 * state as no setting, which never loosens anything.
 */
export async function applyProviderSafety(
  entry: ProviderSafetyEntry | null | undefined,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!entry) return input
  try {
    const params = (await overrides())[entry.modelId]
    if (!params) return input
    const mayLoosen = await looseningAllowed()
    const hasInputMedia = requestCarriesInputMedia(input)
    let next = input
    for (const lever of entry.levers) {
      const change = resolveLeverChange({ lever, value: params[lever.param], hasInputMedia, looseningAllowed: mayLoosen })
      if (change) next = { ...next, [lever.param]: change.apply }
    }
    return next
  } catch (err) {
    console.warn(`[provider-safety] could not apply the setting for ${entry.modelId}, keeping today's request: ${err instanceof Error ? err.message : String(err)}`)
    return input
  }
}

/** The KIE chokepoint's lookup: the wire model, then the caller's model key, because a key is not always threaded. */
export function kieSafetyEntry(wireModel: string, modelKey: string | null | undefined): ProviderSafetyEntry | null {
  return kieSafetyEntryByWireModel(wireModel) ?? (modelKey ? kieSafetyEntryByModelId(modelKey) : null)
}

/**
 * Whether a job runs on a model whose saved setting is looser than today's
 * request. Read at the worker's pickup, where a job's visibility is decided:
 * anything made on a loosened model is kept out of the public gallery. At the
 * model level on purpose: a run whose own request kept today's filter (it
 * carried an input image, say) is still kept private, because erring that way
 * costs nothing and a job's payload is not the request's exact body. Never
 * throws, and a failed read reads as false.
 */
export async function isLoosenedRun(entries: readonly ProviderSafetyEntry[]): Promise<boolean> {
  if (entries.length === 0) return false
  try {
    const all = await overrides()
    for (const entry of entries) {
      const params = all[entry.modelId]
      if (!params) continue
      for (const lever of entry.levers) {
        const value = params[lever.param]
        if (value === undefined || !isLeverValue(lever, value)) continue
        if (lever.neverLoosen || lever.wireUnconfirmed) continue
        if (isLooserThanToday(lever, value)) return true
      }
    }
    return false
  } catch {
    return false
  }
}
