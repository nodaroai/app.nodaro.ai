import { describe, it, expect } from "vitest"
import { characterMentionSlug, type ConnectedReference } from "@nodaro/shared"

import type { Shot } from "../shot"
import {
  clearCastLookForRole,
  mentionsName,
  renameInProse,
  renameRoleInShots,
  shotProse,
  type RenameRoleArgs,
} from "../cast-rename"
import { foldScenePrompt, stripScenePrompt } from "../scene-prompt"

/**
 * RENAME + RECAST (spec 2026-08-31-project-cast-registry, D6e / C3).
 *
 * The pair is defined by what each one does NOT do: rename never moves the
 * binding, recast never moves the prose. These pin both halves.
 */

function ref(name: string, id = "c1"): ConnectedReference {
  return {
    id,
    defaultName: name,
    source: "wired-character",
    url: `https://r2.example/${id}.png`,
    characterSlug: characterMentionSlug(name),
    characterCanonicalDescription: `${name}, mid 30s`,
  }
}

const ARGS = {
  kind: "character" as const,
  oldKey: "abi",
  newKey: "sara",
  oldName: "Abi",
  newName: "Sara",
  // Required since R78: a renamer with no OTHER names still says so.
  reservedNames: [],
}

describe("renameInProse — the deterministic rewrite", () => {
  it("hits a whole word, and only a whole word", () => {
    const { text, count } = renameInProse("Abi meets Abigail, not Kabi", "Abi", "Sara")
    expect(text).toBe("Sara meets Abigail, not Kabi")
    expect(count).toBe(1)
  })

  it("hits EVERY occurrence in the string", () => {
    const { text, count } = renameInProse("Abi looks at Abi.", "Abi", "Sara")
    expect(text).toBe("Sara looks at Sara.")
    expect(count).toBe(2)
  })

  it("carries an unresolved `@Abi` along — it is the same role, spelled loud", () => {
    const { text, count } = renameInProse("@Abi waits", "Abi", "Sara")
    expect(text).toBe("@Sara waits")
    expect(count).toBe(1)
  })

  it("is EXACT-CASE, like the wire binder", () => {
    expect(renameInProse("abi waits", "Abi", "Sara").count).toBe(0)
  })

  it("a name with regex metacharacters is matched literally, not compiled", () => {
    const { text, count } = renameInProse("C++ walks in", "C++", "Rust")
    expect(text).toBe("Rust walks in")
    expect(count).toBe(1)
  })

  it("a rename to `<name> <n>` leaves the `<name>` inside an existing `<name> 2` alone", () => {
    // The ENROLLER's suffix form. The `Panda` inside `@Panda 2` is another
    // actor's whole name, and rewriting it hands both of them the same words
    // back — the collision the suffix had just resolved.
    const { text, count } = renameInProse(
      "@Panda and @Panda 2 arrive",
      "Panda",
      "Panda 2",
    )
    expect(text).toBe("@Panda 2 and @Panda 2 arrive")
    expect(count).toBe(1)
  })

  it("the suffix guard is EXACT — a different trailing number is still a hit (B10)", () => {
    // "Panda 20 metres off" is prose about "Panda", not a mention of the
    // colliding "Panda 2" — refusing on ANY trailing digit run would silently
    // drop this rename. Narrowed to the ONE string newName itself names.
    const { text, count } = renameInProse(
      "Panda 20 metres off the trail",
      "Panda",
      "Panda 2",
    )
    expect(text).toBe("Panda 2 20 metres off the trail")
    expect(count).toBe(1)
    // …and the exact colliding number is still refused, both directions pinned
    // by the one guard.
    expect(renameInProse("Panda 2 waits", "Panda", "Panda 2").count).toBe(0)
  })

  it("an occurrence that starts a RESERVED role's name is refused (R75b)", () => {
    // The ordinary third collision: ours holds `Panda` AND `Panda 2`, so an
    // arriving `Panda` becomes `Panda 3` — and the `Panda` inside `@Panda 2`
    // is the OTHER role's whole name, exactly as it is when the suffix form is
    // `Panda 2`. The guard reads the reserved names, not `newName`'s digits.
    expect(
      renameInProse("Panda 2 waits", "Panda", "Panda 3", ["Panda 2"]).count,
    ).toBe(0)
    // …and it is not about digits at all: "Panda Bear" is another role's whole
    // name by the same rule, one guard for both.
    const bear = renameInProse("Panda Bear waits", "Panda", "Sara", [
      "Panda Bear",
    ])
    expect(bear.count).toBe(0)
    expect(bear.text).toBe("Panda Bear waits")
  })

  it("…and only a PROPER prefix is refused — the name itself never refuses itself", () => {
    // The keeper's own name is always in the reserved list on the enroll path
    // (it is the role the newcomer collided with). An equal name is no prefix,
    // or the guard would refuse every occurrence there is.
    expect(renameInProse("Panda swims", "Panda", "Panda 2", ["Panda"]).count).toBe(1)
    // Reserved or not, "Panda 20 metres off" is prose about "Panda".
    const off = renameInProse("Panda 20 metres off", "Panda", "Panda 3", [
      "Panda 2",
    ])
    expect(off.text).toBe("Panda 3 20 metres off")
    expect(off.count).toBe(1)
    // A reserved name that this one is no prefix of is not its business.
    expect(renameInProse("Abi waits", "Abi", "Sara", ["Panda 2"]).count).toBe(1)
  })

  it("…and that guard is the suffix form's alone", () => {
    // An ordinary rename has no reason to skip a name followed by a number.
    expect(renameInProse("Abi 2 waits", "Abi", "Sara").text).toBe("Sara 2 waits")
  })

  it("renaming to itself is a no-op — no churn, no count", () => {
    const out = renameInProse("Abi waits", "Abi", "Abi")
    expect(out.count).toBe(0)
    expect(out.text).toBe("Abi waits")
  })
})

