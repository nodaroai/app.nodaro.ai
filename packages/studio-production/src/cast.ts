import { CAST_KIND_LIST } from "./format/schema"
import { isMentionSegment } from "./mention-grammar"
import {
  availableCastKey,
  castKeyForName,
  castSlug,
  suffixedDisplayName,
} from "./cast-keys"
import { sanitizeCastDescription, sanitizeCastRole } from "./cast-resolve"

// Re-exported off the local bindings above, so each name is written once:
// every existing `import { castSlug } from "./cast"` is unchanged by R74's
// split.
export { availableCastKey, castKeyForName, castSlug, suffixedDisplayName }
// The `@`-run reading lives in its own module (the importer's gate signal reads
// it without any of the cast machinery), re-exported here so every
// `import { castMentionRuns } from "./cast"` keeps working.
export { castMentionRuns } from "./cast-mention-runs"
export type { CastMentionRun } from "./cast-mention-runs"
// R78's split, done: the `@name` LOOKUP LADDER and the REFERENCE BUILDER moved
// to `cast-lookup.ts` / `cast-resolve.ts` for size, exactly as the key layer
// did — they read the registry and nothing here reads them back, which is what
// made it a move rather than a refactor. Re-exported by name so no call site
// knows the split exists; both siblings take only `type` imports from this
// file, so the runtime graph is a line: cast → cast-resolve → cast-lookup →
// cast-keys.
export {
  candidateForMember,
  castKeyForActor,
  facelessRole,
  hasActor,
  lookupCastName,
  memberFromCandidate,
  poolOptions,
  scanCastTokens,
  unresolvedCastNames,
} from "./cast-lookup"
export type {
  CastCandidate,
  CastLookupOptions,
  CastPoolState,
  CastToken,
  CastVerdict,
} from "./cast-lookup"
export {
  applyCastLook,
  CAST_DESCRIPTION_MAX_LENGTH,
  CAST_ROLE_MAX_LENGTH,
  castRolePresets,
  castRoleRenders,
  libraryDescription,
  resolveRole,
  sanitizeCastDescription,
  sanitizeCastRole,
} from "./cast-resolve"
export type { CastReference, ResolvedRole } from "./cast-resolve"

/**
 * THE PROJECT CAST REGISTRY — a production-local map from a ROLE NAME to the one
 * ACTOR it means (spec `2026-08-31-project-cast-registry`).
 *
 * The model in one line: **a cast row is a ROLE; a library asset is an ACTOR.**
 * Prompts address roles by name (`@abi is walking in the @park`); this registry
 * says what each name means; the account library is the *talent pool*, consulted
 * exactly once at enrollment and never during resolution (D6d — enrollment is a
 * COPY, not a link).
 *
 * WIRE-NEUTRAL BY CONSTRUCTION. Nothing here reaches `nodes.run`. A resolved
 * role materializes an ORDINARY entity chip — the same attrs a picker pick
 * writes, the same `ConnectedReference` its `toConnectedReference()` yields — so
 * `collectReferences` → `bindMentionTokens` (spec `2026-08-30-structured-prompt-
 * assembly`, D1) see exactly what they see today. That is what makes the wire
 * byte-parity invariant structural rather than aspirational: there is no second
 * reference builder and no second submit channel to keep in step.
 *
 * THE KEY LAYER — `castSlug`, `availableCastKey`, `suffixedDisplayName`,
 * `castKeyForName` — lives in `cast-keys.ts` (R74, split for size), the `@name`
 * LADDER in `cast-lookup.ts` and the REFERENCE BUILDER in `cast-resolve.ts`
 * (R78); all three are re-exported here unchanged. What stays in this file is
 * the ROW itself — the shapes, enrollment, removal and the persisted blob's
 * reading and copying.
 */

/** The kinds a role can be bound to — the chip kinds, one-for-one. */
export type CastKind = "character" | "location" | "object" | "creature" | "image"

