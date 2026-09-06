import type { ConnectedReference } from "@nodaro/shared"

import { castMentionRuns } from "./cast-mention-runs"
import { castKeyForName, castSlug } from "./cast-keys"
import type { Cast, CastKind, CastMember } from "./cast"

/**
 * THE `@name` LOOKUP LADDER (R78) — the TALENT POOL and everything that walks
 * it: what a typed or pasted `@name` means, and which library row a cast row is
 * bound to (spec `2026-08-31-project-cast-registry`, D6c).
 *
 * Split out of `cast.ts` purely for size, exactly as the key layer was: this
 * reads the registry and nothing in the registry reads it back, which is what
 * makes it a move rather than a refactor. `cast.ts` re-exports every name here,
 * so no call site knows the split exists — and the only edge back to it is a
 * `type` import, so the module graph stays acyclic at runtime.
 */

/**
 * The minimum a library row needs to be castable — structurally satisfied by
 * `EntityPickerItem` (hooks/useEntities), which is what every caller passes.
 * Declared here so `lib/` never imports `hooks/`.
 */
export interface CastCandidate {
  readonly id: string
  readonly kind: CastKind
  readonly name: string
  readonly thumbnailUrl: string | null
  /** The picked VIEW label; undefined = the canonical row. */
  readonly variant?: string
  readonly toConnectedReference: () => ConnectedReference
}

/**
 * The cast row a candidate enrolls as — the role name defaults to the ACTOR's
 * name (D6d: the right guess almost always, and renameable afterwards).
 *
 * Always the CANONICAL binding: a VIEW pick enrolls the role's identity, never
 * its look. Which view a given scene uses is the scene overlay's job (D6f), and
 * baking the first-picked view into the role's default would make every later
 * scene inherit a pose nobody chose.
 */
export function memberFromCandidate(c: CastCandidate): CastMember {
  return { kind: c.kind, assetId: c.id, displayName: c.name }
}

/**
 * Does this role have an ACTOR at all, or is it a DESCRIBED role — a name with
 * words and no face (spec `2026-09-06-reference-menu-and-described-roles-design`,
 * R5)? A TYPE PREDICATE rather than a boolean, so a reader that has passed the
 * gate hands its `string` to {@link castKeyForActor} / `actorKey` without a `!`,
 * and one that hasn't cannot.
 *
 * It lives HERE rather than beside `CastMember` for the same reason the role
 * words do (`cast-resolve`): the ladder below needs it as a VALUE, and an import
 * back into `cast.ts` would close the runtime line into a cycle. `cast.ts`
 * re-exports it by name, so no call site knows.
 */
export function hasActor(
  member: CastMember,
): member is CastMember & { readonly assetId: string } {
  return !!member.assetId
}

/**
 * The role already bound to this actor, if any. Enrollment is IDEMPOTENT BY
 * ACTOR: picking the same row twice reuses its role rather than minting
 * `kira-2` — the auto-suffix exists for two DIFFERENT actors colliding on a
 * name (D6a), never for one actor picked twice.
 */
export function castKeyForActor(
  cast: Cast,
  kind: CastKind,
  assetId: string,
): string | undefined {
  for (const [key, m] of Object.entries(cast)) {
    if (m.kind === kind && m.assetId === assetId) return key
  }
  return undefined
}

/**
 * THE ENROLLMENT LADDER (D6c) — what a typed or pasted `@name` means. PURE, so
 * the `@`-suggestion path, the type-ahead materializer and the paste scan all
 * ask ONE function and can never disagree about a verdict.
 *
 *  1. in the cast              → `cast` (materialize instantly)
 *  2. exactly one library hit  → `enroll` (bind + auto-enroll, toast + undo)
 *  3. two or more library hits → `ambiguous` (NEVER guess — ask)
 *  4. nothing                  → `unknown` (leave it unresolved; submit warns)
 *
 * Plus `pending`: the talent pool is still loading, so "unique" and "unknown"
 * are not yet knowable. A pending verdict must render exactly like an unresolved
 * one and re-ask later — mis-enrolling against a half-loaded, paginated library
 * is the one wrong answer that persists.
 */
