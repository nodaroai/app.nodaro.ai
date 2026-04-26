import { useEffect } from "react"
import { create } from "zustand"

interface AltKeyState {
  pressed: boolean
  set: (pressed: boolean) => void
}

export const useAltKeyStore = create<AltKeyState>((set) => ({
  pressed: false,
  set: (pressed) => set((s) => (s.pressed === pressed ? s : { pressed })),
}))

/**
 * Mount once at the app/editor root. Tracks Alt key state in a Zustand
 * store so any component can subscribe with `useAltKeyStore((s) => s.pressed)`
 * and re-render only on actual state transitions.
 *
 * Releases on blur to avoid the flag getting stuck if the user Alt-tabs
 * away while holding it.
 */
export function useAltKeyTracker(): void {
  useEffect(() => {
    const setPressed = useAltKeyStore.getState().set
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey) setPressed(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.altKey) setPressed(false)
    }
    const onBlur = () => setPressed(false)
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("blur", onBlur)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", onBlur)
    }
  }, [])
}
