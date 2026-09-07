import { describe, it, expect } from "vitest"
import { characterMentionSlug, type ConnectedReference } from "@nodaro/shared"

import type { Cast } from "../cast"
import { castFromChips, describedRolesFrom, mergeCast } from "../cast-merge"
import type { Shot } from "../shot"

/**
 * C5's two arriving-roles paths (spec 2026-08-31-project-cast-registry): the
 * paste merge and the LEGACY MIGRATION ("on first edit the enroller mints the
 * cast from the chips, auto-suffixing collisions and rewriting the prose once,
 * visibly").
 *
 * The hard case both share is D6a's: a name already taken by a DIFFERENT actor.
 * The registry refuses to resolve that at the identity layer — one name is one
 * person — so it resolves at the NAME layer and the prose has to move with it.
 * That prose rewrite is what these tests are really about: a suffix that the
 * words don't carry would leave `@panda` bound to one of two pandas at random,
 * which is the exact bug the whole spec exists to kill.
 */

const chip = (
  id: string,
  name: string,
  over: Partial<ConnectedReference> = {},
): ConnectedReference => ({
  id,
  defaultName: name,
  source: "wired-character",
  url: `https://r2.example/${id}.png`,
  characterSlug: characterMentionSlug(name),
  ...over,
})

const framed = (id: string, prompt: string, refs: ConnectedReference[]): Shot => ({
  id,
  still: {
    nodeId: `generate-image-${id}`,
    url: `https://r2.example/${id}.png`,
    provider: "nano-banana",
    prompt,
    results: [{ url: `https://r2.example/${id}.png`, prompt, references: refs }],
  },
})