describe("mentionsName and renameInProse cannot diverge (B9)", () => {
  // Both build their boundary from the same `namePattern(name, newName,
  // reservedNames)` call now, so this is a property check, not a list of
  // hand-picked examples: for every case, renameInProse touching an occurrence
  // and mentionsName reporting one are the SAME fact, asked two ways.
  //
  // Every entry whose ONLY occurrence is a REFUSED one is what gives this test
  // teeth: drop an argument from either call and the two answers split — one
  // counts nothing, the other still says yes.
  const CASES: ReadonlyArray<
    readonly [
      text: string,
      from: string,
      to: string,
      reserved?: ReadonlyArray<string>,
    ]
  > = [
    // the bare name
    ["Abi waits by the door", "Abi", "Sara"],
    // the role's own `@<role-slug>` token — the second spelling C6 added
    ["@abi waits by the door", "Abi", "Sara"],
    // NOT a hit — a whole-word boundary, not a substring
    ["Abigail waits by the door", "Abi", "Sara"],
    // the enroller's suffix-collision guard: `@Panda 2` is a DIFFERENT actor's
    // whole name and must be left alone, while a bare `@Panda` still rewrites
    ["@Panda and @Panda 2 arrive", "Panda", "Panda 2"],
    // …and the same text with the bare `@Panda` gone: the ONLY occurrence is
    // the refused one, so the two functions can only agree by reading the same
    // `newName` (drop it and this is a hit again — RED)
    ["@Panda 2 arrives", "Panda", "Panda 2"],
    // the RESERVED sibling, whose refusal `newName` alone cannot explain: the
    // rename is `Panda` → `Panda 3` and it is our own `Panda 2` being spared
    // (drop `reservedNames` and this too is a hit again — RED)
    ["Panda 2 waits by the door", "Panda", "Panda 3", ["Panda 2"]],
    // exercises the guard from the other side — a trailing number that starts
    // no reserved name at all, and so is an ordinary mention
    ["Panda 20 metres off the trail", "Panda", "Panda 3", ["Panda 2"]],
  ]

  it("agree on every occurrence, for the same (name, newName, reserved) triple", () => {
    for (const [text, from, to, reserved] of CASES) {
      const { count } = renameInProse(text, from, to, reserved)
      expect(mentionsName(text, from, to, reserved)).toBe(count > 0)
    }
  })
})

