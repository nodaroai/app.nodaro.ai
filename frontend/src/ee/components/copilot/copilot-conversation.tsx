/**
 * The transcript: everything the server has persisted, then the turn that is
 * still arriving.
 *
 * History and the live turn are two different sources by design — the server
 * only stores prose and tool calls, while a live turn also carries the cards
 * (what changed, what a run would cost). The live turn stays on screen until
 * the refetch that follows `done` contains its id, so nothing flickers and
 * nothing is drawn twice.
 */
import { useEffect, useRef, useState } from "react"
import { COPILOT_STRINGS as S } from "@/ee/lib/copilot/strings"
import { splitWireMessage } from "@/ee/lib/copilot/mentions"
import { useCopilotStore } from "@/ee/lib/copilot/turn-store"
import { CopilotActivityRows } from "./copilot-activity"
import { WorkflowUpdatedCard } from "./copilot-cards"
import { CopilotRunSection } from "./copilot-run-section"
import type { CopilotActivity, DisplayMessage } from "@/ee/lib/copilot/types"

interface CopilotConversationProps {
  messages: DisplayMessage[]
  userId: string | undefined
  nodeCount: number
  onShowOnCanvas: (nodeIds: string[]) => void
  onStopRun: () => void
  onRetry: () => void
}

export function CopilotConversation({
  messages,
  userId,
  nodeCount,
  onShowOnCanvas,
  onStopRun,
  onRetry,
}: CopilotConversationProps) {
  const turn = useCopilotStore((s) => s.turn)
  const streaming = useCopilotStore((s) => s.streaming)
  const activityCollapsed = useCopilotStore((s) => s.activityCollapsed)
  const setActivityCollapsed = useCopilotStore((s) => s.setActivityCollapsed)
  const insufficient = useCopilotStore((s) => s.insufficient)
  const runPhase = useCopilotStore((s) => s.runPhase)

  const collapsedForTurn = useRef<string | null>(null)
  useEffect(() => {
    // Collapse the receipt ONCE PER TURN when it lands. Without the per-turn
    // latch this re-runs on every mount, so expanding it and then switching
    // editor tabs and back would silently collapse it again.
    if (streaming || turn.status !== "completed" || turn.activities.length === 0) return
    if (collapsedForTurn.current === turn.turnId) return
    collapsedForTurn.current = turn.turnId
    setActivityCollapsed(true)
  }, [streaming, turn.status, turn.turnId, turn.activities.length, setActivityCollapsed])

  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" })
  }, [turn.text, turn.activities.length, turn.update, turn.status, runPhase, messages.length])

  const persisted = new Set(messages.map((m) => m.turnId))
  const showLive = turn.status !== "idle" && (!turn.turnId || !persisted.has(turn.turnId))

  return (
    <div className="flex flex-col gap-3.5">
      {messages.map((message) =>
        message.role === "user" ? (
          <UserBubble key={message.id} text={message.parts.map((p) => (p.kind === "text" ? p.text : "")).join("")} />
        ) : (
          <AssistantMessage key={message.id} message={message} />
        ),
      )}

      {showLive && (
        <>
          <UserBubble text={turn.userText} />

          {turn.text && (
            <div className="text-[13px] leading-[1.6] text-foreground tracking-[-0.005em] whitespace-pre-wrap break-words">
              {turn.text}
              {streaming && (
                <span className="inline-block w-0.5 h-[13px] bg-primary ml-0.5 -mb-0.5 animate-pulse" aria-hidden />
              )}
            </div>
          )}

          <CopilotActivityRows
            activities={turn.activities}
            collapsed={activityCollapsed}
            onExpand={() => setActivityCollapsed(false)}
          />
        </>
      )}

      {/* Everything below is PANEL state, not transcript. It is rendered
          outside the live block on purpose: the server persists a turn's
          messages before it emits `done`, so `showLive` flips false a second
          or two into the run decision. Scoping the proposal card to the live
          block would destroy the user's only way to approve or decline the
          run — and the outcome watcher along with it. None of these are
          replayed from history, so there is no double-render either. */}
      {turn.update && (
        <WorkflowUpdatedCard update={turn.update} onShowOnCanvas={() => onShowOnCanvas(turn.update!.addedNodeIds)} />
      )}

      <CopilotRunSection userId={userId} nodeCount={nodeCount} onStopRun={onStopRun} />

      {turn.status === "capped" && <div className="text-[11.5px] text-[var(--copilot-muted)] px-0.5">{S.capped}</div>}
      {turn.status === "cancelled" && <div className="text-[11.5px] text-[var(--copilot-dim)] px-0.5">{S.cancelled}</div>}
      {turn.error && (
        <div className="flex items-center gap-2 text-[11.5px] text-[var(--copilot-fail)] px-0.5">
          <span className="min-w-0 break-words">{turn.error.message}</span>
          <button type="button" onClick={onRetry} className="ml-auto underline whitespace-nowrap">
            {S.errorRetry}
          </button>
        </div>
      )}
      {insufficient && (
        <div className="text-[11.5px] text-[var(--copilot-fail)] px-0.5">
          Not enough credits — this turn needs {insufficient.required}, you have {insufficient.balance}.
        </div>
      )}
      {turn.creditsCharged !== null && turn.creditsCharged > 0 && (
        <div className="text-[11px] text-[var(--copilot-dim)] px-0.5 tabular-nums">
          Used {S.usedCredits(turn.creditsCharged)}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}

function UserBubble({ text }: { text: string }) {
  const { text: prose, refs } = splitWireMessage(text)
  if (!prose && refs.length === 0) return null
  return (
    <div className="flex justify-end">
      <div className="max-w-[92%] px-2.5 py-2.5 bg-[var(--copilot-surface)] border border-border rounded-[12px_12px_4px_12px] flex flex-col gap-[7px]">
        {refs.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {refs.map((ref, i) => (
              <span
                key={`${i}:${ref}`}
                className="inline-flex items-center px-2 py-[3px] rounded-[7px] text-[11.5px] text-foreground whitespace-nowrap bg-[var(--copilot-mention)]/10 border border-[var(--copilot-mention)]/40"
              >
                {ref.replace(/^(character|location)\s+/, "").replace(/"/g, "")}
              </span>
            ))}
          </div>
        )}
        {prose && <div className="text-[12.5px] leading-[1.5] text-foreground whitespace-pre-wrap break-words">{prose}</div>}
      </div>
    </div>
  )
}

function AssistantMessage({ message }: { message: DisplayMessage }) {
  const [expanded, setExpanded] = useState(false)
  const text = message.parts
    .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
    .map((p) => p.text)
    .join("\n")
  const activities: CopilotActivity[] = message.parts
    .filter((p): p is { kind: "tool_call"; id: string; name: string; label: string; status: "finished" | "failed" } =>
      p.kind === "tool_call",
    )
    .map((p) => ({ id: p.id, label: p.label, note: "", status: p.status }))

  return (
    <div className="flex flex-col gap-3">
      {text && (
        <div className="text-[13px] leading-[1.6] text-foreground tracking-[-0.005em] whitespace-pre-wrap break-words">
          {text}
        </div>
      )}
      <CopilotActivityRows activities={activities} collapsed={!expanded} onExpand={() => setExpanded(true)} />
    </div>
  )
}
