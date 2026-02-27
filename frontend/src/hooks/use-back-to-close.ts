import { useEffect, useRef } from "react"

/**
 * Push a history entry when `open` becomes true so that pressing
 * the mobile back button/gesture closes the modal instead of
 * navigating away from the page.
 */
export function useBackToClose(open: boolean, onClose: () => void) {
  const pushed = useRef(false)

  useEffect(() => {
    if (open && !pushed.current) {
      // Push a dummy state so "back" has somewhere to go
      window.history.pushState({ modal: true }, "")
      pushed.current = true
    }

    if (!open && pushed.current) {
      pushed.current = false
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    const handlePopState = () => {
      // Back was pressed — close the modal instead of navigating
      pushed.current = false
      onClose()
    }

    window.addEventListener("popstate", handlePopState)
    return () => {
      window.removeEventListener("popstate", handlePopState)
      // If the modal closes programmatically (not via back), remove the
      // extra history entry we pushed so the stack stays clean.
      if (pushed.current) {
        pushed.current = false
        window.history.back()
      }
    }
  }, [open, onClose])
}
