import type { ConnectedReference } from "@nodaro/shared"

import { roleTokenForName } from "./cast"
import { untokenizeRoleReferences } from "./role-prose"

/**
 * Split the Directing references into the two channels `/v1/generate-video`
 * accepts: the bound `@`-entity chips (STRUCTURED `connectedReferences`) and the
 * manual rail uploads (flat `referenceImageUrls`). The ROUTE owns assembly —
 * `assembleVideoConnectedReferences` resolves each chip to its `@image_N`
 * attachment + identity directive server-side (canvas-parity), so studio sends the
 * chips VERBATIM and never re-implements prompt logic (CLAUDE.md forbids
 * client-side assembly). This replaces the old prose-guide bridge.
 *
 * Two invariants keep the server's `@image_N` numbering aligned with its
 * directives:
 *
 * - **Slot reservation.** Flat refs LEAD the numbering and the structured chips
 *   take the remainder, so the rail is capped at `imageLimit − reservedByChips`
 *   (chips reserve one slot per UNIQUE non-empty url, itself capped at
 *   `imageLimit`). Without this a full rail would starve the identity-critical
 *   chip attachments — preserving the old "portraits lead" intent under the split.
 * - **Cross-channel dedup.** A rail url equal to a chip url is dropped (the chip
 *   wins — it rides structured); sending both would double-attach and misalign a
 *   slot number against its directive.
 *
 * Rail urls also de-dupe among themselves (first-seen order preserved). Empty
 * results collapse to `undefined` (the caller spreads each channel only when
 * present). Copy-on-write: inputs are never mutated; fresh arrays are returned.
 */
export function deriveDirectingReferences(args: {
  references: ReadonlyArray<ConnectedReference>
  railImageUrls: ReadonlyArray<string> | undefined
  imageLimit: number
}): {
  connectedReferences: ConnectedReference[] | undefined
  referenceImageUrls: string[] | undefined
} {
  const { references, railImageUrls, imageLimit } = args

  // Chips ride verbatim — no source-filtering, no transform (the route assembles).
  const connectedReferences = references.length ? [...references] : undefined

  // Chips reserve one @image_N slot per UNIQUE non-empty url (empty-url chips
  // attach nothing, so they reserve nothing), capped at the limit.
  const chipUrls = new Set<string>()
  for (const r of references) {
    if (r.url) chipUrls.add(r.url)
  }
  const railBudget = imageLimit - Math.min(chipUrls.size, imageLimit)

  // Rail: de-dupe among selves (order preserved), drop any url a chip already
  // carries (cross-channel dedup), then cap at the reserved remainder.
  const railList: string[] = []
  const seen = new Set<string>()
  for (const url of railImageUrls ?? []) {
    if (!url || seen.has(url) || chipUrls.has(url)) continue
    seen.add(url)
    railList.push(url)
  }
  const cappedRail = railBudget > 0 ? railList.slice(0, railBudget) : []
  const referenceImageUrls = cappedRail.length ? cappedRail : undefined

  return { connectedReferences, referenceImageUrls }
}

/** A word character for boundary purposes — a name ends where prose resumes
 *  (the same rule `prompt-mentions` reads a typed `@Name` by). */
