/**
 * `remember` — the copilot's ONLY write into its per-user memory.
 *
 * Visibility is the consent control: every successful save emits a
 * `memory_saved` SSE event so the panel can pin a "Saved: …" line with a
 * one-tap undo. There are no silent writes, and there is no update — a memory
 * is written once, listed in the panel, and deleted there (or via undo).
 *
 * The URL reject is a security boundary, not hygiene: a memory is
 * cross-thread PERSISTENT, injected into every future turn. A URL inside one
 * is a durable exfiltration/persistence channel that outlives whatever
 * conversation wrote it. Ids are fine; addresses never.
 */
import { MEMORY_CAPS } from "../constants.js"
import { insertMemory } from "../memories.js"
import type { CopilotToolContext } from "./types.js"

export interface RememberArgs {
  content?: unknown
}

export interface RememberResult {
  text: string
  isError: boolean
  summary?: string
}

const HAS_URL_RE = /http/i

export async function runRemember(ctx: CopilotToolContext, args: RememberArgs): Promise<RememberResult> {
  const raw = typeof args.content === "string" ? args.content.trim() : ""
  if (!raw) {
    return { text: "Nothing to remember: pass `content` — one short standing rule in the user's own terms.", isError: true }
  }
  if (raw.length > MEMORY_CAPS.maxChars) {
    return {
      text: `A memory must be at most ${MEMORY_CAPS.maxChars} characters — distill it to the standing rule itself (${raw.length} sent).`,
      isError: true,
    }
  }
  if (HAS_URL_RE.test(raw)) {
    return {
      text: "A memory may never contain a URL or link — memories persist across every future conversation. Remember the preference in plain words; reference files by name or id instead.",
      isError: true,
    }
  }

  const outcome = await insertMemory(ctx.userId, raw, ctx.threadId)
  switch (outcome.kind) {
    case "saved":
      ctx.emit({ type: "memory_saved", data: { id: outcome.memory.id, content: outcome.memory.content } })
      return {
        text: `Saved. This preference now rides into every future conversation; the user sees it and can delete it in the panel.`,
        isError: false,
        summary: raw.slice(0, 60),
      }
    case "duplicate":
      return { text: "Already remembered — an identical memory exists. Nothing was written.", isError: false, summary: "already saved" }
    case "full":
      return {
        text: `Memory is full (${MEMORY_CAPS.maxPerUser} saved). Tell the user to delete some in the "What the copilot remembers" panel before saving new ones.`,
        isError: true,
      }
    case "unavailable":
      return { text: "Memory is not available on this deployment yet. Tell the user the preference was noted for this conversation only.", isError: true }
  }
}
