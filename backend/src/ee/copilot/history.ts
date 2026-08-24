/**
 * Replaying a thread into the model.
 *
 * Two rules earn their keep:
 *   - Truncate by WHOLE TURNS. Every `tool_use` block must be answered by a
 *     `tool_result` in the next message; cutting inside a turn produces a
 *     request the API rejects outright.
 *   - Drop a trailing turn whose last assistant message still has unanswered
 *     `tool_use` blocks — that is a crashed turn, and replaying it is the same
 *     rejection.
 *
 * The per-turn `<workflow-context>` preamble is stored beside the user text
 * and re-attached only for the LATEST turn: ten snapshots of a changing graph
 * would contradict each other.
 */
import type Anthropic from "@anthropic-ai/sdk"
import { TURN_CAPS } from "./constants.js"
import type { CopilotMessageRow } from "./store.js"

interface TurnGroup {
  turnId: string
  messages: Anthropic.Messages.MessageParam[]
  chars: number
}

function toMessage(row: CopilotMessageRow): Anthropic.Messages.MessageParam | null {
  let content = Array.isArray(row.content) ? (row.content as Anthropic.Messages.ContentBlockParam[]) : null
  if (!content || content.length === 0) return null
  // Drop the turn's own `<workflow-context>` snapshot: only the CURRENT turn's
  // preamble is sent, or a ten-turn thread replays ten contradictory node
  // inventories and version numbers.
  if (row.role === "user") {
    const first = content[0] as { type?: string; text?: string }
    // Matched WITHOUT the closing bracket on purpose: the fence carries a
    // per-turn nonce now (`<workflow-context-a1b2c3>`), and every row written
    // before that change still opens with the bare `<workflow-context>`. The
    // prefix covers both, so old threads keep replaying correctly.
    if (first?.type === "text" && typeof first.text === "string" && first.text.startsWith("<workflow-context")) {
      content = content.slice(1)
    }
  }
  return content.length > 0 ? { role: row.role, content } : null
}

function hasUnansweredToolUse(messages: Anthropic.Messages.MessageParam[]): boolean {
  const last = messages[messages.length - 1]
  if (!last || last.role !== "assistant" || typeof last.content === "string") return false
  return last.content.some((block) => (block as { type?: string }).type === "tool_use")
}

/** Group stored messages by turn, in order. */
function groupTurns(rows: readonly CopilotMessageRow[]): TurnGroup[] {
  const groups: TurnGroup[] = []
  for (const row of rows) {
    const message = toMessage(row)
    if (!message) continue
    const current = groups[groups.length - 1]
    if (current && current.turnId === row.turn_id) {
      current.messages.push(message)
      current.chars += JSON.stringify(message).length
    } else {
      groups.push({ turnId: row.turn_id, messages: [message], chars: JSON.stringify(message).length })
    }
  }
  return groups
}

/**
 * The history to replay for the NEXT turn: newest turns first until the
 * budget is spent, then restored to chronological order.
 */
export function buildHistory(rows: readonly CopilotMessageRow[]): Anthropic.Messages.MessageParam[] {
  const groups = groupTurns(rows).filter((g) => !hasUnansweredToolUse(g.messages))
  const budgetChars = TURN_CAPS.historyTokenBudget * 4
  const kept: TurnGroup[] = []
  let used = 0
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i]!
    if (used + group.chars > budgetChars) break
    used += group.chars
    kept.unshift(group)
  }
  return kept.flatMap((g) => g.messages)
}

/** The user message for this turn: the volatile context block, then the user's own words. */
export function buildUserContent(preamble: string, text: string): Anthropic.Messages.ContentBlockParam[] {
  return [
    { type: "text", text: preamble },
    { type: "text", text },
  ]
}
