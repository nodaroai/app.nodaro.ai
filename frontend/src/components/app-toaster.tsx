import { createPortal } from "react-dom"
import { Toaster } from "sonner"
import { KEEP_INTERACTIVE_ATTR } from "@/lib/use-inert-behind"

/**
 * The app's toasts, in a layer of their own directly under <body>, marked to
 * stay live while a full-screen editor makes the page behind it inert: a toast
 * raised during an export or an import is still announced by a screen reader
 * and its buttons still work (use-inert-behind.ts).
 */
export function AppToaster() {
  return createPortal(
    <div {...{ [KEEP_INTERACTIVE_ATTR]: "" }}>
      <Toaster richColors position="bottom-right" />
    </div>,
    document.body,
  )
}