// Named `PANEL`, not `CAST_KINDS`, because `production-format/schema.ts` owns
// that name for a DIFFERENT list — the plan format's four importable entity
// kinds (no `image`, since a plan entry proposes an entity to create, never a
// bare image reference). This one adds `image` because a persisted row may
// carry one — `readCast` accepts it, though no writer mints one today
// (`cast-merge` refuses the kind outright).
//
// DERIVED from those four rather than restating them: a fifth entity kind
// lands here by construction, and if {@link CastKind} were not widened with it
// the spread stops typechecking — the compiler asks, instead of a comment
// asking the next author to remember one more list.
const CAST_PANEL_KINDS: ReadonlyArray<CastKind> = [...CAST_KIND_LIST, "image"]

/**
 * A LOOK — one specific view/variant of the bound actor (D6f). `variantSlug` is
 * the platform's own variant key (a character's `angles:back`), `label` its
 * display name ("back"); absent = the actor's canonical image.
 */
export interface CastLook {
  readonly url: string
  readonly variantSlug?: string
  readonly label?: string
}

/** One cast row: the role's binding + its default look + its display casing. */
export interface CastMember {
  readonly kind: CastKind
  /**
   * The bound actor: an entity row id, or the image ref id for kind `image`.
   *
   * ABSENT = a DESCRIBED ROLE — a name with words and no face (spec
   * `2026-09-06-reference-menu-and-described-roles-design`, R5). Never `""`: an
   * empty string would collapse every equality reader ({@link castKeyForActor},
   * `castKeyForAsset`, `enrollOne`, the import probes) onto one actor, where
   * `undefined` never equals a real id — and the compiler then enumerates the
   * readers that must decide. {@link hasActor} is the predicate; nothing reads
   * the field's truthiness by hand.
   */
  readonly assetId?: string
  /** Default look — absent = the actor's canonical image. */
  readonly defaultLook?: CastLook
  /**
   * The role PHRASE this role rides with — the WORD the prompt should use for
   * the reference ("panda", "clothes", "background"). Free text stored as typed,
   * normalized by {@link sanitizeCastRole}; absent = the platform's own default
   * for the reference's source.
   *
   * It rides on the REFERENCE, never on the mention token (D6p): the character
   * grammar's third token segment is a VARIANT, so a role smuggled into the
   * token would parse as a view of the actor. `resolveRole` stamps it onto the
   * `ConnectedReference.defaultRole` the platform reads for SOME reference
   * sources (`resolveDefaultRole`), which is exactly the seat a canvas character
   * node's role dropdown fills. Which sources those are is not uniform — see
   * {@link castRoleRenders}, the gate on offering the control at all.
   */
  readonly defaultRole?: string
  /**
   * The role's own IDENTITY DESCRIPTION — what this name looks like, in words,
   * for the whole production. Hand-written; ABSENT means "use the live library
   * caption", so there is no `descriptionSource` field to keep in step:
   * PRESENCE IS THE SOURCE, "reset to library" deletes the key, and the caption
   * is read at resolve time rather than copied here (a stored copy would freeze
   * a caption the library later changes).
   *
   * It is the ONE thing a DESCRIBED role (no {@link assetId}) has to say, and a
   * bound role may carry it too — then it rides the wire as the per-use
   * `descriptionOverride` instead of the actor's own caption.
   */
  readonly description?: string
  /**
   * Display casing for the prose ("Abi"); the KEY stays the slug.
   *
   * **INV-C:** `castSlug(kind, displayName) === <key>` for every row. The whole
   * registry rests on it — the wire addresses a reference by the slug of its
   * `defaultName`, so a key that disagreed with its display name would bind a
   * token the cast never promised. {@link readCast} re-keys on read, so the
   * invariant holds even for a blob hand-edited on the canvas.
   */
  readonly displayName: string
}

/** `settings.studio.cast` — the role sheet, keyed by the role's slug. */
export type Cast = Readonly<Record<string, CastMember>>

/**
 * `Shot.castLook` — the SCENE LOOK OVERLAY (D6f): which view of the one true
 * actor THIS scene uses, keyed by the same role slug the cast is. Sticky per
 * scene, falls back to the cast row's `defaultLook`, and reset LOUDLY by a
 * recast (a pin is a view of the OLD actor — see `recastCastMember`).
 */
export type CastLookMap = Readonly<Record<string, CastLook>>

