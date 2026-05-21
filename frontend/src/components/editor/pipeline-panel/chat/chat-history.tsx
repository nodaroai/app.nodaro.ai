import { useEffect, useRef } from "react"
import type { ChatTurn as ChatTurnType } from "@nodaro/client"
import { ChatTurnBubble } from "./chat-turn"

interface Props {
  turns: ChatTurnType[]
  onApplyProposal: (turnId: string) => void
  isApplying?: boolean
  applyError?: unknown
}

/**
 * Phase 1D.2b — Scrolling chat history. Renders turns in ascending
 * turn_n order; auto-scrolls to the bottom whenever a new turn arrives
 * (keyed on `turns.length` to keep this cheap on re-render).
 */
export function ChatHistory({
  turns,
  onApplyProposal,
  isApplying,
  applyError,
}: Props) {
  const endRef = useRef<HTMLDivElement | null>(null)
  const sorted = [...turns].sort((a, b) => a.turn_n - b.turn_n)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [turns.length])

  if (sorted.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-3 text-xs text-zinc-500 dark:text-zinc-400 italic">
        No messages yet. Start the conversation below to refine the Showrunner's
        plan.
      </div>
    )
  }

  return (
    <div
      className="flex-1 overflow-y-auto p-3 space-y-3"
      data-testid="chat-history"
    >
      {sorted.map((turn) => (
        <ChatTurnBubble
          key={turn.id}
          turn={turn}
          onApplyProposal={onApplyProposal}
          isApplying={isApplying}
          applyError={applyError}
        />
      ))}
      <div ref={endRef} data-testid="chat-history-end" />
    </div>
  )
}