export type CastVerdict =
  | { readonly kind: "cast"; readonly key: string; readonly member: CastMember }
  | { readonly kind: "enroll"; readonly candidate: CastCandidate }
  | { readonly kind: "ambiguous"; readonly candidates: ReadonlyArray<CastCandidate> }
  | { readonly kind: "unknown" }
  | { readonly kind: "pending" }

export interface CastLookupOptions {
  /** FALSE while the talent pool is still loading — forces `pending`. */
  readonly libraryReady?: boolean
  /** TRUE when the pool FAILED to load — forces `unknown` (B5). Not `pending`:
   *  the entity queries retry once and never refetch on focus, so a failed pool
   *  never settles on its own, and a verdict that says "ask me again later"
   *  leaves the name in a state nothing will ever leave. `unknown` is the
   *  honest one — the name rides as prose and the submit warns about it, which
   *  is what an unbindable name deserves. And never a MATCH: a pool that only
   *  half-arrived cannot support the uniqueness claim rung 2 makes. */
  readonly libraryErrored?: boolean
}

/**
 * The talent pool's own state, as the surfaces that hold one carry it (the
 * composer's `castRef`, the materializer's options, the token extension's
 * `resolve()`). {@link poolOptions} is the ONE conversion into
 * {@link CastLookupOptions}, so a surface can't thread `ready` and quietly
 * forget `errored` — the pair travels as one value.
 */
export interface CastPoolState {
  readonly ready: boolean
  /** REQUIRED, not optional (fix round 1, B1): the guarantee this type exists
   *  for — "a surface can't thread `ready` and forget `errored`" — is only a
   *  guarantee if omitting it fails to compile. A surface with no error channel
   *  passes `false` explicitly. */
  readonly errored: boolean
}

/** The lookup options a pool state implies. */
export function poolOptions(pool: CastPoolState): CastLookupOptions {
  return { libraryReady: pool.ready, libraryErrored: pool.errored }
}

/**
 * Walk the ladder for one typed name. Matching is by SLUG on both rungs, so
 * `"Old Library"`, `"old library"` and `"Old  Library"` are one name — the same
 * collapse the wire grammar performs, which is what keeps a cast hit and a wire
 * token addressing the same thing.
 */
export function lookupCastName(
  name: string,
  cast: Cast,
  library: ReadonlyArray<CastCandidate>,
  opts: CastLookupOptions = {},
): CastVerdict {
  const trimmed = name.trim()
  if (!trimmed) return { kind: "unknown" }
  // Rung 1 — the cast. Slug per kind is byte-identical, so one probe suffices.
  const key = castKeyForName(trimmed)
  if (!key) return { kind: "unknown" }
  const member = cast[key]
  if (member) return { kind: "cast", key, member }
  // Rung 2/3 — the talent pool, but only once it is fully in hand. A pool that
  // FAILED never will be, so it answers `unknown` rather than a `pending` that
  // nothing can ever resolve (see {@link CastLookupOptions.libraryErrored}).
  if (opts.libraryErrored) return { kind: "unknown" }
  if (opts.libraryReady === false) return { kind: "pending" }
  const matches = library.filter(
    (c) => !c.variant && castSlug(c.kind, c.name) === key,
  )
  if (matches.length === 1) return { kind: "enroll", candidate: matches[0] }
  if (matches.length > 1) return { kind: "ambiguous", candidates: matches }
  return { kind: "unknown" }
}

/**
 * The library row a cast member resolves to — the ACTOR, found by id + kind.
 * Undefined when the actor isn't in hand (a deleted row, or a page not loaded);
 * the caller then leaves the name as prose, exactly as today.
 */
export function candidateForMember(
  member: CastMember,
  library: ReadonlyArray<CastCandidate>,
): CastCandidate | undefined {
  return library.find(
    (c) => !c.variant && c.id === member.assetId && c.kind === member.kind,
  )
}