/**
 * THE ROLE'S PROSE TOKEN (C6 — "the prose IS the grammar", spec D6g).
 *
 * A cast chip serializes as `@<role-slug>` rather than as its bare name, so the
 * persisted prompt SAYS what it binds: `@stylized-cartoon-horse and @panda-2
 * walking in @sunspire-valley` survives a copy, a paste, an export and a
 * re-open, where three bare nouns did not. The role slug is the cast KEY
 * (INV-C), so a token round-trips through {@link castKeyForName} unchanged —
 * which is what lets the C2 materializer rebuild the chip from the token with
 * no new tokenizer.
 *
 * `null` when the key can't be a mention segment. `isMentionSegment` is the
 * WIRE binder's own grammar class, imported rather than copied: a token the
 * prose emits but `bindMentionTokens` refuses would reach the model literally.
 * (`castSlug` can emit "" for an unsluggable name and a digit-led slug for
 * "3D Render" — both are exactly that case.) Those roles keep their bare name,
 * which is what they had before the token existed.
 */
export function roleToken(key: string): string | null {
  return key && isMentionSegment(key) ? `@${key}` : null
}

/**
 * The role a CHIP renders — the one predicate the serializer and the submit
 * seam share, so the prose can never claim a binding the wire won't make (or
 * hide one it will).
 *
 * A VIEW chip (`variant` set) is not a role: it is a deliberate one-off pick of
 * a specific image, which `resolveChipThroughCast` leaves alone for the same
 * reason and which has no role slug to say.
 */
export function castKeyForChip(
  attrs: { readonly name: string; readonly variant?: string },
  cast: Cast,
): string | null {
  if (attrs.variant) return null
  const key = castKeyForName(attrs.name)
  return key && cast[key] ? key : null
}

/**
 * ENROLL a role. Returns the cast with the new row plus the key it landed on —
 * suffixed when the name was taken, never an overwrite (D6a). Copy-on-write.
 *
 * A blank slug (an unsluggable name — Hebrew, emoji) enrolls NOTHING: it could
 * never be addressed by name, which is the only thing a cast row is for.
 */
export function enrollCastMember(
  cast: Cast,
  member: CastMember,
): { readonly cast: Cast; readonly key: string } | null {
  const base = castSlug(member.kind, member.displayName)
  if (!base) return null
  const key = availableCastKey(cast, base)
  const displayName = suffixedDisplayName(member.kind, member.displayName, key)
  return {
    cast: { ...cast, [key]: { ...member, displayName } },
    key,
  }
}

/** Remove a role. Returns the SAME object when the key isn't cast (no churn). */
export function removeCastMember(cast: Cast, key: string): Cast {
  if (!(key in cast)) return cast
  const next = { ...cast }
  delete next[key]
  return next
}

/** The cast rows in stable display order (by display name, then key). */
export function castEntries(
  cast: Cast,
): ReadonlyArray<{ readonly key: string; readonly member: CastMember }> {
  return Object.entries(cast)
    .map(([key, member]) => ({ key, member }))
    .sort(
      (a, b) =>
        a.member.displayName.localeCompare(b.member.displayName) ||
        a.key.localeCompare(b.key),
    )
}

/** Deep copy for the serialize path — the persisted blob never aliases state. */
export function copyCast(cast: Cast): Cast {
  const out: Record<string, CastMember> = {}
  for (const [key, m] of Object.entries(cast)) {
    // `assetId` stays in the position it has always held, written CONDITIONALLY
    // rather than moved: a described role must not serialize an `assetId` key
    // at all (R5), and a bound one must serialize byte-identically to the way
    // it did before described roles existed.
    out[key] = {
      kind: m.kind,
      ...(m.assetId ? { assetId: m.assetId } : {}),
      displayName: m.displayName,
      ...(m.defaultLook ? { defaultLook: { ...m.defaultLook } } : {}),
      ...(m.defaultRole ? { defaultRole: m.defaultRole } : {}),
      ...(m.description ? { description: m.description } : {}),
    }
  }
  return out
}

