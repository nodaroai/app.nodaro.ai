import {
  entityMentionSlugForRef,
  imageMentionSlugForRef,
  knownImageSlugsFromRefs,
  type ConnectedReference,
} from "@nodaro/shared"

import { roleTokenForName, type CastKind } from "./cast"
import {
  MENTION_SEGMENT,
  TOKEN_TRAILING,
  isWholeToken,
} from "./mention-grammar"
import { untokenizeRoleReferences } from "./role-prose"

export { isMentionSegment } from "./mention-grammar"

/** Existing raw mention tokens in the prose — the platform autocomplete's own
 *  scan (`nextMentionIndex`, picker-ui `build-ref-pill-nodes.ts`): the unified
 *  `@<slug>:N` counter continues from the highest N already typed. */
const EXISTING_MENTION_RE =
  /(?:^|[^a-zA-Z0-9])@[a-z][a-z0-9-]*:(\d+)(?::(?:[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*|[a-z][a-z0-9-]*))?(?::(?:[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*|[a-z][a-z0-9-]*))?/g

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** The text that must NOT follow a token emitted under the SHORT (2-or-3
 *  segment) grammar — named images, creatures and objects — mirroring the two
 *  guards their finders apply and the character/location ones don't: the
 *  `(?![:a-z0-9-])` lookahead (letters/digits are already excluded by the
 *  binder's own name boundary, leaving `:` and `-`) and the `/<segment>` slash
 *  guard. Both live in the platform's shared `mention-token-grammar.ts`, which
 *  `findImageMentionTokens` and `findEntityMentionTokens` are two views of, so
 *  the one rule here covers all three kinds. Anything matching makes the
 *  platform reject the whole token. */
const SHORT_GRAMMAR_TRAILING_REJECT = /^(?:[:-]|\/[a-z])/

/**
 * What a framing submit sends: the mention-bound WIRE prompt and the reference
 * list it is bound against. The two are ONE decision — a token is only legal
 * for a ref the platform can address (`imageMentionSlugForRef`), and for an
 * image chip that means the wire ref drops `isExtraRef`. Emitting one without
 * the other either leaks a literal `@ref-1:1` to the model (token, no stripped
 * ref) or silently loses the ref's directive line (stripped ref, no token).
 */
export interface MentionBinding {
  readonly wirePrompt: string
  /** The SAME array instance as the input when nothing was stripped. */
  readonly wireReferences: ReadonlyArray<ConnectedReference>
}

/**
 * An image chip's WIRE shape: the platform's own
 * `toConnectedReference({ kind: "image", … })` output — `isExtraRef` and the
 * synthetic `description` OMITTED (not set `false`/`""`), because
 * `imageMentionSlugForRef` refuses `isExtraRef === true` refs outright
 * (`packages/shared/src/image-mention-slug.ts:198-204`): an extra renders its
 * own directive body line, so letting a mention bind one too would double-emit
 * the same prose.
 */
function toWireImageRef(r: ConnectedReference): ConnectedReference {
  // Rest-destructure so the keys are ABSENT, not present-and-falsy — the
  // platform gate reads `isExtraRef === true`, but the shape parity with
  // `toConnectedReference` is what keeps this reviewable.
  const { isExtraRef: _isExtraRef, description: _description, ...rest } = r
  return rest
}

/**
 * The FRAMING wire prompt with each bound chip's NAME rewritten into the
 * platform's mention grammar — `@<slug>:<index>` — so `/v1/generate-image`
 * resolves the reference INLINE (identity directive + canonical description +
 * attachment) instead of degrading it to the nameless trailing role phrase
 * ("the person from reference image A") the hybrid canonical fallback emits for
 * unmentioned wired refs (spec 2026-08-30-structured-prompt-assembly, D1).
 *
 * The `<index>` mirrors the canvas autocomplete's rule exactly (picker-ui
 * `nextMentionIndex`): one unified counter across characters, locations AND
 * named images, starting at `max(existing N in the prose) + 1`, incrementing
 * per bound occurrence in reading order. It is correlation on the hybrid path
 * but POSITIONAL text in the legacy resolver's `Image N (Name)` bullets, which
 * is why studio must not invent its own rule (spec D1). Images have no legacy
 * resolver at all, so for them the index is pure correlation.
 *
 * FIVE KINDS, ONE PRECEDENCE (S7). The platform resolves mentions
 * character → location → image → creature → object, each pass splicing its
 * matched tokens out before the next runs (`buildImagePrompt`'s Phase 0), and
 * this function claims slugs in that same order. Creature and object are ONE
 * platform pass whose slug → ref map is built creature-first
 * (`resolveEntityMentionsHybrid`), so they share ONE claim space here and the
 * creature is simply iterated first — seeding between them would block every
 * object with its own slug. A mentioned creature/object also drops out of the
 * trailing canonical block (`objCoveredUrls`), which is what makes the inline
 * binding a MOVE of the prose rather than a second copy of it.
 *
 * PER-KIND `isExtraRef` RULE — not "canonical chips only" any more (S4):
 *  - a character / location / creature / object VIEW chip keeps riding the
 *    `isExtraRef` channel untouched: it already attaches its exact image with a
 *    directive line, and mentioning it as well risks a double attach until the
 *    platform's mention↔extra-ref interplay is pinned. For the two entity kinds
 *    that skip costs nothing to write — `entityMentionSlugForRef` refuses an
 *    extra ref itself, so the platform predicate IS the rule;
 *  - an IMAGE chip's `isExtraRef` is a studio convention
 *    (`imageRefToConnectedReference`), and it is STRIPPED on the wire for
 *    exactly the refs a token was emitted for. The trade: that chip loses its
 *    trailing `Ref 1 (reference image A).` directive and gains an inline
 *    `reference image A` at the chip's own prose position — the directive's
 *    only content was the name→slot link, which the mention makes positional
 *    and direct. An UNBOUND image chip (name not in the prose, unsluggable
 *    name, no url, a slug a higher-precedence kind already claimed) keeps the
 *    directive exactly as today, which is why the strip is per-reference and
 *    conditional on a token actually being emitted.
 *
 * DUPLICATE SLUGS — FIRST PER SLUG (spec D1 edge rules, amended by S4). The
 * first reference claiming a slug binds; every later reference on that slug is
 * left alone and keeps today's directive line. This is what the shipped
 * platform resolver already does (`resolveImageMentionsHybrid`'s
 * `if (!bySlug.has(slug))`), and it is the slug-level lift of the name-level
 * first-wins this function has always had. Two tokens on one slug is the
 * forbidden state: they would point the model at image A twice and leave B
 * unexplained.
 *
 * CROSS-KIND PRECEDENCE IS SEEDED FROM THE PLATFORM'S OWN SLUG DERIVATIONS.
 * A lower-precedence pass is blocked by every slug a higher-precedence kind
 * merely KNOWS, not by the subset this binder considers bindable. The platform
 * derives `knownCharacterSlugs` / `knownLocationSlugs` from every ref's
 * `characterSlug` / `locationSlug` with no url / `isExtraRef` / variant filter
 * (`prompt-builder.ts`). So a location VIEW chip — `isExtraRef`, no
 * `locationVariantSlug`, which this binder skips — still keys the platform's
 * location `bySlug` map and would STEAL a token an image chip on the same slug
 * emitted, binding the board's image at the image chip's prose position while
 * the named image attached with no directive at all. Seeding the claim set per
 * pass is what closes that.
 *
 * IMAGES HAVE NO "UNFILTERED" SET to seed the entity passes from, and inventing
 * one would be wrong rather than conservative: `isExtraRef` is a gate the
 * platform's OWN `knownImageSlugsFromRefs` applies, and the set it will compute
 * is the one over the refs STUDIO SENDS. Those are the stripped ones (already
 * in the claim set, via the image pass's own `claim`) plus any raw ref the
 * predicate accepts as-is — which is exactly `knownImageSlugsFromRefs` over the
 * input. Their union is the superset seeded before the entity passes.
 *
 * TWO PROSE FORMS, ONE PASS (C6). A chip serializes either as its bare NAME
 * (un-enrolled / legacy / a VIEW pick) or — once its entity is a role in the
 * production's cast — as the `@<role-slug>` TOKEN. Both bind here, in one
 * combined pattern so the `<index>` counter still runs in reading order. The
 * token map is derived from the claims, never from the cast: the role slug IS
 * the reference's mention slug (`resolveRole` renames both together), so this
 * module needs no registry import and a bundle-imported prompt binds the same.
 * A widening falls out and is correct: a hand-typed lowercase `@kira` now binds
 * when a reference claims the `kira` slug — reachable only when that reference
 * is actually present, which is precisely when the model should see it.
 *
 * Matching mirrors {@link import("./directing-references").bindReferenceTokens}:
 * every whole-word occurrence, EXACT case (catalog terms fold lowercase; a chip
 * named "Iris" must not bind `iris wipe`), longest name first in one pass. The
 * boundary before a name additionally excludes `@`, so a typed `@Jack Mercer`
 * is never rewritten into `@@jack-mercer:1` — it stays literal, exactly as
 * today. WIRE-ONLY: callers persist the RAW prose AND the RAW references, so
 * chips restore by name (or by token) and an unbound chip's fallback is
 * unchanged.
 *
 * The trailing boundary is STRICTER FOR THE SHORT GRAMMAR — images, creatures
 * and objects ({@link SHORT_GRAMMAR_TRAILING_REJECT}) — because the platform's
 * finders for those kinds are: they alone carry a `(?![:a-z0-9-])` lookahead
 * plus a `/<segment>` post-match guard, both deliberate collision guards
 * against the character/location grammars (the shared
 * `packages/shared/src/mention-token-grammar.ts`). Emitting a token the finder
 * then refuses is the one state worse than not binding at all — the ref is
 * ALREADY stripped, so the model gets a literal `@ref-1:1-lit` and an
 * unexplained attachment. The occurrence is left as prose instead; the rule is
 * per OCCURRENCE, so a clean occurrence of the same chip elsewhere still binds.
 */
export function bindMentionTokens(
  prompt: string,
  references: ReadonlyArray<ConnectedReference>,
): MentionBinding {
  if (!prompt || references.length === 0)
    return { wirePrompt: prompt, wireReferences: references }
  // First chip wins a name (two chips sharing a label can't fight over it) AND
  // first chip wins a SLUG, across all three kinds, in the platform's own
  // precedence order (character → location → image). The claim set is what
  // stops two different names collapsing onto one slug — the case S1's
  // name-only map missed.
  const byName = new Map<string, { slug: string; ref: ConnectedReference }>()
  const claimed = new Set<string>()
  // The WIRE shape for each image ref a token may be emitted for; only the ones
  // the replace actually consumed are swapped in below.
  const mediaWire = new Map<
    ConnectedReference,
    { slug: string; wireRef: ConnectedReference }
  >()
  // Every ref claimed under the SHORT grammar — images, creatures, objects. It
  // is a SUPERSET of `mediaWire`'s keys on purpose: an entity claim needs the
  // stricter trailing guard just as much, and it needs no wire strip at all, so
  // the guard cannot piggyback on the strip map.
  const shortGrammar = new Set<ConnectedReference>()
  const claim = (
    name: string,
    slug: string,
    ref: ConnectedReference,
  ): boolean => {
    // TRAP: the replace pattern is built from NAMES while the claim set holds
    // SLUGS. A candidate skipped for an already-claimed slug must NOT
    // contribute its name to the pattern — its prose occurrence stays plain
    // prose and its reference passes through untouched (an image chip thereby
    // keeps `isExtraRef` and its directive line). Skipping BEFORE `byName.set`
    // is what achieves that.
    if (!name || byName.has(name) || claimed.has(slug)) return false
    claimed.add(slug)
    byName.set(name, { slug, ref })
    return true
  }

  for (const r of references) {
    if (!r.url || r.isExtraRef) continue
    if (r.source !== "wired-character" || r.variantSlug || !r.characterSlug)
      continue
    if (!MENTION_SEGMENT.test(r.characterSlug)) continue
    claim(r.defaultName.trim(), r.characterSlug, r)
  }
  // Characters outrank locations: every slug the platform's character finder
  // KNOWS is off-limits below, bindable here or not (see the header note).
  for (const r of references) if (r.characterSlug) claimed.add(r.characterSlug)
  for (const r of references) {
    if (!r.url || r.isExtraRef) continue
    if (r.source !== "wired-location" || r.locationVariantSlug || !r.locationSlug)
      continue
    if (!MENTION_SEGMENT.test(r.locationSlug)) continue
    claim(r.defaultName.trim(), r.locationSlug, r)
  }
  // …and locations outrank images, on the same unfiltered basis.
  for (const r of references) if (r.locationSlug) claimed.add(r.locationSlug)
  for (const r of references) {
    // NOT gated on `isExtraRef` — for an image chip that flag is what S4
    // removes, never a reason to skip. Build the wire candidate FIRST, then ask
    // the PLATFORM predicate whether it is addressable (source, url,
    // defaultName, and the unexported slug grammar — re-deriving that pattern
    // here is exactly the drift this import prevents).
    const wireRef = toWireImageRef(r)
    const slug = imageMentionSlugForRef(wireRef)
    if (!slug) continue
    if (!claim(r.defaultName.trim(), slug, r)) continue
    mediaWire.set(r, { slug, wireRef })
    shortGrammar.add(r)
  }
  // …and images outrank creatures and objects (see the header note on why the
  // seed is a union rather than an "unfiltered" set).
  for (const s of knownImageSlugsFromRefs(references)) claimed.add(s)
  // ONE claim space for the two entity kinds, creature FIRST — the platform
  // resolves both in a single pass whose slug → ref map is built creature-first,
  // so a name two kinds share resolves as the creature.
  for (const source of ["wired-creature", "wired-object"] as const) {
    for (const r of references) {
      if (r.source !== source) continue
      // The PLATFORM predicate, whole — source, `isExtraRef`, url, defaultName
      // and the unexported slug grammar. Unlike images there is nothing to
      // strip: a canonical entity chip is already the wire shape, and a VIEW
      // chip's `isExtraRef` is a deliberate one-off image pick (as for a
      // character or location view), which the predicate refuses on its own.
      const slug = entityMentionSlugForRef(r)
      if (!slug) continue
      if (claim(r.defaultName.trim(), slug, r)) shortGrammar.add(r)
    }
  }
  if (byName.size === 0)
    return {
      wirePrompt: untokenizeRoleReferences(prompt, references),
      wireReferences: references,
    }

  // Continue the prose's own mention counter (the canvas autocomplete rule).
  let nextIndex = 1
  for (const m of prompt.matchAll(EXISTING_MENTION_RE)) {
    const n = parseInt(m[1], 10)
    if (Number.isInteger(n) && n >= nextIndex) nextIndex = n + 1
  }

  const names = [...byName.keys()].sort((a, b) => b.length - a.length)
  // THE PROSE FORM OF A CAST CHIP (C6). A chip whose entity is enrolled in the
  // production's cast serializes as `@<role-slug>` rather than as its bare name
  // (`lib/cast`'s `roleToken`), so the persisted prompt is self-describing —
  // "the prose IS the grammar" (spec 2026-08-31-project-cast-registry, D6g).
  // The binder needs NO cast knowledge to honour it: the role slug and the
  // reference's own mention slug are the same string by construction
  // (`resolveRole`'s rename keeps `characterSlug`/`locationSlug`/`defaultName`
  // in step with the role's display name), so the token map is derived
  // MECHANICALLY from the claims above. A slug a claim skipped contributes no
  // token, exactly as a skipped name contributes no name.
  const byToken = new Map<string, { slug: string; ref: ConnectedReference }>()
  for (const c of byName.values()) byToken.set(c.slug, c)
  const slugs = [...byToken.keys()].sort((a, b) => b.length - a.length)
  // ONE pattern over both forms, not two passes: the `<index>` counter runs in
  // READING ORDER (the canvas autocomplete's rule), and two passes would number
  // every token before every name whatever the prose says.
  //
  // Captured prefix, not lookbehind (Safari 16.0 baseline — see
  // directing-references.ts). `@` stays excluded from the prefix, so a typed
  // `@Jack Mercer` is still never rewritten into `@@jack-mercer:1` — the name
  // branch can only fire where no `@` precedes it, and the token branch owns
  // the `@` itself.
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}@])(?:@(${slugs.map(escapeRegExp).join("|")})(?!${TOKEN_TRAILING.source})` +
      `|(${names.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}]))`,
    "gu",
  )
  // Only-bind-what-the-prose-names comes free from the replace design: a chip
  // whose name the user deleted from the text emits no token, so its reference
  // must NOT be stripped either.
  const consumed = new Set<string>()
  const wirePrompt = prompt.replace(
    pattern,
    (
      match: string,
      before: string,
      slug: string | undefined,
      name: string | undefined,
      offset: number,
    ) => {
      const c = slug !== undefined ? byToken.get(slug)! : byName.get(name!)!
      // Reject BEFORE `consumed` and BEFORE the counter: a refused occurrence
      // must neither strip the ref nor burn an index the platform will never
      // see. `match` includes the captured prefix, so its end is the name's end.
      if (
        shortGrammar.has(c.ref) &&
        SHORT_GRAMMAR_TRAILING_REJECT.test(prompt.slice(offset + match.length))
      )
        return match
      consumed.add(c.slug)
      return `${before}@${c.slug}:${nextIndex++}`
    },
  )

  // Copy-on-write, identity-stable: unbound refs pass through BY IDENTITY, and
  // when nothing was stripped the INPUT array itself comes back (effect-dep
  // stable, allocates nothing on the common path).
  let changed = false
  const out = references.map((r) => {
    const m = mediaWire.get(r)
    if (!m || !consumed.has(m.slug)) return r
    changed = true
    return m.wireRef
  })
  return {
    // THE LAST GATE (see lib/role-prose): a chip whose reference carries no
    // url, or is a VIEW pick riding `isExtraRef`, or whose slug a
    // higher-precedence kind already claimed, still SERIALIZED as
    // `@<role-slug>` — the serializer's predicate is wider than this binder's.
    // Every such token now degrades to the chip's own name, which is exactly
    // the prose it wore before C6. A bound token is already `@slug:N`, so the
    // `:` in its trailing guard keeps this pass off it.
    wirePrompt: untokenizeRoleReferences(wirePrompt, references),
    wireReferences: changed ? out : references,
  }
}

/**
 * RE-BIND `@Name` TEXT THAT LOST ITS CHIP.
 *
 * A restored prompt rebuilds its entity chips from the references stored ON the
 * result ({@link import("./shot").ShotClipResult.references}). When those are
 * missing the prose survives but the bindings don't — the `@` mentions come back
 * as flat text, and a re-generate then sends the NAME without the face.
 *
 * That is exactly what happened to clips whose render finished after a reload:
 * the bound chips lived only in an in-memory per-job map, so the completion
 * stored none (the `/` direction chips had a persisted fallback and survived —
 * the asymmetry that made this look like "only the @ references vanished").
 * The marker now carries the references too, but clips already saved without
 * them stay unbound, so this recovers them the same way
 * {@link import("./voice-direction").restoreClipDirections} recovers legacy
 * direction tokens: from the text itself.
 *
 * DELIBERATELY CONSERVATIVE — it only claims an explicit, typed `@Name` or the
 * cast chip's own `@<role-slug>` token (C6 — the spelling this very path now
 * meets most, since a bundle import and a reference-less clip result are exactly
 * the prose that arrives token-bearing):
 *  - the mention must carry the `@` (a bare name in the prose is prose; binding
 *    every occurrence of a location called "River" would send images nobody asked
 *    for),
 *  - the TOKEN spelling is tried first and claimed whole, so `@panda-2` binds
 *    Panda 2 and a library "Panda" can never bind inside it,
 *  - the name must match a library entity EXACTLY (case-insensitive) and end on a
 *    non-word boundary, longest name first (`@Andre Williams 2` binds Andre
 *    Williams 2, never Andre),
 *  - anything already bound is left alone.
 */

/** The minimum an entity row needs to be recoverable: its name + the binding. */
export interface MentionCandidate {
  readonly id: string
  readonly name: string
  /** WHICH library the row came from, when the source knows (the cast pool does;
   *  older candidate sources may not). The binder below is kind-blind — an
   *  `@Name` in a sentence names whatever the library calls that — but a CAST
   *  row declares a kind, and `castMatches` binds it within its own; the
   *  importer hands this binder a pool already narrowed to what its rows chose
   *  (`production-format/import.ts`, `candidatesForProse`). */
  readonly kind?: CastKind
  readonly toConnectedReference: () => ConnectedReference
}

/** A word character for boundary purposes — a mention ends where prose resumes. */
export function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch)
}

/**
 * Does a typed `@Name` end at `index`? Word characters end it for the obvious
 * reason ("@Eitan" must not match an entity called "Eit"), and so does a `-`
 * that CONTINUES the run: post-C6 a suffixed role serializes as `@panda-2`, and
 * `-` is not a word character, so a library "Panda" used to bind inside it and
 * recover the WRONG actor. The `-2` suffix is minted precisely when a "Panda"
 * already exists, so that collision is the norm wherever a suffixed role does.
 * A trailing `:` still ends the name — `@kira:1` is the wire's own spelling of
 * Kira, and recovering her there is right.
 *
 * Exported for the importer's canonicalize stage (D41,
 * `production-format/import-canonical-mentions.ts`), which decides where a
 * DECLARED name ends and must judge that boundary exactly as this binder does.
 */
export function endsTypedName(text: string, index: number): boolean {
  const next = text[index]
  if (next === undefined) return true
  if (isWordChar(next)) return false
  return !(next === "-" && isWordChar(text[index + 1]))
}

/**
 * The references to ADD to `bound` so the prompt's typed `@Name` mentions bind
 * again. Empty when everything is already bound (the normal path — no work).
 */
export function recoverTypedMentions(
  text: string,
  bound: ReadonlyArray<ConnectedReference>,
  candidates: ReadonlyArray<MentionCandidate>,
): ConnectedReference[] {
  if (!text.includes("@") || candidates.length === 0) return []
  // Every SPELLING a candidate can wear at an `@`, longest first across both
  // forms — one order, not a token pass then a name pass: `@andre` (a token)
  // must never claim the head of `@Andre Williams 2` (a name) just because
  // tokens were asked first.
  //
  // A token is offered only for a name that is already trimmed, because the
  // recovery judges a LIBRARY row exactly, as the wire binder does: a row
  // literally called " Natalie" can bind neither `@Natalie` nor `@natalie`.
  const spellings = candidates
    .flatMap((c) => {
      const token = c.name.trim() === c.name ? roleTokenForName(c.name) : null
      return [
        { text: c.name.toLowerCase(), token: false, c },
        ...(token ? [{ text: token, token: true, c }] : []),
      ]
    })
    .filter((s) => s.text.length > 0)
    .sort((a, b) => b.text.length - a.text.length)
  const claimed = new Set(bound.map((r) => r.id))
  const boundNames = new Set(bound.map((r) => r.defaultName.toLowerCase()))
  const lower = text.toLowerCase()
  const out: ConnectedReference[] = []

  for (let i = lower.indexOf("@"); i !== -1; i = lower.indexOf("@", i + 1)) {
    const after = i + 1
    // A cast chip serializes as `@<role-slug>` (C6), and this recovery runs on
    // exactly the prose that lost its references — an imported bundle, a clip
    // whose render finished after a reload — which post-C6 is token prose. The
    // token starts AT the `@` and is claimed whole (the wire binders' own rule),
    // so `@panda-2` recovers Panda 2 and a library "Panda" can no longer bind
    // inside it and hand back the wrong actor.
    const hit = spellings.find((s) =>
      s.token
        ? lower.startsWith(s.text, i) && isWholeToken(lower, i, s.text.length)
        : lower.startsWith(s.text, after) &&
          endsTypedName(lower, after + s.text.length),
    )
    if (!hit) continue
    const match = hit.c
    if (claimed.has(match.id) || boundNames.has(match.name.toLowerCase())) continue
    claimed.add(match.id)
    out.push(match.toConnectedReference())
  }
  return out
}

/**
 * `bound` plus whatever the prose still names — the value a restore should hand
 * the editor. Returns the SAME array when there is nothing to recover, so the
 * common path allocates nothing and effect deps don't churn.
 */
export function withRecoveredMentions(
  text: string | undefined,
  bound: ReadonlyArray<ConnectedReference> | undefined,
  candidates: ReadonlyArray<MentionCandidate>,
): ReadonlyArray<ConnectedReference> | undefined {
  if (!text) return bound
  const recovered = recoverTypedMentions(text, bound ?? [], candidates)
  if (recovered.length === 0) return bound
  return [...(bound ?? []), ...recovered]
}
