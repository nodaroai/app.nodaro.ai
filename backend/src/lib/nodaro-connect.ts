import { supabase } from "./supabase.js"
import { rememberNodaroConnected } from "./nodaro-connect-cache.js"
import { resolveProviderKey } from "./provider-keys-runtime.js"
import { decryptSecret, encryptSecret, EncryptionKeyMissingError } from "./instance-cipher.js"

/**
 * Community cloud-connect — instance-side connection store (Phase 4a).
 *
 * A self-hosted community instance connects to Nodaro Cloud via the OAuth
 * flow (design doc 2026-08-12, checkpoint 2 = option B): it self-registers
 * once through the cloud's DCR endpoint (software_id nodaro-community),
 * then completes the authorize flow; the resulting `ndr_app_` token is the
 * instance credential. Everything lives server-side under ONE app_settings
 * key — the token never reaches a browser (the frontend talks to the
 * instance's own /v1/nodaro-connect/* routes, which proxy the cloud).
 *
 * Community instances are single-operator by design; app_settings is the
 * same trust domain as the instance's provider API keys.
 */

export const NODARO_CONNECT_SETTINGS_KEY = "nodaro_cloud_connection"

/** Default cloud host; overridable for staging soaks via env. */
export function nodaroCloudBase(): string {
  return process.env.NODARO_CLOUD_URL || "https://app.nodaro.ai"
}

export interface NodaroConnection {
  clientId: string
  clientSecret: string
  /** Set once the OAuth flow completes; absent = registration started only. */
  accessToken?: string
  connectedAt?: string
}

/**
 * The connection store, read without collapsing "could not read" into "not
 * connected". Boot-time provider registration must RETRY on `unavailable`
 * (the worker's first read races the container's own proxy on the community
 * stack) and STOP on `not-connected`; treating both as null is what left the
 * cloud provider unregistered on every boot.
 */
/** How the instance authenticates to the cloud: the OAuth flow's stored
 *  `ndr_app_` token, or a personal API token — from the environment ("env")
 *  or pasted on /setup ("app"). The env/app distinction is load-bearing for
 *  the UI: tiles lock editing for env-managed keys, so reporting a pasted
 *  key as "env" made it impossible to Remove/Change (#4b review — the
 *  founder hit it live). */
export type NodaroCredentialSource = "oauth" | "env" | "app"

export type NodaroConnectionState =
  | { state: "connected"; source: "oauth"; connection: NodaroConnection }
  | { state: "connected"; source: "env" | "app" }
  | { state: "not-connected" }
  | { state: "unavailable"; reason: string }

/**
 * The key-lane credential with its TRUE layer. config.NODARO_API_KEY is a
 * getter over the same resolution (env first, then app) but erases which
 * layer answered — read the runtime directly so the source stays honest.
 */
function keyLaneApiKey(): { value: string; source: "env" | "app" } | null {
  const resolved = resolveProviderKey("nodaro")
  if (!resolved) return null
  const value = resolved.value.trim()
  return value.length > 0 ? { value, source: resolved.source } : null
}

/**
 * Connection state with the env key folded in. A stored OAuth connection wins
 * — it carries per-instance spend caps and Connected Instances visibility on
 * the cloud; the env key is a plain personal credential. With an env key set,
 * an UNREADABLE store still reads as connected: nothing about that credential
 * lives in the database, so boot-time registration has nothing to wait for.
 */
export async function readNodaroConnectionState(): Promise<NodaroConnectionState> {
  const stored = await readStoredConnectionState()
  // Both #768 and #777 meet here: the key lane reports its TRUE layer
  // (env|app — the tile-lock fix), and the resolved state feeds the sync
  // last-known cache (nodaro-connect-cache.ts) for consumers that cannot
  // await. An `unavailable` read teaches the cache nothing (could not
  // read ≠ not connected).
  const key = keyLaneApiKey()
  const resolved: NodaroConnectionState =
    stored.state === "connected"
      ? stored
      : key
        ? { state: "connected", source: key.source }
        : stored
  if (resolved.state === "connected") rememberNodaroConnected(true)
  else if (resolved.state === "not-connected") rememberNodaroConnected(false)
  return resolved
}

