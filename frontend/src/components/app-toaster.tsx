import { createPortal } from "react-dom"
import { Toaster } from "sonner"
import { KEEP_INTERACTIVE_ATTR } from "@/lib/use-inert-behind"

/**
 * The app's toasts, in a layer of their own directly under <body>, marked to
 * stay live while a full-screen editor makes the page behind it inert: a toast
 * raised during an export or an import is still announced by a screen reader
 * and its buttons still work (use-inert-behind.ts). They rise above the shared
 * header's phone bottom bar by its published height (0 without it), from
 * sonner's own offsets (24 px; 16 px on a phone).
 */
const OFFSET = { bottom: "calc(24px + var(--ns-bottom-bar-h, 0px))" }
const MOBILE_OFFSET = { bottom: "calc(16px + var(--ns-bottom-bar-h, 0px))" }

export function AppToaster() {
  return createPortal(
    <div {...{ [KEEP_INTERACTIVE_ATTR]: "" }}>
      <Toaster richColors position="bottom-right" offset={OFFSET} mobileOffset={MOBILE_OFFSET} />
    </div>,
    document.body,
  )
}
