import type { ConnectedReference } from "@nodaro/shared"

import {
  castKeyForActor,
  castSlug,
  enrollCastMember,
  hasActor,
  sanitizeCastDescription,
  type Cast,
  type CastKind,
  type CastMember,
} from "./cast"
import { renameRoleInShots, shotReferences } from "./cast-rename"
import { CAST_KINDS, type CastEntry } from "./format/schema"
import { REF_SOURCE_KIND } from "./ref-source-kind"
import type { Shot } from "./shot"

/**
 * ENROLLING ROLES THAT ARRIVE FROM SOMEWHERE ELSE (spec
 * 2026-08-31-project-cast-registry, C5) — one mechanism, two callers:
 *
 *  - **Import into an open production.** A pasted scene brings its own role
 *    sheet, which meets a cast that already exists.
 *  - **Legacy migration** (D6g). A production made before the registry is
 *    chip-addressed: the chips carry the ids, the prose carries the names, and
 *    nothing says which name means whom. "On first edit the enroller mints the
 *    cast from the chips, auto-suffixing collisions and rewriting the prose
 *    once, visibly."
 *
 * Both hit the SAME hard case, which is why they share one implementation: a
 * name already taken by a DIFFERENT actor. D6a forbids resolving that at the
 * identity layer — one name is one person per production — so it is resolved at
 * the NAME layer, the only place a text prompt can truthfully keep the
 * difference: the newcomer becomes `panda-2`, and the prose that named it is
 * rewritten to say so. The words then carry the distinction the chips used to
 * hide, which is D6b's whole claim.
 *
 * The rewrite is scoped to the ARRIVING shots. A paste must never re-word the
 * scenes that were already here — they said "Panda" about the panda they meant,
 * and they still mean it. Where the arriving set is the WHOLE production (the
 * chip sweep below), that scope isn't enough on its own — see `enrollOne`'s
 * `byIdentity`.
 */

/** One name that had to move, so the caller can SAY so (the "visibly" in D6g). */
export interface CastEnrollment {
  readonly key: string
  readonly displayName: string
  /** The name the prose used to say, when the enrollment had to rename it. */
  readonly renamedFrom?: string
}

export interface MergeCastResult {
  readonly cast: Cast
  readonly shots: ReadonlyArray<Shot>
  /** Every role added — the toast's material. Empty ⇒ nothing changed at all. */
  readonly enrolled: ReadonlyArray<CastEnrollment>
}

/**
 * Enroll ONE role into `cast`, renaming the arriving prose when the name was
 * already taken by somebody else. Returns the same cast and shots when the
 * actor is already cast (idempotent by ACTOR — the auto-suffix exists for two
 * different actors colliding, never for one actor arriving twice).
 *
 * `byIdentity` says whether the rewrite must be scoped to the actor's OWN
 * chips, and the two callers genuinely differ:
 *
 *  - A PASTE (`mergeCast`) is scoped by the shots it is given — every one of
 *    them arrived with this sheet, so every "Kira" in them is the arriving
 *    Kira, chip or no chip. The sheet is authoritative there, and a pasted
 *    scene whose reference was dropped still says the name in prose. But a
 *    sheet can carry TWO actors whose names collide in turn (a `Panda` that
 *    becomes `Panda 2`, beside the sheet's own `Panda 2`), and then "by name"
 *    is not enough within the slice either — see {@link sliceBindsActor}.
 *    Identity scoping does not cost the paste its chip-less scenes, though:
 *    the rewrite widens the scope back to the whole slice wherever the slice
 *    has one claimant to the name (B11, `cast-rename.sliceOwnsName`).
 *  - A CHIP SWEEP (`castFromChips`) is not. It reads a whole production (or a
 *    whole appended slice), so BOTH pandas' scenes are in the same array —
 *    and every candidate came from a chip, so the actor's own chips are
 *    exactly where its words are.
 *
 * IDENTITY SCOPE IS WIDENED BY THE SLICE, NOT BY THE NAME (B11/H3). Where a
 * surface's chips claim the name for NOBODY — a scene bound to other roles
 * only, or a legacy take with no `references` at all — `sliceOwnsName` hands
 * those words to the actor anyway, but ONLY where the whole arriving slice has
 * exactly one claimant to the name. That is what makes the widening safe: the
 * case it exists for (a chip-less scene that plainly means the one panda in the
 * file) is settled, and the case it must not guess at (two actors answering to
 * the same name) still fails closed and leaves the words with the keeper.
 */
