import type { ConnectedReference } from "@nodaro/shared"

import type { Shot, ShotBeat, ShotStillResult, ShotClipResult } from "./shot"
import {
  castSlug,
  removeCastLook,
  roleTokenForName,
  type CastKind,
} from "./cast"

/**
 * THE TWO ONE-CLICK COMMANDS that fall out of the single map row (spec
 * 2026-08-31-project-cast-registry, D6e). Both are pure over the shot array —
 * the store applies them, the tests drive them directly.
 *
 * **Rename** keeps the actor and changes the NAME: a deterministic prose
 * rewrite across every scene, safe precisely because names are project-unique
 * (D6a). It rewrites the *rendering*, never the binding — actor ids and urls
 * are untouched, so provenance survives intact (D6b: the chip is a view over
 * the cast row, and the name is what the view says).
 *
 * **Recast** keeps the name and swaps the ACTOR, and therefore rewrites
 * NOTHING: identity resolves through the live cast row at submit, so every
 * scene follows from the one repoint and the prose never moves. Its one
 * legitimate loss is the scene look PINS — views of the old actor — which are
 * dropped and REPORTED rather than left as stale images of a previous person.
 */

/** Every prose surface a rename touched, for the "hits every scene once" report. */
export interface RenameReport {
  /** How many prose occurrences were rewritten across the production. */
  readonly rewrites: number
  /** How many SHOTS changed at all (prose or reference). */
  readonly shots: number
}

export interface RenameRoleArgs {
  readonly kind: CastKind
  readonly oldKey: string
  readonly newKey: string
  readonly oldName: string
  readonly newName: string
  /**
   * IDENTITY SCOPE — the actor the moving name belongs to. Set by the ENROLLER
   * (`cast-merge.enrollOne`), whose rename is a collision: two different actors
   * answer to one name, and only ONE of them is moving. Without it the rewrite
   * is by name alone, so the scene that meant the OTHER panda is re-worded and
   * its chip repointed at a role it never had.
   *
   * THE SCOPE IS THE SLICE, NOT THE SHOT (B11). A chip binds the actor in one
   * scene and the next scene of the same arriving set just says the name — and
   * that name is still this actor's, because the whole set arrived together
   * under one sheet. So the scope widens to every shot in `shots` once ANY of
   * them binds the actor by chip, and withdraws only where a SECOND actor
   * claims the name somewhere in the slice: there the words a chip-less scene
   * wrote are a guess nothing in the slice can settle, and leaving them with
   * the keeper is the recoverable half. See {@link sliceOwnsName}.
   *
   * Absent for the Cast panel's own Rename, and that is not an oversight: there
   * one actor is the only claimant to the name, and the prose that says it
   * carries no chip at all in places the rename must still reach (a recipe-only
   * shot's words are the only thing tying it to the role — D6i).
   */
  readonly assetId?: string
  /**
   * THE OTHER ROLES' display names — every name in the cast except the one
   * moving. The rewrite refuses an occurrence that merely STARTS one of them
   * ("Panda" inside "Panda 2", inside "Panda Bear"): those words are somebody
   * else's whole name, and rewriting them hands two roles the same words back.
   *
   * REQUIRED, so the compiler asks the next renamer for them instead of a
   * comment asking the next author to remember (an omitted list is silently a
   * rename with no guard at all). Both renamers supply theirs from the cast
   * each already holds: the enroller (`cast-merge.enrollOne`) passes the
   * destination cast the newcomer collided with PLUS the arriving sheet's own
   * other names, the Cast panel passes the cast minus the row being renamed.
   * Pass `[]` where a caller genuinely has no other names — never nothing.
   */
  readonly reservedNames: ReadonlyArray<string>
}

