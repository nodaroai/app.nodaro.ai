import {
  characterMentionSlug,
  imageMentionSlug,
  locationMentionSlug,
} from "@nodaro/shared"

import type { Cast, CastKind } from "./cast"

/**
 * THE CAST'S KEY LAYER (R74) — slugging, minting and growing the KEYS a cast
 * row lives under (spec `2026-08-31-project-cast-registry`, INV-C:
 * `castSlug(kind, displayName) === <key>` for every row).
 *
 * Split out of `cast.ts` purely for size, not for concern: the registry
 * itself — `Cast`, `CastMember`, enrollment, resolution, the `@name` ladder —
 * still lives there, which re-exports everything here, so no call site needs
 * to know the split exists. This file owns the KEY, never the ROW.
 */

/**
 * The role key for a display name — the PLATFORM's own mention slug, never a
 * hand-rolled `\s+ → -` (D1d: two studio call sites had exactly that drift, and
 * a key that forks from the grammar binds nothing on the wire).
 *
 * The three platform slug functions are byte-identical algorithms today; the
 * per-kind dispatch is drift insurance, not behavior.
 */
export function castSlug(kind: CastKind, name: string): string {
  if (kind === "character" || kind === "creature") return characterMentionSlug(name)
  if (kind === "location") return locationMentionSlug(name)
  return imageMentionSlug(name)
}

/**
 * The role a NAME addresses — the probe behind the submit seam (`@abi` in the
 * prose, "Abi" on a chip and `abi` in the cast are all the same role).
 *
 * KIND IS NOT PART OF THE KEY (D6a/D6b: *the name IS the identity key*). One
 * name means one thing per production, whatever kind it is; the per-kind slug
 * dispatch in {@link castSlug} is drift insurance over three byte-identical
 * algorithms, not a namespace.
 */
export function castKeyForName(name: string): string {
  return castSlug("image", name.trim())
}

/**
 * A KEY's own trailing `-<n>` — `panda-2` → `["panda", "2"]`. THE one
 * definition of "ends in an integer", read by {@link availableCastKey} (which
 * GROWS that number) and by {@link suffixedDisplayName} (which copies the grown
 * number onto the display name). Two readers of the same fact with two
 * definitions is exactly how "T-800" came to read as `t-801`: the minter saw a
 * trailing integer where the display parser saw none.
 */
const KEY_TRAILING_INT = /^(.*)-(\d+)$/

/**
 * A NAME's own trailing integer, the separator joining it and whatever trails
 * it — "Panda 2" → `["Panda", " ", "2", ""]`, "T-800" → `["T", "-", "800", ""]`,
 * "Room 101." → `["Room", " ", "101", "."]`. ANY non-alphanumeric run
 * separates, because the KEY cannot tell a space from a dash (both slug to `-`)
 * and the display has to follow the key.
 *
 * The TRAILER is why the digits are not anchored at `$`: a name the user typed
 * with punctuation after its number ("Panda 2!", "Room 101.") slugs to the same
 * `panda-2` the plain form does — the platform slug drops the trailer — so the
 * key grows while a `$`-anchored parser saw no number at all and the display
 * fell back to the raw key. Carried onto the grown form, the trailer keeps the
 * name the user wrote AND slugs back to the key ("Panda 3!" → `panda-3`).
 */
const NAME_TRAILING_INT = /^(.*?)([^\p{L}\p{N}]+)(\d+)([^\p{L}\p{N}]*)$/u

/**
 * The free key for `base`, filename-collision style: `panda`, then `panda-2`,
 * `panda-3`… (D6a — one name is one cast member per production, enforced AT THE
 * DOOR). Never returns a key already in `cast`, so an add can never overwrite a
 * role; the caller renames the DISPLAY name to match (see
 * {@link suffixedDisplayName}) so INV-C survives the suffix.
 *
 * A `base` that already ends in its OWN trailing `-<n>` ({@link KEY_TRAILING_INT})
 * GROWS that integer on a further collision (`panda-2` tries `panda-3`, then
 * `panda-4`…) rather than appending a second one beside it (`panda-2-2`) — R73.
 * This is blind to WHY the base ends in digits: a base minted by a previous
 * collision (`panda-2`) and one where the number was always part of the name
 * (`room-101`, from a location literally called "Room 101") grow exactly the
 * same way, because from here there is no way — and no need — to tell them apart.
 */
