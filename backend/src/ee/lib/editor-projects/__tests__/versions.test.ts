import { describe, it, expect } from "vitest"
import jsonpatch from "fast-json-patch"
import { canonicalJson, contentHash } from "../canonical.js"
import { EditorProjectRefusal } from "../errors.js"
import { MAX_PATCHES_PER_FULL, patchBaseFor, rebuildVersionText, storesAsPatch, versionsToThin, type VersionShape } from "../versions.js"

/**
 * The pure rules of a project's versions: which to thin, which kind a new one
 * is stored as, and rebuilding a version's whole content (verified by hash).
 */

const you = (number: number, extra: Partial<VersionShape> = {}): VersionShape => ({
  number, label: `Manual edit ${number}`, author: "you", kind: "full", base_number: null, ...extra,
})
const fulls = (count: number, from = 1) => Array.from({ length: count }, (_, i) => you(from + i))

describe("versionsToThin", () => {
  it("versionsToThin returns nothing at or under the cap", () => {
    expect(versionsToThin([])).toEqual([])
    expect(versionsToThin(fulls(50))).toEqual([])
    expect(versionsToThin(fulls(3), 3)).toEqual([])
  })

  it("drops the oldest unprotected first", () => {
    expect(versionsToThin(fulls(51))).toEqual([1])
    expect(versionsToThin(fulls(53))).toEqual([1, 2, 3])
    // Order of the input does not matter.
    expect(versionsToThin([...fulls(52)].reverse())).toEqual([1, 2])
  })

  it("never drops an agent's or an Exported version", () => {
    const versions = [
      you(1, { author: "Claude" }),
      you(2, { label: "Exported" }),
      you(3),
      ...fulls(49, 4),
    ]
    expect(versionsToThin(versions)).toEqual([3, 4])
    // When every version over the cap is protected, nothing.
    const allProtected = [...Array.from({ length: 50 }, (_, i) => you(i + 1, { author: "agent" })), you(51)]
    expect(versionsToThin(allProtected)).toEqual([])
  })

  it("never drops the newest version (the one just cut)", () => {
    const versions = [...Array.from({ length: 50 }, (_, i) => you(i + 1, { label: "Exported" })), you(51)]
    expect(versionsToThin(versions)).toEqual([])
  })

  it("never drops a full version that a kept patch needs", () => {
    // 1 is full with patches 2..4 on it; 2 is an agent's, so 1 must stay.
    const versions = [
      you(1),
      you(2, { kind: "patch", base_number: 1, author: "agent" }),
      you(3, { kind: "patch", base_number: 1 }),
      you(4, { kind: "patch", base_number: 1 }),
      ...fulls(49, 5),
    ]
    const thinned = versionsToThin(versions)
    expect(thinned).toEqual([3, 4, 5])
    expect(thinned).not.toContain(1)
  })

  it("a full version is dropped only with or after every patch on it", () => {
    const versions = [
      you(1),
      you(2, { kind: "patch", base_number: 1 }),
      you(3, { kind: "patch", base_number: 1 }),
      ...fulls(50, 4),
    ]
    // Three over the cap: the two patches, then the full they were on.
    const thinned = versionsToThin(versions)
    expect(thinned).toEqual([2, 3, 1])
    for (const n of thinned) {
      const v = versions.find((x) => x.number === n)!
      if (v.kind === "full") {
        const dependents = versions.filter((x) => x.base_number === n).map((x) => x.number)
        for (const d of dependents) expect(thinned.indexOf(d)).toBeLessThan(thinned.indexOf(n))
      }
    }
    // Only two over: the patches go, the full stays (it is still the oldest content).
    expect(versionsToThin(versions.slice(0, 52))).toEqual([2, 3])
  })
})

describe("the ceiling of 200 versions in all", () => {
  const agent = (number: number, extra: Partial<VersionShape> = {}) => you(number, { author: "agent", ...extra })

  it("past 200, the oldest go even when protected, but never the newest", () => {
    const versions = Array.from({ length: 202 }, (_, i) => agent(i + 1))
    expect(versionsToThin(versions)).toEqual([1, 2])
    expect(versionsToThin(Array.from({ length: 200 }, (_, i) => agent(i + 1)))).toEqual([])
    // Exported versions too.
    expect(versionsToThin(Array.from({ length: 201 }, (_, i) => you(i + 1, { label: "Exported" })))).toEqual([1])
    // Explicit cap and ceiling.
    expect(versionsToThin(Array.from({ length: 6 }, (_, i) => agent(i + 1)), 2, 4)).toEqual([1, 2])
  })

  it("the unprotected go first, then the oldest protected, to stay at 200", () => {
    // 210 versions: 5 of a person's own (numbers 100..104), the rest an agent's.
    const versions = Array.from({ length: 210 }, (_, i) => (i + 1 >= 100 && i + 1 <= 104 ? you(i + 1) : agent(i + 1)))
    expect(versionsToThin(versions)).toEqual([100, 101, 102, 103, 104, 1, 2, 3, 4, 5])
  })

  it("past 200, never a full version a kept patch needs: its patches go first", () => {
    const versions = [agent(1), agent(2, { kind: "patch", base_number: 1 }), ...Array.from({ length: 199 }, (_, i) => agent(i + 3))]
    expect(versions).toHaveLength(201)
    expect(versionsToThin(versions)).toEqual([2])
    const two = [...versions, agent(202)]
    expect(versionsToThin(two)).toEqual([2, 1])
  })
})

