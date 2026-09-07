/**
 * The `looks` section — the per-scene look and its per-cast overrides.
 *
 * The oracle is the studio store: `setShotLook` / `setShotCastLook` /
 * `setShotCastLookMap` (`src/store/production-store-cast-look.ts`), whose
 * assertions live in `src/store/production-store.cast.test.ts`. Those three
 * cases are ported here VERBATIM — only the call shape moves, from
 * `s().setShotCastLook(…)` to `looksHandlers.set_cast_look(production, op, ctx)`.
 *
 * `setShotLook` has no store test of its own in the studio repo, so its cases
 * below are written from the reducer's behaviour (`withShotLook`): copy on
 * write, an empty map DROPS the field, and an already-look-less scene comes
 * back as the SAME array and the SAME shot.
 *
 * The one deliberate generalisation: the store is silent when the shot id names
 * nothing, and an operation must not be — a caller who addressed a shot that
 * left needs to hear about it, so every handler throws `op_target_missing`.
 */
import { describe, expect, it } from "vitest"

import type { CastLookMap } from "../../cast"
import type { LookSelectionMap } from "../../shot"
import { isOpError } from "../errors"
import type { OpContext } from "../types"
import type { Production } from "../production"
import { looksHandlers, looksOpClasses, looksOpSchemas } from "../sections/looks"

const ctx: OpContext = { now: "2026-09-06T12:00:00.000Z", mintId: () => "id-1" }

/** The store test's own fixture: one framed scene with a pin on `abi`. */
const seed = (): Production => ({
  shots: [
    {
      id: "s1",
      still: {
        nodeId: "n1",
        url: "https://r2.example/1.png",
        provider: "nano-banana",
        prompt: "Abi walks in",
      },
      castLook: { abi: { url: "https://r2.example/back.png", label: "back" } },
    },
  ],
  cast: {
    abi: { kind: "character", assetId: "c1", displayName: "Abi" },
  },
})

const setLook = (production: Production, shotId: string, look: LookSelectionMap) =>
  looksHandlers.set_look(production, { op: "set_look", shotId, look }, ctx)

const setCastLook = (
  production: Production,
  shotId: string,
  key: string,
  look: CastLookMap[string] | null,
) =>
  looksHandlers.set_cast_look(
    production,
    { op: "set_cast_look", shotId, key, look },
    ctx,
  )

const setCastLookMap = (production: Production, shotId: string, map: CastLookMap) =>
  looksHandlers.set_cast_look_map(
    production,
    { op: "set_cast_look_map", shotId, map },
    ctx,
  )

describe("looks — the per-cast pins (ported from production-store.cast.test.ts)", () => {
  it("setShotCastLookMap replaces the whole map (the copy-settings apply)", () => {
    let p = seed()
    p = setCastLookMap(p, "s1", { park: { url: "https://r2.example/dusk.png" } }).production
    expect(p.shots[0].castLook).toEqual({ park: { url: "https://r2.example/dusk.png" } })
    // Copied, never aliased — the store must not share the caller's object.
    const incoming = { abi: { url: "https://r2.example/x.png" } }
    p = setCastLookMap(p, "s1", incoming).production
    expect(p.shots[0].castLook).not.toBe(incoming)
    // An empty map drops the field, exactly like `setShotLook`.
    p = setCastLookMap(p, "s1", {}).production
    expect("castLook" in p.shots[0]).toBe(false)
  })

  it("setShotCastLookMap is a true no-op on an un-pinned scene", () => {
    let p = seed()
    p = setCastLookMap(p, "s1", {}).production
    const shots = p.shots
    p = setCastLookMap(p, "s1", {}).production
    // The SAME array and the SAME shot back. Copy-on-write is load-bearing for
    // re-render, and a fresh array would also mark the production dirty for a
    // save that changed nothing.
    expect(p.shots).toBe(shots)
    expect(p.shots[0]).toBe(shots[0])
  })

  it("setShotCastLook pins, replaces and clears — dropping the field when last", () => {
    let p = seed()
    p = setCastLook(p, "s1", "park", { url: "https://r2.example/dusk.png" }).production
    expect(Object.keys(p.shots[0].castLook!).sort()).toEqual(["abi", "park"])
    p = setCastLook(p, "s1", "abi", null).production
    expect(p.shots[0].castLook).toEqual({ park: { url: "https://r2.example/dusk.png" } })
    p = setCastLook(p, "s1", "park", null).production
    expect("castLook" in p.shots[0]).toBe(false)
  })
})

