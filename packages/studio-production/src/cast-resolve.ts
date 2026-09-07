import {
  REFERENCE_ROLE_PRESETS,
  type ConnectedReference,
  type ReferenceSource,
} from "@nodaro/shared"

import { castSlug } from "./cast-keys"
import { candidateForMember, type CastCandidate } from "./cast-lookup"
import type { CastKind, CastLook, CastMember } from "./cast"

/**
 * THE REFERENCE BUILDER (R78) — the one place a cast row becomes the chip attrs
 * and the `ConnectedReference` a submit sends, plus the ROLE WORD layer (D6p)
 * that rides on it.
 *
 * Split out of `cast.ts` for size, alongside the `@name` ladder
 * (`cast-lookup.ts`). `cast.ts` re-exports every name here, so no call site
 * knows the split exists.
 *
 * THE ROLE WORD LIVES HERE, not in `cast.ts` (a deviation from the split plan,
 * for one structural reason): `withDefaultRole` is the last gate before the
 * wire and normalizes through {@link sanitizeCastRole}, and `readCast`
 * normalizes through it too. Keeping the word in `cast.ts` would make the two
 * modules import each other's VALUES at runtime; keeping it here leaves one
 * direction — `cast` → `cast-resolve` → `cast-lookup` → `cast-keys` — and the
 * only edges back are `type` imports, which are erased.
 */

/**
 * The platform reference SOURCE a cast kind materializes as — the same source
 * the candidate's own `toConnectedReference()` stamps, which is what makes the
 * role menu below show the vocabulary the resolver will actually honour.
 */
const CAST_ROLE_SOURCE: Record<CastKind, ReferenceSource> = {
  character: "wired-character",
  location: "wired-location",
  object: "wired-object",
  creature: "wired-creature",
  image: "wired-image",
}

/**
 * The curated role vocabulary for a kind — READ FROM THE PLATFORM's own
 * `REFERENCE_ROLE_PRESETS`, never a hand list here. The presets are the single
 * source of truth for the wording `roleToPhrase` knows how to say, so a
 * studio-local copy would drift into offering words it can't render.
 *
 * A preset list existing for a source does NOT mean the assembler consults the
 * ref's `defaultRole` on that source's path — {@link castRoleRenders} is the
 * gate for that, and it is the one the menu asks.
 *
 * The menu adds "default" (clear) and free text around this; neither is a
 * preset, so neither belongs in the shared constant.
 */
export function castRolePresets(kind: CastKind): ReadonlyArray<string> {
  return REFERENCE_ROLE_PRESETS[CAST_ROLE_SOURCE[kind]]
}

/**
 * Does the role's WORD actually reach the prompt for this kind? The gate on
 * offering the control at all — a pick that renders nothing is a silent no-op,
 * which is worse than no control.
 *
 * `ConnectedReference.defaultRole` is a shared field every source accepts, but
 * only some of the assembler's paths CONSULT it (`resolveDefaultRole`), and the
 * paths a studio reference takes are decided by its source:
 *
 *  - `character` — consulted on all three character paths (mention, canonical
 *    fallback, extra refs). The seat the canvas character node's dropdown fills.
 *  - `image`     — consulted by the image-mention resolver.
 *  - `location`  — NOT consulted: the location mention resolver and the location
 *    canonical render both derive the role from the usage mode instead. Studio
 *    emits a two-segment `@slug:N` token (no role segment), so nothing carries
 *    the word. TODO(nodaro): un-gate once the platform's location role chain is
 *    live on the target environment (the usual deploy-platform-first rule).
 *  - `object` / `creature` — consulted since S7, by the entity-mention resolver
 *    (`resolveEntityMentionsHybrid` calls `resolveDefaultRole(match.defaultRole,
 *    …)` for every token it binds), exactly as the image resolver does. The
 *    canonical render for an UNMENTIONED entity still hardcodes the source
 *    default, which is the same shape `image` has always had: the word reaches
 *    the prompt for a bound chip and is inert for an unbound one.
 *
 * The field itself stays end-to-end for every kind — stored, copied, serialized
 * and sent. It is schema-accepted and inert where unread, so a gated kind starts
 * working the day the platform reads it, with no studio change beyond this map.
 */
export function castRoleRenders(kind: CastKind): boolean {
  return CAST_ROLE_RENDERED[kind]
}

const CAST_ROLE_RENDERED: Record<CastKind, boolean> = {
  character: true,
  image: true,
  location: false,
  object: true,
  creature: true,
}

/**
 * The longest role word studio stores. The platform's own `sanitizeRole` caps
 * its (slug-form) roles at 32 characters; the same number bounds ours, so one
 * ceiling holds across the ecosystem.
 */
export const CAST_ROLE_MAX_LENGTH = 32

