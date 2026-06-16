/**
 * On/off preferences for the add-node connect flow, persisted in localStorage.
 * `makeBoolPref` is the shared try/catch boolean-pref helper — SSR-safe, never
 * throws when storage is unavailable. Mirrors the pattern in `add-node-menu-tab.ts`.
 */
function makeBoolPref(key: string, defaultOn: boolean) {
  return {
    get(): boolean {
      try {
        const v = localStorage.getItem(key)
        return v === null ? defaultOn : v === "1"
      } catch {
        return defaultOn
      }
    },
    set(on: boolean): void {
      try {
        localStorage.setItem(key, on ? "1" : "0")
      } catch {
        /* ignore */
      }
    },
  }
}

/** Tab-auto-connect: create a node from the popup and auto-wire it to the focused
 *  node. Defaults to ON. */
export const AUTO_CONNECT_KEY = "nodaro:autoConnect"
const autoConnectPref = makeBoolPref(AUTO_CONNECT_KEY, true)
export const getAutoConnectPref = autoConnectPref.get
export const setAutoConnectPref = autoConnectPref.set

/**
 * Smart Connect: when ON (and Auto Connect is ON), picking a node skips the
 * Connect dialog and auto-picks the handle + name. Only meaningful while
 * `getAutoConnectPref()` is true. Defaults to ON.
 */
export const SMART_CONNECT_KEY = "nodaro:smartConnect"
const smartConnectPref = makeBoolPref(SMART_CONNECT_KEY, true)
/**
 * Smart Connect is currently DISABLED (its toggle is hidden in the Add Node
 * popup): picking a node always opens the Connect dialog instead of silently
 * auto-wiring. We force the getter to `false` here — the single chokepoint the
 * canvas reads at pick time — so any stale `nodaro:smartConnect=1` in a user's
 * localStorage is ignored. The pref plumbing (`smartConnectPref`,
 * `setSmartConnectPref`) is intentionally kept so restoring is a one-line
 * change: swap this back to `smartConnectPref.get`.
 */
export const getSmartConnectPref = (): boolean => false
export const setSmartConnectPref = smartConnectPref.set