const WORD_CHAR = "[\\p{L}\\p{N}]"
const NON_WORD_CHAR = "[^\\p{L}\\p{N}]"

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * The wire prompt with each bound chip's NAME bound to the chip ITSELF, using
 * the platform's id-addressed reference token — `{ref:<id>}`, where `<id>` is
 * byte-identical to the `connectedReferences[].id` the chip rides under. The
 * route substitutes the chip's `@image_N` seat AFTER it has numbered the
 * references (rail → mentioned characters → canonical wired characters →
 * everything else), so studio never computes a seat and a change to the
 * platform's numbering can never misbind a picture. (The first cut of this
 * mirrored that walk client-side and wrote positional `{image:N}` tokens; the
 * platform's `{ref:}` retired the mirror — issue #1052 / PR #1053 there.)
 *
 * The chip renders into the prose as its bare name, and the route binds the
 * picture with a trailing legend (`Ref 4 (@image_4).`) — so the model had to
 * connect a name in shot 1 to a line after shot 2 to know which picture shot 1
 * used. Worse, an image chip's old auto-label `Image N` IS the platform's
 * ordinal grammar. So:
 *
 *   - an image chip's name is REPLACED by the bare token — `walking together
 *     Ref 4` → `walking together {ref:<its id>}` → `… @image_4` on the model;
 *   - any other chip keeps its name (a proper noun the prose needs) and gains the
 *     token after it — `Iris` → `Iris ({ref:<its id>})`.
 *
 * Every whole-word occurrence binds, so each shot names the picture it uses.
 * Matching is EXACT-CASE on purpose: catalog transition terms fold lowercase
 * (`iris wipe`, `linear wipe`), and a chip named "Iris" must not bind a wipe to
 * a portrait. Longest name first, in one pass over the original text, so
 * `Image 1` never claims `Image 10` and a token never gets re-scanned.
 *
 * A token the route cannot seat degrades to the chip's `defaultName` (never
 * the raw token, never a phantom `@image_N`) — so only two things are left to
 * studio: keep `defaultName` human-readable, and skip the chips the route will
 * not attach at all — those past the provider's image budget (the rail takes
 * its seats first, chips take the remainder in list order) and those with no
 * picture — so an entity chip never degrades to `Iris (Iris)`. WIRE-ONLY: the
 * persisted prompt keeps the names, so a restore rebuilds the chips.
 *
 * The boundary BEFORE a name is a captured prefix, not a lookbehind: lookbehind
 * is the one regex feature the build's baseline (Vite's default, Safari 16.0)
 * lacks until 16.4, and this runs on the submit path — a `RegExp` that fails to
 * construct there is an Animate click that does nothing.
 *
 * WHAT THIS DOES NOT ATTACH, IT STILL HAS TO SAY (C6 follow-up). Two skips above
 * are deliberate — the chips past the image budget, and (at the call site) a
 * FRAMES-mode animate, which sends no `connectedReferences` at all because the
 * start still already carries the identity. Both used to be harmless: the chip
 * simply kept its bare name in the prose. Post-C6 the prose is `@panda-2`, so a
 * skip now ships a machine slug to the model. `chipReferences` names every chip
 * the prose HAS, whether or not it rides the wire, and `untokenizeRoles` gives
 * each unbound token its word back (see lib/role-prose).
 */
export function bindReferenceTokens(
  prompt: string,
  channels: {
    readonly connectedReferences: ReadonlyArray<ConnectedReference> | undefined
    readonly referenceImageUrls: ReadonlyArray<string> | undefined
    /** The provider's image-reference cap (the extend route's is one less). */
    readonly imageLimit: number
    /**
     * Every chip the PROSE names, whether or not it rides the wire — the words
     * the role tokens stand for. Defaults to `connectedReferences`, which is the
     * whole chip list on the references-mode and extend paths; frames mode has
     * to pass its chips explicitly, since it sends none of them.
     */
    readonly chipReferences?: ReadonlyArray<ConnectedReference>
  },
): string {
  const { connectedReferences, referenceImageUrls, imageLimit } = channels
  const named = channels.chipReferences ?? connectedReferences
  if (!prompt) return prompt
  // Nothing rides the wire ⇒ nothing to bind, but the prose may still be all
  // tokens (frames mode). The fallback is the whole job here.
  if (!connectedReferences?.length) return untokenizeRoleReferences(prompt, named)
  const rail = Math.min(referenceImageUrls?.length ?? 0, imageLimit)
  const attached = connectedReferences.slice(0, Math.max(0, imageLimit - rail))
  // First chip wins a name, so two chips sharing one label can't fight over it.
  const byName = new Map<string, ConnectedReference>()
  for (const r of attached) {
    const name = r.defaultName.trim()
    if (name && r.url && r.id && !byName.has(name)) byName.set(name, r)
  }
  if (byName.size === 0) return untokenizeRoleReferences(prompt, named)
  // THE CAST CHIP'S PROSE FORM (C6). `renderText` serializes a chip whose entity
  // is a role as `@<role-slug>`, not as its bare name — in a DIRECTING prompt
  // exactly as in a framing one — so a name-only match would leave a literal
  // `@panda-2` in the wire prompt beside a picture nothing explains. The token
  // is derived from the reference's own `defaultName` (`roleTokenForName`), so
  // this stays cast-free: the role slug IS the slug of the name the chip says.
  const byToken = new Map<string, ConnectedReference>()
  for (const [name, ref] of byName) {
    const token = roleTokenForName(name)
    if (token && !byToken.has(token)) byToken.set(token, ref)
  }
  const names = [...byName.keys()].sort((a, b) => b.length - a.length)
  // `-` and `:` join the trailing guard for the token branch alone: they are the
  // two characters that would make the run a LONGER token than the one claimed
  // (`@panda` inside `@panda-2`), and binding the short one would attach the
  // wrong picture and leave the remainder as literal prose.
  const tokens = [...byToken.keys()].sort((a, b) => b.length - a.length)
  // `(?!)` — a never-satisfiable branch — keeps the CAPTURE POSITIONS fixed when
  // no name sluggable to a token is bound, so the callback below reads one shape
  // always instead of forking on the pattern it was handed.
  const tokenAlt = tokens.length ? tokens.map(escapeRegExp).join("|") : "(?!)"
  const pattern = new RegExp(
    `(^|${NON_WORD_CHAR})(?:(${tokenAlt})(?![\\p{L}\\p{N}:-])` +
      `|(${names.map(escapeRegExp).join("|")})(?!${WORD_CHAR}))`,
    "gu",
  )
  const boundPrompt = prompt.replace(
    pattern,
    (
      _match: string,
      before: string,
      roleToken: string | undefined,
      name: string | undefined,
    ) => {
      const ref =
        roleToken !== undefined ? byToken.get(roleToken)! : byName.get(name!)!
      const token = `{ref:${ref.id}}`
      // A cast chip's token stands in for the NAME, so the human word it
      // replaced comes back with the binding: the prose needs the proper noun.
      const word = ref.defaultName.trim()
      const bound = ref.source === "wired-image" ? token : `${word} (${token})`
      return `${before}${bound}`
    },
  )
  // The tokens `attached` skipped — an over-budget chip, or one the caller sent
  // for naming only — get the bare name back, never a `{ref:}` the route has no
  // seat to substitute.
  return untokenizeRoleReferences(boundPrompt, named)
}
