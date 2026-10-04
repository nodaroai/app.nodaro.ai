/**
 * The Copilot rail.
 *
 * A fixed 380px column on the left of the canvas — the right edge already
 * belongs to the config and pipeline panels. The panel is a view: the turn it
 * displays is owned by the module-level engine, so closing this panel, or
 * switching to the Present tab, does not cancel work in flight.
 *
 * Lazy-loaded through a core shim (`copilot-panel-slot.tsx`); this file and
 * everything it imports never reach a community build.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { COPILOT_RAIL_WIDTH, useCopilotUiStore } from "@/hooks/use-copilot-ui-store"
import { COPILOT_KEYS as K } from "@/ee/lib/copilot/strings"
import { useT } from "@/lib/i18n"
import { focusNodes } from "@/ee/lib/copilot/canvas-sync"
import { useCopilotMentions } from "@/ee/lib/copilot/use-copilot-mentions"
import { sendCopilotMessage, stopCopilotTurn, teardownCopilot } from "@/ee/lib/copilot/turn-engine"
import { useCopilotStore, type CopilotSaveResult } from "@/ee/lib/copilot/turn-store"
import { useCopilotHistory, useCopilotThreadForWorkflow } from "@/ee/hooks/copilot/use-copilot-thread"
import { useCopilotHandoff } from "@/ee/hooks/copilot/use-copilot-handoff"
import { CopilotComposer } from "./copilot-composer"
import { CopilotConversation } from "./copilot-conversation"
import { CopilotEmptyState } from "./copilot-empty-state"
import { CopilotHeader } from "./copilot-header"
import { useCopilotSettingsChange } from "./copilot-settings"
import { firstNameOf } from "@/ee/lib/copilot/first-name"

export interface CopilotPanelProps {
  onClose: () => void
  /** Folds the rail to the strip. On a phone, where there is no strip, it closes the sheet. */
  onMinimize: () => void
  projectId: string | undefined
  save: ((projectId: string) => Promise<CopilotSaveResult>) | null
  run: ((opts?: { skipConfirm?: boolean }) => Promise<{ executionId: string | null }>) | null
  runNode: ((nodeId: string, opts?: { skipConfirm?: boolean }) => Promise<{ started: boolean }>) | null
  estimateNode: ((nodeId: string) => number | null) | null
  onStopRun: () => void
  creditEstimate: number
  /** True while the editor is refetching model costs — the estimate is the previous graph's. */
  estimateStale: boolean
  /** The canvas version the estimate was computed for. */
  estimateVersion: number | null
  isRunning: boolean
  activeExecutionId: string | null
  /** Phones get a full-width sheet; a 380px rail beside the canvas leaves neither usable. */
  fullScreen?: boolean
}

