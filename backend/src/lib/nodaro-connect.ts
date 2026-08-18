import { supabase } from "./supabase.js"
import { rememberNodaroConnected } from "./nodaro-connect-cache.js"
import { resolveProviderKey } from "./provider-keys-runtime.js"

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
    const value = typeof data.value === "string" ? safeParse(data.value) : data.value
    if (!value || typeof value !== "object") return { state: "not-connected" }
    const conn = value as NodaroConnection
    if (!conn.clientId || !conn.clientSecret || !conn.accessToken) return { state: "not-connected" }
    return { state: "connected", source: "oauth", connection: conn }
  } catch (err) {
    return { state: "unavailable", reason: err instanceof Error ? err.message : String(err) }
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
  const value = typeof data.value === "string" ? safeParse(data.value) : data.value
  if (!value || typeof value !== "object") return null
  const conn = value as NodaroConnection
  return conn.clientId && conn.clientSecret ? conn : null
}

export async function saveNodaroConnection(conn: NodaroConnection): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: NODARO_CONNECT_SETTINGS_KEY, value: conn }, { onConflict: "key" })
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