describe("renameRoleInShots — every scene, exactly once", () => {
  const shots: Shot[] = [
    {
      id: "s1",
      still: {
        nodeId: "n1",
        url: "https://r2.example/1.png",
        provider: "gpt-image-2",
        prompt: "Abi walks in",
        results: [
          {
            url: "https://r2.example/1.png",
            prompt: "Abi walks in",
            references: [ref("Abi")],
          },
        ],
      },
      clip: {
        nodeId: "v1",
        url: "https://r2.example/1.mp4",
        provider: "seedance-2",
        prompt: "Abi turns",
        results: [
          { url: "https://r2.example/1.mp4", prompt: "Abi turns", references: [ref("Abi")] },
        ],
      },
      beats: [{ id: "b1", seconds: 4, text: "Abi sprints", references: [ref("Abi")] }],
      plan: { frame: { prompt: "Abi in the doorway" } },
      castLook: { abi: { url: "https://r2.example/back.png", label: "back" } },
    },
    { id: "s2", still: { nodeId: "n2", url: "u", provider: "p", prompt: "the room is empty" } },
  ]

  it("rewrites every prose surface and counts them", () => {
    const { shots: next, report } = renameRoleInShots(shots, ARGS)
    // still.prompt, still result, clip.prompt, clip result, beat, plan frame
    expect(report.rewrites).toBe(6)
    expect(report.shots).toBe(1)
    expect(next[0].still!.prompt).toBe("Sara walks in")
    expect(next[0].still!.results![0].prompt).toBe("Sara walks in")
    expect(next[0].clip!.prompt).toBe("Sara turns")
    expect(next[0].clip!.results![0].prompt).toBe("Sara turns")
    expect(next[0].beats![0].text).toBe("Sara sprints")
    expect(next[0].plan!.frame!.prompt).toBe("Sara in the doorway")
  })

  it("carries the SLUG with the name, so the wire binds the new word", () => {
    const { shots: next } = renameRoleInShots(shots, ARGS)
    const r = next[0].still!.results![0].references![0]
    expect(r.defaultName).toBe("Sara")
    expect(r.characterSlug).toBe("sara")
    // The BINDING is untouched — a rename changes the rendering, never the actor.
    expect(r.id).toBe("c1")
    expect(r.url).toBe("https://r2.example/c1.png")
  })

  it("re-keys the scene PIN — a rename does not change who the role is", () => {
    const { shots: next } = renameRoleInShots(shots, ARGS)
    expect(next[0].castLook).toEqual({
      sara: { url: "https://r2.example/back.png", label: "back" },
    })
  })

  it("is copy-on-write — a scene that never said the name comes back identical", () => {
    const { shots: next } = renameRoleInShots(shots, ARGS)
    expect(next[1]).toBe(shots[1])
    expect(next[0]).not.toBe(shots[0])
  })

  it("a production that never said the name comes back as the SAME array", () => {
    const { shots: next, report } = renameRoleInShots(shots, {
      ...ARGS,
      oldKey: "kira",
      oldName: "Kira",
    })
    expect(next).toBe(shots)
    expect(report).toEqual({ rewrites: 0, shots: 0 })
  })

  it("touches no other role's references", () => {
    const withKira: Shot[] = [
      {
        id: "s1",
        still: {
          nodeId: "n1",
          url: "u",
          provider: "p",
          prompt: "Abi and Kira",
          results: [
            { url: "u", prompt: "Abi and Kira", references: [ref("Abi"), ref("Kira", "c2")] },
          ],
        },
      },
    ]
    const { shots: next } = renameRoleInShots(withKira, ARGS)
    const refs = next[0].still!.results![0].references!
    expect(refs.map((r) => r.defaultName)).toEqual(["Sara", "Kira"])
    expect(refs[1]).toBe(withKira[0].still!.results![0].references![1])
  })
})