describe("mergeCast — an arriving sheet meets one that exists", () => {
  const mine: Cast = {
    kira: { kind: "character", assetId: "char-kira", displayName: "Kira" },
  }

  it("a free name enrolls as-is, prose untouched", () => {
    const shots = [framed("s1", "Jax in the rain", [chip("char-jax", "Jax")])]
    const out = mergeCast(mine, {
      jax: { kind: "character", assetId: "char-jax", displayName: "Jax" },
    }, shots)
    expect(out.cast.jax?.assetId).toBe("char-jax")
    expect(out.shots[0]!.still!.prompt).toBe("Jax in the rain")
    expect(out.enrolled).toEqual([{ key: "jax", displayName: "Jax" }])
  })

  it("the SAME actor arriving again reuses its role — no `kira-2`", () => {
    const out = mergeCast(mine, {
      kira: { kind: "character", assetId: "char-kira", displayName: "Kira" },
    }, [])
    expect(Object.keys(out.cast)).toEqual(["kira"])
    expect(out.enrolled).toEqual([])
  })

  it("a DIFFERENT actor on a taken name is suffixed AND the arriving prose says so", () => {
    const shots = [framed("s1", "Kira waits", [chip("other-kira", "Kira")])]
    const out = mergeCast(mine, {
      kira: { kind: "character", assetId: "other-kira", displayName: "Kira" },
    }, shots)

    expect(out.cast["kira"]!.assetId).toBe("char-kira")
    expect(out.cast["kira-2"]).toEqual({
      kind: "character",
      assetId: "other-kira",
      displayName: "Kira 2",
    })
    // The words carry the distinction the chips used to hide (D6b).
    expect(out.shots[0]!.still!.prompt).toBe("Kira 2 waits")
    expect(out.shots[0]!.still!.results![0]!.references![0]!.defaultName).toBe("Kira 2")
    expect(out.enrolled).toEqual([
      { key: "kira-2", displayName: "Kira 2", renamedFrom: "Kira" },
    ])
  })

  it("a SECOND collision leaves the actor the first one just settled alone", () => {
    // The cascade. The sheet brings a `Panda` (which collides with ours and is
    // renamed `Panda 2`) and its OWN `Panda 2` — so step 2's name is the name
    // step 1 just handed out, and a rewrite scoped by NAME retargets the actor
    // step 1 had already settled, prose and chip.
    const ours: Cast = {
      panda: { kind: "character", assetId: "panda-dest", displayName: "Panda" },
    }
    const shots = [
      framed("s1", "@Panda swims", [chip("panda-a", "Panda")]),
      framed("s2", "@Panda 2 climbs", [chip("panda-b", "Panda 2")]),
    ]
    const out = mergeCast(
      ours,
      {
        panda: { kind: "character", assetId: "panda-a", displayName: "Panda" },
        "panda-2": { kind: "character", assetId: "panda-b", displayName: "Panda 2" },
      },
      shots,
    )

    expect(out.cast["panda"]!.assetId).toBe("panda-dest")
    expect(out.cast["panda-2"]!.assetId).toBe("panda-a")
    // R73: availableCastKey GROWS a base's own trailing integer on a further
    // collision (`panda-2` tries `panda-3`, next `panda-4`…) instead of
    // nesting a second suffix onto it (`panda-2-2`) — so step 2's `Panda 2`
    // lands on its OWN row at `panda-3`, and suffixedDisplayName grows the
    // display to match: "Panda 3".
    expect(out.cast["panda-3"]!.assetId).toBe("panda-b")
    expect(out.cast["panda-3"]!.displayName).toBe("Panda 3")

    // s1 was settled on `Panda 2` by step 1 and stays there.
    expect(out.shots[0]!.still!.prompt).toBe("@Panda 2 swims")
    expect(out.shots[0]!.still!.results![0]!.references![0]!.defaultName).toBe(
      "Panda 2",
    )
    // s2 is the one step 2 owns, and it moves — to "Panda 3", the name its new
    // row actually carries.
    expect(out.shots[1]!.still!.prompt).toBe("@Panda 3 climbs")
    expect(out.shots[1]!.still!.results![0]!.references![0]!.defaultName).toBe(
      "Panda 3",
    )
  })

  it("a sibling role named in the SAME surface is left alone (R75b)", () => {
    // Both names in ONE owned surface — the case identity scoping cannot see,
    // because the surface binds the arriving actor and therefore owns every
    // word in it. `Panda 2` is a role we already hold; the rewrite of `Panda`
    // must not run through it.
    const ours: Cast = {
      panda: { kind: "character", assetId: "panda-dest", displayName: "Panda" },
      "panda-2": { kind: "character", assetId: "panda-dest2", displayName: "Panda 2" },
    }
    const shots = [
      framed("s1", "@Panda waits for @Panda 2", [
        chip("panda-a", "Panda"),
        chip("panda-dest2", "Panda 2"),
      ]),
    ]
    const out = mergeCast(
      ours,
      { panda: { kind: "character", assetId: "panda-a", displayName: "Panda" } },
      shots,
    )

    expect(out.cast["panda-3"]!.assetId).toBe("panda-a")
    expect(out.cast["panda-3"]!.displayName).toBe("Panda 3")
    // The arriving panda moves; the one we already had keeps its words AND its
    // chip, which never said anything else.
    expect(out.shots[0]!.still!.prompt).toBe("@Panda 3 waits for @Panda 2")
    const refs = out.shots[0]!.still!.results![0]!.references!
    expect(refs.map((r) => r.defaultName)).toEqual(["Panda 3", "Panda 2"])
  })

  it("a sibling role arriving in the SAME SHEET is left alone too (R78)", () => {
    // The destination cast has never heard of "Panda Bear" — it arrives in this
    // very sheet — so reserving only OUR names let the `Panda` rewrite run
    // straight through the newcomer standing beside it ("Panda 2 Bear"), giving
    // a role the sheet plainly describes a name nobody chose. The sheet's own
    // rows are in hand at the merge, so they are reserved with ours.
    const ours: Cast = {
      panda: { kind: "character", assetId: "panda-dest", displayName: "Panda" },
    }
    const shots = [
      framed("s1", "@Panda and @Panda Bear arrive", [
        chip("panda-a", "Panda"),
        chip("bear-c", "Panda Bear"),
      ]),
    ]
    const out = mergeCast(
      ours,
      {
        panda: { kind: "character", assetId: "panda-a", displayName: "Panda" },
        "panda-bear": {
          kind: "character",
          assetId: "bear-c",
          displayName: "Panda Bear",
        },
      },
      shots,
    )

    expect(out.cast["panda-2"]!.assetId).toBe("panda-a")
    expect(out.cast["panda-bear"]!.assetId).toBe("bear-c")
    expect(out.shots[0]!.still!.prompt).toBe("@Panda 2 and @Panda Bear arrive")
    expect(
      out.shots[0]!.still!.results![0]!.references!.map((r) => r.defaultName),
    ).toEqual(["Panda 2", "Panda Bear"])
  })

  it("renames EVERY arriving scene, not just the one holding the chip (B11)", () => {
    // One paste, one sheet: s2 says the arriving Kira's name with no chip of
    // its own (a dropped reference, or prose written before the bind). Scoped
    // per shot, s2 kept calling the newcomer "Kira" — the keeper's name.
    const shots = [
      framed("s1", "Kira waits", [chip("other-kira", "Kira")]),
      framed("s2", "Kira leaves", []),
    ]
    const out = mergeCast(mine, {
      kira: { kind: "character", assetId: "other-kira", displayName: "Kira" },
    }, shots)

    expect(out.cast["kira-2"]!.assetId).toBe("other-kira")
    expect(out.shots[0]!.still!.prompt).toBe("Kira 2 waits")
    expect(out.shots[1]!.still!.prompt).toBe("Kira 2 leaves")
  })

  it("a sheet whose chips were all dropped still renames by name", () => {
    // The negative: nothing in the slice binds the actor, so `sliceBindsActor`
    // never turns identity scoping on and the sheet is the only witness —
    // today's behaviour, unchanged.
    const shots = [
      framed("s1", "Kira waits", []),
      framed("s2", "Kira leaves", []),
    ]
    const out = mergeCast(mine, {
      kira: { kind: "character", assetId: "other-kira", displayName: "Kira" },
    }, shots)

    expect(out.shots[0]!.still!.prompt).toBe("Kira 2 waits")
    expect(out.shots[1]!.still!.prompt).toBe("Kira 2 leaves")
  })

  it("nothing arriving ⇒ the SAME objects back", () => {
    const shots = [framed("s1", "Kira waits", [])]
    const out = mergeCast(mine, undefined, shots)
    expect(out.cast).toBe(mine)
    expect(out.shots).toBe(shots)
  })
})

