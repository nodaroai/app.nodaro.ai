/**
 * The CAST section, exercised — the studio store's cast reducers as operations.
 *
 * Every assertion here is PORTED from `src/store/production-store.cast.test.ts`
 * in the studio checkout (describes "the project cast" L13, "rename and recast"
 * L93, "roles that arrive from elsewhere (C5)" L311). Only the call shape
 * changes: `s().addCastMember(member)` becomes
 * `castHandlers.enroll_cast(production, op, ctx)` and the state read moves from
 * `s().cast` to `result.production.cast`. The expectations themselves are the
 * store's, verbatim — the studio suite is the specification of these reducers.
 *
 * Two deliberate generalisations, both from the contract (`SECTIONS.md` rule 5
 * and its cast row) rather than from a re-reading of the reducer:
 *  - a missing key is `op_target_missing`, where the reducer is a silent
 *    reference no-op (the spec spells it out for `recast_cast_member`; the
 *    other three key-addressed ops follow the same rule);
 *  - an unsluggable name is `op_invalid`, where the reducer returns `null`.
 * The state assertions those tests carry ("…and the cast is unchanged") survive
 * the move untouched.
 */
import { describe, expect, it } from "vitest"

import { isOpError } from "../errors"
import type { Production } from "../production"
import type { OpContext } from "../types"
import { castHandlers, castOpClasses, castOpSchemas } from "../sections/cast"

import type { Cast, CastMember } from "../../cast"
import type { Shot } from "../../shot"

const ctx: OpContext = { now: "2026-09-06T12:00:00.000Z", mintId: () => "id-1" }

const production = (cast: Cast = {}, shots: Shot[] = []): Production => ({
  shots,
  cast,
})

/** The one shot the studio's rename/recast describe sets up (its `setShots`). */
const abiShot = (): Shot => ({
  id: "s1",
  still: {
    nodeId: "n1",
    url: "https://r2.example/1.png",
    provider: "nano-banana",
    prompt: "Abi walks in",
  },
  castLook: { abi: { url: "https://r2.example/back.png", label: "back" } },
})

const abiCast: Cast = {
  abi: { kind: "character", assetId: "c1", displayName: "Abi" },
}

const enroll = (doc: Production, member: CastMember) =>
  castHandlers.enroll_cast(doc, { op: "enroll_cast", member }, ctx)

const codeOf = (run: () => unknown): string => {
  try {
    run()
  } catch (error) {
    if (!isOpError(error)) throw error
    return error.code
  }
  throw new Error("expected an OpError")
}

// ── the project cast (studio L13) ───────────────────────────────────────────

describe("cast ops — the project cast", () => {
  it("enroll_cast reports the key it LANDED on, suffixing a collision", () => {
    const first = enroll(production(), {
      kind: "creature",
      assetId: "c1",
      displayName: "Panda",
    })
    expect(first.receipt.ids).toEqual(["panda"])
    const second = enroll(first.production, {
      kind: "creature",
      assetId: "c2",
      displayName: "Panda",
    })
    expect(second.receipt.ids).toEqual(["panda-2"])
    expect(second.production.cast!["panda"].assetId).toBe("c1")
    expect(second.production.cast!["panda-2"].assetId).toBe("c2")
  })

  it("two enrollments in one batch can't both claim the same slug", () => {
    // The stale-snapshot hazard: the second op must read the cast the FIRST one
    // landed, which is what applying it to the returned production is.
    const first = enroll(production(), {
      kind: "character",
      assetId: "a",
      displayName: "Abi",
    })
    const second = enroll(first.production, {
      kind: "character",
      assetId: "b",
      displayName: "Abi",
    })
    expect([first.receipt.ids?.[0], second.receipt.ids?.[0]]).toEqual([
      "abi",
      "abi-2",
    ])
  })

  it("an unsluggable name enrolls nothing", () => {
    const doc = production()
    expect(
      codeOf(() =>
        enroll(doc, { kind: "character", assetId: "c", displayName: "🎬" }),
      ),
    ).toBe("op_invalid")
    expect(doc.cast).toEqual({})
  })

  it("copy-on-write: the previous cast object is never mutated", () => {
    const first = enroll(production(), {
      kind: "character",
      assetId: "a",
      displayName: "Abi",
    })
    const before = first.production.cast
    const second = enroll(first.production, {
      kind: "location",
      assetId: "l",
      displayName: "Park",
    })
    expect(before).toEqual({
      abi: { kind: "character", assetId: "a", displayName: "Abi" },
    })
    expect(second.production.cast).not.toBe(before)
  })

  it("remove_cast_member drops one row; a missing key is refused", () => {
    const doc = production(abiCast)
    expect(
      codeOf(() =>
        castHandlers.remove_cast_member(
          doc,
          { op: "remove_cast_member", key: "nobody" },
          ctx,
        ),
      ),
    ).toBe("op_target_missing")
    expect(doc.cast).toBe(abiCast)
    const removed = castHandlers.remove_cast_member(
      doc,
      { op: "remove_cast_member", key: "abi" },
      ctx,
    )
    expect(removed.production.cast).toEqual({})
  })

  it("names the role it bound, in the user's words", () => {
    const result = enroll(production(), {
      kind: "character",
      assetId: "char-kira",
      displayName: "Kira",
    })
    expect(result.receipt.summary).toBe("Bound @Kira (character).")
  })
})

