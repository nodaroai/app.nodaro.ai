/**
 * `@` mentions.
 *
 * A mention is a CHIP, not a URL. The wire message carries the entity's name
 * and kind as plain text and the model resolves it with `list_characters` /
 * `list_locations` — the two entity tools on its allowlist. That is deliberate:
 * `edit_workflow` rejects model-authored media addresses, so handing the model
 * a URL here would either be useless or a hole in that boundary. Media files
 * and uploaded attachments need server-side id resolution and are not part of
 * this release.
 */
import type { CopilotMention } from "./types"

/** The `@query` the caret is currently sitting in, or null. */
export function activeMentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret)
  const match = /(?:^|\s)@([\p{L}\p{N}._-]*)$/u.exec(before)
  if (!match) return null
  return { query: match[1] ?? "", start: caret - (match[1]?.length ?? 0) - 1 }
}

/** Remove the `@query` the user was typing once they pick from the list. */
export function stripMentionQuery(text: string, caret: number): { text: string; caret: number } {
  const active = activeMentionQuery(text, caret)
  if (!active) return { text, caret }
  const next = text.slice(0, active.start) + text.slice(caret)
  return { text: next, caret: active.start }
}

const KIND_LABEL: Record<CopilotMention["kind"], string> = {
  character: "character",
  location: "location",
}

const MAX_MENTION_NAME = 120

/**
 * A mention name lands in the USER message — the one channel the model is told
 * to obey, unlike tool results, which arrive inside an untrusted wrapper. Today
 * only the sender can author these names, so nothing is gained by forging one;
 * that stops being true the moment characters and locations become shareable
 * across a workspace. Strip the envelope's own punctuation and any control or
 * formatting characters now, while it costs three lines.
 */
function cleanName(name: string): string {
  return (
    name
      .replace(/[\p{Cc}\p{Cf}]/gu, " ")
      // Quotes, backslashes and semicolons are the envelope's own punctuation.
      // Brackets go too, so a name can never carry something that reads like a
      // marker of ours — "[references]", "[system]".
      .replace(/["\\;[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      // By code POINT, not code unit: slicing UTF-16 mid-emoji leaves a lone
      // surrogate, which Postgres and the model API both reject — every
      // message mentioning that entity would fail after the credits are
      // reserved.
      .split(/(?:)/u)
      .slice(0, MAX_MENTION_NAME)
      .join("")
  )
}

/**
 * What actually goes over the wire. The references line is appended rather than
 * interpolated so the user's own sentence reaches the model unedited.
 */
export function buildWireMessage(text: string, mentions: readonly CopilotMention[]): string {
  const body = text.trim()
  if (mentions.length === 0) return body
  const refs = mentions.map((m) => `${KIND_LABEL[m.kind]} "${cleanName(m.name)}"`).join("; ")
  const line = `[references] ${refs}`
  return body ? `${body}\n\n${line}` : line
}

/** Split a stored message back into prose and its references line, for display. */
export function splitWireMessage(message: string): { text: string; refs: string[] } {
  const idx = message.lastIndexOf("\n\n[references] ")
  if (idx === -1) return { text: message, refs: [] }
  const refs = message
    .slice(idx + "\n\n[references] ".length)
    .split(";")
    .map((r) => r.trim())
    .filter(Boolean)
  return { text: message.slice(0, idx), refs }
}

export function filterMentions<T extends { name: string }>(items: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...items]
  return items.filter((i) => i.name.toLowerCase().includes(q))
}