describe("castFromChips — the legacy migration", () => {
  it("mints a role per distinct actor, in scene order", () => {
    const shots = [
      framed("s1", "Kira on the roof", [chip("char-kira", "Kira")]),
      framed("s2", "Jax in the rain", [chip("char-jax", "Jax")]),
    ]
    const out = castFromChips({}, shots)
    expect(out.enrolled.map((e) => e.key)).toEqual(["kira", "jax"])
    expect(out.cast).toEqual({
      kira: { kind: "character", assetId: "char-kira", displayName: "Kira" },
      jax: { kind: "character", assetId: "char-jax", displayName: "Jax" },
    })
  })

  it("TWO PANDAS: the first keeps the name, the second is suffixed and the prose rewritten", () => {
    const shots = [
      framed("s1", "Panda swims", [chip("panda-a", "Panda")]),
      framed("s2", "Panda climbs", [chip("panda-b", "Panda")]),
    ]
    const out = castFromChips({}, shots)
    expect(Object.keys(out.cast).sort()).toEqual(["panda", "panda-2"])
    expect(out.cast["panda"]!.assetId).toBe("panda-a")
    expect(out.cast["panda-2"]!.assetId).toBe("panda-b")
    // Scene 2's word is the one that had to move. Scene 1's does NOT: it says
    // "Panda" about the panda that KEPT the name, and a rename scoped by name
    // alone rewrote it (prose and chip) into the other actor's — which is the
    // exact confusion D6a exists to prevent. Untouched, and the same object.
    expect(out.shots[1]!.still!.prompt).toBe("Panda 2 climbs")
    expect(out.shots[0]).toBe(shots[0])
    expect(out.shots[0]!.still!.prompt).toBe("Panda swims")
    expect(
      out.shots[0]!.still!.results![0]!.references![0]!.defaultName,
    ).toBe("Panda")
    expect(out.enrolled[1]).toEqual({
      key: "panda-2",
      displayName: "Panda 2",
      renamedFrom: "Panda",
    })
  })

  it("is IDEMPOTENT — minting twice adds nothing and moves no prose", () => {
    const shots = [framed("s1", "Kira on the roof", [chip("char-kira", "Kira")])]
    const first = castFromChips({}, shots)
    const second = castFromChips(first.cast, first.shots)
    expect(second.enrolled).toEqual([])
    expect(second.cast).toBe(first.cast)
    expect(second.shots).toBe(first.shots)
  })

  it("skips VIEW chips — a one-off pick is not a claim about who somebody is", () => {
    const shots = [
      framed("s1", "Kira from behind", [
        chip("char-kira", "Kira", { isExtraRef: true, variantSlug: "angles:back" }),
      ]),
    ]
    expect(castFromChips({}, shots).enrolled).toEqual([])
  })

  it("skips IMAGE chips — no library row behind them to repoint", () => {
    const shots = [
      framed("s1", "Ref 1 on the wall", [
        chip("img-1", "Ref 1", { source: "wired-image", isExtraRef: false }),
      ]),
    ]
    expect(castFromChips({}, shots).enrolled).toEqual([])
  })

  it("a production with no chips comes back as the SAME objects", () => {
    const shots = [framed("s1", "an empty street", [])]
    const out = castFromChips({}, shots)
    expect(out.shots).toBe(shots)
    expect(out.enrolled).toEqual([])
  })

  it("sweeps an IMPORTED scene's PLAN chips too — frame, then motion, before the beats (D7)", () => {
    const shots: Shot[] = [
      {
        id: "s1",
        plan: {
          frame: { prompt: "@Abi", references: [chip("char-abi", "Abi")] },
          motion: { prompt: "@Kira", references: [chip("char-kira", "Kira")] },
        },
      },
    ]
    const out = castFromChips({}, shots)
    expect(out.enrolled.map((e) => e.displayName)).toEqual(["Abi", "Kira"])
  })

  it("the PLAN's chip is the enrollment record when a beat names the same name", () => {
    // `consider` walks the plan BEFORE the beats, so the plan's actor keeps the
    // plain name and the beat's takes the suffix; flip the order and this reads
    // `panda-beat`. Both live in ONE shot, so the rewrite has to be scoped to
    // the chips that own the words, not to the scene.
    const shots: Shot[] = [
      {
        id: "s1",
        plan: {
          frame: { prompt: "@Panda waves", references: [chip("panda-plan", "Panda")] },
        },
        beats: [
          {
            id: "b",
            seconds: 4,
            text: "@Panda swims",
            references: [chip("panda-beat", "Panda")],
          },
        ],
      },
    ]
    const out = castFromChips({}, shots)
    expect(out.cast["panda"]!.assetId).toBe("panda-plan")
    expect(out.cast["panda-2"]!.assetId).toBe("panda-beat")
    // Only the beat moved — the plan still says what its own chip binds.
    expect(out.shots[0]!.beats![0]!.text).toBe("@Panda 2 swims")
    expect(out.shots[0]!.beats![0]!.references![0]!.defaultName).toBe("Panda 2")
    expect(out.shots[0]!.plan!.frame!.prompt).toBe("@Panda waves")
    expect(out.shots[0]!.plan!.frame!.references![0]!.defaultName).toBe("Panda")
  })

  it("a renamed role is rewritten in the plan's prose AND its chip (INV-C)", () => {
    const shots: Shot[] = [
      {
        id: "a",
        beats: [
          { id: "b", seconds: 4, text: "@Panda", references: [chip("panda-a", "Panda")] },
        ],
      },
      {
        id: "b",
        plan: {
          frame: { prompt: "@Panda waves", references: [chip("panda-b", "Panda")] },
        },
      },
    ]
    const out = castFromChips({}, shots)
    expect(out.enrolled.find((e) => e.renamedFrom)?.displayName).toBe("Panda 2")
    expect(out.shots[1]!.plan?.frame?.prompt).toContain("@Panda 2")
    // The chip must say what the prose now says — a rewrite that moved only the
    // words would leave the reference pointing at the OTHER actor's slug.
    const planRef = out.shots[1]!.plan?.frame?.references?.[0]
    expect(planRef?.defaultName).toBe("Panda 2")
    expect(planRef?.characterSlug).toBe("panda-2")
  })
})