/**
 * THE SHARED WALK (D6i): `shotProse` is what the export projection asks and what
 * the rename answers, so anything the one reads the other must rewrite. A
 * recipe-only shot — the node-less placeholder an imported bundle leaves in the
 * timeline — is the one place a role's name lives with no reference beside it,
 * which is exactly why a rename that skips it drops the role from the next
 * export while its prose keeps naming the person.
 */
describe("renameShot — a recipe-only scene renames too", () => {
  const shots: Shot[] = [
    {
      id: "s1",
      recipe: {
        framing: { prompt: "Abi walks into the park" },
        directing: { prompt: "Abi turns to camera" },
      },
    },
  ]

  it("rewrites both halves of the recipe and counts them", () => {
    const { shots: next, report } = renameRoleInShots(shots, ARGS)
    expect(next[0].recipe!.framing!.prompt).toBe("Sara walks into the park")
    expect(next[0].recipe!.directing!.prompt).toBe("Sara turns to camera")
    expect(report.rewrites).toBe(2)
    expect(report.shots).toBe(1)
  })

  it("leaves everything the recipe carries besides the prose alone", () => {
    const withLevers: Shot[] = [
      {
        id: "s1",
        recipe: {
          framing: { prompt: "Abi waits", provider: "gpt-image-2", promptFormat: 2 },
          voice: { text: "unchanged" },
        },
      },
    ]
    const { shots: next } = renameRoleInShots(withLevers, ARGS)
    expect(next[0].recipe!.framing!.provider).toBe("gpt-image-2")
    expect(next[0].recipe!.framing!.promptFormat).toBe(2)
    expect(next[0].recipe!.voice).toBe(withLevers[0].recipe!.voice)
  })

  it("the walk and the rewrite agree: no prose the projection reads is missed", () => {
    const { shots: next } = renameRoleInShots(shots, ARGS)
    // `shotProse` is the projection's question; after the rename not one of its
    // strings may still say the old name.
    expect(shotProse(next[0]).some((t) => t.includes("Abi"))).toBe(false)
    expect(shotProse(next[0])).toContain("Sara walks into the park")
  })

  it("a recipe that never says the name comes back as the SAME shot", () => {
    const other: Shot[] = [{ id: "s1", recipe: { framing: { prompt: "Kira waits" } } }]
    const { shots: next } = renameRoleInShots(other, ARGS)
    expect(next[0]).toBe(other[0])
  })
})

/**
 * THE SCENE'S GENERIC PROMPT is a fourth prose surface, and it exists in THREE
 * copies: the live one on the scene, the one a take recorded, and the one an
 * in-flight marker carries. They are not independent — a take's stored `prompt`
 * has the scene paragraph folded INTO it, and `stripScenePrompt` unfolds it by
 * matching the two byte for byte. Rename one copy and not the other and the
 * match fails: the take restores with the paragraph doubled, silently.
 */
describe("renameShot — the scene's generic prompt, in all three copies", () => {
  const shots: Shot[] = [
    {
      id: "s1",
      scenePrompt: "The whole clip follows Abi.",
      clip: {
        nodeId: "v1",
        url: "https://r2.example/1.mp4",
        provider: "seedance-2",
        prompt: foldScenePrompt("The whole clip follows Abi.", "Abi turns"),
        results: [
          {
            url: "https://r2.example/1.mp4",
            prompt: foldScenePrompt("The whole clip follows Abi.", "Abi turns"),
            scenePrompt: "The whole clip follows Abi.",
          },
        ],
      },
      pendingClips: [
        {
          jobId: "job-1",
          provider: "seedance-2",
          startedAt: 1_756_720_800_000,
          prompt: foldScenePrompt("The whole clip follows Abi.", "Abi runs"),
          scenePrompt: "The whole clip follows Abi.",
        },
      ],
    },
  ]

  it("rewrites the scene's own copy, the take's and the marker's", () => {
    const { shots: next } = renameRoleInShots(shots, ARGS)
    expect(next[0].scenePrompt).toBe("The whole clip follows Sara.")
    expect(next[0].clip!.results![0].scenePrompt).toBe("The whole clip follows Sara.")
    expect(next[0].pendingClips![0].scenePrompt).toBe("The whole clip follows Sara.")
  })

  it("keeps the fold invertible — the stored prompt still unfolds after the rename", () => {
    const { shots: next } = renameRoleInShots(shots, ARGS)
    const take = next[0].clip!.results![0]
    expect(stripScenePrompt(take.prompt!, take.scenePrompt)).toBe("Sara turns")
    const marker = next[0].pendingClips![0]
    expect(stripScenePrompt(marker.prompt!, marker.scenePrompt)).toBe("Sara runs")
  })

  it("the walk reads it too — the export projection asks what the rename answers", () => {
    expect(shotProse(shots[0])).toContain("The whole clip follows Abi.")
    const { shots: next } = renameRoleInShots(shots, ARGS)
    expect(shotProse(next[0]).some((t) => t.includes("Abi"))).toBe(false)
  })
})

