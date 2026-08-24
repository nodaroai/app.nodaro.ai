/**
 * `@` mentions.
 *
 * A mention is a CHIP, not a URL. The wire message carries the entity's kind,
 * name and ID — never an address. `edit_workflow` rejects model-authored media
 * addresses, so a URL here would either be useless or a hole in that boundary,
 * while an ID is safe by construction: every entity tool scopes its lookup to
 * the session's own user, so a mention can only address the sender's own
 * assets.
 *
 * Media files and uploaded attachments still need server-side resolution and
 * are not part of this release.
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

/** Only a plain identifier reaches the wire — never something that reads as a directive. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

/**
 * What actually goes over the wire. The references line is appended rather than
 * interpolated so the user's own sentence reaches the model unedited.
 *
 * The ID is what makes a mention work at all. Without it the model has to FIND
 * the entity by name, and the listing tools return a bounded, most-recently-
 * updated page — a user with 347 characters got "I could not find them" for
 * anything outside the newest few. With it, the model calls `get_character`
 * once and is done. An ID is safe to hand over where a URL would not be: every
 * entity tool scopes its lookup to the session's own user, so a mention can
 * only ever address the sender's own assets.
 */
export function buildWireMessage(text: string, mentions: readonly CopilotMention[]): string {
  const body = text.trim()
  if (mentions.length === 0) return body
  const refs = mentions
    .map((m) => {
      const named = `${KIND_LABEL[m.kind]} "${cleanName(m.name)}"`
      return SAFE_ID.test(m.id) ? `${named} (id: ${m.id})` : named
    })
    .join("; ")
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

/**
 * The name to show on a chip, out of a stored reference.
 *
 * A reference on the wire is `character "Maya" (id: …)` — written for the
 * model. A person should see "Maya".
 */
export function mentionDisplayName(ref: string): string {
  return /"([^"]*)"/.exec(ref)?.[1] ?? ref.replace(/\s*\(id: [^)]*\)\s*$/, "").trim()
}

export function filterMentions<T extends { name: string }>(items: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...items]
  return items.filter((i) => i.name.toLowerCase().includes(q))
}
