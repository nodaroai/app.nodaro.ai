import type { ConnectedReference } from "@nodaro/shared"

import { castSlug, type Cast, type CastKind } from "./cast"
import { mentionsName, shotProse } from "./cast-rename"
import type { Shot } from "./shot"

/**
 * THE CAST'S HALF OF A BUNDLE (spec 2026-08-31-project-cast-registry, C5 /
 * D6g) — the export-side projection.
 *
 * A bundle carries the cast **once**, as the production-level role sheet, and
 * that is the whole point of the registry on the portability side: a
 * cross-account import re-points ONE table (N roles) instead of N per-result
 * reference arrays, and every scene follows because the submit seam resolves
 * chips through the LIVE cast row by name.
 *
 * What it does NOT do is widen the export. The whole film's role sheet must not
 * ride a one-scene file: an importer asked to triage twelve roles for a bundle
 * that mentions two is being asked about people who aren't in the film they
 * were handed, and the ids and thumbnails of the other ten leave the account
 * for nothing. So the sheet is projected onto the slice actually exported.
 */

/** Every reference a shot carries, across every collection that holds one. */
function* shotReferences(shot: Shot): Generator<ConnectedReference> {
  for (const r of shot.still?.results ?? []) yield* r.references ?? []
  for (const r of shot.clip?.results ?? []) {
    yield* r.references ?? []
    for (const b of r.beats ?? []) yield* b.references ?? []
  }
  for (const b of shot.beats ?? []) yield* b.references ?? []
  for (const p of shot.pendingClips ?? []) {
    yield* p.references ?? []
    for (const b of p.beats ?? []) yield* b.references ?? []
  }
}

/**
 * Is this role USED by the exported slice? Three independent predicates, in
 * increasing cost, and deliberately UNION rather than intersection — carrying a
 * role the slice happens not to mention costs one dialog row, while dropping one
 * it does mention costs the importer a name with no face and no way to fix it.
 *
 *  1. a scene PIN keyed by the role (`castLook`),
 *  2. a bound reference wearing the role's name or its actor's id,
 *  3. the role's own WORD in the prose — its NAME or, since C6, the
 *     `@<role-slug>` TOKEN a cast chip serializes as. `mentionsName` weighs both
 *     spellings (`cast-rename`'s `namePattern`), which is what still makes a
 *     CHIP count here now that `renderText` no longer writes the bare name, and
 *     it is the only signal a recipe-only slice has left once its references are
 *     stripped.
 *
 * The prose predicate is asked with the cast's OTHER names reserved (R78), so
 * it asks exactly what a RENAME would answer: a "Panda 2" in the prose is that
 * role's whole name, not a use of "Panda", and the rename has refused to touch
 * it since R75b. Sharing `namePattern` was the point of lifting `shotProse`
 * out; sharing its guard finishes it. The union stays generous where it
 * matters — a role the slice mentions by any spelling of its OWN name is still
 * carried, which is what D6i's "name with no face" needs.
 */
function roleIsUsed(
  key: string,
  kind: CastKind,
  displayName: string,
  /** ABSENT for a DESCRIBED role (R5) — it has no actor, so the chip probe
   *  below never fires for it and the NAME probes carry it, which is exactly
   *  what "a name with no face" needs. */
  assetId: string | undefined,
  shots: ReadonlyArray<Shot>,
  reservedNames: ReadonlyArray<string>,
): boolean {
  for (const shot of shots) {
    if (shot.castLook?.[key]) return true
    for (const ref of shotReferences(shot)) {
      if (assetId && ref.id === assetId) return true
      if (ref.defaultName && castSlug(kind, ref.defaultName) === key) return true
    }
    for (const text of shotProse(shot)) {
      if (mentionsName(text, displayName, undefined, reservedNames)) return true
    }
  }
  return false
}

/**
 * The role sheet a bundle of `shots` carries — the rows those shots use, and
 * nothing else. `undefined` when nothing survives, so a cast-less production
 * (and a slice that mentions no role) exports byte-identically to today: the
 * omit-when-empty rule, which is also what makes a legacy bundle's import path
 * provably unchanged.
 */
export function castForShots(
  cast: Cast | undefined,
  shots: ReadonlyArray<Shot>,
): Cast | undefined {
  if (!cast) return undefined
  const out: Record<string, Cast[string]> = {}
  const entries = Object.entries(cast)
  for (const [key, member] of entries) {
    const others = entries.filter(([k]) => k !== key).map(([, m]) => m.displayName)
    if (roleIsUsed(key, member.kind, member.displayName, member.assetId, shots, others)) {
      out[key] = member
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}
