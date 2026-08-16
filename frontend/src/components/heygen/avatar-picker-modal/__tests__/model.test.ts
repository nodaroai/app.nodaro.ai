import { describe, it, expect, beforeEach } from "vitest"
import type { HeygenAvatar } from "@/lib/api"
import {
  DEFAULT_FILTERS,
  countOwnLooks,
  derivePersonGenders,
  deriveScenes,
  describeSelection,
  engineLabels,
  filterPeople,
  groupByPerson,
  locateLook,
  lookLabel,
  personDisplayName,
  personMeta,
  sceneOf,
  sortByRecency,
} from "../model"
import { readRecentAvatarIds, rememberRecentAvatar } from "../recent-avatars"

function look(name: string, id = name, extra: Partial<HeygenAvatar> = {}): HeygenAvatar {
  return { avatarId: id, name, gender: "female", previewImageUrl: `https://cdn/${id}.jpg`, ...extra }
}

/** No groupId here — the first-name fallback path (older servers / fixtures). */
const CATALOG: HeygenAvatar[] = [
  look("Mine Studio 1", "m1", { ownership: "private", status: "processing" }),
  look("Mine Studio 2", "m2", { ownership: "private" }),
  look("Cora Office 4", "c4", { supportedEngines: ["avatar_v", "avatar_iv"], defaultVoiceId: "v-cora" }),
  look("Cora Livingroom 1", "c1"),
  look("Cora Modern Corporate 2", "c2"),
  look("Brian Desk 1", "b1", { gender: "male" }),
  look("Brian Office 2", "b2", { gender: "male", supportedEngines: ["avatar_iv"] }),
  look("Signe", "s0", { gender: "unknown" }),
]

describe("sceneOf", () => {
  it("strips the trailing number from the scene part of a look name", () => {
    expect(sceneOf(look("Cora Office 4"))).toBe("Office")
    expect(sceneOf(look("Cora Modern Corporate 2"))).toBe("Modern Corporate")
    expect(sceneOf(look("Signe"))).toBe("")
  })
})

describe("groupByPerson", () => {
  it("groups looks into people in catalog order, with gender, scenes, V support, own flag and a usable cover", () => {
    const people = groupByPerson(CATALOG)
    expect(people.map((p) => p.name)).toEqual(["Mine", "Cora", "Brian", "Signe"])
    const cora = people[1]
    expect(cora.looks.map((l) => l.avatarId)).toEqual(["c4", "c1", "c2"])
    expect(cora.scenes).toEqual(["Office", "Livingroom", "Modern Corporate"])
    expect(cora.gender).toBe("female")
    expect(cora.supportsV).toBe(true)
    expect(cora.own).toBe(false)
    const mine = people[0]
    expect(mine.own).toBe(true)
    // the cover skips a look HeyGen is still building
    expect(mine.cover.avatarId).toBe("m2")
    expect(people[3].gender).toBe("unknown")
    expect(personMeta(cora)).toBe("Female · Office")
    expect(personMeta(people[3])).toBe("—")
  })

  it("groups by HeyGen's avatar group when the looks carry one: two 'Theo' groups stay two people, and a group with descriptive look names is ONE person", () => {
    const catalog = [
      look("Theo Office 1", "t1", { groupId: "g-theo-a" }),
      look("Theo Kitchen 2", "t2", { groupId: "g-theo-a" }),
      look("Theo", "t3", { groupId: "g-theo-b" }),
      look("Breezy Beach Stroller 3", "v1", { groupId: "g-vera" }),
      look("VERA, l'Ingénieure du Futur 4", "v2", { groupId: "g-vera" }),
      look("Vera, la Consultante 2", "v3", { groupId: "g-vera" }),
      look("Charismatic Professional 3", "v4", { groupId: "g-vera" }),
      look("AINA", "a1", { groupId: "g-aina" }),
      look("Elegant Pastel Belle 2", "a2", { groupId: "g-aina" }),
    ]
    const people = groupByPerson(catalog)
    expect(people.map((p) => [p.key, p.name, p.looks.length])).toEqual([
      ["g:g-theo-a", "Theo", 2],
      ["g:g-theo-b", "Theo", 1],
      ["g:g-vera", "Vera", 4], // most common first word, punctuation dropped
      ["g:g-aina", "Aina", 2], // the bare base look names the person; all-caps title-cased
    ])
    // look labels inside a person: scene for "Person Scene N", the whole name when descriptive
    const vera = people[2]
    expect(vera.looks.map((l) => lookLabel(l, vera))).toEqual([
      "Breezy Beach Stroller 3",
      "VERA, l'Ingénieure du Futur 4", // a comma makes it a title, kept whole
      "Vera, la Consultante 2",
      "Charismatic Professional 3",
    ])
    const aina = people[3]
    expect(lookLabel(aina.looks[0], aina)).toBe("AINA")
    expect(lookLabel(aina.looks[1], aina)).toBe("Elegant Pastel Belle 2")
    expect(personDisplayName([look("Zion", "z")])).toBe("Zion")
    // descriptive look names contribute no "scene" to the card meta
    expect(personMeta(vera)).toBe("Female")
    expect(personMeta(people[0])).toBe("Female · Office")
  })
})