/**
 * The DESCRIBED role a verdict names, if that is what it names: a `cast` hit
 * whose member has no actor — words and no face (spec
 * `2026-09-06-reference-menu-and-described-roles-design`, R5). Undefined for
 * every other verdict, a BOUND `cast` hit included.
 *
 * ONE reader for the two surfaces that must agree about it — the editor's
 * unresolved decoration and the submit warning. Both used to see such a name as
 * `unknown` and say so; enrolling it made it a `cast` verdict and both fell
 * silent, so a name that binds to nothing started riding with no signal at all.
 * S2 replaces this with the hollow chip and the described wire channel; until
 * then the words ride as prose, and both surfaces say so.
 *
 * It hands back the MEMBER rather than answering yes/no, so the decoration can
 * quote the role's own words without asking the cast a second question — and it
 * is not a type predicate, because the negative branch must keep the BOUND
 * `cast` verdict that a `verdict is …cast` narrowing would subtract.
 */
export function facelessRole(verdict: CastVerdict): CastMember | undefined {
  if (verdict.kind !== "cast" || hasActor(verdict.member)) return undefined
  return verdict.member
}

// ── unresolved tokens ────────────────────────────────────────────────────────

/** Longest-first name candidates for one `@` run ("Old Library Annex" first). */
function namePrefixes(run: string): string[] {
  const words = run.split(/[ \t]+/).filter(Boolean)
  const out: string[] = []
  for (let n = words.length; n >= 1; n -= 1) out.push(words.slice(0, n).join(" "))
  return out
}

/** One `@name` occurrence the prose carries, with its verdict. */
export interface CastToken {
  /** The name as typed, without the `@`. */
  readonly name: string
  /** Index of the `@` in the source text. */
  readonly start: number
  /** Index one past the name's last character. */
  readonly end: number
  readonly verdict: CastVerdict
}

/**
 * Every typed `@name` in `text`, each walked through the ladder. Chips do NOT
 * appear here — not because a chip is `@`-less (since C6 it serializes as
 * `@<role-slug>`), but because the editor never hands this function a chip's
 * serialization: the caller reads TEXT nodes only (`castScanRuns`, whose
 * docblock is the sibling half of this one). That is what keeps a leftover `@`
 * the signal that a name has no face, and what lets the materializer converge —
 * a token it turns into a chip leaves this reading entirely.
 *
 * The longest matching prefix wins per occurrence, so `@Old Library` resolves to
 * the two-word role rather than to a role called "Old"; when nothing matches,
 * the FIRST word carries the unresolved verdict (the smallest honest claim).
 */
export function scanCastTokens(
  text: string,
  cast: Cast,
  library: ReadonlyArray<CastCandidate>,
  opts: CastLookupOptions = {},
): CastToken[] {
  const out: CastToken[] = []
  for (const { run, start } of castMentionRuns(text)) {
    let fallback: CastToken | null = null
    let resolved: CastToken | null = null
    for (const name of namePrefixes(run)) {
      const verdict = lookupCastName(name, cast, library, opts)
      const token: CastToken = {
        name,
        start,
        end: start + 1 + name.length,
        verdict,
      }
      // Only a DECIDED verdict claims the longer run. `unknown` and `pending`
      // keep walking down to shorter prefixes — a pool that hasn't loaded must
      // not let "@Solo waits" swallow the sentence and warn about the verb.
      if (verdict.kind === "cast" || verdict.kind === "enroll" || verdict.kind === "ambiguous") {
        resolved = token
        break
      }
      // Last write wins ⇒ the SHORTEST prefix (the first word): the smallest
      // honest claim about what the user meant to name.
      fallback = token
    }
    const token = resolved ?? fallback
    if (token) out.push(token)
  }
  return out
}

/** The `@names` in the prose that bind to nothing — what the submit warns about
 *  (D6c-4: a name without a face never rides silently again). A DESCRIBED role
 *  is listed too: it is cast, but its words ride as prose until S2's described
 *  channel ships, so "without a face" is still literally what it is. */
export function unresolvedCastNames(
  text: string,
  cast: Cast,
  library: ReadonlyArray<CastCandidate>,
  opts: CastLookupOptions = {},
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of scanCastTokens(text, cast, library, opts)) {
    // A DESCRIBED role is the one `cast` verdict that still reaches no face
    // ({@link facelessRole}), so it keeps warning; every other binding verdict
    // is on its way to a chip.
    const binds =
      !facelessRole(t.verdict) &&
      (t.verdict.kind === "cast" || t.verdict.kind === "enroll")
    if (binds) continue
    if (seen.has(t.name)) continue
    seen.add(t.name)
    out.push(t.name)
  }
  return out
}
