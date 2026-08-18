/**
 * The app-managed layer of provider keys — operator-supplied, encrypted at
 * rest, mirrored into the runtime snapshot that `config.<PROVIDER>_KEY`
 * resolves through (env still wins; see lib/provider-keys-runtime.ts).
 *
 * Three processes share the DB but not memory: the API (where the operator
 * pastes a key), the worker (where generation runs) and the orchestrator.
 *   - The API applies its own writes to the snapshot immediately, so
 *     /setup reflects a save at once.
 *   - Everyone loads the store at boot with the transport retry (the same
 *     Caddy race every boot-time DB read has on the community stack) and
 *     applies ONE snapshot when the read succeeds.
 *   - The worker/orchestrator see the API's writes two ways: a TTL refresh
 *     (default 30 s, polled at a third of that so no tick is skipped), and
 *     the router's self-heal — a route that finds no provider forces one
 *     re-read (`refreshProviderCredentialsNow`) before it fails, so "paste a
 *     key, hit Run" holds without waiting for the TTL. A Redis bus can
 *     replace the poll if it ever becomes a complaint.
 * Values never leave the backend: routes report { set, source } only.
 */

import { supabase } from "./supabase.js"
import { withTransportRetry, type TransportRetryOptions } from "./boot-retry.js"
import { decryptSecret, encryptSecret, EncryptionKeyMissingError } from "./instance-cipher.js"
import {
  PROVIDER_KEY_IDS,
  applyAppSnapshot,
  getProviderKeyOverride,
  resolveProviderKey,
  resolveProviderKeyRaw,
  setProviderKeyOverrides,
  type ProviderKeyId,
  type ProviderKeyOverride,
  type ProviderKeySource,
} from "./provider-keys-runtime.js"

const TABLE = "provider_credentials"
/** One app_settings object: { [providerId]: { disabled?, ignoreEnv? } }. */
const OVERRIDES_SETTINGS_KEY = "provider_key_overrides"
export const PROVIDER_CREDENTIALS_TTL_MS = 30_000

interface Row {
  provider: string
  ciphertext: string
}

let loadedAt: number | null = null
let refreshing: Promise<boolean> | null = null

function isKnown(id: string): id is ProviderKeyId {
  return (PROVIDER_KEY_IDS as readonly string[]).includes(id)
}

async function readAll(): Promise<Row[]> {
  const { data, error } = await supabase.from(TABLE).select("provider, ciphertext")
  if (error) throw error
  return (data ?? []) as Row[]
}

function sanitizeOverrides(value: unknown): Partial<Record<ProviderKeyId, ProviderKeyOverride>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const out: Partial<Record<ProviderKeyId, ProviderKeyOverride>> = {}
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isKnown(id) || !raw || typeof raw !== "object") continue
    const o = raw as { disabled?: unknown; ignoreEnv?: unknown }
    const entry: { disabled?: boolean; ignoreEnv?: boolean } = {}
    if (o.disabled === true) entry.disabled = true
    if (o.ignoreEnv === true) entry.ignoreEnv = true
    if (entry.disabled || entry.ignoreEnv) out[id] = entry
  }
  return out
}

async function readOverridesRow(): Promise<Partial<Record<ProviderKeyId, ProviderKeyOverride>>> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", OVERRIDES_SETTINGS_KEY)
    .maybeSingle()
  if (error) throw error
  const value = typeof data?.value === "string" ? JSON.parse(data.value) : data?.value
  return sanitizeOverrides(value)
}

function decryptRows(rows: Row[]): Partial<Record<ProviderKeyId, string>> {
  const out: Partial<Record<ProviderKeyId, string>> = {}
  for (const row of rows) {
    if (!isKnown(row.provider)) continue
    try {
      out[row.provider] = decryptSecret(row.ciphertext)
    } catch {
      // A rotated/lost instance key: this row is unreadable. Say so once and
      // move on — one bad row must not hide the others or crash boot.
      console.warn(`[provider-credentials] ${row.provider}: stored key could not be decrypted (instance encryption key changed?) — re-enter it on /setup`)
    }
  }
  return out
}

/**
 * Boot: read every row and apply one snapshot. Retries transport failures on
 * the boot schedule; a missing encryption key or a store that never answers
 * degrades to "no app-managed keys" (env keys keep working) — never throws.
 */
export async function loadProviderCredentials(
  opts: TransportRetryOptions & { now?: () => number } = {},
): Promise<void> {
  const now = opts.now ?? Date.now
  try {
    const rows = await withTransportRetry("provider-credentials", readAll, opts)
    await applyAppSnapshot(decryptRows(rows))
    // Overrides ride the same boot pass — a disable set before a restart
    // must hold from the very first routing decision.
    try {
      await setProviderKeyOverrides(await readOverridesRow())
    } catch (err) {
      console.warn("[provider-credentials] could not load provider overrides:", err instanceof Error ? err.message : err)
    }
    loadedAt = now()
  } catch (err) {
    if (err instanceof EncryptionKeyMissingError) {
      console.warn("[provider-credentials] no instance encryption key — app-managed provider keys are disabled until NODARO_ENCRYPTION_KEY is set")
    } else {
      console.warn("[provider-credentials] could not load stored provider keys:", err instanceof Error ? err.message : err)
    }
  }
}