describe("which kind a new version is stored as", () => {
  it("a patch is against the newest full version, while it has fewer than 20 patches", () => {
    expect(patchBaseFor([])).toBeNull()
    expect(patchBaseFor([you(1), you(2, { kind: "patch", base_number: 1 }), you(3)])).toBe(3)
    const onOne = [you(1), ...Array.from({ length: MAX_PATCHES_PER_FULL - 1 }, (_, i) => you(i + 2, { kind: "patch", base_number: 1 }))]
    expect(patchBaseFor(onOne)).toBe(1)
    const full = [...onOne, you(onOne.length + 1, { kind: "patch", base_number: 1 })]
    expect(full.filter((v) => v.kind === "patch")).toHaveLength(MAX_PATCHES_PER_FULL)
    expect(patchBaseFor(full)).toBeNull()
  })

  it("a patch is stored only when its gzip is under a quarter of the whole's", () => {
    expect(storesAsPatch(24, 100)).toBe(true)
    expect(storesAsPatch(25, 100)).toBe(false)
    expect(storesAsPatch(80, 100)).toBe(false)
  })
})

describe("rebuilding a version's whole content", () => {
  const base = { clips: [{ id: "a", start: 0 }, { id: "b", start: 5 }], title: "Cut", meta: { fps: 30 } }
  const next = { clips: [{ id: "a", start: 0 }, { id: "b", start: 6 }, { id: "c", start: 9 }], title: "Cut 2", meta: { fps: 30 } }
  const baseText = canonicalJson(base)
  const nextText = canonicalJson(next)
  const ops = jsonpatch.compare(JSON.parse(baseText), JSON.parse(nextText))

  it("a full version is its own canonical text, checked against its hash", () => {
    expect(rebuildVersionText({ kind: "full", content_hash: contentHash(baseText) }, '{ "title": "Cut", "meta": {"fps":30}, "clips": [{"id":"a","start":0},{"id":"b","start":5}] }', null)).toBe(baseText)
  })

  it("a patch version applied to its base equals the content it was cut from", () => {
    expect(rebuildVersionText({ kind: "patch", content_hash: contentHash(nextText) }, canonicalJson(ops), baseText)).toBe(nextText)
  })

  it("anything that does not rebuild to the row's hash is version_unreadable, never other content", () => {
    const unreadable = (fn: () => unknown) => {
      try {
        fn()
      } catch (err) {
        expect(err).toBeInstanceOf(EditorProjectRefusal)
        expect(err).toMatchObject({ status: 500, code: "version_unreadable" })
        return
      }
      throw new Error("expected version_unreadable")
    }
    const nextHash = contentHash(nextText)
    // A wrong hash for a full version.
    unreadable(() => rebuildVersionText({ kind: "full", content_hash: nextHash }, baseText, null))
    // A patch with no base, a corrupt patch, a patch that applies to the wrong result, a disallowed op.
    unreadable(() => rebuildVersionText({ kind: "patch", content_hash: nextHash }, canonicalJson(ops), null))
    unreadable(() => rebuildVersionText({ kind: "patch", content_hash: nextHash }, "[{nope", baseText))
    unreadable(() => rebuildVersionText({ kind: "patch", content_hash: nextHash }, canonicalJson(ops.slice(1)), baseText))
    unreadable(() => rebuildVersionText({ kind: "patch", content_hash: nextHash }, JSON.stringify([{ op: "copy", from: "", path: "/x" }]), baseText))
    unreadable(() => rebuildVersionText({ kind: "patch", content_hash: nextHash }, JSON.stringify([{ op: "remove", path: "/missing" }]), baseText))
    unreadable(() => rebuildVersionText({ kind: "full", content_hash: nextHash }, "not json", null))
  })
})