/**
 * Normalize a role word for storage: trim, collapse internal whitespace runs,
 * bound the length. Blank ⇒ `""`, which every caller reads as ABSENT.
 *
 * The bound is not cosmetic. The word is spliced VERBATIM into the assembled
 * phrase ("the <role> from reference image A") of every generation for the
 * role, and the backend takes `defaultRole` as an unbounded
 * `z.string().optional()` — so without a cap here, a paragraph pasted into the
 * Custom… box rides the wire forever with nothing downstream to stop it.
 *
 * DELIBERATELY NOT the platform's `sanitizeRole` — that slugs to `[a-z0-9-]`,
 * and this word is PROSE, not a token segment (it rides the reference, D6p).
 * Slugging would mangle the phrase and would also miss `roleToPhrase`'s one
 * multi-word special case, `"empty background"`, which matches only in its
 * SPACED form — which is likewise why the whitespace collapse earns its place:
 * a typed `"empty  background"` must land on the preset, not beside it.
 */
export function sanitizeCastRole(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, CAST_ROLE_MAX_LENGTH).trim()
}

/**
 * The longest identity DESCRIPTION studio stores — the platform's own bound for
 * the field it rides in (`z.string().max(2000)`), so one ceiling holds across
 * the ecosystem. The route REFUSES an over-long value rather than truncating
 * it, which is why the cap lives at studio's own doors: a pasted page would
 * otherwise fail the generation rather than the paste.
 */
export const CAST_DESCRIPTION_MAX_LENGTH = 2000

/**
 * Normalize a role's identity description for storage: trim and bound. Blank ⇒
 * `""`, which every caller reads as ABSENT (there is no `description: ""` — the
 * absent key IS "use the live library caption").
 *
 * DELIBERATELY NOT {@link sanitizeCastRole}'s whitespace collapse: a role word
 * is one phrase spliced into a sentence, while this is PROSE the author may
 * paragraph. Only the ends are trimmed and the length bounded.
 */
export function sanitizeCastDescription(raw: string): string {
  return raw.trim().slice(0, CAST_DESCRIPTION_MAX_LENGTH).trim()
}

/**
 * Overlay a role's LOOK onto its actor's canonical reference — byte-identical to
 * what picking that same view in the `@` picker produces
 * (`characterViewToConnectedReference` / `viewToConnectedReference` in
 * hooks/useEntities), which is the whole point: the cast changes WHICH reference
 * is built, never HOW.
 *
 * A look with no `label` can't produce a directive line, so it swaps the url
 * only — better than fabricating a nameless extra ref.
 */
export function applyCastLook(
  ref: ConnectedReference,
  look: CastLook,
): ConnectedReference {
  if (!look.url) return ref
  if (!look.label) return { ...ref, url: look.url }
  if (ref.source === "wired-character") {
    return {
      ...ref,
      url: look.url,
      variantSlug: look.variantSlug,
      variantDisplayName: look.label,
      isExtraRef: true,
      description: look.label,
    }
  }
  return { ...ref, url: look.url, isExtraRef: true, description: look.label }
}

/**
 * A `ConnectedReference` plus the per-use identity description studio sends
 * (spec `2026-09-06-reference-menu-and-described-roles-design`, R4).
 *
 * A STUDIO-LOCAL WIDENING until the platform stage's `@nodaro/shared` is
 * published and adopted (S2). It is a strict SUPERTYPE of the field set — every
 * downstream `ConnectedReference` slot takes one unchanged — and it exists at
 * all because an object literal typed as the bare shared interface fails excess
 * property checking on the new key. An older API strips the field (the route
 * zod is non-strict), so shipping ahead of the platform costs nothing.
 */
export type CastReference = ConnectedReference & {
  /** The identity description THIS use of the reference should be rendered
   *  with, in place of the actor's own library caption. */
  readonly descriptionOverride?: string
}

/**
 * The IDENTITY description a library row already carries — the caption the
 * override replaces, read off the reference the candidate itself builds rather
 * than off a second copy of the row.
 *
 * Read from the REFERENCE deliberately (a deviation from the plan's "a
 * `CastCandidate.description` from the SDK rows"): each source puts its
 * identity text in a different slot, the converters in `useEntityViews` already
 * decide which, and a per-kind copy of that decision here is exactly the drift
 * that would make "differs from the library" answer about a caption the model
 * never sees. One expression per source, addressed the way the assembler
 * addresses it.
 */
export function libraryDescription(ref: ConnectedReference): string | undefined {
  if (ref.source === "wired-character") {
    return ref.characterCanonicalDescription || ref.description || undefined
  }
  if (ref.source === "wired-location") {
    return ref.locationCanonicalDescription || ref.description || undefined
  }
  return ref.description || undefined
}

/**
 * Stamp the role's OWN words onto the reference — the per-use identity
 * description (R4), in a NEW field: `description` stays the view-label slot
 * studio has always sent, and re-purposing it would make a look label and an
 * identity line indistinguishable on the wire.
 *
 * Absent — or merely repeating the live library caption — ⇒ the SAME object
 * back. That is what keeps the wire byte-identical for every production that
 * has no description of its own, which is the parity invariant the whole
 * registry rests on; and a row that says what the library already says has
 * nothing to override.
 */