/**
 * THE LIVE COMPOSER PROMPTS (the enroller's identity scope, `RenameRoleArgs.assetId`).
 *
 * `still.prompt` and `clip.prompt` carry no chip list of their own — the
 * composer SEEDS them from a stored take and the chips ride the take. So the
 * scope is that take's, not the whole scene's: a scene framed with one panda
 * whose motion beat names the other would otherwise have its framing words
 * rewritten by the beat's enrollment, while the result they were seeded from
 * keeps the old name.
 */
describe("renameShot — a live prompt is scoped to the surface it was seeded from", () => {
  const mixed: Shot[] = [
    {
      id: "s1",
      still: {
        nodeId: "n1",
        url: "u",
        provider: "p",
        prompt: "@Panda swims",
        results: [
          { url: "u", prompt: "@Panda swims", references: [ref("Panda", "panda-a")] },
        ],
      },
      beats: [
        {
          id: "b1",
          seconds: 4,
          text: "@Panda climbs out",
          references: [ref("Panda", "panda-b")],
        },
      ],
    },
  ]
  const enrolling = (assetId: string) => ({
    kind: "character" as const,
    oldKey: "panda",
    newKey: "panda-2",
    oldName: "Panda",
    newName: "Panda 2",
    assetId,
    reservedNames: [],
  })

  it("leaves the framing prompt with the actor the still's own take binds", () => {
    const { shots: next } = renameRoleInShots(mixed, enrolling("panda-b"))
    expect(next[0].still!.prompt).toBe("@Panda swims")
    expect(next[0].still!.results![0].prompt).toBe("@Panda swims")
    // The beat is the newcomer's own surface, and it moves — words and chip.
    expect(next[0].beats![0].text).toBe("@Panda 2 climbs out")
    expect(next[0].beats![0].references![0].defaultName).toBe("Panda 2")
  })

  it("…and moves it when the still's OWN actor is the one enrolling", () => {
    const { shots: next } = renameRoleInShots(mixed, enrolling("panda-a"))
    expect(next[0].still!.prompt).toBe("@Panda 2 swims")
    expect(next[0].beats![0].text).toBe("@Panda climbs out")
  })

  it("falls back to the scene's chips when the surface has no take of its own", () => {
    // A framing prompt typed before anything rendered: nothing was seeded from
    // a take, so what the SCENE binds is the narrowest honest answer.
    const draft: Shot[] = [
      {
        id: "s1",
        still: { nodeId: "n1", url: "", provider: "p", prompt: "@Panda swims" },
        beats: [
          {
            id: "b1",
            seconds: 4,
            text: "@Panda climbs",
            references: [ref("Panda", "panda-b")],
          },
        ],
      },
    ]
    const { shots: next } = renameRoleInShots(draft, enrolling("panda-b"))
    expect(next[0].still!.prompt).toBe("@Panda 2 swims")
  })
})

/**
 * B11 — THE IDENTITY SCOPE IS THE SLICE, NOT THE SHOT.
 *
 * An arriving set comes under ONE sheet, so a scene of it that binds the actor
 * by chip and the next scene that merely says the name mean the same person.
 * Scoped per shot, only the first one was renamed and the second went on
 * calling the newcomer by the keeper's name — the exact confusion the suffix
 * exists to end. The widening stops where the slice stops being a witness: two
 * actors answering to the name inside it, and a chip-less scene could be either.
 */
