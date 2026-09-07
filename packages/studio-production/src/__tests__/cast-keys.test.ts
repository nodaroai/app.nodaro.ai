import { describe, it, expect } from "vitest"

import { availableCastKey, castSlug, suffixedDisplayName } from "../cast-keys"
import type { Cast } from "../cast"

/**
 * The KEY LAYER moved out of `cast.ts` (R74): the platform slug wrapper and
 * the key minter + display-name pair its own collision growth (R73) rests on.
 * `cast.test.ts` keeps the ENROLLMENT-level tests (`enrollCastMember`'s own
 * suffix cascade, INV-C through a live cast) — this file is the standalone,
 * pure-function pin for the two primitives underneath it.
 */

describe("castSlug — the key comes from the platform grammar, never hand-rolled", () => {
  it("matches the platform's own mention slug per kind", () => {
    expect(castSlug("character", "Jack Mercer")).toBe("jack-mercer")
    expect(castSlug("location", "Sunset  Boat")).toBe("sunset-boat")
    expect(castSlug("image", "Scene 1 · Take 1")).toBe("scene-1-take-1")
    // The D1d drift the hand-rolled `\s+ → -` version shipped: punctuation
    // stripped and runs collapsed, not left in the key.
    expect(castSlug("character", "Kira-Vance")).toBe(
      castSlug("character", "Kira Vance"),
    )
  })

  it("an unsluggable name yields no key at all", () => {
    expect(castSlug("character", "אבי")).toBe("")
    expect(castSlug("character", "🎬")).toBe("")
  })
})

