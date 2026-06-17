// frontend/src/lib/bool-pref.ts
/**
 * Shared try/catch boolean-pref helper for localStorage-backed on/off UI
 * preferences. SSR-safe — never throws when storage is unavailable. Values are
 * encoded as "1"/"0"; an unset key returns `defaultOn`.
 *
 * Single source for this pattern (previously duplicated privately in
 * auto-connect-pref.ts). New device-local toggles (e.g. inline-prompt-pref.ts)
 * build on this.
 */
export function makeBoolPref(key: string, defaultOn: boolean) {
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