describe("looks — set_look (written from `withShotLook`, which has no store test)", () => {
  it("writes the scene's own layer, copied rather than aliased", () => {
    const incoming: LookSelectionMap = {
      atmosphereId: "golden-hour",
      lensIds: ["anamorphic", "wide"],
    }
    const p = setLook(seed(), "s1", incoming).production

    expect(p.shots[0].look).toEqual(incoming)
    expect(p.shots[0].look).not.toBe(incoming)
    // The multi-pick arm is copied too — a push on the caller's array must not
    // reach the persisted document.
    expect(p.shots[0].look!.lensIds).not.toBe(incoming.lensIds)
  })

  it("an empty map DROPS the field, and an un-looked scene is a true no-op", () => {
    let p = setLook(seed(), "s1", { atmosphereId: "golden-hour" }).production
    p = setLook(p, "s1", {}).production
    expect("look" in p.shots[0]).toBe(false)

    const shots = p.shots
    p = setLook(p, "s1", {}).production
    expect(p.shots).toBe(shots)
    expect(p.shots[0]).toBe(shots[0])
  })

  it("copy-on-write: the production it was handed is never touched", () => {
    const before = seed()
    const shots = before.shots
    const after = setLook(before, "s1", { atmosphereId: "golden-hour" }).production

    expect(after).not.toBe(before)
    expect(before.shots).toBe(shots)
    expect("look" in before.shots[0]).toBe(false)
  })

  it("never carries look prose — a selection is catalog IDS", () => {
    const p = setLook(seed(), "s1", { atmosphereId: "golden-hour" }).production
    expect(p.shots[0].look).toEqual({ atmosphereId: "golden-hour" })
  })
})

describe("looks — a shot the document does not have", () => {
  it("throws op_target_missing rather than writing nothing in silence", () => {
    const p = seed()
    const calls = [
      () => setLook(p, "nope", { atmosphereId: "golden-hour" }),
      () => setCastLook(p, "nope", "abi", { url: "https://r2.example/x.png" }),
      () => setCastLookMap(p, "nope", { abi: { url: "https://r2.example/x.png" } }),
    ]
    for (const call of calls) {
      try {
        call()
        expect.unreachable("the handler must refuse a shot that is not there")
      } catch (error) {
        expect(isOpError(error)).toBe(true)
        if (!isOpError(error)) throw error
        expect(error.code).toBe("op_target_missing")
      }
    }
  })
})

describe("looks — the receipts and the vocabulary", () => {
  it("names the scene and the role the way the user sees them", () => {
    const p = seed()
    expect(setLook(p, "s1", { atmosphereId: "golden-hour" }).receipt).toEqual({
      op: "set_look",
      summary: "Set the look on Shot 1.",
    })
    expect(setLook(p, "s1", {}).receipt.summary).toBe("Cleared the look on Shot 1.")
    expect(
      setCastLook(p, "s1", "abi", { url: "https://r2.example/x.png" }).receipt.summary,
    ).toBe("Pinned a look for Abi (character) on Shot 1.")
    expect(setCastLook(p, "s1", "abi", null).receipt.summary).toBe(
      "Cleared the pinned look for Abi (character) on Shot 1.",
    )
    expect(setCastLookMap(p, "s1", { abi: { url: "https://r2.example/x.png" } }).receipt.summary).toBe(
      "Pinned 1 look on Shot 1.",
    )
    expect(setCastLookMap(p, "s1", {}).receipt.summary).toBe(
      "Cleared the pinned looks on Shot 1.",
    )
  })

  it("prefers a scene's NAME over its position", () => {
    const named: Production = {
      shots: [{ id: "s0" }, { id: "s1", name: "Rooftop" }],
    }
    expect(setLook(named, "s1", { atmosphereId: "dusk" }).receipt.summary).toBe(
      "Set the look on “Rooftop”.",
    )
    expect(setLook(named, "s0", { atmosphereId: "dusk" }).receipt.summary).toBe(
      "Set the look on Shot 1.",
    )
  })

  it("falls back to the role KEY when the role is not enrolled", () => {
    expect(
      setCastLook(seed(), "s1", "park", { url: "https://r2.example/dusk.png" }).receipt
        .summary,
    ).toBe("Pinned a look for park on Shot 1.")
  })

  it("says so when a write changed nothing", () => {
    const p = setCastLookMap(seed(), "s1", {}).production
    expect(setCastLookMap(p, "s1", {}).warnings).toEqual([
      "Shot 1 had no pinned looks already.",
    ])
    expect(setLook(p, "s1", {}).warnings).toEqual(["Shot 1 had no look already."])
  })

  it("declares every op it schemas, all of them safe", () => {
    expect(Object.keys(looksOpSchemas)).toEqual([
      "set_look",
      "set_cast_look",
      "set_cast_look_map",
    ])
    expect(Object.keys(looksHandlers)).toEqual(Object.keys(looksOpSchemas))
    expect(Object.values(looksOpClasses)).toEqual(["S", "S", "S"])
  })

  it("parses the args §6 names, and refuses a malformed pin", () => {
    expect(
      looksOpSchemas.set_cast_look.parse({
        op: "set_cast_look",
        shotId: "s1",
        key: "abi",
        look: null,
      }),
    ).toEqual({ op: "set_cast_look", shotId: "s1", key: "abi", look: null })
    expect(
      looksOpSchemas.set_look.parse({
        op: "set_look",
        shotId: "s1",
        look: { lensIds: ["anamorphic"] },
      }).look,
    ).toEqual({ lensIds: ["anamorphic"] })
    expect(
      looksOpSchemas.set_cast_look_map.safeParse({
        op: "set_cast_look_map",
        shotId: "s1",
        map: { abi: { label: "back" } },
      }).success,
    ).toBe(false)
  })
})