describe("describedRolesFrom — the plan's unbound names become roles", () => {
  it("mints a DESCRIBED role per unresolved entry, with its words", () => {
    expect(
      describedRolesFrom(
        [
          { kind: "character", name: " Natalie ", description: " late 20s " },
          { kind: "location", name: "Old Bridge" },
        ],
        {},
      ),
    ).toEqual([
      { kind: "character", displayName: "Natalie", description: "late 20s" },
      { kind: "location", displayName: "Old Bridge" },
    ])
  })

  it("drops what the plan format itself can't place — a kind, a blank name", () => {
    expect(
      describedRolesFrom(
        [
          { kind: "prop" as never, name: "Nope" },
          { kind: "character", name: "   " },
        ],
        {},
      ),
    ).toEqual([])
  })

  it("skips a name the cast ALREADY has, and de-dupes within the plan", () => {
    // Both directions of D6a: a described role must never mint `abi-2` beside
    // the Abi the chips just bound, and a document that names the same person
    // twice enrolls them once.
    const cast: Cast = {
      abi: { kind: "character", assetId: "c1", displayName: "Abi" },
    }
    expect(
      describedRolesFrom(
        [
          { kind: "character", name: "Abi", description: "ignored" },
          { kind: "character", name: "Natalie" },
          { kind: "character", name: "natalie", description: "the second row" },
        ],
        cast,
      ),
    ).toEqual([{ kind: "character", displayName: "Natalie" }])
  })
})