// ── rename and recast (studio L93) ──────────────────────────────────────────

describe("cast ops — rename and recast", () => {
  const doc = () => production(abiCast, [abiShot()])

  const rename = (from: Production, key: string, displayName: string) =>
    castHandlers.rename_cast_member(
      from,
      { op: "rename_cast_member", key, displayName },
      ctx,
    )

  const recast = (
    from: Production,
    key: string,
    actor: { kind: "character"; assetId: string },
  ) =>
    castHandlers.recast_cast_member(
      from,
      { op: "recast_cast_member", key, actor },
      ctx,
    )

  const setRole = (from: Production, key: string, role: string | null) =>
    castHandlers.set_cast_role(from, { op: "set_cast_role", key, role }, ctx)

  it("rename keeps the ACTOR, moves the key, and rewrites the prose", () => {
    const landed = rename(doc(), "abi", "Sara")
    expect(landed.receipt.ids).toEqual(["sara"])
    expect(landed.production.cast).toEqual({
      sara: { kind: "character", assetId: "c1", displayName: "Sara" },
    })
    expect(landed.production.shots[0].still!.prompt).toBe("Sara walks in")
    // The pin follows the rename: same actor, so the view is still valid.
    expect(landed.production.shots[0].castLook).toEqual({
      sara: { url: "https://r2.example/back.png", label: "back" },
    })
  })

  it("renaming to a TAKEN name suffixes at the door rather than overwriting", () => {
    const seeded = enroll(doc(), {
      kind: "character",
      assetId: "c2",
      displayName: "Sara",
    })
    const landed = rename(seeded.production, "abi", "Sara")
    expect(landed.receipt.ids![0]).toBe("sara-2")
    expect(landed.production.cast!["sara-2"].displayName).toBe("Sara 2")
    expect(landed.production.cast!["sara"].assetId).toBe("c2")
    expect(landed.production.cast!["sara-2"].assetId).toBe("c1")
    // The prose says what the role is actually called, not what was asked for.
    expect(landed.production.shots[0].still!.prompt).toBe("Sara 2 walks in")
  })

  it("renaming to a different SPELLING of the same slug keeps its own key", () => {
    const landed = rename(doc(), "abi", "ABI")
    expect(landed.receipt.ids![0]).toBe("abi")
    expect(landed.production.cast!["abi"].displayName).toBe("ABI")
    expect(Object.keys(landed.production.cast!)).toEqual(["abi"])
  })

  it("recast keeps the NAME, swaps the actor, and REPORTS the reset pins", () => {
    const result = recast(doc(), "abi", { kind: "character", assetId: "c9" })
    expect(result.receipt.summary).toBe("Recast @Abi (character) (reset 1 pin).")
    expect(result.production.cast!["abi"]).toEqual({
      kind: "character",
      assetId: "c9",
      displayName: "Abi",
    })
    // A pin was a view of the actor that left — dropped, never left stale.
    expect(result.production.shots[0].castLook).toBeUndefined()
    // …and the prose never moved.
    expect(result.production.shots[0].still!.prompt).toBe("Abi walks in")
  })

  it("recast drops the ROW's own default look too — same staleness as a pin", () => {
    const seeded = production(
      {
        abi: {
          kind: "character",
          assetId: "c1",
          displayName: "Abi",
          defaultLook: { url: "https://r2.example/old.png", label: "back" },
        },
      },
      [abiShot()],
    )
    const result = recast(seeded, "abi", { kind: "character", assetId: "c9" })
    expect(result.production.cast!["abi"].defaultLook).toBeUndefined()
  })

  it("set_cast_role sets the WORD, trimmed and stored as typed (D6p)", () => {
    const result = setRole(doc(), "abi", "  Panda Suit  ")
    expect(result.production.cast!["abi"]).toEqual({
      kind: "character",
      assetId: "c1",
      displayName: "Abi",
      defaultRole: "Panda Suit",
    })
  })

  it("bounds the word and collapses its whitespace — nothing downstream does", () => {
    const long = setRole(doc(), "abi", "z".repeat(100))
    expect(long.production.cast!["abi"].defaultRole).toBe("z".repeat(32))
    // …and a Custom… pick lands on the SPACED preset `roleToPhrase` special-cases.
    const spaced = setRole(doc(), "abi", "empty   background")
    expect(spaced.production.cast!["abi"].defaultRole).toBe("empty background")
  })

  it("an EMPTY word clears the field — no `defaultRole` key survives", () => {
    for (const cleared of [null, "", "   "]) {
      const set = setRole(doc(), "abi", "panda")
      const wiped = setRole(set.production, "abi", cleared)
      expect("defaultRole" in wiped.production.cast!["abi"]).toBe(false)
    }
  })

  it("is a true no-op when the word didn't change; a role that isn't cast is refused", () => {
    const set = setRole(doc(), "abi", "panda")
    const cast = set.production.cast
    // The SAME object back: copy-on-write is load-bearing for re-render, and a
    // fresh cast would mark the production dirty for a save that changed nothing.
    expect(setRole(set.production, "abi", "panda").production.cast).toBe(cast)
    expect(setRole(set.production, "abi", "  panda  ").production.cast).toBe(cast)
    expect(codeOf(() => setRole(set.production, "nobody", "panda"))).toBe(
      "op_target_missing",
    )
    // …and clearing an already-role-less row is a no-op too.
    const cleared = setRole(set.production, "abi", null)
    expect(setRole(cleared.production, "abi", null).production.cast).toBe(
      cleared.production.cast,
    )
  })

  it("the role WORD survives a recast — it names the role, not the actor", () => {
    const set = setRole(doc(), "abi", "panda")
    const result = recast(set.production, "abi", {
      kind: "character",
      assetId: "c9",
    })
    expect(result.production.cast!["abi"]).toEqual({
      kind: "character",
      assetId: "c9",
      displayName: "Abi",
      defaultRole: "panda",
    })
  })

  it("the role WORD survives a rename, riding to the row's new key", () => {
    const set = setRole(doc(), "abi", "panda")
    const landed = rename(set.production, "abi", "Sara")
    expect(landed.production.cast!["sara"].defaultRole).toBe("panda")
  })

  it("both are refused on a role that isn't cast", () => {
    const base = doc()
    expect(codeOf(() => rename(base, "nobody", "X"))).toBe("op_target_missing")
    expect(
      codeOf(() => recast(base, "nobody", { kind: "character", assetId: "z" })),
    ).toBe("op_target_missing")
    expect(base.cast).toBe(abiCast)
  })

  it("says how many prompts a rename rewrote", () => {
    const landed = rename(doc(), "abi", "Sara")
    expect(landed.receipt.summary).toBe("Renamed @Abi to @Sara (character).")
    expect(landed.warnings).toEqual(["Renamed the role in 1 prompt."])
  })
})

