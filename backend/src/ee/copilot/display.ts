/**
 * Stored blocks → what the panel is allowed to render.
 *
 * The wire shape is deliberately narrower than storage: thinking blocks never
 * leave the server, tool inputs and results are summarized rather than
 * echoed (they carry prompts, media URLs and raw provider error strings), and
 * a tool result's untrusted wrapper is never handed to a browser verbatim.
 */
import type { CopilotMessageRow } from "./store.js"
import { toolLabel } from "./tool-labels.js"

export type DisplayPart =
  | { kind: "text"; text: string }
  | { kind: "tool_call"; id: string; name: string; label: string; status: "finished" | "failed" }

export interface DisplayMessage {
  id: string
  seq: number
  turnId: string
  role: "user" | "assistant"
  createdAt: string
  parts: DisplayPart[]
}

interface StoredBlock {
  type?: string
  text?: unknown
  id?: unknown
  name?: unknown
  tool_use_id?: unknown
  is_error?: unknown
}

export function toDisplayMessages(rows: readonly CopilotMessageRow[]): DisplayMessage[] {
  const errorByToolUse = new Map<string, boolean>()
  for (const row of rows) {
    for (const block of asBlocks(row.content)) {
      if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
        errorByToolUse.set(block.tool_use_id, Boolean(block.is_error))
      }
    }
  }

  const messages: DisplayMessage[] = []
  for (const row of rows) {
    const parts: DisplayPart[] = []
    for (const block of asBlocks(row.content)) {
      if (block.type === "text" && typeof block.text === "string") {
        // The user message's first block is the generated context preamble —
        // never shown; the user did not type it. Matched WITHOUT the closing
        // bracket, for the same reason the replay strip is: the fence carries a
        // per-turn nonce now, and every row written before that still opens
        // with the bare `<workflow-context>`. Miss either form and a node
        // inventory appears in the panel as if the user had typed it.
        if (row.role === "user" && block.text.startsWith("<workflow-context")) continue
        parts.push({ kind: "text", text: block.text })
      } else if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
        parts.push({
          kind: "tool_call",
          id: block.id,
          name: block.name,
          label: toolLabel(block.name),
          status: errorByToolUse.get(block.id) ? "failed" : "finished",
        })
      }
      // thinking / tool_result blocks are intentionally dropped.
    }
    if (parts.length === 0) continue
    messages.push({
      id: row.id,
      seq: row.seq,
      turnId: row.turn_id,
      role: row.role,
      createdAt: row.created_at,
      parts,
    })
  }
  return messages
}

function asBlocks(content: unknown): StoredBlock[] {
  return Array.isArray(content) ? (content as StoredBlock[]) : []
}