/**
 * Whole-word, EXACT-CASE occurrences of `name` — the same boundary rule
 * `bindMentionTokens` / `bindReferenceTokens` bind on, so a rename hits exactly
 * the words that would have become wire tokens and nothing else. "Abi" must not
 * hit "Abigail" (that is what the spec's "exactly once" is guarding), and a
 * captured prefix stands in for a lookbehind (Safari 16.0 baseline, per
 * `directing-references.ts`).
 *
 * A leading `@` is INCLUDED, unlike the binder's: an unresolved `@Abi` in the
 * prose is the same role by another spelling, and leaving it behind would turn
 * a rename into a fresh unresolved token.
 *
 * THE ROLE'S OWN TOKEN IS A THIRD SPELLING (C6). A cast chip serializes as
 * `@<role-slug>` — `@stylized-cartoon-horse`, dashes — which the name form
 * ("Stylized cartoon horse", spaces) never matches. Both are the same role
 * saying its own name, so both are ONE pattern here, and every caller inherits
 * it: the rename would otherwise leave stale tokens keyed to a role that no
 * longer exists (every scene lighting up unresolved), and `roleIsUsed`'s prose
 * predicate (`cast-bundle`) would drop a role the slice plainly uses — the
 * "name with no face" D6i exists to prevent. Emitted only when the name has a
 * token at all; an unsluggable one keeps the two-form pattern it had.
 *
 * A NAME THAT STARTS A RESERVED ONE IS NOT AN OCCURRENCE (R75b). The enroller's
 * collision is the reason: a `Panda` that has to become `Panda 3` also lives
 * inside the `Panda 2` beside it — a DIFFERENT role's whole name — and
 * rewriting that occurrence hands both of them the same words back, which is
 * the collision the suffix just resolved. So every reserved name this one is a
 * PROPER PREFIX of contributes its tail (" 2", " Bear") to one guard, refusing
 * an occurrence followed by that tail and nothing longer: "Panda 20 metres off"
 * is an ordinary mention of "Panda" and still matches, mid-rename or not, and
 * so does a "Panda Bears" where the reserved name is "Panda Bear". A name that
 * is no proper prefix of any reserved one keeps the boundary it always had.
 *
 * `newName` is reserved too, and is passed separately because it is not in the
 * caller's cast yet: it is the name this rename is about to make real, and
 * where the colliding role has not been enrolled either (a sheet's own
 * `Panda 2` arriving after its `Panda`) it is the only witness there is.
 */