describe("availableCastKey / suffixedDisplayName — the key minter and its display pair", () => {
  it("are consistent standalone", () => {
    const cast: Cast = {
      abi: { kind: "character", assetId: "a", displayName: "Abi" },
    }
    expect(availableCastKey(cast, "abi")).toBe("abi-2")
    expect(availableCastKey(cast, "zoe")).toBe("zoe")
    expect(suffixedDisplayName("character", "Abi", "abi-2")).toBe("Abi 2")
    expect(suffixedDisplayName("character", "Abi", "abi")).toBe("Abi")
  })

  it("suffixedDisplayName GROWS a name that already ends in a trailing integer", () => {
    // "Panda 2" colliding again must read "Panda 3", never "Panda 2 2".
    expect(suffixedDisplayName("creature", "Panda 2", "panda-3")).toBe("Panda 3")
    // Growth by one regardless of how large the existing number already is.
    expect(suffixedDisplayName("creature", "Panda 10", "panda-11")).toBe("Panda 11")
    // No trailing integer at all ⇒ unchanged, append-the-key's-suffix behaviour.
    expect(suffixedDisplayName("creature", "Panda", "panda-3")).toBe("Panda 3")
  })

  it("availableCastKey GROWS a base's own trailing integer, never nests it (R73)", () => {
    const cast: Cast = {
      panda: { kind: "creature", assetId: "p1", displayName: "Panda" },
      "panda-2": { kind: "creature", assetId: "p2", displayName: "Panda 2" },
    }
    // A base that is ITSELF already suffixed grows the number instead of
    // appending a second one — `panda-2` tries `panda-3`, not `panda-2-2`.
    expect(availableCastKey(cast, "panda-2")).toBe("panda-3")
    expect(
      availableCastKey(
        { ...cast, "panda-3": { kind: "creature", assetId: "p3", displayName: "Panda 3" } },
        "panda-2",
      ),
    ).toBe("panda-4")
    // A base with no trailing integer keeps the `-2`, `-3`… loop it always had.
    expect(availableCastKey(cast, "panda")).toBe("panda-3")
    expect(availableCastKey({ panda: cast.panda! }, "panda")).toBe("panda-2")
  })

  it("…which is what makes 'Panda 10' → 'Panda 11' reachable through the real minter", () => {
    // Not a hand-picked key: the pipeline `enrollCastMember` actually drives.
    const cast: Cast = {
      "panda-10": { kind: "creature", assetId: "p10", displayName: "Panda 10" },
    }
    const key = availableCastKey(cast, "panda-10")
    expect(key).toBe("panda-11")
    expect(suffixedDisplayName("creature", "Panda 10", key)).toBe("Panda 11")
    // The rule is blind to WHY a base ends in digits — a location literally
    // called "Room 101" collides and grows exactly the same way, to
    // `room-102`, never the nested `room-101-2`.
    expect(availableCastKey({ "room-101": cast.panda! }, "room-101")).toBe(
      "room-102",
    )
  })

  it("the display follows the KEY when the minter skips a taken number (R75a)", () => {
    const cast: Cast = {
      panda: { kind: "creature", assetId: "p1", displayName: "Panda" },
      "panda-2": { kind: "creature", assetId: "p2", displayName: "Panda 2" },
      "panda-3": { kind: "creature", assetId: "p3", displayName: "Panda 3" },
    }
    // The minter SKIPS the taken `panda-3`, so a display grown by +1 off its
    // own name ("Panda 3") would name a different key than the one assigned.
    // The number is the KEY's, always.
    const key = availableCastKey(cast, "panda-2")
    expect(key).toBe("panda-4")
    expect(suffixedDisplayName("creature", "Panda 2", key)).toBe("Panda 4")
  })

  it("a name whose digits carry a TRAILER grows WITH it (R78)", () => {
    // The platform slug drops a trailing "!" or "." — "Panda 2!" slugs to
    // `panda-2` — so the minter grows the KEY while a `$`-anchored name parser
    // saw no trailing integer at all, appended, and left the belt to hand the
    // user the raw key as their role's name.
    expect(suffixedDisplayName("creature", "Panda 2!", "panda-3")).toBe("Panda 3!")
    expect(suffixedDisplayName("location", "Room 101.", "room-102")).toBe("Room 102.")
    // The grown form still slugs back to the key, which is the whole invariant.
    expect(castSlug("creature", "Panda 3!")).toBe("panda-3")
    expect(castSlug("location", "Room 102.")).toBe("room-102")
  })

  it("a tail too long to COUNT IN cannot spin the minter forever (R90)", () => {
    // 23 digits — past `Number.MAX_SAFE_INTEGER`. Against the pre-R90 minter
    // this call NEVER RETURNS: `Number(tail) + 1` saturates, so `n + 1 === n`,
    // the candidate stays `panda-1e+23` — a key the cast already holds — and
    // the loop spins. A tail that cannot be counted in is not a counter: it
    // stays part of the root and a fresh one is appended beside it.
    const huge = "panda-99999999999999999999999"
    const member = { kind: "creature" as const, assetId: "p", displayName: "Panda" }
    const cast: Cast = { [huge]: member, "panda-1e+23": member }
    expect(availableCastKey(cast, huge)).toBe(`${huge}-2`)
    // The same guard at the TOP of the safe range, where growing would leave no
    // headroom for the candidates the loop may still have to try.
    const max = `panda-${Number.MAX_SAFE_INTEGER}`
    expect(availableCastKey({ [max]: member }, max)).toBe(`${max}-2`)
    // …and the display follows that key instead of falling back to it.
    expect(
      suffixedDisplayName("creature", "Panda 99999999999999999999999", `${huge}-2`),
    ).toBe("Panda 99999999999999999999999 2")
  })

  it("a DASH-joined number is a trailing integer too — both readers agree", () => {
    // "T-800" slugs to `t-800`, so the minter grows it to `t-801` (R73). The
    // display parser must see the same trailing integer and keep the name's
    // OWN separator, or INV-C's belt fires and the role reads "t-801".
    const cast: Cast = {
      "t-800": { kind: "character", assetId: "t1", displayName: "T-800" },
    }
    const key = availableCastKey(cast, "t-800")
    expect(key).toBe("t-801")
    expect(suffixedDisplayName("character", "T-800", key)).toBe("T-801")
  })
})
