/**
 * The rendered email body, shown to the admin before they send and again in the
 * history afterwards.
 *
 * ALWAYS in a sandboxed iframe, never `dangerouslySetInnerHTML`. The HTML is
 * ours — escape-then-build on the server — but it is HTML built from text a
 * human typed, and rendering it inline would put that string in the admin
 * panel's own DOM, where a mistake in the renderer becomes a mistake in a
 * privileged page. `sandbox=""` with no tokens means no scripts, no forms, no
 * navigation, no same-origin: the frame can paint and nothing else.
 */
import { useEffect, useRef, useState } from "react"

/** Matches the email's own body styling closely enough to be a real preview. */
const FRAME_CSS = `
  body { margin: 0; padding: 16px; background: #ffffff; color: #111827;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  a { color: #4f46e5; }
  * { max-width: 100%; }
`

export function MessagePreview({
  bodyHtml,
  className,
}: {
  readonly bodyHtml: string
  readonly className?: string
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(120)

  // Grow the frame to its content so the admin sees the whole message without
  // an inner scrollbar. Read after paint, and clamped — a runaway document
  // must not push the dialog off the screen.
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const measure = () => {
      const doc = frame.contentDocument
      if (!doc?.body) return
      setHeight(Math.min(Math.max(doc.body.scrollHeight + 8, 80), 600))
    }
    frame.addEventListener("load", measure)
    // The srcdoc may already be parsed by the time the listener attaches.
    const t = window.setTimeout(measure, 0)
    return () => {
      frame.removeEventListener("load", measure)
      window.clearTimeout(t)
    }
  }, [bodyHtml])

  return (
    <iframe
      ref={frameRef}
      // No sandbox tokens at all: paint only.
      sandbox=""
      title="Email preview"
      srcDoc={`<!doctype html><meta charset="utf-8"><style>${FRAME_CSS}</style>${bodyHtml}`}
      className={className ?? "w-full rounded-md border bg-white"}
      style={{ height }}
    />
  )
}
