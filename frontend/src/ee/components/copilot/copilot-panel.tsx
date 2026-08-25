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
import { useEffect, useRef } from "react"
import { useAuth } from "@/hooks/use-auth"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { COPILOT_RAIL_WIDTH } from "@/hooks/use-copilot-ui-store"
import { COPILOT_STRINGS as S } from "@/ee/lib/copilot/strings"
import { focusNodes } from "@/ee/lib/copilot/canvas-sync"
import { useCopilotMentions } from "@/ee/lib/copilot/use-copilot-mentions"
import { sendCopilotMessage, stopCopilotTurn, teardownCopilot } from "@/ee/lib/copilot/turn-engine"
import { useCopilotStore, type CopilotSaveResult } from "@/ee/lib/copilot/turn-store"
import { useCopilotHistory, useCopilotSettings, useCopilotThreadForWorkflow } from "@/ee/hooks/copilot/use-copilot-thread"
import { useCopilotHandoff } from "@/ee/hooks/copilot/use-copilot-handoff"
import type { CopilotMention, CopilotModelTier } from "@/ee/lib/copilot/types"
import { CopilotComposer } from "./copilot-composer"
import { CopilotConversation } from "./copilot-conversation"
import { CopilotEmptyState } from "./copilot-empty-state"
import { CopilotHeader } from "./copilot-header"

export interface CopilotPanelProps {
  onClose: () => void
  projectId: string | undefined
  save: ((projectId: string) => Promise<CopilotSaveResult>) | null
  run: ((opts?: { skipConfirm?: boolean }) => Promise<{ executionId: string | null }>) | null
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
  projectId,
  save,
  run,
  onStopRun,
  creditEstimate,
  estimateStale,
  estimateVersion,
  isRunning,
  activeExecutionId,
  fullScreen,
}: CopilotPanelProps) {
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

  const { thread } = useCopilotThreadForWorkflow()
  const { messages, busy } = useCopilotHistory(threadId)
  // Arriving from the home page: send what the user typed there, once.
  useCopilotHandoff(thread, workflowId)
  const settings = useCopilotSettings(threadId)

  const { mentions: mentionSources } = useCopilotMentions(projectId, userId)

  // Hand the engine the editor callbacks it cannot reach on its own.
  //
  // `run` and `save` arrive as fresh closures on every editor render, so they
  // are registered as STABLE wrappers over a ref — otherwise the engine's
  // `bridge` object would be replaced on every render of the editor. The
  // wrapper is null (not a no-op) when the underlying callback is missing, so
  // the engine's `bridge.run !== null` check keeps meaning "a run can happen".
  const callbacksRef = useRef({ save, run })
  useEffect(() => {
    callbacksRef.current = { save, run }
  }, [save, run])

  const canSave = save !== null
  const canRun = run !== null
  useEffect(() => {
    setBridge({
      save: canSave ? (pid: string) => callbacksRef.current.save!(pid) : null,
      run: canRun ? (opts?: { skipConfirm?: boolean }) => callbacksRef.current.run!(opts) : null,
    })
    // Nulled on unmount so a stale `run` from a closed editor can never fire a
    // paid run.
    return () => setBridge({ save: null, run: null })
  }, [setBridge, canSave, canRun])

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

  const setSettings = (patch: {
    runMode?: "ask" | "auto"
    autoRunLimitCredits?: number
    allowPublishing?: boolean
    modelTier?: CopilotModelTier
  }) => {
    // Local first so the toggle responds with no thread and with no network.
    const current = useCopilotStore.getState()
    current.setRunSettings(
      patch.runMode ?? current.runMode,
      patch.autoRunLimitCredits ?? current.autoRunLimit,
      patch.allowPublishing ?? current.allowPublishing,
      patch.modelTier ?? current.modelTier,
    )
    if (threadId) settings.mutate(patch)
  }

  return (
    <aside
      aria-label={S.title}
      style={fullScreen ? undefined : { width: COPILOT_RAIL_WIDTH }}
      className={`bg-[var(--copilot-panel)] flex flex-col min-h-0 ${
        fullScreen ? "absolute inset-0 z-40" : "flex-none border-r border-border"
      }`}
    >
      <CopilotHeader onClose={onClose} onChangeSettings={setSettings} />

      {/* `role="log"` carries an implicit `aria-live="polite"`, so it must be
          turned off explicitly: a streamed answer mutates on every token and a
          screen reader would read a half-formed sentence continuously. The
          status line below is the sole announcer. */}
      <div className="flex-1 overflow-y-auto px-3.5 py-4 min-h-0" role="log" aria-live="off">
        {messages.length === 0 && !streaming && turnStatus === "idle" ? (
          <CopilotEmptyState
            firstName={firstNameOf(user?.email, user?.user_metadata?.full_name as string | undefined)}
            onPick={send}
            disabled={isReadOnly}
          />
        ) : (
          <CopilotConversation
            messages={messages}
            userId={userId}
            nodeCount={nodeCount}
            onShowOnCanvas={focusNodes}
            onStopRun={onStopRun}
            onRetry={() => send(turnUserText)}
          />
        )}
      </div>

      {/* One short, stable sentence per state change — this is what gets announced. */}
      <div className="sr-only" role="status" aria-live="polite">
        {streaming ? S.a11yWorking : turnStatus === "completed" ? S.a11yDone : ""}
      </div>

      {busy && (
        <div className="flex-none px-3.5 py-2.5 border-t border-border flex items-start gap-2">
          <span
            className="mt-1 w-2.5 h-2.5 flex-none rounded-full border-2 border-primary/25 border-t-primary animate-spin"
            aria-hidden
          />
          <div className="min-w-0">
            <div className="text-[11.5px] font-medium text-foreground">
              {busy.kind === "ours" ? S.stillWorkingTitle : S.otherTabTitle}
            </div>
            {busy.kind === "ours" && (
              <div className="text-[11px] text-[var(--copilot-muted)]">{S.stillWorkingBlurb}</div>
            )}
          </div>
        </div>
      )}

      {isReadOnly ? (
        <div className="flex-none px-3.5 py-4 border-t border-border">
          <div className="text-xs font-semibold text-foreground">{S.readOnlyTitle}</div>
          <div className="mt-1 text-[11.5px] text-[var(--copilot-muted)]">{S.readOnlyBlurb}</div>
        </div>
      ) : (
        <CopilotComposer
          mentionSources={mentionSources}
          onSend={send}
          onStop={() => void stopCopilotTurn()}
          disabled={busy !== null}
        />
      )}
    </aside>
  )
}

/** "Hey asi" — the greeting uses whatever first name we can honestly derive. */
function firstNameOf(email: string | undefined, fullName: string | undefined): string {
  const fromName = fullName?.trim().split(/\s+/)[0]
  if (fromName) return fromName
  const local = email?.split("@")[0] ?? ""
  return local || "there"
}
