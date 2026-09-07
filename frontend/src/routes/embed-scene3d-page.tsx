/**
 * `/embed/scene3d` — the stateless Scene3D preview frame.
 *
 * A host application (studio.nodaro.ai and the other thin clients) frames this
 * route to get the platform's real three.js previsualization — the SAME
 * `Scene3DPreview` + sampler the editor canvas and the MP4 export use — without
 * copying the renderer, shipping the private Remotion package, or handing the
 * host a Nodaro session.
 *
 * What makes that safe is that this page owns NOTHING:
 *
 * - No auth. It never reads a Supabase session, never sends `Authorization`,
 *   never calls `/v1`. There is no token here to leak to a hostile parent.
 * - No storage. Nothing is written to localStorage, and nothing survives a
 *   reload — the parent is the only source of truth and re-pushes on `ready`.
 * - No state machine. The scene it shows is exactly the last snapshot it
 *   ACCEPTED. Emitting an edit does not advance the local view: the parent
 *   validates the event against its own active revision and pushes the result
 *   back. A frame that moved on its own could disagree with the state that will
 *   actually be saved.
 *
 * The contract (message shapes, bounds, the ignore-vs-reject rule) lives in
 * `@/lib/scene3d/embed-protocol` and is documented publicly in
 * `docs/scene3d-embed.md`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { AlertTriangle, Boxes } from "lucide-react"
import { Scene3DPreview } from "@/components/editor/scene3d/scene3d-preview"
import { planRevisionId } from "@/lib/scene3d/plan-view"
import {
  buildScene3DEventMessage,
  buildScene3DReadyMessage,
  classifyScene3DEmbedMessage,
  isScene3DEmbedMutation,
  parseScene3DEmbedParams,
  type Scene3DEmbedEvent,
  type Scene3DEmbedState,
} from "@/lib/scene3d/embed-protocol"
import { useT } from "@/lib/i18n"

/**
 * `ready` is announced on mount, but a parent that creates the iframe and only
 * then attaches its listener can miss that first announcement — and the frame
 * has no way to know. So it repeats, on a bounded schedule, until the parent
 * says ANYTHING addressed to us (a rejected push still proves it is listening).
 * Bounded because an unanswered handshake is a broken integration, not
 * something to retry forever.
 */
const READY_RETRY_MS = 400
const READY_RETRY_LIMIT = 8

export default function EmbedScene3DPage() {
  const t = useT()
  const [searchParams] = useSearchParams()
  const params = useMemo(
    () => parseScene3DEmbedParams(searchParams.toString()),
    [searchParams],
  )

  const [state, setState] = useState<Scene3DEmbedState | null>(null)
  const [rejection, setRejection] = useState<string | null>(null)

  /** The revision the user is looking at — stamped on every outbound event. */
  const revisionId = state ? planRevisionId(state.scenePlan) ?? null : null
  const revisionRef = useRef<string | null>(null)
  revisionRef.current = revisionId

  const readOnly = state?.readOnly ?? true

  useEffect(() => {
    if (!params.ok) return
    const { parentOrigin, channel } = params
    const parent = window.parent

    // Set by ANY message that clears the transport + addressing checks, which
    // is what proves the parent's listener is attached. Deliberately not "the
    // first ACCEPTED message": a parent whose first push we refuse is still
    // there, and re-announcing readiness at it would tell it nothing new.
    let heard = false
    let attempts = 0

    const onMessage = (event: MessageEvent) => {
      const verdict = classifyScene3DEmbedMessage(
        { data: event.data, origin: event.origin, source: event.source },
        { parentOrigin, channel, expectedSource: parent },
      )
      if (verdict.kind === "ignore") return
      heard = true
      if (verdict.kind === "reject") {
        // The refused push is NOT applied. Whatever was accepted before stays on
        // screen — losing a scene the user is working in is worse than showing
        // them that the newest update did not pass.
        setRejection(verdict.reason)
        return
      }
      setRejection(null)
      setState(verdict.state)
    }

    window.addEventListener("message", onMessage)
    const announce = () => parent.postMessage(buildScene3DReadyMessage(channel), parentOrigin)
    announce()
    const timer = window.setInterval(() => {
      attempts += 1
      if (heard || attempts > READY_RETRY_LIMIT) {
        window.clearInterval(timer)
        return
      }
      announce()
    }, READY_RETRY_MS)

    return () => {
      window.removeEventListener("message", onMessage)
      window.clearInterval(timer)
    }
  }, [params])

  const emit = useCallback(
    (event: Scene3DEmbedEvent) => {
      if (!params.ok) return
      // Second half of the read-only guard. `Scene3DPreview` already withholds
      // the controls AND refuses the callbacks; this makes the FRAME incapable
      // of emitting a mutation, whatever a future caller does to the panel.
      if (readOnly && isScene3DEmbedMutation(event)) return
      window.parent.postMessage(
        buildScene3DEventMessage(params.channel, revisionRef.current, event),
        // Never `"*"`. The scene, the object ids and the revision ids all leave
        // this frame addressed to exactly one origin.
        params.parentOrigin,
      )
    },
    [params, readOnly],
  )

  if (!params.ok) {
    return (
      <Notice tone="error" title={t("embed3d.configError", { reason: params.error })} />
    )
  }

  if (!state) {
    return (
      <div className="min-h-screen bg-background p-3">
        {rejection && <RejectionBanner reason={rejection} />}
        <Notice tone="idle" title={t("embed3d.waiting")} detail={t("embed3d.waitingHint")} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-3 flex flex-col gap-2">
      {rejection && <RejectionBanner reason={rejection} />}
      {readOnly && (
        <span className="self-start rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {t("embed3d.readOnly")}
        </span>
      )}
      <Scene3DPreview
        scenePlan={state.scenePlan}
        selectedObjectIds={state.selectedObjectIds}
        lockedObjectIds={state.lockedObjectIds}
        history={state.history}
        pendingPlan={state.pendingPlan}
        isGenerating={state.isGenerating}
        readOnly={readOnly}
        onSelectionChange={(objectIds) => emit({ kind: "selection", objectIds })}
        onLockChange={(objectIds) => emit({ kind: "locks", objectIds })}
        onPlanChange={(plan, changeSummary) => emit({ kind: "plan", plan, changeSummary })}
        onRestore={(id) => emit({ kind: "restore", revisionId: id })}
        onResolvePending={(adopt) => emit({ kind: "resolve-pending", adopt })}
      />
    </div>
  )
}

function RejectionBanner({ reason }: { reason: string }) {
  const t = useT()
  return (
    <div
      role="alert"
      className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 flex items-start gap-1.5"
    >
      <AlertTriangle className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
      <p className="text-[11px] text-amber-500">{t("embed3d.rejected", { reason })}</p>
    </div>
  )
}

function Notice({ tone, title, detail }: { tone: "error" | "idle"; title: string; detail?: string }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className="flex min-h-[8rem] flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--border-primary)] bg-muted/20 p-4 text-center"
    >
      {tone === "error" ? (
        <AlertTriangle className="w-5 h-5 text-amber-500" />
      ) : (
        <Boxes className="w-5 h-5 text-muted-foreground/60" />
      )}
      <p className={`text-[11px] ${tone === "error" ? "text-amber-500" : "text-muted-foreground"}`}>{title}</p>
      {detail && <p className="text-[10px] text-muted-foreground/70">{detail}</p>}
    </div>
  )
}