function enrollOne(
  cast: Cast,
  shots: ReadonlyArray<Shot>,
  member: CastMember,
  byIdentity: boolean,
  arrivingNames: ReadonlyArray<string>,
): { cast: Cast; shots: ReadonlyArray<Shot>; enrollment?: CastEnrollment } {
  // Idempotent by ACTOR where there IS one; by NAME where there is not. A
  // DESCRIBED role (R5) has no identity to be idempotent about, so the probe
  // that keeps one actor from enrolling twice becomes the probe that keeps one
  // name from doing so — a name already cast IS that role, and minting
  // `natalie-2` beside it is the forbidden state D6a exists to stop.
  if (hasActor(member)) {
    if (castKeyForActor(cast, member.kind, member.assetId)) return { cast, shots }
  } else if (castSlug(member.kind, member.displayName) in cast) {
    return { cast, shots }
  }
  const enrolled = enrollCastMember(cast, member)
  // An unsluggable name (Hebrew, emoji) can never be addressed by name, which
  // is the only thing a role is for — it stays a plain chip, exactly as today.
  if (!enrolled) return { cast, shots }
  const landed = enrolled.cast[enrolled.key]!
  const renamed = landed.displayName !== member.displayName
  const next = renamed
    ? renameRoleInShots(shots, {
        kind: member.kind,
        oldKey: castSlug(member.kind, member.displayName),
        newKey: enrolled.key,
        oldName: member.displayName,
        newName: landed.displayName,
        // The name is taken, so the OTHER actor's chips say it too — and their
        // scenes still mean them.
        ...(byIdentity ? { assetId: member.assetId } : {}),
        // The cast the newcomer just collided with, PLUS the arriving sheet's
        // own other names: both are whole words this rewrite must not run
        // through (R75b/R78 — the `Panda` inside our own `Panda 2`, and the
        // `Panda` inside the sheet's own `Panda Bear`, which is a role the
        // sheet KNOWS about but has not enrolled yet). The destination cast is
        // read BEFORE the enrollment, so the newcomer's own new name isn't in
        // it; `namePattern` reserves that one separately, and drops every
        // reserved name this one is not a proper prefix of — so the moving
        // name's own entry in `arrivingNames` costs nothing.
        reservedNames: [
          ...Object.values(cast).map((m) => m.displayName),
          ...arrivingNames,
        ],
      }).shots
    : shots
  return {
    cast: enrolled.cast,
    shots: next,
    enrollment: {
      key: enrolled.key,
      displayName: landed.displayName,
      ...(renamed ? { renamedFrom: member.displayName } : {}),
    },
  }
}

/**
 * Do the arriving shots BIND this actor by chip — a reference carrying its id
 * under the name that is about to move? Then the actor's own words can be found
 * where its chips are, and the rewrite is scoped by identity: the sheet's next
 * collision must not retarget the actor a previous one just settled (`Panda`
 * renamed to `Panda 2` beside a sheet that already had a `Panda 2` of its own).
 *
 * Where it binds NOTHING the sheet is the only witness there is — a pasted
 * scene whose reference was dropped still says the name in prose — and the
 * rewrite falls back to the name, which is the arriving actor's by construction.
 * Matched on id AND name, exactly as the rewriter's own scope is, so identity
 * scoping is never switched on where it would find nothing to move.
 *
 * This flag decides WHETHER to scope by identity; how far that scope reaches is
 * the rewriter's own question (B11). A slice that binds the actor in one shot
 * and merely names it in the next still renames both — one sheet, one arrival,
 * one actor — unless a SECOND actor claims the name somewhere in the slice, and
 * then the chip-less words stay with the keeper (`cast-rename.sliceOwnsName`).
 */
function sliceBindsActor(
  shots: ReadonlyArray<Shot>,
  member: CastMember,
): boolean {
  // A DESCRIBED role (R5) binds no chip anywhere by definition, so identity
  // scoping has nothing to scope BY: its words are found by name, which is the
  // fallback this returns `false` for.
  if (!hasActor(member)) return false
  return shots.some((shot) =>
    shotReferences(shot).some(
      (ref) => ref.id === member.assetId && ref.defaultName === member.displayName,
    ),
  )
}

/**
 * Merge an arriving role sheet into an existing one, rewriting the arriving
 * shots where a name had to move. Copy-on-write: nothing to add ⇒ the SAME
 * objects back, so a legacy paste into a legacy production is a provable no-op.
 */
export function mergeCast(
  cast: Cast,
  incoming: Cast | undefined,
  shots: ReadonlyArray<Shot>,
): MergeCastResult {
  if (!incoming || Object.keys(incoming).length === 0) {
    return { cast, shots, enrolled: [] }
  }
  let nextCast = cast
  let nextShots = shots
  const enrolled: CastEnrollment[] = []
  // Display order, so a collision suffix is assigned by a rule the user can
  // predict rather than by object-key iteration order.
  const rows = Object.values(incoming).sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  )
  const arrivingNames = rows.map((r) => r.displayName)
  for (const member of rows) {
    const step = enrollOne(
      nextCast,
      nextShots,
      member,
      sliceBindsActor(nextShots, member),
      arrivingNames,
    )
    nextCast = step.cast
    nextShots = step.shots
    if (step.enrollment) enrolled.push(step.enrollment)
  }
  return { cast: nextCast, shots: nextShots, enrolled }
}