/**
 * Re-read the store when the snapshot is older than the TTL (worker path).
 * Resolves `true` when some effective key changed — after the change
 * listeners (provider registration) have settled, so the caller can act on
 * the new registry state at once. `ttlMs: 0` forces the read.
 */
export async function refreshProviderCredentialsIfStale(
  opts: { ttlMs?: number; now?: () => number } = {},
): Promise<boolean> {
  const ttl = opts.ttlMs ?? PROVIDER_CREDENTIALS_TTL_MS
  const now = opts.now ?? Date.now
  if (loadedAt !== null && now() - loadedAt < ttl) return false
  if (refreshing) return refreshing
  refreshing = (async () => {
    try {
      const changed = await applyAppSnapshot(decryptRows(await readAll()))
      const overrideChanged = await setProviderKeyOverrides(await readOverridesRow().catch(() => ({})))
      loadedAt = now()
      return changed.length > 0 || overrideChanged.length > 0
    } catch (err) {
      // Keep the last good snapshot; try again after the next TTL.
      console.warn("[provider-credentials] refresh failed, keeping last snapshot:", err instanceof Error ? err.message : err)
      loadedAt = now()
      return false
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

/**
 * The self-heal read: a route that found no provider re-reads the store once
 * so a key pasted on /setup seconds ago is registered before the job fails.
 * Bounded — a hung store must not stall a failing route — and reports
 * `false` on timeout while the read itself continues in the background.
 */
export async function refreshProviderCredentialsNow(opts: { timeoutMs?: number } = {}): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 3_000
  return Promise.race([
    refreshProviderCredentialsIfStale({ ttlMs: 0 }),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs).unref?.()),
  ])
}

/** Encrypt and store; visible in this process immediately. */
export async function setProviderCredential(id: ProviderKeyId, value: string, updatedBy: string | null): Promise<void> {
  if (!isKnown(id)) throw new Error(`unknown provider id: ${String(id)}`)
  const trimmed = value.trim()
  if (!trimmed) throw new Error("provider key is empty")
  const ciphertext = encryptSecret(trimmed)
  const { error } = await supabase
    .from(TABLE)
    .upsert({ provider: id, ciphertext, key_version: 1, updated_at: new Date().toISOString(), updated_by: updatedBy }, { onConflict: "provider" })
  if (error) throw new Error(`Failed to store ${id} key: ${error.message}`)
  await reapplyFromStore()
}

export async function clearProviderCredential(id: ProviderKeyId): Promise<void> {
  if (!isKnown(id)) throw new Error(`unknown provider id: ${String(id)}`)
  const { error } = await supabase.from(TABLE).delete().eq("provider", id)
  if (error) throw new Error(`Failed to clear ${id} key: ${error.message}`)
  await reapplyFromStore()
}

async function reapplyFromStore(): Promise<void> {
  await applyAppSnapshot(decryptRows(await readAll()))
  await setProviderKeyOverrides(await readOverridesRow().catch(() => ({})))
  loadedAt = Date.now()
}

/**
 * Merge-write one provider's override and apply it in this process at once
 * (the API path; the worker inherits via the TTL refresh above). `false`
 * values DELETE the flag so the stored object never accumulates noise.
 */
export async function setProviderOverride(
  id: ProviderKeyId,
  patch: { disabled?: boolean; ignoreEnv?: boolean },
): Promise<void> {
  if (!isKnown(id)) throw new Error(`unknown provider id: ${String(id)}`)
  const current = await readOverridesRow().catch(() => ({}) as Partial<Record<ProviderKeyId, ProviderKeyOverride>>)
  const entry: { disabled?: boolean; ignoreEnv?: boolean } = { ...current[id] }
  if (patch.disabled !== undefined) {
    if (patch.disabled) entry.disabled = true
    else delete entry.disabled
  }
  if (patch.ignoreEnv !== undefined) {
    if (patch.ignoreEnv) entry.ignoreEnv = true
    else delete entry.ignoreEnv
  }
  const next = { ...current } as Record<string, ProviderKeyOverride>
  if (entry.disabled || entry.ignoreEnv) next[id] = entry
  else delete next[id]
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: OVERRIDES_SETTINGS_KEY, value: next }, { onConflict: "key" })
  if (error) throw new Error(`Failed to store provider overrides: ${error.message}`)
  await setProviderKeyOverrides(next)
}

export interface ProviderCredentialState {
  readonly id: ProviderKeyId
  readonly set: boolean
  readonly source: ProviderKeySource | null
  readonly disabled: boolean
  readonly ignoreEnv: boolean
}

/** What the setup screen may know: set or not, from where, and the operator
 *  overrides. Presence/source come from the RAW layers so a disabled
 *  provider renders "disabled", never "missing". Never a value. */
export function listProviderCredentialStates(): ProviderCredentialState[] {
  return PROVIDER_KEY_IDS.map((id) => {
    const raw = resolveProviderKeyRaw(id)
    const override = getProviderKeyOverride(id)
    const source = override.ignoreEnv && raw?.source === "env"
      ? (resolveProviderKey(id)?.source ?? raw?.source ?? null)
      : (raw?.source ?? null)
    return {
      id,
      set: raw !== null,
      source,
      disabled: override.disabled === true,
      ignoreEnv: override.ignoreEnv === true,
    }
  })
}

export function _resetProviderCredentialsForTests(): void {
  loadedAt = null
  refreshing = null
}