function withDescriptionOverride(
  ref: ConnectedReference,
  description: string | undefined,
  library: string | undefined,
): CastReference {
  // BOTH sides sanitized, so the comparison is like with like: the row's words
  // are stored trimmed and a library caption is whatever the entity was saved
  // with, so a raw compare would call a description that merely repeats a
  // padded caption an override.
  const own = sanitizeCastDescription(description ?? "")
  if (!own || own === sanitizeCastDescription(library ?? "")) return ref
  return { ...ref, descriptionOverride: own }
}

/**
 * A resolved role, ready to drop into the editor: the chip attrs and the rich
 * reference to record beside them — the two halves a picker pick writes.
 *
 * The DISPLAY NAME wins over the actor's library name (D6d: cast "Michal" AS
 * `@abi`), on BOTH halves — the chip renders it as prose and the reference's
 * `defaultName` + mention slug must address the same word, or the wire binder
 * would emit a token for a name the prose never says.
 */
export interface ResolvedRole {
  readonly attrs: {
    readonly entityId: string
    readonly kind: CastKind
    readonly name: string
    readonly thumbnailUrl: string | null
    readonly variant?: string
  }
  readonly reference: CastReference
}

/** Re-name a reference to the ROLE, keeping every slug in step with it. */
function renameReference(
  ref: ConnectedReference,
  kind: CastKind,
  displayName: string,
): ConnectedReference {
  if (ref.defaultName === displayName) return ref
  const next: ConnectedReference = { ...ref, defaultName: displayName }
  if (ref.characterSlug !== undefined) {
    return { ...next, characterSlug: castSlug(kind, displayName) }
  }
  if (ref.locationSlug !== undefined) {
    return { ...next, locationSlug: castSlug(kind, displayName) }
  }
  return next
}

/**
 * Stamp the role's own word onto the reference — the ONE place the cast's
 * `defaultRole` reaches the wire (D6p).
 *
 * `defaultRole` is an EXISTING shared `ConnectedReference` field (the canvas
 * character node's role dropdown fills the same seat), read by the platform's
 * `resolveDefaultRole` when a reference's own path consults it. It is stamped
 * for EVERY kind, gated for none: the field is schema-accepted on all sources
 * and inert where the assembler doesn't read it, so a kind starts rendering its
 * word the day the platform reads it, with no change here. What IS gated is
 * offering the control — see {@link castRoleRenders}.
 *
 * Absent role ⇒ the SAME object back, so a role-less production's wire stays
 * byte-identical to a chip-built one (the parity invariant).
 */
function withDefaultRole(
  ref: ConnectedReference,
  defaultRole: string | undefined,
): ConnectedReference {
  // Normalized here too, not just at the doors: this is the LAST gate before the
  // wire, so a member that reached state some other way still rides bounded.
  const role = sanitizeCastRole(defaultRole ?? "")
  return role ? { ...ref, defaultRole: role } : ref
}

/**
 * MATERIALIZE a role against its actor — the one function the editor calls to
 * turn `@abi` into a chip. Returns `null` when the actor isn't in hand.
 *
 * WIRE PARITY: with a role whose display name is the actor's own and neither a
 * look nor a `defaultRole`, this returns EXACTLY the candidate's chip attrs +
 * `toConnectedReference()` — the picker pick's output, unmodified. The guard
 * test pins that equality.
 */
export function resolveRole(
  member: CastMember,
  library: ReadonlyArray<CastCandidate>,
  /** THIS scene's pin (D6f). Absent ⇒ the role's own `defaultLook`. */
  pinnedLook?: CastLook,
): ResolvedRole | null {
  // A DESCRIBED role (no `assetId`, R5) matches no candidate and leaves here —
  // it has no actor to materialize, exactly like a bound role whose actor isn't
  // in hand. The caller's `null` branch already means "leave the name as prose".
  const actor = candidateForMember(member, library)
  if (!actor) return null
  const look = pinnedLook ?? member.defaultLook
  const base = actor.toConnectedReference()
  const looked = look ? applyCastLook(base, look) : base
  return {
    attrs: {
      // The ACTOR's own id — `member.assetId` by construction, since
      // `candidateForMember` matched on it, and the half the compiler can see
      // is a `string`.
      entityId: actor.id,
      kind: member.kind,
      name: member.displayName,
      thumbnailUrl: look?.url ?? actor.thumbnailUrl,
      ...(look?.label ? { variant: look.label } : {}),
    },
    // base → applyCastLook → renameReference → withDefaultRole →
    // withDescriptionOverride (the spec's §2.2 order). The library caption is
    // read off the CANONICAL reference, never the looked one: `applyCastLook`
    // writes the view's label into `description`, and comparing against that
    // would call every pinned scene an override.
    reference: withDescriptionOverride(
      withDefaultRole(
        renameReference(looked, member.kind, member.displayName),
        member.defaultRole,
      ),
      member.description,
      libraryDescription(base),
    ),
  }
}
