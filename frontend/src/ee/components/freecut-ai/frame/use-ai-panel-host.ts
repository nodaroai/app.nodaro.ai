/**
 * The panel's half of the frame handshake: announce NODARO_AI_PANEL_READY to
 * the page that frames it until that page answers, and take NODARO_AI_PANEL_INIT
 * from it alone (`classifyHostMessage`). The first host to answer is the host
 * for the frame's life; its later INITs update what the panel works on.
 */
import { useEffect, useState } from "react"
import { AI_PANEL_PROTOCOL_VERSION, NODARO_AI_PANEL_READY } from "@nodaro/shared/media"
import { classifyHostMessage, type HostInit } from "@/ee/lib/freecut-ai/frame-host"

/** A host that attaches its listener late can miss the first announcement, so it repeats, a bounded number of times. */
const READY_RETRY_MS = 400
const READY_RETRY_LIMIT = 10

export type AiPanelHostState =
  | { readonly kind: "waiting" }
  /** Nobody answered: the page was opened on its own, or by a page that does not host the panel. */
  | { readonly kind: "alone" }
  | ({ readonly kind: "ready" } & HostInit)

export function useAiPanelHost(): AiPanelHostState {
  const [state, setState] = useState<AiPanelHostState>(() => (window.parent === window ? { kind: "alone" } : { kind: "waiting" }))

  useEffect(() => {
    if (window.parent === window) return
    let host: string | null = null
    let tries = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const onMessage = (event: MessageEvent) => {
      const verdict = classifyHostMessage(event, window.parent, { selfOrigin: window.location.origin })
      if (!verdict || (host !== null && verdict.origin !== host)) return
      host = verdict.origin
      clearTimeout(timer)
      setState({ kind: "ready", ...verdict })
    }
    window.addEventListener("message", onMessage)
    const announce = () => {
      if (host !== null) return
      if (tries >= READY_RETRY_LIMIT) {
        setState({ kind: "alone" })
        return
      }
      tries += 1
      // No secret rides on it, so any parent may hear it; only an allowed one is listened to.
      window.parent.postMessage({ type: NODARO_AI_PANEL_READY, payload: { version: AI_PANEL_PROTOCOL_VERSION } }, "*")
      timer = setTimeout(announce, READY_RETRY_MS)
    }
    announce()
    return () => {
      window.removeEventListener("message", onMessage)
      clearTimeout(timer)
    }
  }, [])

  return state
}
