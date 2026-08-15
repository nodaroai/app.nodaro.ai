import { supabase } from "./supabase.js"

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
export type NodaroConnectionState =
  | { state: "connected"; connection: NodaroConnection }
  | { state: "not-connected" }
  | { state: "unavailable"; reason: string }

export async function readNodaroConnectionState(): Promise<NodaroConnectionState> {
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
    return { state: "connected", connection: conn }
  } catch (err) {
    return { state: "unavailable", reason: err instanceof Error ? err.message : String(err) }
  }
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

export async function clearNodaroConnection(): Promise<void> {
  await supabase.from("app_settings").delete().eq("key", NODARO_CONNECT_SETTINGS_KEY)
}

/** True once the instance holds a usable cloud token. */
export async function isNodaroConnected(): Promise<boolean> {
  const conn = await getNodaroConnection()
  return Boolean(conn?.accessToken)
}

/**
 * Authenticated fetch against the connected cloud. Throws when not
 * connected — callers gate on isNodaroConnected() (the provider registers
 * itself only when connected, so this is a programming-error guard).
 */
export async function nodaroCloudFetch(path: string, init?: RequestInit): Promise<Response> {
  const conn = await getNodaroConnection()
  if (!conn?.accessToken) {
    throw new Error("nodaro.ai is not connected")
  }
  return fetch(`${nodaroCloudBase()}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${conn.accessToken}`,
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
