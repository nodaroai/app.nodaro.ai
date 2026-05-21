import type { ChatTurn as ChatTurnType } from "@nodaro/client"
import { ProposedChangeCard } from "./proposed-change-card"

interface Props {
  turn: ChatTurnType
  /** Wired to usePipelineChat.applyProposal. Only used by assistant turns. */
  onApplyProposal: (turnId: string) => void
  isApplying?: boolean
  applyError?: unknown
}

/**
 * Phase 1D.2b — Single chat bubble. User turns right-aligned (pink-ish),
 * assistant turns left-aligned (zinc). When the turn carries a
 * `proposed_change`, mounts `ProposedChangeCard` below the message. The
 * card's `applied` state derives from `applied_to_attempt_id !== null`
 * on the turn row — that flag is set by SSE `chat:proposal_applied`
 * landing in the chat cache (see `use-pipeline-events.ts`).
 */
export function ChatTurnBubble({
  turn,
  onApplyProposal,
  isApplying,
  applyError,
}: Props) {
  const isUser = turn.role === "user"
  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
      data-testid={`chat-turn-${turn.turn_n}`}
      data-role={turn.role}
    >
      <div className={`max-w-[85%] flex flex-col ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={
            isUser
              ? "rounded-lg px-3 py-2 text-sm bg-[#ff0073] text-white"
              : "rounded-lg px-3 py-2 text-sm bg-white dark:bg-[#1E1E1E] border border-zinc-200 dark:border-[#2D2D2D] text-zinc-800 dark:text-zinc-100"
          }
        >
          {turn.content}
        </div>
        {!isUser && turn.proposed_change && (
          <ProposedChangeCard
            proposedChange={turn.proposed_change}
            turnId={turn.id}
            applied={Boolean(turn.applied_to_attempt_id)}
            onApply={onApplyProposal}
            isApplying={isApplying}
            applyError={applyError}
          />
        )}
      </div>
    </div>
  )
}