describe("renameRoleInShots — the slice answers for the words no chip claims", () => {
  const enrolling = {
    kind: "character" as const,
    oldKey: "kira",
    newKey: "kira-2",
    oldName: "Kira",
    newName: "Kira 2",
    assetId: "kira-b",
    reservedNames: [],
  }
  const framed = (id: string, prompt: string, refs: ConnectedReference[]): Shot => ({
    id,
    still: {
      nodeId: `n-${id}`,
      url: "u",
      provider: "p",
      prompt,
      results: [{ url: "u", prompt, references: refs }],
    },
  })

  it("renames the chip-less scene too, once ANY scene in the slice binds the actor", () => {
    const shots = [
      framed("a", "Kira waits", [ref("Kira", "kira-b")]),
      framed("b", "Kira leaves", []),
    ]
    const { shots: next, report } = renameRoleInShots(shots, enrolling)
    expect(next[0].still!.prompt).toBe("Kira 2 waits")
    // The scene the per-shot scope used to leave behind.
    expect(next[1].still!.prompt).toBe("Kira 2 leaves")
    expect(report.shots).toBe(2)
  })

  it("…and a take with no `references` at all is one of those", () => {
    const shots: Shot[] = [
      framed("a", "Kira waits", [ref("Kira", "kira-b")]),
      { id: "b", recipe: { framing: { prompt: "Kira in the doorway" } } },
    ]
    const { shots: next } = renameRoleInShots(shots, enrolling)
    expect(next[1].recipe!.framing!.prompt).toBe("Kira 2 in the doorway")
  })

  it("an actor bound by chip in NO scene of the slice moves nothing", () => {
    // Today's answer, unchanged: nothing in the slice ties these words to the
    // actor, so there is no claim to widen.
    const shots = [framed("a", "Kira waits", []), framed("b", "Kira leaves", [])]
    const { shots: next, report } = renameRoleInShots(shots, enrolling)
    expect(next).toBe(shots)
    expect(report).toEqual({ rewrites: 0, shots: 0 })
  })

  it("TWO claimants in the slice: the chip-less words stay with the keeper", () => {
    const shots = [
      framed("a", "Kira waits", [ref("Kira", "kira-a")]),
      framed("b", "Kira climbs", [ref("Kira", "kira-b")]),
      framed("c", "Kira leaves", []),
    ]
    const { shots: next } = renameRoleInShots(shots, enrolling)
    expect(next[0].still!.prompt).toBe("Kira waits")
    expect(next[1].still!.prompt).toBe("Kira 2 climbs")
    // Nothing in the slice can settle whose "Kira" this is — it keeps the name
    // it was written with, which is the recoverable half.
    expect(next[2]).toBe(shots[2])
  })

  it("a surface bound to OTHER roles only still defers to the slice", () => {
    const shots = [
      framed("a", "Kira waits", [ref("Kira", "kira-b")]),
      framed("b", "Kira and Jax", [ref("Jax", "jax")]),
    ]
    const { shots: next } = renameRoleInShots(shots, enrolling)
    expect(next[1].still!.prompt).toBe("Kira 2 and Jax")
    // The other role's chip is untouched — a rename moves one name.
    expect(next[1].still!.results![0].references![0].defaultName).toBe("Jax")
  })
})

/**
 * B13 — THE SHOT'S CHIPS ARE COLLECTED ONCE.
 *
 * The three scopes a scoped rename needs (the shot's, the still's, the clip's)
 * used to be three separate walks over the same shot, so every still and clip
 * reference was gathered twice per rename. They are one grouped pass now.
 *
 * The meter is a DELTA, not a literal budget: a rename with no actor to scope
 * by collects no scope at all, so its reads are the rewrite's own, and both
 * runs rewrite the same surfaces (the actor is bound in every one). What is
 * left between them IS the collection — one read per reference list.
 */
