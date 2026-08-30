/**
 * `{ref:<id>}` / `{ref:<id>:<label>}` — id-addressed reference tokens.
 *
 * The API/Studio form of the positional `{image:N}` token: the client names a
 * reference by its OWN `connectedReferences[].id` and the platform substitutes
 * the `@image_N` seat after IT has done the numbering. Without it a client that
 * wanted the binding inline had to mirror the numbering walk client-side — a
 * duplicated rule that misbinds pictures the moment the walk changes.
 *
 * `resolveVideoReferenceCore` builds the `RefIdTokenContext` DURING its walk
 * and calls `resolveRefIdTokens` before the `referenceOrder` reorder (so the
 * binding follows the reference to its final seat); the video routes call it
 * standalone on their no-image-reference early return (nothing seated, so
 * every token degrades).
 */

import { REF_BINDING } from "./ref-binding.js"

/** The label class of `REFERENCE_TOKEN_RE` (`{image:N:label}`), shared. */
const REF_TOKEN_LABEL_RE = /^[a-zA-Z0-9_ -]+$/
/** Cheap gate for the whole pass — a prompt without it is untouched. */
const HAS_REF_ID_TOKEN_RE = /\{ref:/i
/**
 * One well-formed `{ref:…}` token: everything between `{ref:` and the next
 * `}` that contains no brace. Greedy over a brace-free class, so the scan is
 * LINEAR in the prompt length whatever the content — `prompt` is up to
 * `PROMPT_HARD_CEILING` (30k) chars of caller-controlled text, so a lazy
 * quantifier with a nested optional label group here would be a quadratic-time
 * ReDoS surface. The id / label split happens in code (`splitLabel`), not in
 * the regex. `ref` is case-insensitive; ids are not.
 */
const REF_ID_TOKEN_RE = /\{[rR][eE][fF]:([^{}]*)\}/g
/**
 * Last-resort net for a MALFORMED `{ref:` (a brace inside the id, or no
 * closing `}`): drop the `{ref:` run up to the next whitespace or brace, so
 * the prefix can never reach a model, without eating prose past the token.
 */
const MALFORMED_REF_ID_TOKEN_RE = /\{[rR][eE][fF]:[^\s{}]*\}?/g

/** What `resolveRefIdTokens` resolves against — the numbering walk's output. */
export interface RefIdTokenContext {
  /** Reference id → the 1-based `@image_N` seat the walk gave it. */
  readonly slotById: ReadonlyMap<string, number>
  /** Reference id → display name, the degrade target of a token that cannot bind. */
  readonly nameById: ReadonlyMap<string, string>
  /**
   * How many image references actually ship — the same range gate `{image:N}`
   * uses. A seat past it (a capped-out or duplicate-URL ref) must not bind.
   */
  readonly imageCount: number
}

/**
 * Split a token's content into `<id>` and an optional `<label>` at the LAST
 * colon — only when the tail is a well-formed label. Ids are opaque and may
 * themselves contain `:` (`slug:variant`) or `/` (a URL), so nothing before
 * the last colon is ever interpreted.
 */
function splitLabel(content: string): { id: string; label?: string } {
  const at = content.lastIndexOf(":")
  if (at === -1) return { id: content }
  const tail = content.slice(at + 1)
  if (!REF_TOKEN_LABEL_RE.test(tail)) return { id: content }
  return { id: content.slice(0, at), label: tail }
}

/**
 * Rewrite id-addressed reference tokens into the `@image_N` binding of the
 * reference the caller sent under that id.
 *
 * Ids are matched by IDENTITY against the known ids (seated or named), never
 * parsed by character class: the whole content is tried as an id first (the
 * longest reading — an id may itself end in something label-shaped), then
 * `<id>:<label>` split at the last colon, then the token is unknown. The label
 * class is the one `REFERENCE_TOKEN_RE` uses. An id containing `{`, `}`, an
 * `@name:N` mention or a `{image:N}` token is unsupported (the mention pass
 * runs first and would rewrite it; a brace ends the token).
 *
 * Per token:
 *   - id seated in range → `REF_BINDING.image(label, N)` when labeled, else the
 *     bare `REF_BINDING.ordinal(N)` — exactly what `{image:N[:label]}` emits.
 *   - otherwise (unknown id, ref skipped by the walk, capped out, or no image
 *     references at all) → the label if given, else the ref's display name if
 *     the id is known, else "". A token never ships raw — a malformed one is
 *     dropped by the last-resort net.
 *
 * No whitespace tidy here: every caller runs `resolveReferenceTokens` after
 * this (the core does at every return), and that collapses the gap a dropped
 * token leaves. Returns the input untouched when it carries no `{ref:` at all.
 */
export function resolveRefIdTokens(
  prompt: string | undefined,
  ctx: RefIdTokenContext,
): string | undefined {
  if (!prompt || !HAS_REF_ID_TOKEN_RE.test(prompt)) return prompt
  const known = (id: string): boolean => id.length > 0 && (ctx.slotById.has(id) || ctx.nameById.has(id))
  const bind = (id: string, label: string | undefined): string => {
    const slot = ctx.slotById.get(id)
    if (slot !== undefined && slot >= 1 && slot <= ctx.imageCount) {
      return label ? REF_BINDING.image(label, slot) : REF_BINDING.ordinal(slot)
    }
    return label ?? ctx.nameById.get(id) ?? ""
  }
  return prompt
    .replace(REF_ID_TOKEN_RE, (_match, content: string) => {
      if (known(content)) return bind(content, undefined)
      const { id, label } = splitLabel(content)
      if (known(id)) return bind(id, label)
      return label ?? ""
    })
    .replace(MALFORMED_REF_ID_TOKEN_RE, "")
}