export default function CopilotPanel({
  onClose,
  onMinimize,
  projectId,
  save,
  run,
  runNode,
  estimateNode,
  onStopRun,
  creditEstimate,
  estimateStale,
  estimateVersion,
  isRunning,
  activeExecutionId,
  fullScreen,
}: CopilotPanelProps) {
  const t = useT()
  const { user } = useAuth()
  const userId = user?.id
  const workflowId = useWorkflowStore((s) => s.workflowId)
  const isReadOnly = useWorkflowStore((s) => s.isReadOnly)
  const nodeCount = useWorkflowStore((s) => s.nodes.length)

  const threadId = useCopilotStore((s) => s.threadId)
  const streaming = useCopilotStore((s) => s.streaming)
  const setBridge = useCopilotStore((s) => s.setBridge)
  const turnStatus = useCopilotStore((s) => s.turn.status)
  const turnUserText = useCopilotStore((s) => s.turn.userText)
  const turnStartedAt = useCopilotStore((s) => s.turn.startedAt)

  const { thread } = useCopilotThreadForWorkflow()
  const { messages, busy } = useCopilotHistory(threadId)
  // Arriving from the home page: send what the user typed there, once.
  useCopilotHandoff(thread, workflowId)
  const setSettings = useCopilotSettingsChange()

  // Held here, not in the composer: for FILES this is a server query, and this
  // is the component that owns the fetch.
  const [mentionSearch, setMentionSearch] = useState("")
  // Stable, because the composer reports through an effect that lists it.
  const handleMentionSearch = useCallback((value: string) => setMentionSearch(value), [])
  const { mentions: mentionSources, fileTotal, hasMoreFiles, loadMoreFiles } = useCopilotMentions(userId, mentionSearch)

  // Hand the engine the editor callbacks it cannot reach on its own.
  //
  // `run` and `save` arrive as fresh closures on every editor render, so they
  // are registered as STABLE wrappers over a ref — otherwise the engine's
  // `bridge` object would be replaced on every render of the editor. The
  // wrapper is null (not a no-op) when the underlying callback is missing, so
  // the engine's `bridge.run !== null` check keeps meaning "a run can happen".
  const callbacksRef = useRef({ save, run, runNode, estimateNode })
  useEffect(() => {
    callbacksRef.current = { save, run, runNode, estimateNode }
  }, [save, run, runNode, estimateNode])

  const canSave = save !== null
  const canRun = run !== null
  const canRunNode = runNode !== null
  const canEstimateNode = estimateNode !== null
  useEffect(() => {
    setBridge({
      save: canSave ? (pid: string) => callbacksRef.current.save!(pid) : null,
      run: canRun ? (opts?: { skipConfirm?: boolean }) => callbacksRef.current.run!(opts) : null,
      runNode: canRunNode
        ? (nodeId: string, opts?: { skipConfirm?: boolean }) => callbacksRef.current.runNode!(nodeId, opts)
        : null,
      estimateNode: canEstimateNode ? (nodeId: string) => callbacksRef.current.estimateNode!(nodeId) : null,
    })
    // Nulled on unmount so a stale `run` from a closed editor can never fire a
    // paid run.
    return () => setBridge({ save: null, run: null, runNode: null, estimateNode: null })
  }, [setBridge, canSave, canRun, canRunNode, canEstimateNode])

  useEffect(() => {
    setBridge({ projectId, creditEstimate, estimateStale, estimateVersion, isRunning, activeExecutionId })
    // Values are cleared on unmount too, not just the callbacks: leaving
    // `isRunning: true` behind after an editor-tab switch would keep the engine
    // refusing to run long after the run ended.
    return () =>
      setBridge({ creditEstimate: 0, estimateStale: true, estimateVersion: null, isRunning: false, activeExecutionId: null })
  }, [setBridge, projectId, creditEstimate, estimateStale, estimateVersion, isRunning, activeExecutionId])

  // A different workflow means a different conversation.
  useEffect(() => {
    if (workflowId && useCopilotStore.getState().workflowId !== workflowId) {
      teardownCopilot(workflowId)
    }
  }, [workflowId])



  const send = (text: string) => {
    void sendCopilotMessage(text)
  }

  // A message typed in the middle of the canvas, handed over as the rail
  // opened. Declared after the bridge effects above, so on the first mount the
  // editor callbacks a send needs are registered before it goes out; bound to
  // its workflow, so a switch in between never sends it to another one. It
  // stays pending until the send settles: the save and the thread handshake
  // come before the turn is marked active, and folding the rail in that gap
  // must not read as "nothing said" (copilot-placement).
  const pendingPrompt = useCopilotUiStore((s) => s.pendingPrompt)
  const handedOver = useRef<typeof pendingPrompt>(null)
  useEffect(() => {
    if (!pendingPrompt || handedOver.current === pendingPrompt) return
    handedOver.current = pendingPrompt
    if (pendingPrompt.workflowId !== workflowId) {
      useCopilotUiStore.getState().clearPendingPrompt()
      return
    }
    void sendCopilotMessage(pendingPrompt.text).finally(() => {
      if (useCopilotUiStore.getState().pendingPrompt !== pendingPrompt) return
      useCopilotUiStore.getState().clearPendingPrompt()
      // Refused before its turn began (a failed save, a lost connection, the
      // notice says which): the sentence goes back into the box to send again.
      const { turn, draft, setDraft } = useCopilotStore.getState()
      if (!turnStartedSince(turn.startedAt, pendingPrompt.sentAt) && !draft.trim()) setDraft(pendingPrompt.text)
    })
  }, [pendingPrompt, workflowId])
  // On screen from the click on: the save and the thread handshake run before
  // the engine starts the turn, and the rail must not sit empty meanwhile.
  const handover =
    pendingPrompt && pendingPrompt.workflowId === workflowId && !turnStartedSince(turnStartedAt, pendingPrompt.sentAt)
      ? pendingPrompt.text
      : null

  return (
    <aside
      aria-label={t(K.title)}
      style={fullScreen ? undefined : { width: COPILOT_RAIL_WIDTH }}
      className={`bg-[var(--copilot-panel)] flex flex-col min-h-0 ${
        fullScreen ? "absolute inset-0 z-40" : "flex-none border-e border-border"
      }`}
    >
      <CopilotHeader onClose={onClose} onMinimize={onMinimize} onChangeSettings={setSettings} />

      {/* `role="log"` carries an implicit `aria-live="polite"`, so it must be
          turned off explicitly: a streamed answer mutates on every token and a
          screen reader would read a half-formed sentence continuously. The
          status line below is the sole announcer. */}
      <div className="flex-1 overflow-y-auto px-3.5 py-4 min-h-0" role="log" aria-live="off">
        {messages.length === 0 && !streaming && turnStatus === "idle" && handover === null ? (
          <CopilotEmptyState
            firstName={firstNameOf(user?.email, user?.user_metadata?.full_name as string | undefined)}
            onPick={send}
            disabled={isReadOnly}
            // The person started building by hand: the rail says where it went.
            moved={nodeCount > 0}
          />
        ) : (
          <CopilotConversation
            messages={messages}
            userId={userId}
            nodeCount={nodeCount}
            onShowOnCanvas={focusNodes}
            onStopRun={onStopRun}
            onRetry={() => send(turnUserText)}
            handover={handover}
          />
        )}
      </div>

      {/* One short, stable sentence per state change — this is what gets announced. */}
      <div className="sr-only" role="status" aria-live="polite">
        {streaming ? t(K.a11yWorking) : turnStatus === "completed" ? t(K.a11yDone) : ""}
      </div>

      {busy && (
        <div className="flex-none px-3.5 py-2.5 border-t border-border flex items-start gap-2">
          <span
            className="mt-1 w-2.5 h-2.5 flex-none rounded-full border-2 border-primary/25 border-t-primary animate-spin"
            aria-hidden
          />
          <div className="min-w-0">
            <div className="text-[11.5px] font-medium text-foreground">
              {t(busy.kind === "ours" ? K.stillWorkingTitle : K.otherTabTitle)}
            </div>
            {busy.kind === "ours" && (
              <div className="text-[11px] text-[var(--copilot-muted)]">{t(K.stillWorkingBlurb)}</div>
            )}
          </div>
        </div>
      )}

      {isReadOnly ? (
        <div className="flex-none px-3.5 py-4 border-t border-border">
          <div className="text-xs font-semibold text-foreground">{t(K.readOnlyTitle)}</div>
          <div className="mt-1 text-[11.5px] text-[var(--copilot-muted)]">{t(K.readOnlyBlurb)}</div>
        </div>
      ) : (
        <CopilotComposer
          mentionSources={mentionSources}
          onSearchChange={handleMentionSearch}
          fileTotal={fileTotal}
          hasMoreFiles={hasMoreFiles}
          onLoadMoreFiles={loadMoreFiles}
          onSend={send}
          onStop={() => void stopCopilotTurn()}
          disabled={busy !== null || handover !== null}
        />
      )}
    </aside>
  )
}

/** Whether the engine started a turn at or after `since` (a handover's own turn, not an earlier one). */
function turnStartedSince(startedAt: number | null, since: number): boolean {
  return startedAt !== null && startedAt >= since
}