describe("renameRoleInShots — the shot's chips are collected once (B13)", () => {
  const P = "Abi walks in"
  interface Tally {
    reads: number
  }

  /** A surface whose `references` COUNTS its reads. Defined rather than spread:
   *  a spread would evaluate the getter once and hand on a plain value. */
  function metered<T>(base: T, refs: ConnectedReference[], tally: Tally): T {
    return Object.defineProperty(base, "references", {
      enumerable: true,
      get() {
        tally.reads += 1
        return refs
      },
    })
  }

  /** Every surface the scope walk visits, one reference list each. */
  const LISTS = 8

  function fixture(tally: Tally): Shot[] {
    const refs = [ref("Abi")]
    return [
      {
        id: "s1",
        still: {
          nodeId: "n1",
          url: "u",
          provider: "p",
          prompt: P,
          results: [metered({ url: "u", prompt: P }, refs, tally)],
        },
        clip: {
          nodeId: "v1",
          url: "u",
          provider: "p",
          prompt: P,
          results: [
            metered(
              {
                url: "u",
                prompt: P,
                beats: [metered({ id: "cb", seconds: 4, text: P }, refs, tally)],
              },
              refs,
              tally,
            ),
          ],
        },
        beats: [metered({ id: "b1", seconds: 4, text: P }, refs, tally)],
        plan: {
          frame: metered({ prompt: P }, refs, tally),
          motion: metered({ prompt: P }, refs, tally),
        },
        pendingClips: [
          metered(
            {
              jobId: "j1",
              provider: "p",
              prompt: P,
              startedAt: 0,
              beats: [metered({ id: "pb", seconds: 4, text: P }, refs, tally)],
            },
            refs,
            tally,
          ),
        ],
      },
    ]
  }

  const reads = (args: RenameRoleArgs): number => {
    const tally: Tally = { reads: 0 }
    renameRoleInShots(fixture(tally), args)
    return tally.reads
  }

  it("costs ONE read per reference list to build the identity scope", () => {
    const rewriteOnly = reads(ARGS)
    const withScope = reads({ ...ARGS, assetId: "c1" })
    expect(withScope - rewriteOnly).toBe(LISTS)
  })

  it("…and the fixture really does bind the actor everywhere it says", () => {
    // The delta above is only the collection if BOTH runs rewrite the same
    // surfaces. This is that premise, stated: the scoped run moves every one.
    const tally: Tally = { reads: 0 }
    const { report } = renameRoleInShots(fixture(tally), { ...ARGS, assetId: "c1" })
    // still.prompt + still take, clip.prompt + clip take + its beat, the live
    // beat, plan frame + motion, and the pending marker + its beat.
    expect(report.rewrites).toBe(10)
  })
})

describe("clearCastLookForRole — recast's one, reported, rewrite", () => {
  const shots: Shot[] = [
    { id: "s1", castLook: { abi: { url: "https://r2.example/back.png" } } },
    {
      id: "s2",
      castLook: {
        abi: { url: "https://r2.example/side.png" },
        park: { url: "https://r2.example/dusk.png" },
      },
    },
    { id: "s3" },
  ]

  it("drops the role's pin in every scene and REPORTS the count", () => {
    const { shots: next, pinsReset } = clearCastLookForRole(shots, "abi")
    expect(pinsReset).toBe(2)
    expect(next[0].castLook).toBeUndefined()
    expect(next[1].castLook).toEqual({ park: { url: "https://r2.example/dusk.png" } })
  })

  it("omit-when-empty: the last pin removed drops the field, never `{}`", () => {
    const { shots: next } = clearCastLookForRole(shots, "abi")
    expect("castLook" in next[0]).toBe(false)
  })

  it("leaves other roles' pins and untouched scenes alone (copy-on-write)", () => {
    const { shots: next } = clearCastLookForRole(shots, "abi")
    expect(next[2]).toBe(shots[2])
  })

  it("an unpinned production comes back as the SAME array", () => {
    const { shots: next, pinsReset } = clearCastLookForRole(shots, "nobody")
    expect(next).toBe(shots)
    expect(pinsReset).toBe(0)
  })
})