async function readStoredConnectionState(): Promise<NodaroConnectionState> {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", NODARO_CONNECT_SETTINGS_KEY)
      .maybeSingle()
    if (error) return { state: "unavailable", reason: error.message }
    if (!data?.value) return { state: "not-connected" }
    // A sealed row the cipher cannot open (key lost, restored without the
    // app-data volume) throws here and lands in the catch below as
    // `unavailable` — "could not read", never "not connected".
    const { conn, legacy } = unsealConnection(data.value)
    if (!conn) return { state: "not-connected" }
    if (!conn.clientId || !conn.clientSecret || !conn.accessToken) return { state: "not-connected" }
    // This is the read every status check and boot registration goes
    // through — the one an install that connected before #864 actually
    // performs — so the legacy row is re-sealed HERE, not only from the
    // connect routes. Awaited (its own try/catch; the read never fails
    // because the write did): a fire-and-forget upsert would race whatever
    // the caller writes next.
    if (legacy) await resealLegacyConnection(conn)
    return { state: "connected", source: "oauth", connection: conn }
  } catch (err) {
    return { state: "unavailable", reason: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Stored shape of the connection row since #864: the registration + tokens
 * sealed with the instance cipher, the same AES-256-GCM key that guards the
 * pasted provider keys one table over. Before this the row was plaintext JSON
 * — a `clientSecret` and a live credit-spending `accessToken` readable by
 * anyone holding a DB dump, beside provider keys that were ciphertext to them.
 * `sealed` is the envelope version; the plaintext era is version 1 in spirit
 * and has no marker at all.
 */
interface SealedConnection {
  readonly sealed: 2
  readonly ciphertext: string
}

function isSealed(value: unknown): value is SealedConnection {
  return (
    !!value &&
    typeof value === "object" &&
    (value as SealedConnection).sealed === 2 &&
    typeof (value as SealedConnection).ciphertext === "string"
  )
}

/**
 * Decode a stored row value — the sealed envelope OR the legacy plaintext
 * object (rows written before #864 must keep opening; `legacy` tells the
 * reader to re-seal them). Throws when a sealed row cannot be opened, with a
 * reason an operator can act on.
 */
function unsealConnection(raw: unknown): { conn: NodaroConnection | null; legacy: boolean } {
  const value = typeof raw === "string" ? safeParse(raw) : raw
  if (!value || typeof value !== "object") return { conn: null, legacy: false }
  if ("sealed" in value) {
    // Anything that CLAIMS to be sealed is handled here. An envelope from a
    // newer version, or a damaged one, must surface as unreadable — falling
    // through to "legacy plaintext" would read as not-connected, and /start
    // would register a fresh client over the row (#708's cap, again).
    if (!isSealed(value)) {
      throw new Error(`unrecognized sealed connection envelope (sealed=${String((value as { sealed: unknown }).sealed)})`)
    }
    let plaintext: string
    try {
      plaintext = decryptSecret(value.ciphertext)
    } catch (err) {
      throw new Error(
        "the stored nodaro.ai connection cannot be decrypted — the instance encryption key is not the one that " +
          "wrote it (restored without the app-data volume, or NODARO_ENCRYPTION_KEY changed): " +
          (err instanceof Error ? err.message : String(err)),
      )
    }
    const inner = safeParse(plaintext)
    return { conn: inner && typeof inner === "object" ? (inner as NodaroConnection) : null, legacy: false }
  }
  return { conn: value as NodaroConnection, legacy: true }
}

let warnedPlaintextOnce = false

/**
 * Seal for storage. Without an instance key there is nothing to seal with:
 * the row is written as before (plaintext) so Connect keeps working on a
 * misconfigured install, and the condition is logged once — the setup screen
 * already flags the missing key for the provider-credentials path. A key
 * that is PRESENT but malformed is a different thing: that throws, the same
 * way provider-credentials refuses to store under it.
 */
function sealConnection(conn: NodaroConnection): SealedConnection | NodaroConnection {
  try {
    return { sealed: 2, ciphertext: encryptSecret(JSON.stringify(conn)) }
  } catch (err) {
    if (!(err instanceof EncryptionKeyMissingError)) throw err
    if (!warnedPlaintextOnce) {
      warnedPlaintextOnce = true
      console.warn("[nodaro-connect] no instance encryption key — storing the cloud connection unencrypted (set NODARO_ENCRYPTION_KEY)")
    }
    return conn
  }
}

/**
 * Lazy migration: re-write a plaintext row sealed, the first time it is read
 * with a key available. Best-effort — never throws — and AWAITED by callers
 * so it can't land after a write the caller makes next (disconnect strips
 * the token; a straggling re-seal of the full row would put it back).
 */
async function resealLegacyConnection(conn: NodaroConnection): Promise<void> {
  try {
    const sealed = sealConnection(conn)
    if (sealed === conn) return // no key — nothing to migrate to
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: NODARO_CONNECT_SETTINGS_KEY, value: sealed }, { onConflict: "key" })
    if (error) throw new Error(error.message)
  } catch (err) {
    console.warn("[nodaro-connect] could not re-seal the legacy connection row:", err instanceof Error ? err.message : String(err))
  }
}

