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

/**
 * Put the picked name where the user was typing it — do NOT lift it out of the
 * sentence.
 *
 * A mention carries two things: WHO, and WHERE in the sentence. Picking used to
 * delete the `@query` and show the entity only as a chip above the box, which
 * kept the who and threw away the where: "an ad with two actors" plus a
 * detached list of two names tells the model nothing about which of them does
 * what. "@Emma walks in while @George raises the bottle" does, and that is how
 * the Studio's composer has always worked.
 *
 * The `@` is kept so the user can still see which words are linked — a plain
 * name in the middle of their own prose is indistinguishable from typing it.
 */
export function insertMentionName(text: string, caret: number, name: string): { text: string; caret: number } {
  const active = activeMentionQuery(text, caret)
  const start = active ? active.start : caret
  const before = text.slice(0, start)
  const after = text.slice(caret)
  // A trailing space ONLY at the end of the text, so the user can keep typing
  // without gluing the next word on. Mid-sentence it must not be added: what
  // follows a mention there is usually punctuation, and "@Maya , then" is worse
  // than the problem the space solves.
  const token = `@${cleanName(name)}${after.length === 0 ? " " : ""}`
  return { text: before + token + after, caret: before.length + token.length }
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
 * What actually goes over the wire.
 *
 * The names themselves are already IN the sentence, where the user put them
 * (`insertMentionName`) — that is what tells the model which mention is the
 * subject and which is the object. This line is the glossary for those names:
 * it is appended rather than interpolated so the user's own sentence reaches
 * the model unedited.
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

interface EntityLike {
  id: string
  name: string
  sourceImageUrl?: string | null
}

/**
 * A character/location row as the picker wants it. Shared by both composers —
 * the editor rail scopes its lists to the open project, the home dock has no
 * project and asks for all of the user's, and the shape is the same either way.
 */
export function toMentions(items: EntityLike[] | undefined, kind: CopilotMention["kind"]): CopilotMention[] {
  return (items ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    kind,
    imageUrl: item.sourceImageUrl ?? null,
  }))
}

export function filterMentions<T extends { name: string }>(items: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...items]
  return items.filter((i) => i.name.toLowerCase().includes(q))
}
