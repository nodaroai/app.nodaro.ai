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

/**
 * Image ids from the message's own `[references]` glossary (vision turns).
 *
 * The glossary is OUR wire format — one trailing line the composer writes
 * (`[references] image file "shot.png" (id: <uuid>); character "Iris" …`) —
 * so parsing it server-side covers every path that produces a message (typed
 * `@`, the paperclip, the home-page handoff) with zero client changes. Only
 * `image file` entries count, only well-formed uuids survive, and the cap is
 * enforced here so a glossary stuffed with ids cannot balloon the request.
 * Ownership is NOT decided here — the caller resolves each id through the
 * owner-scoped resolver, and a foreign id simply fails to resolve.
 */
export function extractImageRefIds(message: string): string[] {
  const idx = message.lastIndexOf("\n\n[references] ")
  const line = idx === -1 && message.startsWith("[references] ")
    ? message.slice("[references] ".length)
    : idx !== -1
      ? message.slice(idx + "\n\n[references] ".length)
      : null
  if (!line) return []
  const firstLine = line.split("\n", 1)[0] ?? ""
  const ids: string[] = []
  const re = /image file "[^"]*" \(id: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi
  for (const match of firstLine.matchAll(re)) {
    const id = match[1]!
    if (!ids.includes(id)) ids.push(id)
    if (ids.length >= TURN_CAPS.maxVisionImages) break
  }
  return ids
}

/**
 * The user message for this turn: the volatile context block, the attached
 * images (vision turns — the model SEES what the user attached, so "build me
 * something like this screenshot" works in one turn), then the user's own
 * words. Images sit between context and prose per the vision guidance: the
 * question refers to them, so they come first.
 */
export function buildUserContent(
  preamble: string,
  text: string,
  imageUrls: readonly string[] = [],
): Anthropic.Messages.ContentBlockParam[] {
  return [
    { type: "text", text: preamble },
    ...imageUrls.slice(0, TURN_CAPS.maxVisionImages).map(
      (url): Anthropic.Messages.ContentBlockParam => ({ type: "image", source: { type: "url", url } }),
    ),
    { type: "text", text },
  ]
}