// ── roles that arrive from elsewhere, C5 (studio L311) ──────────────────────

describe("cast ops — roles that arrive from elsewhere (C5)", () => {
  /** The chipped scene the studio's `chipped()` helper serializes. */
  const chipped = (id: string, name: string, actorId: string): Shot => ({
    id,
    still: {
      nodeId: `generate-image-${id}`,
      url: `https://r2.example/${id}.png`,
      provider: "nano-banana",
      prompt: `${name} waits`,
      results: [
        {
          url: `https://r2.example/${id}.png`,
          prompt: `${name} waits`,
          references: [
            {
              id: actorId,
              defaultName: name,
              source: "wired-character",
              url: `https://r2.example/${actorId}.png`,
            },
          ],
        },
      ],
    },
  })

  const mint = (from: Production) =>
    castHandlers.mint_cast_from_chips(
      from,
      { op: "mint_cast_from_chips" },
      ctx,
    )

  it("mint_cast_from_chips mints the LEGACY production's cast and reports it", () => {
    const doc = production({}, [chipped("a", "Kira", "char-kira")])
    expect(doc.cast).toEqual({})
    const minted = mint(doc)
    expect(minted.receipt.ids).toEqual(["kira"])
    expect(minted.receipt.summary).toBe("Minted @Kira from the scenes’ chips.")
    expect(minted.production.cast!["kira"].assetId).toBe("char-kira")
    // Idempotent — a second run has nothing to mint.
    const again = mint(minted.production)
    expect(again.receipt.ids).toBeUndefined()
    expect(again.production).toBe(minted.production)
  })
})

// ── the section's own contract ──────────────────────────────────────────────

describe("cast ops — the section table", () => {
  it("declares a schema, a handler and a class for the same six ops", () => {
    const ops = Object.keys(castOpSchemas).sort()
    expect(ops).toEqual([
      "enroll_cast",
      "mint_cast_from_chips",
      "recast_cast_member",
      "remove_cast_member",
      "rename_cast_member",
      "set_cast_role",
    ])
    expect(Object.keys(castHandlers).sort()).toEqual(ops)
    expect(Object.keys(castOpClasses).sort()).toEqual(ops)
    expect(castOpClasses.remove_cast_member).toBe("D")
  })

  it("each schema pins its own `op` literal", () => {
    for (const [name, schema] of Object.entries(castOpSchemas)) {
      expect(schema.safeParse({ op: "not_this_one" }).success).toBe(false)
      expect(
        schema.safeParse({ op: name, key: "abi", displayName: "Abi", role: null })
          .success,
      ).toBe(name !== "enroll_cast" && name !== "recast_cast_member")
    }
  })
})