export function availableCastKey(cast: Cast, base: string): string {
  if (!base) return base
  if (!(base in cast)) return base
  const trailing = base.match(KEY_TRAILING_INT)
  const counter = trailing ? Number(trailing[2]) : Number.NaN
  // A tail we cannot COUNT IN is not a counter (R90). Past the safe-integer
  // range — `panda-<23 digits>` — `n + 1 === n`, so the candidate below would
  // stop changing and a cast already holding it would spin this loop FOREVER.
  // Such a tail stays part of the root and a fresh counter is appended beside
  // it (`panda-<23 digits>-2`), which is also the display the user can read.
  //
  // The headroom term is what makes the loop provably finite: every failed
  // candidate is a DISTINCT key already in `cast`, so at most `|cast| + 1` of
  // them are tried, and reserving that much headroom keeps every `n` in the
  // range where `n + 1 !== n`.
  const grows =
    Number.isSafeInteger(counter) &&
    counter + Object.keys(cast).length < Number.MAX_SAFE_INTEGER
  const root = trailing && grows ? trailing[1] : base
  const start = grows ? counter + 1 : 2
  for (let n = start; ; n += 1) {
    const candidate = `${root}-${n}`
    if (!(candidate in cast)) return candidate
  }
}

/**
 * The display name a suffixed key must carry so INV-C holds: `"Panda"` + key
 * `panda-3` → `"Panda 3"`. Derived from the KEY's own suffix rather than a
 * counter, so the two can't disagree.
 *
 * A name that already ends in its OWN trailing integer ("Panda 2") GROWS that
 * integer to the KEY's — the pairing with {@link availableCastKey}'s own growth
 * (R73/R75a), keeping the name's separator: "Panda 2" + `panda-4` → "Panda 4",
 * "T-800" + `t-801` → "T-801". The number is read off the KEY, never `+1` of
 * the name's own, because the minter SKIPS numbers already taken — `panda-2`
 * colliding into a cast that holds `panda-3` lands on `panda-4`, and a display
 * that counted for itself would say "Panda 3". A name with no trailing integer
 * appends the key's suffix, as before.
 *
 * The belt is what actually enforces INV-C: a form that doesn't slug back to
 * `key` falls back to the key itself, a name the user can still read. Nothing
 * the MINTER produces reaches it any more — a nested `panda-2-2` appends to
 * "Panda 2 2", which slugs straight back — so it is a hand-built-key belt now,
 * which is the good news: every real path (`enrollCastMember` and both composer
 * sites take their key from {@link availableCastKey}) keeps the name.
 */
export function suffixedDisplayName(
  kind: CastKind,
  displayName: string,
  key: string,
): string {
  const base = castSlug(kind, displayName)
  if (key === base) return displayName
  const keyTail = key.match(KEY_TRAILING_INT)
  const nameTail = displayName.match(NAME_TRAILING_INT)
  // The APPEND form reads the key's own suffix off the end of `base`, so it is
  // only meaningful where the key actually extends the base. It does not always:
  // a name whose digits carry a trailer ("Panda 2!") slugs to `panda-2`, which
  // GROWS to `panda-3` — a key that is no extension of `base` at all. Slicing
  // there produced garbage the belt then threw away; naming the condition keeps
  // the fallback honest instead.
  const appended = key.startsWith(`${base}-`)
    ? `${displayName} ${key.slice(base.length + 1)}`
    : key
  // GROW only where the key grew this name's own stem: the name's separator,
  // the KEY's number, the name's own trailer. Anything else appends, and the
  // belt below has the last word either way.
  const grown =
    keyTail && nameTail && castSlug(kind, nameTail[1]!) === keyTail[1]
      ? `${nameTail[1]}${nameTail[2]}${keyTail[2]}${nameTail[4]}`
      : appended
  return castSlug(kind, grown) === key ? grown : key
}
