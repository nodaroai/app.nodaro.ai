/**
 * On/off preference for Tab-auto-connect (create a node from the add-node popup
 * and auto-wire it to the focused node). Mirrors the localStorage pattern in
 * `add-node-menu-tab.ts` — try/catch so it's SSR-safe and never throws when
 * storage is unavailable. Defaults to ON when unset.
 */
export const AUTO_CONNECT_KEY = "nodaro:autoConnect"

export function getAutoConnectPref(): boolean {
  try {
    const v = localStorage.getItem(AUTO_CONNECT_KEY)
    return v === null ? true : v === "1"
  } catch {
    return true
  }
}

export function setAutoConnectPref(on: boolean): void {
  try {
    localStorage.setItem(AUTO_CONNECT_KEY, on ? "1" : "0")
  } catch {
    /* ignore */
  }
}
