import { runtimeSettingsSourceOrigin } from "@/lib/runtime-config"

/**
 * Carries a browser's saved settings to the app's pages' own host
 * (FLOW_UI_ORIGIN, with or without the move: per-origin storage stays on the
 * kept host, PUBLIC_URL, which keeps serving the pages unless they moved). On
 * the first load on the Flow host, a hidden frame of the kept host's
 * `/storage-bridge.html` hands them over; this writes only the keys that are
 * not already here, sets a flag, and removes the frame. The flag is set only
 * when the old host's storage could be read and every write here succeeded;
 * otherwise the next load asks again. Three seconds at most, and never in the
 * way of anything else. Once per browser: a setting changed on the kept host
 * afterwards stays there. On any other host, and on a deployment whose pages
 * have no host of their own, nothing runs, no frame is made and no request is
 * sent.
 *
 * The keys are the settings a person would otherwise lose: remembered node
 * settings, the org workspace, accessibility, language, recents. Never a
 * Supabase session key.
 */

export const STORAGE_BRIDGE_EXACT_KEYS: readonly string[] = [
  "nodaro-active-workspace",
  "nodaro.a11y.v1",
  "nodaro:preferred-locale",
  "nodaro:node-selection-history",
  "nodaro:heygen-recent-avatars",
  "prompt-wizard-model",
  "prompt-wizard-reasoning-effort",
  "prompt-wizard-preference",
  "theme",
]

export const STORAGE_BRIDGE_PREFIXES: readonly string[] = ["nodaro:nodeMemory:v1:"]

export const STORAGE_BRIDGE_DONE_KEY = "nodaro:storage-bridge:imported"
export const STORAGE_BRIDGE_TIMEOUT_MS = 3000

function allowed(key: string): boolean {
  return STORAGE_BRIDGE_EXACT_KEYS.includes(key) || STORAGE_BRIDGE_PREFIXES.some((prefix) => key.startsWith(prefix))
}

function importAlreadyDone(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_BRIDGE_DONE_KEY) !== null
  } catch {
    return true
  }
}

function writeMissing(keys: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(keys)) {
    if (!allowed(key) || typeof value !== "string") continue
    try {
      if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, value)
    } catch {
      return
    }
  }
  try {
    window.localStorage.setItem(STORAGE_BRIDGE_DONE_KEY, new Date().toISOString())
  } catch {
    // storage blocked: nothing to remember, nothing to retry safely either
  }
}

/** Asks the old host's bridge page for the saved settings, once per browser. Fire and forget. */
export function importLegacyStorage(timeoutMs: number = STORAGE_BRIDGE_TIMEOUT_MS): void {
  if (typeof window === "undefined") return
  const keptOrigin = runtimeSettingsSourceOrigin()
  if (keptOrigin === "" || importAlreadyDone()) return

  const frame = document.createElement("iframe")
  frame.title = "Settings import"
  frame.setAttribute("aria-hidden", "true")
  frame.style.display = "none"
  frame.src = `${keptOrigin}/storage-bridge.html`

  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    window.removeEventListener("message", onMessage)
    window.clearTimeout(timer)
    frame.remove()
  }
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== keptOrigin || event.source !== frame.contentWindow) return
    const data = event.data as { type?: unknown; readable?: unknown; keys?: unknown } | null
    if (data?.type !== "nodaro:storage-bridge" || typeof data.keys !== "object" || data.keys === null) return
    // Storage the old host could not read is not an empty one: never marked done, so the next load asks again.
    if (data.readable === true) writeMissing(data.keys as Record<string, unknown>)
    finish()
  }
  const timer = window.setTimeout(finish, timeoutMs)
  window.addEventListener("message", onMessage)
  document.body.appendChild(frame)
}
