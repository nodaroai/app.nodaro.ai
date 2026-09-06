import type { Cast, CastKind, CastMember } from "./cast"

/**
 * RECASTING A BOUND CAST ROW AT LANDING (Task 5) — the Review step lists WHO
 * each declared cast name bound to (`ImportSummary.boundCast`) and lets the
 * user pick somebody else before anything lands. The change is a RECAST, the
 * cast registry's own operation (spec `2026-08-31-project-cast-registry`, D6e):
 * the role keeps the DECLARED name, only the actor moves — which is exactly
 * what the editor's own "Recast…" does, and what keeps the landed prose (which
 * says `@young-man-in-red-jacket`) addressing the same role.
 *
 * Two landings, two mechanisms, one rule: an APPEND goes through the store's
 * `recastCastMember` (the shots are already in the store), a CREATE cannot —
 * it serializes a cast it just minted and persists it to a NEW workflow,
 * without ever touching the store, so it applies {@link applyCastRebinds} to
 * that cast instead. The row-level swap — {@link recastActor} — is the ONE
 * rule both go through: the reducer builds its row from it too, and adds only
 * the store-side effects (the scene look pins it has to clear).
 */

/** The actor a bound row is recast TO — the picker's row, kept whole so the
 *  preview can show the choice (name + thumbnail) before anything lands. */
export interface RebindChoice {
  readonly kind: CastKind
  readonly assetId: string
  readonly name: string
  readonly thumbnailUrl?: string
}

/** One recast the landing applies. */
export interface CastRebind {
  /** The actor the row BOUND to — `BoundCastRow.candidateId`, which is what the
   *  landed role was minted from. */
  readonly from: string
  readonly to: RebindChoice
}

/**
 * The role a landed actor became. Keyed by ASSET alone rather than by
 * `(kind, assetId)` (`castKeyForActor`): the declared row's `kind` is the
 * DOCUMENT's claim, and `castMatches` binds a row within its own kind only
 * where the library row KNOWS its kind — a candidate from a source that
 * doesn't declare one still binds by name, so a row declared `character` can
 * bind a location entity, and the role is then minted under the LIBRARY row's
 * kind, not the document's. One asset is one actor in a production, so the id
 * alone names the role without asking the document to have been right.
 */
export function castKeyForAsset(cast: Cast, assetId: string): string | undefined {
  for (const [key, member] of Object.entries(cast)) {
    if (member.assetId === assetId) return key
  }
  return undefined
}

/** The row a recast leaves behind — the ONE rule, which the store's own
 *  `recastCastMember` builds its row through as well: the name is kept EXACTLY
 *  (so the key can't move and INV-C holds without re-keying) and so is the ROLE
 *  WORD (D6p), which says what the role IS in the film rather than who plays
 *  it. The row's `defaultLook` goes with the actor that just left.
 *
 *  The hand-written DESCRIPTION is kept too (R3, spec
 *  `2026-09-06-reference-menu-and-described-roles-design`): it is a sentence
 *  about the ROLE, typed by the user, not a caption copied off the actor — a
 *  recast that silently deleted it would lose work nothing else can restore.
 *  "Reset to library" is the one door out of it, and it is offered whenever an
 *  actor exists. This is also what turns a DESCRIBED role into a bound one
 *  without losing the words that described it.
 *
 *  Takes only what it READS of the actor, so the store's narrower `actor`
 *  argument and the picker's whole {@link RebindChoice} both satisfy it. */
export function recastActor(
  member: CastMember,
  to: { readonly kind: CastKind; readonly assetId: string },
): CastMember {
  return {
    kind: to.kind,
    assetId: to.assetId,
    displayName: member.displayName,
    ...(member.defaultRole ? { defaultRole: member.defaultRole } : {}),
    ...(member.description ? { description: member.description } : {}),
  }
}

/**
 * Apply every recast a Review step collected. Copy-on-write, and the SAME cast
 * back when nothing matched — a rebind whose role never landed (its passages
 * were dropped, or the document changed under a re-parse) is skipped silently,
 * because the landing it was asked for has already happened.
 *
 * Scene look PINS are not cleared here, unlike the reducer's: an imported plan
 * carries none (`castLook` is written by the editor's pin UI, never by the
 * mapper), so there is nothing of the old actor to drop.
 */
export function applyCastRebinds(
  cast: Cast,
  rebinds: ReadonlyArray<CastRebind>,
): Cast {
  let next = cast
  for (const { from, to } of rebinds) {
    const key = castKeyForAsset(next, from)
    const member = key ? next[key] : undefined
    if (!key || !member) continue
    next = { ...next, [key]: recastActor(member, to) }
  }
  return next
}

/**
 * DEMOTE a role to a DESCRIBED one — the inverse of {@link recastActor}, and
 * the import triage's "skip" (spec
 * `2026-09-06-reference-menu-and-described-roles-design`, §4).
 *
 * The actor goes, and its `defaultLook` with it (a look is a view of the actor
 * that just left — the same loss a recast carries). The NAME, the role WORD and
 * the hand-written DESCRIPTION stay: they are what the production says about
 * this role, and they are the whole of what a described role is.
 *
 * The row SURVIVES rather than being dropped, which is the change from the
 * pre-R5 skip: the name stays a role the registry knows, so its prose still
 * addresses one thing and an actor can be bound to it later without re-deciding
 * what it means.
 */
export function demoteToDescribed(member: CastMember): CastMember {
  const { assetId: _actor, defaultLook: _look, ...rest } = member
  return rest
}