function namePattern(
  name: string,
  newName?: string,
  reservedNames?: ReadonlyArray<string>,
): RegExp {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const token = roleTokenForName(name)
  // The token branch leads: it is longer and more specific, and `-`/`:` join its
  // trailing guard so `@panda` inside `@panda-2` is not a hit (the same rule the
  // wire binder uses, for the same reason). A reserved name's own token is
  // already out of its reach, so only the NAME branch needs the guard below.
  const tokenBranch = token ? `${escape(token)}(?![\\p{L}\\p{N}:-])|` : ""
  // PROPER prefix only: a reserved name EQUAL to this one (the keeper, always
  // in the list on the enroll path) has no tail, and an empty alternative would
  // refuse every occurrence there is.
  const reserved = newName ? [...(reservedNames ?? []), newName] : reservedNames
  const tails = Array.from(
    new Set(
      (reserved ?? [])
        .filter((r) => r.length > name.length && r.startsWith(name))
        .map((r) => escape(r.slice(name.length))),
    ),
  )
  const nameGuard = tails.length
    ? `(?![\\p{L}\\p{N}])(?!(?:${tails.join("|")})(?![\\p{L}\\p{N}]))`
    : `(?![\\p{L}\\p{N}])`
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])(?:${tokenBranch}(@?)(${escape(name)})${nameGuard})`,
    "gu",
  )
}

/**
 * Does this prose SAY the role's name — the same whole-word, exact-case
 * boundary the rename rewrites on, so "is this role used here?" and "rewrite
 * this role here" can never disagree about what counts as an occurrence.
 *
 * **THE INVARIANT:** for the same `(name, newName, reservedNames)` triple,
 * `mentionsName` and {@link renameInProse} build the boundary from the exact
 * same {@link namePattern} call — there is no second copy of the boundary rule
 * to drift out of step. Both extras are optional for the same reason they are
 * on `namePattern`: most callers (e.g. `cast-bundle`'s "is this role used at
 * all?") are not asking on behalf of a rename and have neither to give.
 *
 * A fresh regex per call: {@link namePattern} is `g`-flagged, and a shared one
 * would carry `lastIndex` from the previous probe and skip alternate hits.
 */
export function mentionsName(
  text: string | undefined,
  name: string,
  newName?: string,
  reservedNames?: ReadonlyArray<string>,
): boolean {
  if (!text || !name) return false
  return namePattern(name, newName, reservedNames).test(text)
}

/**
 * Every PROSE surface of a shot — the same list {@link renameShot} rewrites,
 * lifted out so the export projection ("which roles does this slice use?") asks
 * exactly what the rename answers. The two must agree: a role carried by a
 * bundle but invisible to the rename would arrive un-renameable, and a role the
 * rename can reach but the export drops would arrive un-cast.
 *
 * `recipe` is in BOTH — and it has to be. A recipe is usually built from a
 * result at export time, but an IMPORTED recipe-only shot is a store-resident,
 * node-less placeholder that sits in the timeline until a result lands, and the
 * Cast panel's Rename is reachable the whole time. Left out of the rename, its
 * prose kept the old name while `roleIsUsed` probed it with the new one, and the
 * role dropped out of the next export: a bundle shipping prose that names a
 * person whose row it never carried — the "name with no face" D6i prevents.
 */
export function shotProse(shot: Shot): string[] {
  const out: string[] = []
  const push = (text: string | undefined) => {
    if (text) out.push(text)
  }
  push(shot.still?.prompt)
  for (const r of shot.still?.results ?? []) push(r.prompt)
  push(shot.clip?.prompt)
  for (const r of shot.clip?.results ?? []) {
    push(r.prompt)
    for (const b of r.beats ?? []) push(b.text)
    push(r.scenePrompt)
  }
  for (const b of shot.beats ?? []) push(b.text)
  push(shot.scenePrompt)
  push(shot.plan?.frame?.prompt)
  push(shot.plan?.motion?.prompt)
  for (const p of shot.pendingClips ?? []) {
    push(p.prompt)
    for (const b of p.beats ?? []) push(b.text)
    push(p.scenePrompt)
  }
  push(shot.recipe?.framing?.prompt)
  push(shot.recipe?.directing?.prompt)
  return out
}

/** Rewrite `from` → `to` in one prose string. Returns the text and the count.
 *  `reservedNames` are the OTHER roles' names, whose whole words this rewrite
 *  must not run through ({@link RenameRoleArgs.reservedNames}). */
export function renameInProse(
  text: string,
  from: string,
  to: string,
  reservedNames?: ReadonlyArray<string>,
): { readonly text: string; readonly count: number } {
  if (!text || !from || from === to) return { text, count: 0 }
  let count = 0
  // The NEW role's token, for the occurrences that were written as the old
  // role's. An unsluggable new name has no token to become — the honest
  // rewrite is then the bare `@Name`, which is the unresolved form it will in
  // fact render as.
  const toToken = roleTokenForName(to) ?? `@${to}`
  const next = text.replace(
    namePattern(from, to, reservedNames),
    (
      _m: string,
      before: string,
      at: string | undefined,
      matched: string | undefined,
    ) => {
      count += 1
      // `matched === undefined` ⇒ the TOKEN branch fired (it captures nothing).
      return matched === undefined ? `${before}${toToken}` : `${before}${at}${to}`
    },
  )
  return { text: next, count }
}

/**
 * Re-name a bound reference to the role — `defaultName` plus whatever slug
 * field the kind carries, kept in step so the wire binder emits a token for the
 * word the prose now says (the spec's "wire mentions carry the new slug").
 *
 * Matched by NAME: the reference is the rendering of a role, and two roles can
 * legitimately share one actor (D6b's two-looks case), so repointing every
 * reference with the actor's id would rename the wrong one. When the caller
 * ALSO names the actor ({@link RenameRoleArgs.assetId} — the enroller's
 * collision), the name is not enough on its own: the other actor's chips say
 * the same word and are not the ones moving.
 */
function renameReference(
  ref: ConnectedReference,
  kind: CastKind,
  oldName: string,
  newName: string,
  assetId?: string,
): ConnectedReference {
  if (ref.defaultName !== oldName) return ref
  if (assetId && ref.id !== assetId) return ref
  const next: ConnectedReference = { ...ref, defaultName: newName }
  if (ref.characterSlug !== undefined) {
    return { ...next, characterSlug: castSlug(kind, newName) }
  }
  if (ref.locationSlug !== undefined) {
    return { ...next, locationSlug: castSlug(kind, newName) }
  }
  return next
}

/**
 * A tiny accumulator so every surface below reads the same way and the "did
 * anything change?" question is asked exactly once per shot (copy-on-write: an
 * untouched shot must come back as the SAME object, or the whole strip
 * re-renders on a rename that missed it).
 */
class Rewriter {
  count = 0
  changed = false
  constructor(
    private readonly args: RenameRoleArgs,
    /** The arriving slice settles the name by itself — {@link sliceOwnsName}. */
    private readonly sliceOwns: boolean,
  ) {}

  /**
   * Whether the chips that own a surface's words bind the actor whose name is
   * moving — the identity scope, asked where the words are rather than per
   * shot: one scene can name both pandas (a plan chip and a beat chip), and
   * only the beat's words are the beat chip's to move. Always true without an
   * `assetId`.
   *
   * THREE ANSWERS, NOT TWO (B11). Chips that bind the actor: ours. Chips that
   * say the NAME about somebody else: theirs, and they keep their words. Chips
   * that claim the name for NOBODY — a surface bound to other roles only, or a
   * legacy take with no `references` at all — settle nothing, so the SLICE
   * answers for them: where it binds the actor and no second actor answers to
   * the name anywhere in it, those words are this actor's too.
   */
  private owns(refs: ReadonlyArray<ConnectedReference> | undefined): boolean {
    const { assetId, oldName } = this.args
    if (!assetId) return true
    if (refs?.some((r) => r.id === assetId && r.defaultName === oldName)) return true
    if (refs?.some((r) => r.defaultName === oldName)) return false
    return this.sliceOwns
  }

  /** Rewrite a prose field, counting occurrences. `refs` is the chip list that
   *  OWNS these words: a surface's own where it HAS one, else the surface it
   *  was seeded from, else the shot's ({@link renameShot}).
   *
   *  A surface that claims the name for NOBODY — one bound to other roles only,
   *  or a stored take with no `references` at all (the norm for a legacy
   *  chip-less take) — defers to the slice ({@link Rewriter.owns}): its words
   *  move where the arriving set has exactly one claimant to the name, and stay
   *  with the keeper where two actors answer to it and nothing in the take can
   *  settle which one wrote them. */
  prose(
    text: string | undefined,
    refs?: ReadonlyArray<ConnectedReference>,
  ): string | undefined {
    if (text === undefined) return undefined
    if (!this.owns(refs)) return text
    const { text: next, count } = renameInProse(
      text,
      this.args.oldName,
      this.args.newName,
      this.args.reservedNames,
    )
    if (count > 0) {
      this.count += count
      this.changed = true
    }
    return next
  }

  /** Rewrite a bound reference list; the SAME array back when none matched. */
  refs(
    refs: ReadonlyArray<ConnectedReference> | undefined,
  ): ReadonlyArray<ConnectedReference> | undefined {
    if (!refs?.length) return refs
    let touched = false
    const next = refs.map((r) => {
      const renamed = renameReference(
        r,
        this.args.kind,
        this.args.oldName,
        this.args.newName,
        this.args.assetId,
      )
      if (renamed !== r) touched = true
      return renamed
    })
    if (!touched) return refs
    this.changed = true
    return next
  }
}

function renameStillResult(r: ShotStillResult, w: Rewriter): ShotStillResult {
  const prompt = w.prose(r.prompt, r.references)
  const references = w.refs(r.references)
  if (prompt === r.prompt && references === r.references) return r
  return {
    ...r,
    ...(prompt !== undefined ? { prompt } : {}),
    ...(references ? { references } : {}),
  }
}

function renameClipResult(r: ShotClipResult, w: Rewriter): ShotClipResult {
  const prompt = w.prose(r.prompt, r.references)
  const references = w.refs(r.references)
  const beats = renameBeats(r.beats, w)
  // The take's SUBMITTED prompt has this paragraph folded into it, and
  // `stripScenePrompt` unfolds by matching the two byte for byte — rewrite one
  // and not the other and the restore silently doubles the description.
  const scenePrompt = w.prose(r.scenePrompt, r.references)
  if (
    prompt === r.prompt &&
    references === r.references &&
    beats === r.beats &&
    scenePrompt === r.scenePrompt
  ) {
    return r
  }
  return {
    ...r,
    ...(prompt !== undefined ? { prompt } : {}),
    ...(references ? { references } : {}),
    ...(beats ? { beats } : {}),
    ...(scenePrompt !== undefined ? { scenePrompt } : {}),
  }
}

function renameBeats(
  beats: ReadonlyArray<ShotBeat> | undefined,
  w: Rewriter,
): ReadonlyArray<ShotBeat> | undefined {
  if (!beats?.length) return beats
  let touched = false
  const next = beats.map((b) => {
    const text = w.prose(b.text, b.references) ?? b.text
    const references = w.refs(b.references)
    if (text === b.text && references === b.references) return b
    touched = true
    return { ...b, text, ...(references ? { references } : {}) }
  })
  return touched ? next : beats
}

/**
 * Every chip a shot binds, grouped by the surface that owns it — ONE walk
 * (B13). The three scopes a rename needs used to be three separate walks over
 * the same shot (the shot's own, plus the still's and the clip's inside it), so
 * every still and clip reference was read twice per rename. They are one pass
 * now, and the groups are handed to {@link renameShot} rather than re-derived.
 */
interface ShotScopes {
  /** The STILL's takes — the scope for the live framing prompt, which the
   *  composer seeds from one of those takes. */
  readonly still: ConnectedReference[]
  /** The CLIP's takes — the scope for the live motion prompt and the scene
   *  paragraph beside it. A take is prompt + beats + paragraph, seeded back
   *  into the composer together, so its beats' chips belong to it; the LIVE
   *  `shot.beats` deliberately do not (they carry their own lists and are
   *  scoped by them). The in-flight animate markers count: a resume marker is a
   *  take that hasn't landed yet. */
  readonly clip: ConnectedReference[]
  /** Everything the shot binds, anywhere — the FALLBACK identity scope, for
   *  prose whose own seeding surface binds nothing at all. */
  readonly all: ConnectedReference[]
}

function shotReferenceScopes(shot: Shot): ShotScopes {
  const still: ConnectedReference[] = []
  const clip: ConnectedReference[] = []
  const rest: ConnectedReference[] = []
  const push = (
    out: ConnectedReference[],
    refs?: ReadonlyArray<ConnectedReference>,
  ) => {
    if (refs?.length) out.push(...refs)
  }
  for (const r of shot.still?.results ?? []) push(still, r.references)
  for (const r of shot.clip?.results ?? []) {
    push(clip, r.references)
    for (const b of r.beats ?? []) push(clip, b.references)
  }
  for (const p of shot.pendingClips ?? []) {
    push(clip, p.references)
    for (const b of p.beats ?? []) push(clip, b.references)
  }
  for (const b of shot.beats ?? []) push(rest, b.references)
  push(rest, shot.plan?.frame?.references)
  push(rest, shot.plan?.motion?.references)
  return { still, clip, all: [...still, ...clip, ...rest] }
}

/** Every chip a shot binds, anywhere — the enroller's "does this arriving slice
 *  bind the actor by chip?" probe (`cast-merge`), which is why it is exported:
 *  the scope and the question that decides whether to use it must read the same
 *  chips. Inside this module the grouped {@link shotReferenceScopes} is what a
 *  rename walks, so the same references are never collected twice. */
export function shotReferences(shot: Shot): ConnectedReference[] {
  return shotReferenceScopes(shot).all
}

/**
 * DOES THE ARRIVING SLICE SETTLE THE NAME BY ITSELF (B11)? True when the moving
 * actor is bound by chip somewhere in `shots` and NO other actor answers to the
 * moving name anywhere in them.
 *
 * That is the widened identity scope ({@link RenameRoleArgs.assetId}): a slice
 * arrives under one sheet, so a scene of it that merely SAYS the name means the
 * actor the sheet bound, chip or no chip, and its words move too. Two claimants
 * and the slice is no better witness than the shot — a chip-less "Panda" could
 * be either — so the scope stays where it was and those words keep the keeper's
 * name.
 *
 * Matched on id AND name, exactly as {@link Rewriter.owns} and `cast-merge`'s
 * `sliceBindsActor` are, so the widening is never switched on over chips the
 * rewrite would not recognise.
 *
 * Reads the scopes the rename ALREADY collected rather than walking the shots
 * again (B13) — one collection per shot serves both the claim and the rewrite.
 */
function sliceOwnsName(
  scopes: ReadonlyArray<ShotScopes>,
  args: RenameRoleArgs,
): boolean {
  const { assetId, oldName } = args
  let bound = false
  for (const scope of scopes) {
    for (const ref of scope.all) {
      if (ref.defaultName !== oldName) continue
      if (ref.id !== assetId) return false
      bound = true
    }
  }
  return bound
}

/** A surface's OWN chips where it binds any, else the shot's — the fallback a
 *  surface with nothing bound has no better answer than. */
function surfaceScope(
  own: ConnectedReference[],
  all: ConnectedReference[] | undefined,
): ConnectedReference[] | undefined {
  return own.length > 0 ? own : all
}

/**
 * Rewrite ONE shot. Every prose surface the composer can seed from is covered —
 * the live still/clip prompt, every stored result's prompt (Studio seeds the
 * composer from the ACTIVE result, so skipping those would make a rename
 * invisible the moment you click a strip), the motion beats, the scene's
 * generic prompt in all three of its copies, the authored plan, and the
 * in-flight animate markers a reload resumes from.
 */
function renameShot(
  shot: Shot,
  args: RenameRoleArgs,
  scopes: ShotScopes | undefined,
  sliceOwns: boolean,
): { shot: Shot; count: number } {
  const w = new Rewriter(args, sliceOwns)
  let next: Shot = shot
  // The scopes for prose that carries no chip list of its own. A LIVE composer
  // prompt is seeded from a stored take, so its scope is that surface's takes —
  // scoping it to the whole shot let a motion beat's enrollment rewrite the
  // framing words, which belong to whoever the still was framed with. A recipe
  // (and the scene's generic prompt, which every take copies) has no surface of
  // its own, so it falls back to the shot: those words are seeded from whatever
  // this scene binds, and a recipe binds nothing at all.
  //
  // `scopes` is `undefined` for a rename with no actor to scope by — the Cast
  // panel's own — which is why the walk costs that path nothing at all.
  const scope = scopes?.all
  const stillScope = scopes ? surfaceScope(scopes.still, scope) : undefined
  const clipScope = scopes ? surfaceScope(scopes.clip, scope) : undefined

  if (shot.still) {
    const prompt = w.prose(shot.still.prompt, stillScope) ?? shot.still.prompt
    const results = shot.still.results?.map((r) => renameStillResult(r, w))
    const stillChanged =
      prompt !== shot.still.prompt ||
      (results && results.some((r, i) => r !== shot.still!.results![i]))
    if (stillChanged) {
      next = {
        ...next,
        still: { ...shot.still, prompt, ...(results ? { results } : {}) },
      }
    }
  }

  if (shot.clip) {
    const prompt = w.prose(shot.clip.prompt, clipScope) ?? shot.clip.prompt
    const results = shot.clip.results?.map((r) => renameClipResult(r, w))
    const clipChanged =
      prompt !== shot.clip.prompt ||
      (results && results.some((r, i) => r !== shot.clip!.results![i]))
    if (clipChanged) {
      next = {
        ...next,
        clip: { ...shot.clip, prompt, ...(results ? { results } : {}) },
      }
    }
  }

  const beats = renameBeats(shot.beats, w)
  if (beats !== shot.beats) next = { ...next, beats }

  // The scene paragraph rides the DIRECTING draft (every take stores its own
  // copy), so it is scoped with the motion prompt beside it.
  const scenePrompt = w.prose(shot.scenePrompt, clipScope)
  if (scenePrompt !== shot.scenePrompt) next = { ...next, scenePrompt }

  if (shot.plan) {
    const frame = shot.plan.frame
    const motion = shot.plan.motion
    const framePrompt = w.prose(frame?.prompt, frame?.references)
    const frameRefs = w.refs(frame?.references)
    const motionPrompt = w.prose(motion?.prompt, motion?.references)
    const motionRefs = w.refs(motion?.references)
    if (
      (frame && (framePrompt !== frame.prompt || frameRefs !== frame.references)) ||
      (motion && (motionPrompt !== motion.prompt || motionRefs !== motion.references))
    ) {
      next = {
        ...next,
        plan: {
          ...shot.plan,
          ...(frame
            ? {
                frame: {
                  ...frame,
                  prompt: framePrompt,
                  ...(frameRefs ? { references: frameRefs } : {}),
                },
              }
            : {}),
          ...(motion
            ? {
                motion: {
                  ...motion,
                  prompt: motionPrompt,
                  ...(motionRefs ? { references: motionRefs } : {}),
                },
              }
            : {}),
        },
      }
    }
  }

  // A recipe carries prose and no reference at all, so its words are the ONLY
  // thing tying that scene to a role — `shotProse` reads them, and the export
  // projection asks exactly what this rewrites.
  if (shot.recipe) {
    const framing = shot.recipe.framing
    const directing = shot.recipe.directing
    const framingPrompt = w.prose(framing?.prompt, scope)
    const directingPrompt = w.prose(directing?.prompt, scope)
    if (
      (framing && framingPrompt !== framing.prompt) ||
      (directing && directingPrompt !== directing.prompt)
    ) {
      next = {
        ...next,
        recipe: {
          ...shot.recipe,
          ...(framing ? { framing: { ...framing, prompt: framingPrompt! } } : {}),
          ...(directing
            ? { directing: { ...directing, prompt: directingPrompt! } }
            : {}),
        },
      }
    }
  }

  if (shot.pendingClips?.length) {
    let touched = false
    const pending = shot.pendingClips.map((p) => {
      const prompt = w.prose(p.prompt, p.references) ?? p.prompt
      const references = w.refs(p.references)
      const pBeats = renameBeats(p.beats, w)
      // Same fold as a finished take's — see `renameClipResult`.
      const pScene = w.prose(p.scenePrompt, p.references)
      if (
        prompt === p.prompt &&
        references === p.references &&
        pBeats === p.beats &&
        pScene === p.scenePrompt
      ) {
        return p
      }
      touched = true
      return {
        ...p,
        prompt,
        ...(references ? { references } : {}),
        ...(pBeats ? { beats: pBeats } : {}),
        ...(pScene !== undefined ? { scenePrompt: pScene } : {}),
      }
    })
    if (touched) next = { ...next, pendingClips: pending }
  }

  // The scene's PIN follows the rename — it is a view of the SAME actor, so it
  // survives (only a recast invalidates a pin). Re-keyed, never duplicated.
  //
  // Never on the ENROLLER's collision (`assetId`): there the old key is the
  // KEEPER's, and the newcomer — who has never been in this cast — can own no
  // pin under it. Re-keying would hand the keeper's pinned look to somebody
  // else.
  if (!args.assetId && args.oldKey !== args.newKey && shot.castLook?.[args.oldKey]) {
    const { [args.oldKey]: pin, ...rest } = shot.castLook
    next = { ...next, castLook: { ...rest, [args.newKey]: pin } }
  }

  return { shot: next, count: w.count }
}

/**
 * RENAME a role across the whole production. Copy-on-write: shots that never
 * said the name come back as the same objects.
 *
 * Each shot's chips are collected ONCE (B13), in a pass that precedes every
 * rewrite: the slice's own claim on the name is a question about the whole
 * array, and a shot rewritten first would otherwise answer it about words this
 * call had already moved. The rewrite pass then reuses what that pass gathered
 * instead of walking the same references again.
 */
export function renameRoleInShots(
  shots: ReadonlyArray<Shot>,
  args: RenameRoleArgs,
): { readonly shots: ReadonlyArray<Shot>; readonly report: RenameReport } {
  const scopes = args.assetId ? shots.map(shotReferenceScopes) : undefined
  const sliceOwns = scopes ? sliceOwnsName(scopes, args) : false
  let rewrites = 0
  let touched = 0
  const next = shots.map((shot, i) => {
    const result = renameShot(shot, args, scopes?.[i], sliceOwns)
    if (result.shot !== shot) touched += 1
    rewrites += result.count
    return result.shot
  })
  return {
    shots: touched > 0 ? next : shots,
    report: { rewrites, shots: touched },
  }
}

/**
 * RECAST's one rewrite: drop every scene's pin for the role, because a pin is a
 * view of the actor that just left (D6e). Returns the scene count so the caller
 * can SAY so — "3 scenes had pinned looks — reset" — rather than silently
 * showing the new actor everywhere except three stale frames.
 */
export function clearCastLookForRole(
  shots: ReadonlyArray<Shot>,
  key: string,
): { readonly shots: ReadonlyArray<Shot>; readonly pinsReset: number } {
  let pinsReset = 0
  const next = shots.map((shot) => {
    if (!shot.castLook?.[key]) return shot
    pinsReset += 1
    const remaining = removeCastLook(shot.castLook, key)
    if (Object.keys(remaining).length > 0) return { ...shot, castLook: remaining }
    // Omit-when-empty: an unpinned scene must not carry `castLook: {}`.
    const { castLook: _castLook, ...rest } = shot
    return rest
  })
  return { shots: pinsReset > 0 ? next : shots, pinsReset }
}