/**
 * The bearer token to CALL the cloud with, and where it came from. This is
 * what nodaroCloudFetch and every "is the instance connected" check use.
 * Deliberately NOT getNodaroConnection(): that one is the OAuth
 * REGISTRATION (client id/secret) the connect routes need, and an env key
 * must never masquerade as a registration.
 */
export async function getNodaroCredential(): Promise<{ token: string; source: NodaroCredentialSource } | null> {
  const state = await readNodaroConnectionState()
  if (state.state !== "connected") return null
  if (state.source === "oauth") return { token: state.connection.accessToken!, source: "oauth" }
  const key = keyLaneApiKey()
  if (!key) return null
  return { token: key.value, source: key.source }
}

/**
 * The stored registration/connection, or null. Null covers BOTH "nothing
 * stored" and "store unreachable" — callers that must tell those apart use
 * readNodaroConnectionState(). Unlike that reader, this returns a
 * registration that has not finished the OAuth flow yet (no accessToken),
 * which the connect routes need to resume it.
 */
export async function getNodaroConnection(): Promise<NodaroConnection | null> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", NODARO_CONNECT_SETTINGS_KEY)
    .maybeSingle()
  if (error) {
    console.error("[nodaro-connect] connection read failed:", error.message)
    return null
  }
  if (!data?.value) return null
  let decoded: ReturnType<typeof unsealConnection>
  try {
    decoded = unsealConnection(data.value)
  } catch (err) {
    console.error("[nodaro-connect] connection row cannot be decrypted:", err instanceof Error ? err.message : String(err))
    return null
  }
  const conn = decoded.conn
  if (!conn || !conn.clientId || !conn.clientSecret) return null
  if (decoded.legacy) await resealLegacyConnection(conn)
  return conn
}

export async function saveNodaroConnection(conn: NodaroConnection): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: NODARO_CONNECT_SETTINGS_KEY, value: sealConnection(conn) }, { onConflict: "key" })
  if (error) throw new Error(`Failed to save Nodaro connection: ${error.message}`)
}

/**
 * Disconnect: drop the tokens, KEEP the instance's DCR client
 * (`clientId`/`clientSecret`). Registration is per instance, not per session
 * — the next Connect must reuse it, not mint another one on the cloud. It
 * used to delete the whole record, so every disconnect/reconnect cycle
 * registered a fresh client and each of those counted against the cloud's
 * open-registration cap; five in a day locked the install out (#708).
 *
 * `readNodaroConnectionState` already reads "client but no accessToken" as
 * not-connected, and every proxy checks `accessToken`, so nothing downstream
 * mistakes the kept client for a live connection.
 */
export async function clearNodaroConnection(): Promise<void> {
  const conn = await getNodaroConnection()
  if (!conn) return
  const { accessToken: _t, connectedAt: _c, ...client } = conn
  await saveNodaroConnection(client)
}

/** Forget the instance's DCR client too — only for a full reset (tests, a wipe). */
export async function forgetNodaroClient(): Promise<void> {
  await supabase.from("app_settings").delete().eq("key", NODARO_CONNECT_SETTINGS_KEY)
}

/** True once the instance holds a usable cloud token. */
export async function isNodaroConnected(): Promise<boolean> {
  return (await getNodaroCredential()) !== null
}

/**
 * Authenticated fetch against the connected cloud. Throws when not
 * connected — callers gate on isNodaroConnected() (the provider registers
 * itself only when connected, so this is a programming-error guard).
 */
export async function nodaroCloudFetch(path: string, init?: RequestInit): Promise<Response> {
  const credential = await getNodaroCredential()
  if (!credential) {
    throw new Error("nodaro.ai is not connected")
  }
  return fetch(`${nodaroCloudBase()}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${credential.token}`,
      "Content-Type": "application/json",
    },
  })
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Routing prefs (4b): how the credential participates in provider routing.
// Stored in app_settings ("nodaro_provider_prefs", written by the
// post-connect choice dialog); ABSENT = the legacy default — scope "all",
// precedence "local" — so installs that connected before the dialog existed
// keep routing byte-identically until they make a choice.
// ---------------------------------------------------------------------------
import { getAppSettings, type NodaroProviderPrefs } from "./app-settings.js"

export const LEGACY_NODARO_PREFS: NodaroProviderPrefs = { scope: "all", precedence: "local" }

/** The effective prefs — explicit row, else the legacy default. Rides
 *  getAppSettings' 60s cache; call sites add no DB reads. */
export async function getNodaroProviderPrefs(): Promise<NodaroProviderPrefs> {
  const settings = await getAppSettings().catch(() => null)
  return settings?.nodaro_provider_prefs ?? LEGACY_NODARO_PREFS
}