/** The cast kind a bound reference stands for; `undefined` = not castable. */
function kindForReference(ref: ConnectedReference): CastKind | undefined {
  const kind = REF_SOURCE_KIND[ref.source]
  // An `image` reference has no library row behind it, so it has no ACTOR to be
  // repointed at and nothing an import could resolve or create. It stays a plain
  // named chip, which already works — minting a role for it would add a row that
  // can only ever say what the chip says.
  return kind && kind !== "image" ? kind : undefined
}

/**
 * THE LEGACY MIGRATION (D6g) — mint the cast from a production's own chips.
 *
 * A pre-registry production's bindings live in `references[]`; this reads them
 * as what they always were — a role sheet nobody had written down — and writes
 * it down. Ordered by scene so the first scene's cast keeps its plain names and
 * a later, different actor of the same name takes the suffix: the production
 * reads in the order it was made.
 *
 * VIEW references are skipped. A view chip is a one-off pick of a specific
 * image, not a claim about who somebody is (`resolveRole` leaves them alone for
 * the same reason), and enrolling one would mint a role whose default look is a
 * pose nobody chose.
 */
export function castFromChips(
  cast: Cast,
  shots: ReadonlyArray<Shot>,
): MergeCastResult {
  const candidates: CastMember[] = []
  const seen = new Set<string>()
  const consider = (refs?: ReadonlyArray<ConnectedReference>) => {
    for (const ref of refs ?? []) {
      const kind = kindForReference(ref)
      if (!kind || !ref.id || !ref.defaultName) continue
      if (ref.isExtraRef || ref.variantSlug) continue
      const key = `${kind}:${ref.id}:${ref.defaultName}`
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push({ kind, assetId: ref.id, displayName: ref.defaultName })
    }
  }
  for (const shot of shots) {
    for (const r of shot.still?.results ?? []) consider(r.references)
    for (const r of shot.clip?.results ?? []) {
      consider(r.references)
      for (const b of r.beats ?? []) consider(b.references)
    }
    // An IMPORTED scene's chips ride its plan until it renders (plan-import-v2 D7).
    consider(shot.plan?.frame?.references)
    consider(shot.plan?.motion?.references)
    for (const b of shot.beats ?? []) consider(b.references)
  }
  if (candidates.length === 0) return { cast, shots, enrolled: [] }

  let nextCast = cast
  let nextShots = shots
  const enrolled: CastEnrollment[] = []
  const arrivingNames = candidates.map((c) => c.displayName)
  for (const member of candidates) {
    const step = enrollOne(nextCast, nextShots, member, true, arrivingNames)
    nextCast = step.cast
    nextShots = step.shots
    if (step.enrollment) enrolled.push(step.enrollment)
  }
  return { cast: nextCast, shots: nextShots, enrolled }
}

/**
 * THE PLAN'S UNBOUND NAMES, AS ROLES (spec
 * `2026-09-06-reference-menu-and-described-roles-design`, §4) — the seeding half
 * of `castFromChips`. Where the sweep above reads a production's CHIPS, this
 * reads the document's own `cast[]` rows that bound to NOTHING
 * (`ImportSummary.unresolvedCast`) and mints a DESCRIBED role for each: a name
 * with the plan's words and no face.
 *
 * That is what makes a story or analysis landing consistent before any entity
 * exists — every name in the prose is a role the registry knows, so the same
 * description reaches every scene that says it.
 *
 * The filters are `planCastRows`' own (the format's four kinds, a non-blank
 * name), so the triage dialog and the seeding can never disagree about which
 * rows are placeable. `cast` is read here rather than by each caller: a name the
 * chips ALREADY bound is that role (D6a — one name is one person), so it is
 * skipped rather than suffixed into `abi-2`, and two rows for one name enroll
 * once.
 */
export function describedRolesFrom(
  entries: ReadonlyArray<CastEntry>,
  cast: Cast,
): CastMember[] {
  const out: CastMember[] = []
  const taken = new Set(Object.keys(cast))
  for (const entry of entries) {
    if (!CAST_KINDS.has(entry.kind)) continue
    const displayName = entry.name.trim()
    if (!displayName) continue
    const key = castSlug(entry.kind, displayName)
    if (!key || taken.has(key)) continue
    taken.add(key)
    const description = sanitizeCastDescription(entry.description ?? "")
    out.push({
      kind: entry.kind,
      displayName,
      ...(description ? { description } : {}),
    })
  }
  return out
}
