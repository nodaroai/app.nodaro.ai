import type { ConnectedReference } from "@nodaro/shared"

import { roleTokenForName } from "./cast"
import { TOKEN_TRAILING } from "./mention-grammar"

/**
 * THE ROLE TOKEN'S LAST GATE (C6 follow-up).
 *
 * C6 made a cast chip serialize as `@<role-slug>` so the persisted prose SAYS
 * what it binds. But the predicate the serializer asks — {@link
 * import("./cast").castKeyForChip}, "is this chip's name a role?" — is
 * strictly WIDER than what any wire binder will actually claim. A binder
 * additionally needs a bound channel, a url, a bindable kind and a free claim
 * slot, and every gap between the two predicates shipped a machine slug to the
 * model where a proper noun used to stand:
 *
 *  - an `object` / `creature` chip had no mention path at all on any kind of
 *    prompt — so `@teapot` rode the framing wire literally. S7 gave those two
 *    kinds the platform's entity grammar, so a bindable one now binds; every
 *    OTHER gap below applies to them exactly as it does to a character, and an
 *    unbindable entity token still lands here;
 *  - a chip whose reference carries no url is skipped by `bindMentionTokens`
 *    for that reason alone;
 *  - a VIEW pick rides the `isExtraRef` channel, which every mention predicate
 *    refuses — its picture is already attached with its own directive line;
 *  - a chip past the provider's image cap is deliberately not attached by
 *    `bindReferenceTokens`, and its prose was left saying `@panda-2`;
 *  - a FRAMES-mode animate sends no `connectedReferences` at all by design (the
 *    start still already carries the identity), so nothing bound and the whole
 *    sentence went out in slugs.
 *
 * The fix belongs HERE rather than in the serializer, because none of those
 * conditions — the stage, the provider's cap, the reference's url — are knowable
 * when the chip is typed, and the prose is persisted and portable. So the wire's
 * last act is: any role token still standing gets the human word it stood in
 * for. That is exactly the pre-C6 prose, which is the honest fallback.
 *
 * A token NOTHING here can name is left alone — that is the pre-existing
 * "a name with no face" class (a hand-typed `@Name`), which the submit's own
 * unresolved warning owns.
 */

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Replace every `@<role-slug>` token in `text` that one of `names` accounts for
 * with that name. First name wins a token (two chips sharing a label can't
 * fight over it), longest token first in one pass over the original text.
 *
 * The boundaries are the binders' own: a captured non-word, non-`@` prefix
 * (Safari 16.0 has no lookbehind, and `@@panda` is not a token), and
 * {@link TOKEN_TRAILING} after — so an already-bound `@panda-2:1` and a longer
 * `@panda-2` are both left for the token that really owns them.
 *
 * Returns the SAME string when there is nothing to degrade, so the common path
 * — every chip bound — allocates nothing.
 */
export function untokenizeRoles(
  text: string,
  names: ReadonlyArray<string>,
): string {
  if (!text.includes("@") || names.length === 0) return text
  const byToken = new Map<string, string>()
  for (const raw of names) {
    const name = raw.trim()
    if (!name) continue
    const token = roleTokenForName(name)
    if (token && !byToken.has(token)) byToken.set(token, name)
  }
  if (byToken.size === 0) return text
  const tokens = [...byToken.keys()].sort((a, b) => b.length - a.length)
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}@])(${tokens.map(escapeRegExp).join("|")})(?!${TOKEN_TRAILING.source})`,
    "gu",
  )
  return text.replace(
    pattern,
    (_match: string, before: string, token: string) =>
      `${before}${byToken.get(token)!}`,
  )
}

/** The names a reference list can account for — the chips' own display names,
 *  which is the word each role token stood in for. */
export function referenceNames(
  references: ReadonlyArray<ConnectedReference> | undefined,
): string[] {
  return references?.map((r) => r.defaultName) ?? []
}

/** {@link untokenizeRoles} keyed by the references in hand — the shape both wire
 *  binders use, so "what can name a token" is one answer, not two. */
export function untokenizeRoleReferences(
  text: string,
  references: ReadonlyArray<ConnectedReference> | undefined,
): string {
  if (!references?.length) return text
  return untokenizeRoles(text, referenceNames(references))
}
