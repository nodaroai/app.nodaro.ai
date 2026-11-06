/**
 * Whether `app_settings` changed since an in-memory copy of it was read: the
 * one check every app_settings cache in the backend makes before trusting
 * what it holds (getAppSettings and the config readers built like it).
 *
 * Why. The API, each worker and each replica share one database but not
 * memory. A cache that only waited out its TTL kept serving the old value for
 * up to 60 s after an admin saved through another process, so a run started
 * seconds after a save could run on the old setting.
 *
 * How. `app_settings_version` (migration 605) is one row the DATABASE moves
 * on every statement that writes app_settings (a trigger), so no writer can
 * forget it: routes, stores, scripts, a hand edit, a later migration. A cache
 * remembers the version it was read at (read BEFORE its rows, so new rows can
 * never be filed under an old number: at worst it reads once more) and reads
 * again when the number moved.
 *
 * Cost. One primary-key read per process per {@link APP_SETTINGS_VERSION_MEMO_MS},
 * shared by every concurrent caller and every cache; the settings themselves
 * are read again only when the version moved. A save is seen by every other
 * process within that window; the process that saved drops its caches at
 * once (`invalidateSettingsCache` → {@link forgetAppSettingsVersion}).
 *
 * Failure. A version that cannot be read (no table yet: staging runs dev code
 * on the production database before a migration reaches main; an error; a
 * hang past {@link APP_SETTINGS_VERSION_READ_TIMEOUT_MS}; any answer that is
 * not a whole number) reads as null, and a cache then trusts what it holds
 * until its own TTL, exactly as before the version existed. Logged once per
 * run of failures, never per call.
 */
import { supabase } from "./supabase.js"

/** The table migration 605 creates. */
export const APP_SETTINGS_VERSION_TABLE = "app_settings_version"

/** How long this process trusts a version it read: how soon a save made elsewhere is seen. */
export const APP_SETTINGS_VERSION_MEMO_MS = 1_000

/** A version read slower than this counts as unreadable: the caller is not held up by a slow database. */
export const APP_SETTINGS_VERSION_READ_TIMEOUT_MS = 1_500

let memo: { version: number; at: number } | null = null
let inflight: Promise<number | null> | null = null
/** Moves with every {@link forgetAppSettingsVersion}: a read it overtook is used once, never remembered. */
let generation = 0
let unreadableLogged = false

function withTimeout<T>(work: () => PromiseLike<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    const settle = (value: T | null) => {
      clearTimeout(timer)
      resolve(value)
    }
    try {
      Promise.resolve(work()).then(settle, () => settle(null))
    } catch {
      settle(null)
    }
  })
}

async function readVersion(): Promise<number | null> {
  const answer = await withTimeout(
    () => supabase.from(APP_SETTINGS_VERSION_TABLE).select("version").eq("id", 1).maybeSingle(),
    APP_SETTINGS_VERSION_READ_TIMEOUT_MS,
  )
  const result = answer as { data?: unknown; error?: { message?: string } | null } | null
  const version = result && !result.error ? (result.data as { version?: unknown } | null)?.version : undefined
  if (typeof version === "number" && Number.isSafeInteger(version)) {
    unreadableLogged = false
    return version
  }
  if (!unreadableLogged) {
    unreadableLogged = true
    const why = result?.error?.message ?? (result === null ? "no answer in time" : "no version row")
    console.warn(`[app-settings] could not read ${APP_SETTINGS_VERSION_TABLE} (${why}); settings caches fall back to their TTL`)
  }
  return null
}

/** The current app_settings version, or null when it cannot be read. Never throws. */
export async function appSettingsVersion(): Promise<number | null> {
  if (memo && Date.now() - memo.at < APP_SETTINGS_VERSION_MEMO_MS) return memo.version
  if (inflight) return inflight
  const before = generation
  const read = readVersion().then((version) => {
    if (version !== null && generation === before) memo = { version, at: Date.now() }
    return version
  })
  inflight = read
  try {
    return await read
  } finally {
    if (inflight === read) inflight = null
  }
}

/**
 * True when the settings may have changed since a cache read them at
 * `readAt` (the {@link appSettingsVersion} it took before reading its rows).
 * False while the version cannot be read: the cache's own TTL decides then.
 * A cache read while the version was unreadable (`readAt` null) is read again
 * once the version can be read.
 */
export async function appSettingsChangedSince(readAt: number | null): Promise<boolean> {
  const current = await appSettingsVersion()
  if (current === null) return false
  return current !== readAt
}

/** This process wrote app_settings: the next check reads the version at once. */
export function forgetAppSettingsVersion(): void {
  generation += 1
  memo = null
  inflight = null
}