describe("facets", () => {
  it("deriveScenes ranks scenes by how many looks they cover, merging spelling variants", () => {
    expect(deriveScenes(CATALOG)).toEqual(["Office", "Studio", "Desk", "Livingroom", "Modern Corporate"])
    expect(deriveScenes(CATALOG, 2)).toEqual(["Office", "Studio"])
    const variants = [look("A Living Room 1", "x1"), look("B Livingroom 2", "x2"), look("C LIVING ROOM 3", "x3"), look("D Office 1", "x4")]
    expect(deriveScenes(variants)).toEqual(["Living Room", "Office"])
    // and the facet matches every spelling
    const people = groupByPerson(variants)
    expect(filterPeople(people, { ...DEFAULT_FILTERS, scene: "Living Room" }).map((p) => p.name)).toEqual(["A", "B", "C"])
  })
  it("derivePersonGenders lists the genders present, folding HeyGen's spellings (Woman/Man/Unspecified) onto three values", () => {
    expect(derivePersonGenders(groupByPerson(CATALOG))).toEqual(["female", "male", "unknown"])
    const messy = [look("A X 1", "a", { gender: "Woman" }), look("B X 1", "b", { gender: "Man" }), look("C X 1", "c", { gender: "Unspecified" }), look("D X 1", "d", { gender: "" })]
    const people = groupByPerson(messy)
    expect(people.map((p) => p.gender)).toEqual(["female", "male", "unknown", "unknown"])
    expect(derivePersonGenders(people)).toEqual(["female", "male", "unknown"])
    expect(filterPeople(people, { ...DEFAULT_FILTERS, gender: "female" }).map((p) => p.name)).toEqual(["A"])
  })
})

describe("filterPeople", () => {
  const people = groupByPerson(CATALOG)
  it("no filters → everyone, the very same objects (no re-render churn)", () => {
    const r = filterPeople(people, DEFAULT_FILTERS)
    expect(r).toHaveLength(people.length)
    r.forEach((p, i) => expect(p).toBe(people[i]))
  })
  it("query matches name, look or scene and keeps only the matching looks of a person", () => {
    const r = filterPeople(people, { ...DEFAULT_FILTERS, query: "office" })
    expect(r.map((p) => p.name)).toEqual(["Cora", "Brian"])
    expect(r[0].looks.map((l) => l.avatarId)).toEqual(["c4"])
    expect(r[1].looks.map((l) => l.avatarId)).toEqual(["b2"])
  })
  it("gender, scene and Avatar V narrow the set", () => {
    expect(filterPeople(people, { ...DEFAULT_FILTERS, gender: "male" }).map((p) => p.name)).toEqual(["Brian"])
    expect(filterPeople(people, { ...DEFAULT_FILTERS, scene: "Livingroom" }).map((p) => p.name)).toEqual(["Cora"])
    const v = filterPeople(people, { ...DEFAULT_FILTERS, onlyAvatarV: true })
    expect(v.map((p) => p.name)).toEqual(["Cora"])
    expect(v[0].looks.map((l) => l.avatarId)).toEqual(["c4"])
  })
  it("'Your own looks' keeps only the account's own LOOKS (not a whole person who has one); 'recent' keeps recently used looks", () => {
    const mixed = groupByPerson([look("Anna Studio 1", "own", { groupId: "g-anna", ownership: "private" }), look("Anna Office 1", "pub", { groupId: "g-anna" }), look("Ben Desk 1", "ben", { groupId: "g-ben" })])
    const own = filterPeople(mixed, { ...DEFAULT_FILTERS, library: "own" })
    expect(own.map((p) => p.name)).toEqual(["Anna"])
    expect(own[0].looks.map((l) => l.avatarId)).toEqual(["own"])
    expect(countOwnLooks(mixed)).toBe(1)
    const recent = filterPeople(people, { ...DEFAULT_FILTERS, library: "recent" }, ["b1", "c2"])
    expect(recent.map((p) => p.name)).toEqual(["Cora", "Brian"])
    expect(recent[0].looks.map((l) => l.avatarId)).toEqual(["c2"])
    expect(sortByRecency(recent, ["b1", "c2"]).map((p) => p.name)).toEqual(["Brian", "Cora"])
  })
  it("describeSelection counts people and looks in view", () => {
    expect(describeSelection(people)).toBe("4 people · 8 looks in view")
    expect(describeSelection(filterPeople(people, { ...DEFAULT_FILTERS, gender: "male" }))).toBe("1 person · 2 looks in view")
  })
})

describe("locateLook / engineLabels", () => {
  const people = groupByPerson(CATALOG)
  it("finds the current avatar's person and look, else the first person's cover", () => {
    expect(locateLook(people, "c1")).toMatchObject({ person: { name: "Cora" }, look: { avatarId: "c1" } })
    expect(locateLook(people, "nope")).toMatchObject({ person: { name: "Mine" }, look: { avatarId: "m2" } })
    expect(locateLook([], "c1")).toBeNull()
  })
  it("maps engine ids to labels, defaulting to Avatar IV when HeyGen says nothing", () => {
    expect(engineLabels(look("x", "x", { supportedEngines: ["avatar_v", "avatar_iv"] }))).toEqual(["Avatar V", "Avatar IV"])
    expect(engineLabels(look("x"))).toEqual(["Avatar IV"])
  })
})

describe("recent avatars (localStorage)", () => {
  beforeEach(() => window.localStorage.clear())
  it("remembers the last picks, most recent first, deduped and capped", () => {
    expect(readRecentAvatarIds()).toEqual([])
    rememberRecentAvatar("a")
    rememberRecentAvatar("b")
    expect(rememberRecentAvatar("a")).toEqual(["a", "b"])
    expect(readRecentAvatarIds()).toEqual(["a", "b"])
    for (let i = 0; i < 20; i++) rememberRecentAvatar(`x${i}`)
    expect(readRecentAvatarIds()).toHaveLength(12)
  })
  it("ignores garbage in the store", () => {
    window.localStorage.setItem("nodaro:heygen-recent-avatars", "{nope")
    expect(readRecentAvatarIds()).toEqual([])
  })
})
