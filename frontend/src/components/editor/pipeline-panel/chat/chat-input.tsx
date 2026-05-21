import { useState, type KeyboardEvent } from "react"
import { Button } from "@/components/ui/button"

interface Props {
  onSend: (message: string) => void
  isSending?: boolean
  isAtCap?: boolean
  remaining: number
}

const MAX_LEN = 8000

/**
 * Phase 1D.2b — Chat input. Multi-line textarea + Send button. Enter
 * sends, Shift+Enter inserts a newline. Disabled while sending or once
 * `isAtCap` is true (server-side enforced via CHAT_TURN_CAPS).
 *
 * Footer shows the remaining-turn count, or the cap-reached message when
 * the user has hit the per-stage limit.
 */
export function ChatInput({ onSend, isSending, isAtCap, remaining }: Props) {
  const [draft, setDraft] = useState("")
  const trimmed = draft.trim()
  const canSend = trimmed.length > 0 && !isSending && !isAtCap

  function send() {
    if (!canSend) return
    onSend(trimmed)
    setDraft("")
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div
      className="border-t border-zinc-200 dark:border-[#2D2D2D] p-3 bg-zinc-50 dark:bg-[#121212]"
      data-testid="chat-input"
    >
      <textarea
        rows={3}
        className="w-full rounded border border-zinc-300 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-2 text-sm text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 resize-none focus:outline-none focus:ring-1 focus:ring-[#ff0073]"
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, MAX_LEN))}
        onKeyDown={onKeyDown}
        placeholder={
          isAtCap
            ? "Chat limit reached for this stage."
            : "Refine the Showrunner's plan… (Enter to send, Shift+Enter for newline)"
        }
        disabled={isAtCap || isSending}
        maxLength={MAX_LEN}
        data-testid="chat-input-textarea"
      />
      <div className="flex items-center justify-between mt-2">
        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {isAtCap ? (
            <span data-testid="chat-input-cap-reached">
              Chat limit reached. Approve, branch, or switch to Manual Mode.
            </span>
          ) : (
            <span data-testid="chat-input-remaining">
              {remaining} turn{remaining === 1 ? "" : "s"} remaining
            </span>
          )}
        </div>
        <Button
          size="sm"
          disabled={!canSend}
          onClick={send}
          data-testid="chat-input-send-btn"
        >
          {isSending ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  )
}