/** Deep copy of a scene's look overlay — same no-aliasing rule as {@link copyCast}. */
export function copyCastLook(look: CastLookMap): CastLookMap {
  const out: Record<string, CastLook> = {}
  for (const [key, l] of Object.entries(look)) out[key] = { ...l }
  return out
}

/** Remove one role's pin. Returns the SAME object when unpinned (no churn). */
export function removeCastLook(look: CastLookMap, key: string): CastLookMap {
  if (!(key in look)) return look
  const next = { ...look }
  delete next[key]
  return next
}

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined

function readLook(value: unknown): CastLook | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined
  }
  const rec = value as Record<string, unknown>
  const url = readString(rec.url)
  if (!url) return undefined
  const variantSlug = readString(rec.variantSlug)
  const label = readString(rec.label)
  return {
    url,
    ...(variantSlug ? { variantSlug } : {}),
    ...(label ? { label } : {}),
  }
}

/**
 * Narrow a persisted `settings.studio.cast` blob back to a {@link Cast}.
 * UNTRUSTED (the workflow is canvas-editable), so malformed rows are dropped
 * rather than trusted, exactly like `readReferences` / `readTrash`.
 *
 * RE-KEYS on read: the surviving key is `castSlug(kind, displayName)`, so INV-C
 * is true of anything this returns. First row per key wins — the same
 * first-per-slug rule the wire binder uses (D1a), so a hand-edited duplicate
 * degrades to "one of them" rather than to a silent identity swap.
 *
 * `undefined` when nothing survives, so a cast-less production stays
 * byte-identical through a round-trip (the omit-when-empty rule).
 */
export function readCast(value: unknown): Cast | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined
  }
  const out: Record<string, CastMember> = {}
  for (const raw of Object.values(value as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue
    const rec = raw as Record<string, unknown>
    const kind = CAST_PANEL_KINDS.find((k) => k === rec.kind)
    // `readString` answers ABSENT for `""`, which is R5 on the read side: a
    // hand-edited (or pre-R5) `assetId: ""` reads back as a described role
    // rather than as an actor every other empty row also claims to be.
    const assetId = readString(rec.assetId)
    const displayName = readString(rec.displayName)
    if (!kind || !displayName) continue
    // A DESCRIBED role of kind `image` is dropped: an image row's "actor" IS
    // the media url it carries, so a face-less one names nothing this app can
    // resolve, describe or bind. Every other kind reads without an actor.
    if (!assetId && kind === "image") continue
    const key = castSlug(kind, displayName)
    if (!key || key in out) continue
    const defaultLook = readLook(rec.defaultLook)
    // Normalized on read as well as on write: the blob is canvas-editable (and
    // arrives from imports), so it is the very vector a UI cap can't cover — a
    // role of `"  "` must read as ABSENT, and an unbounded one must be bounded.
    const defaultRole = sanitizeCastRole(readString(rec.defaultRole) ?? "")
    const description = sanitizeCastDescription(readString(rec.description) ?? "")
    out[key] = {
      kind,
      ...(assetId ? { assetId } : {}),
      displayName,
      ...(defaultLook ? { defaultLook } : {}),
      ...(defaultRole ? { defaultRole } : {}),
      ...(description ? { description } : {}),
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Narrow a persisted `Shot.castLook` blob (untrusted, canvas-editable) to a
 * {@link CastLookMap}. A malformed pin is DROPPED, which degrades that scene to
 * the cast default — always safe, exactly like `readLookMap`'s whole-map drop.
 *
 * `undefined` when nothing survives, so an un-pinned scene round-trips
 * byte-identically (the omit-when-empty rule).
 */
export function readCastLookMap(value: unknown): CastLookMap | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined
  }
  const out: Record<string, CastLook> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key) continue
    const look = readLook(raw)
    if (look) out[key] = look
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * The prose token a role called `name` would render as — {@link roleToken} of
 * its key. The CAST-FREE half of the token grammar: the restore path
 * (`buildPromptDoc`), the rename and the export projection all have a display
 * name in hand and no registry, and all three must read the token the chip
 * actually wrote. `null` when the name can't address anything.
 */
export function roleTokenForName(name: string): string | null {
  return roleToken(castKeyForName(name))
}
