/**
 * `/embed/edit-with-ai` — Edit with AI for a product that embeds the video
 * editor (Studio): the same panel the workflow editor shows beside its editor,
 * framed beside the host's.
 *
 * Three handshakes, all with the page that frames this one and no other:
 * - the session: that page hands over its sign-in (`useEmbedSessionHandoff`,
 *   first-party origins only). Until it lands nothing can start, and without
 *   one the panel says to sign in; it never redirects inside the frame.
 * - the editor: that page says what the editor can do and which videos it can
 *   give an address for (`useAiPanelHost`), and carries every edit request on
 *   to the editor, which takes commands only from the page that frames it.
 * - closing: the panel's close button asks that page to close it.
 */
import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { NODARO_AI_PANEL_CLOSE, NODARO_AI_PANEL_LAYOUT, aiPanelOffered } from "@nodaro/shared/media"
import { useAuth } from "@/hooks/use-auth"
import { useEmbedSessionHandoff } from "@/hooks/use-embed-session-handoff"
import { hasCredits } from "@/lib/edition"
import { useT, type MessageKey } from "@/lib/i18n"
import AiEditPanel from "@/ee/components/freecut-ai/ai-edit-panel"
import { useAiPanelHost } from "@/ee/components/freecut-ai/frame/use-ai-panel-host"

export default function EditWithAiFramePage() {
  const t = useT()
  const host = useAiPanelHost()
  const { awaitingHandoff } = useEmbedSessionHandoff()
  const { user, loading } = useAuth()
  const parent = useCallback(() => window.parent, [])
  const hostOrigin = host.kind === "ready" ? host.origin : null
  const close = useCallback(() => {
    if (hostOrigin) window.parent.postMessage({ type: NODARO_AI_PANEL_CLOSE, payload: {} }, hostOrigin)
  }, [hostOrigin])
  const layout = useCallback(
    (wide: boolean) => {
      if (hostOrigin) window.parent.postMessage({ type: NODARO_AI_PANEL_LAYOUT, payload: { wide } }, hostOrigin)
    },
    [hostOrigin],
  )

  // Once shown, the panel stays: a later INIT (a list that changed, an editor reloading) never
  // unmounts it, which would end a run in progress and forget what it did and what it can undo.
  const ready = host.kind === "ready" && !!user && aiPanelOffered(host.init.capabilities) && host.init.videos.length > 0
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (ready) setShown(true)
  }, [ready])

  if (!hasCredits()) return <FrameNote text={t("freecutAi.frame.unavailable")} />
  if (host.kind === "ready" && (ready || shown)) {
    // The host loaded each video under the name it sends, so the run tells them apart by it.
    return (
      <div className="flex h-dvh w-full bg-[#161616]">
        <AiEditPanel
          editorWindow={parent}
          editorOrigin={host.origin}
          videos={host.init.videos}
          openedVideoUrl={host.init.openedVideoUrl}
          matchByName
          onClose={close}
          onLayout={layout}
          project={host.init.project ?? 0}
          className="w-full"
        />
      </div>
    )
  }
  if (host.kind === "alone") return <FrameNote text={t("freecutAi.frame.openFromEditor")} />
  if (host.kind === "waiting") return <FrameNote text={t("freecutAi.frame.connecting")} busy />
  if (awaitingHandoff || loading) {
    if (!user) return <FrameNote text={t("freecutAi.frame.signingIn")} busy />
  }
  if (!user) return <FrameNote text={t("freecutAi.frame.signIn")} link={{ href: "/login", key: "freecutAi.frame.signInLink" }} />
  if (!aiPanelOffered(host.init.capabilities)) {
    return host.init.capabilities.length === 0
      ? <FrameNote text={t("freecutAi.frame.waitingEditor")} busy />
      : <FrameNote text={t("freecutAi.frame.editorTooOld")} />
  }
  return <FrameNote text={t("freecutAi.noVideo")} />
}

function FrameNote({ text, busy = false, link }: { readonly text: string; readonly busy?: boolean; readonly link?: { readonly href: string; readonly key: MessageKey } }) {
  const t = useT()
  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-3 bg-[#161616] px-6 text-center text-white" role="status">
      {busy ? <Loader2 className="h-5 w-5 animate-spin text-white/50" aria-hidden /> : null}
      <p className="text-sm leading-relaxed text-white/75">{text}</p>
      {link ? (
        <a href={link.href} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-white underline underline-offset-2">
          {t(link.key)}
        </a>
      ) : null}
    </div>
  )
}
