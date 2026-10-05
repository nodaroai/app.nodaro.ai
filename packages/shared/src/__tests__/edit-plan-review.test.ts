import { describe, expect, it } from "vitest"
import {
  EDITED_EDL_VERSION,
  editPlanBasis,
  editPlanResultPatch,
  editPlanSavedOutput,
  resolveEditPlanOutput,
  validateEditedEdl,
  type EditedEdl,
} from "../edit-plan-review.js"
import { EXECUTION_DATA_KEYS, TRANSIENT_RUNTIME_KEYS } from "../node-runtime-keys.js"
import type { Edl } from "../edl.js"

// ── fixtures ────────────────────────────────────────────────────────────────

const SOURCES = [{ id: "cam", kind: "video", url: "https://media.example/ep.mp4", role: "master-audio" }]

const TIGHTEN: Edl = {
  version: 1,
  clock: "master",
  sources: SOURCES,
  segments: [
    { id: "seg-0", inMs: 0, outMs: 4000, video: "cam" },
    { id: "seg-1", inMs: 6000, outMs: 9000, video: "cam" },
  ],
  dropped: [{ inMs: 4000, outMs: 6000, reason: "silence" }],
  meta: { title: "Episode 12" },
} as unknown as Edl

const clip = (inMs: number, outMs: number, title: string, hook: string): Edl =>
  ({
    version: 1,
    clock: "master",
    sources: SOURCES,
    segments: [{ id: "seg-0", inMs, outMs, video: "cam" }],
    dropped: [],
    meta: { title, hook },
  }) as unknown as Edl

const CLIPS: Edl[] = [
  clip(1000, 60000, "Why remote teams fail", "Nobody tells you this"),
  clip(70000, 128000, "The pricing myth", "We charged half"),
  clip(130000, 221000, "Our first hire", "We hired wrong"),
]

const CHAPTERS = { version: 1, chapters: [{ startMs: 0, title: "Intro" }] }

const cutEdit = (plan: unknown, edl: { segments: unknown[]; dropped: unknown[] }): EditedEdl =>
  ({ v: EDITED_EDL_VERSION, kind: "edl", basis: editPlanBasis(plan), edl }) as EditedEdl

const clipsEdit = (plan: unknown, clips: Array<{ keep: boolean; hook?: string }>): EditedEdl =>
  ({ v: EDITED_EDL_VERSION, kind: "clips", basis: editPlanBasis(plan), clips }) as EditedEdl

/** Rebuild a JSON value with every object's keys in REVERSE order, at every
 *  depth — what a JSONB round trip may do to `workflows.nodes`. */
function reverseKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeysDeep)
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).reverse()) out[key] = reverseKeysDeep((value as Record<string, unknown>)[key])
    return out
  }
  return value
}

// ── editPlanBasis ───────────────────────────────────────────────────────────

describe("editPlanBasis — FNV-1a-64 over key-sorted JSON (TA13)", () => {
  it("is 16 lowercase hex digits", () => {
    expect(editPlanBasis(TIGHTEN)).toMatch(/^[0-9a-f]{16}$/)
  })

  it("is FNV-1a-64 of the UTF-8 bytes of the canonical JSON (standard vectors)", () => {
    // A JSON string canonicalizes to its JSON text, so the hashed bytes are the
    // quoted string: `""` and `"a"` and `"foobar"` WITH the quotes.
    // Reference values from the published FNV-1a-64 test vectors, computed on
    // the quoted texts.
    expect(editPlanBasis("")).toBe(fnv1a64Reference('""'))
    expect(editPlanBasis("a")).toBe(fnv1a64Reference('"a"'))
    // Non-ASCII hashes its UTF-8 bytes (é = C3 A9; 😀 = F0 9F 98 80), not UTF-16 units.
    expect(editPlanBasis("é😀")).toBe(fnv1a64Reference('"é😀"'))
  })

  it("the reference implementation matches the published vectors", () => {
    expect(fnv1a64Reference("")).toBe("cbf29ce484222325")
    expect(fnv1a64Reference("a")).toBe("af63dc4c8601ec8c")
    expect(fnv1a64Reference("foobar")).toBe("85944171f73967e8")
  })

  it("survives a JSONB round trip that reorders keys at every depth", () => {
    for (const plan of [TIGHTEN, CLIPS, CHAPTERS]) {
      const reordered = reverseKeysDeep(JSON.parse(JSON.stringify(plan)))
      expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(plan))
      expect(editPlanBasis(reordered)).toBe(editPlanBasis(plan))
    }
  })

  it("changes when any value changes, at any depth", () => {
    const moved = JSON.parse(JSON.stringify(CLIPS))
    moved[2].segments[0].inMs += 1
    expect(editPlanBasis(moved)).not.toBe(editPlanBasis(CLIPS))
    const retitled = { ...TIGHTEN, meta: { title: "Episode 13" } }
    expect(editPlanBasis(retitled)).not.toBe(editPlanBasis(TIGHTEN))
  })

  it("keeps array order significant", () => {
    expect(editPlanBasis([CLIPS[1], CLIPS[0], CLIPS[2]])).not.toBe(editPlanBasis(CLIPS))
  })

  it("ignores undefined-valued keys, as the stored JSON does", () => {
    expect(editPlanBasis({ ...TIGHTEN, derivedFrom: undefined })).toBe(editPlanBasis(TIGHTEN))
  })

  it("hashes a plan object once: a later edit of the same plan reuses its basis", () => {
    // Each review keystroke makes a new `editedEdl` object over the SAME plan
    // object, and both engines read a saved plan many times in one run; none of
    // them may walk the whole plan again (about 20 ms on a large one). A
    // counting getter sees every walk.
    let reads = 0
    const counted = Object.defineProperty({ ...CLIPS[0] }, "meta", {
      get: () => (reads++, { title: "counted" }),
      enumerable: true,
    })
    const plan = [counted, CLIPS[1]]
    const first = editPlanBasis(plan)
    expect(reads).toBe(1)
    expect(editPlanBasis(plan)).toBe(first)
    expect(validateEditedEdl({ v: EDITED_EDL_VERSION, kind: "clips", basis: first, clips: [{ keep: true }, { keep: false }] }, plan).ok).toBe(true)
    expect(reads).toBe(1)
    // A copy is another object: hashed on its own, to the same value.
    expect(editPlanBasis(JSON.parse(JSON.stringify(plan)))).toBe(first)
  })
})

// ── editPlanSavedOutput: unedited parity ────────────────────────────────────

describe("editPlanSavedOutput — no edit: today's saved output, unchanged", () => {
  it("tighten and chapters: { json } only", () => {
    expect(editPlanSavedOutput({ generatedJson: TIGHTEN })).toEqual({ json: TIGHTEN })
    expect(editPlanSavedOutput({ generatedJson: CHAPTERS })).toEqual({ json: CHAPTERS })
  })

  it("clips: { json, listResults } with one JSON string per clip", () => {
    expect(editPlanSavedOutput({ generatedJson: CLIPS })).toEqual({
      json: CLIPS,
      listResults: CLIPS.map((c) => JSON.stringify(c)),
    })
  })

  it("no plan: undefined", () => {
    expect(editPlanSavedOutput({})).toBeUndefined()
    expect(editPlanSavedOutput({ editedEdl: cutEdit(TIGHTEN, { segments: [], dropped: [] }) })).toBeUndefined()
  })

  it("ignores the generic result history (a plan is not read from generatedResults)", () => {
    const out = editPlanSavedOutput({ generatedJson: TIGHTEN, generatedResults: [{ url: "x" }] })
    expect(out).toEqual({ json: TIGHTEN })
  })
})

// ── Tighten ─────────────────────────────────────────────────────────────────

describe("resolveEditPlanOutput — Tighten (kind: edl)", () => {
  const restored = {
    segments: [{ id: "seg-0", inMs: 0, outMs: 9000, video: "cam" }],
    dropped: [],
  }

  it("an edit on this plan wins: its segments and dropped, the plan's sources, clock and meta", () => {
    const r = resolveEditPlanOutput(TIGHTEN, cutEdit(TIGHTEN, restored))
    expect(r.status).toBe("applied")
    expect(r.json).toEqual({ ...TIGHTEN, segments: restored.segments, dropped: [] })
    expect(r.listResults).toBeUndefined()
  })

  it("an edit survives the plan's keys being reordered by JSONB", () => {
    const stored = reverseKeysDeep(JSON.parse(JSON.stringify(TIGHTEN)))
    const r = resolveEditPlanOutput(stored, cutEdit(TIGHTEN, restored))
    expect(r.status).toBe("applied")
    expect((r.json as Edl).segments).toEqual(restored.segments)
  })

  it("an edit made against another plan is ignored (stale): the plan as planned", () => {
    const replanned = { ...TIGHTEN, segments: [{ id: "seg-0", inMs: 0, outMs: 3000, video: "cam" }] }
    const r = resolveEditPlanOutput(replanned, cutEdit(TIGHTEN, restored))
    expect(r.status).toBe("stale")
    expect(r.json).toBe(replanned)
  })

  it("never stores sources: an edit's own sources are not read", () => {
    const edit = { ...cutEdit(TIGHTEN, restored), edl: { ...restored, sources: [{ id: "evil", kind: "video", url: "https://x" }] } }
    const r = resolveEditPlanOutput(TIGHTEN, edit)
    expect((r.json as Edl).sources).toEqual(TIGHTEN.sources)
  })

  it("an edit that is structurally broken still applies — the render refuses it, the planner's cut never returns silently", () => {
    const broken = { segments: [{ id: "seg-0", inMs: 5000, outMs: 1000, video: "cam" }], dropped: [] }
    const r = resolveEditPlanOutput(TIGHTEN, cutEdit(TIGHTEN, broken))
    expect(r.status).toBe("applied")
    expect((r.json as Edl).segments).toEqual(broken.segments)
  })

  it("a clips edit on a Tighten plan is invalid and ignored", () => {
    const r = resolveEditPlanOutput(TIGHTEN, clipsEdit(TIGHTEN, [{ keep: false }]))
    expect(r.status).toBe("invalid")
    expect(r.json).toBe(TIGHTEN)
  })
})

// ── Clips ───────────────────────────────────────────────────────────────────

describe("resolveEditPlanOutput — Clips (kind: clips, TA15/TA16)", () => {
  it("the list is row-aligned on the PLAN's indices, with '' at each dropped clip", () => {
    const r = resolveEditPlanOutput(CLIPS, clipsEdit(CLIPS, [{ keep: true }, { keep: false }, { keep: true }]))
    expect(r.status).toBe("applied")
    expect(r.listResults).toEqual([JSON.stringify(CLIPS[0]), "", JSON.stringify(CLIPS[2])])
  })

  it("json holds the kept clips only, so the scalar path (json[0]) is the first KEPT clip", () => {
    const r = resolveEditPlanOutput(CLIPS, clipsEdit(CLIPS, [{ keep: false }, { keep: true }, { keep: false }]))
    expect(r.json).toEqual([CLIPS[1]])
    expect(r.listResults).toEqual(["", JSON.stringify(CLIPS[1]), ""])
  })

  it("nothing kept: json is empty and every row is a hole", () => {
    const r = resolveEditPlanOutput(CLIPS, clipsEdit(CLIPS, [{ keep: false }, { keep: false }, { keep: false }]))
    expect(r.json).toEqual([])
    expect(r.listResults).toEqual(["", "", ""])
  })

  it("holes are '' — never null, which would read as the text \"null\"", () => {
    const r = resolveEditPlanOutput(CLIPS, clipsEdit(CLIPS, [{ keep: false }, { keep: true }, { keep: true }]))
    for (const row of r.listResults ?? []) expect(typeof row).toBe("string")
  })

  it("an edited hook travels as meta.hook (text only, TA20); the title is untouched", () => {
    const r = resolveEditPlanOutput(CLIPS, clipsEdit(CLIPS, [{ keep: true, hook: "Nobody warns you" }, { keep: true }, { keep: true }]))
    const first = (r.json as Edl[])[0]!
    expect(first.meta).toEqual({ title: "Why remote teams fail", hook: "Nobody warns you" })
    expect(JSON.parse(r.listResults![0]!).meta.hook).toBe("Nobody warns you")
    expect((r.json as Edl[])[1]).toEqual(CLIPS[1])
    // The plan itself is never mutated.
    expect(CLIPS[0]!.meta?.hook).toBe("Nobody tells you this")
  })

  it("a hook on a dropped clip changes nothing", () => {
    const r = resolveEditPlanOutput(CLIPS, clipsEdit(CLIPS, [{ keep: false, hook: "x" }, { keep: true }, { keep: true }]))
    expect(r.listResults![0]).toBe("")
  })

  it("decisions that do not line up with the plan's clips are invalid and ignored", () => {
    const r = resolveEditPlanOutput(CLIPS, clipsEdit(CLIPS, [{ keep: true }, { keep: false }]))
    expect(r.status).toBe("invalid")
    expect(r.json).toBe(CLIPS)
    expect(r.listResults).toEqual(CLIPS.map((c) => JSON.stringify(c)))
  })

  it("a re-planned clip set leaves the decisions stale", () => {
    const replanned = [CLIPS[0], CLIPS[2]]
    const r = resolveEditPlanOutput(replanned, clipsEdit(CLIPS, [{ keep: true }, { keep: false }]))
    expect(r.status).toBe("stale")
    expect(r.json).toBe(replanned)
  })

  it("a re-plan with fewer clips leaves a full decision list stale, not invalid (the basis is checked first)", () => {
    const replanned = [CLIPS[0], CLIPS[2]]
    const r = resolveEditPlanOutput(replanned, clipsEdit(CLIPS, [{ keep: true }, { keep: false }, { keep: true }]))
    expect(r.status).toBe("stale")
    expect(r.json).toBe(replanned)
    expect(r.listResults).toEqual(replanned.map((c) => JSON.stringify(c)))
  })

  it("a clips edit meeting a plan re-run as Tighten is stale, not invalid", () => {
    const r = resolveEditPlanOutput(TIGHTEN, clipsEdit(CLIPS, [{ keep: true }, { keep: false }, { keep: true }]))
    expect(r.status).toBe("stale")
    expect(r.json).toBe(TIGHTEN)
  })

  it("an edl edit meeting a plan re-run as a clip set is stale, not invalid", () => {
    const r = resolveEditPlanOutput(CLIPS, cutEdit(TIGHTEN, { segments: [], dropped: [] }))
    expect(r.status).toBe("stale")
    expect(r.json).toBe(CLIPS)
  })

  it("an edl edit on a clip set is invalid and ignored", () => {
    const r = resolveEditPlanOutput(CLIPS, cutEdit(CLIPS, { segments: [], dropped: [] }))
    expect(r.status).toBe("invalid")
  })

  it("editPlanSavedOutput applies the edit stored beside the plan", () => {
    const editedEdl = clipsEdit(CLIPS, [{ keep: true }, { keep: false }, { keep: true }])
    expect(editPlanSavedOutput({ generatedJson: CLIPS, editedEdl })).toEqual({
      json: [CLIPS[0], CLIPS[2]],
      listResults: [JSON.stringify(CLIPS[0]), "", JSON.stringify(CLIPS[2])],
    })
  })
})

// ── Chapters and junk ───────────────────────────────────────────────────────

describe("resolveEditPlanOutput — what an edit never touches", () => {
  it("chapters have no review: any edit is ignored", () => {
    expect(resolveEditPlanOutput(CHAPTERS, cutEdit(CHAPTERS, { segments: [], dropped: [] })).status).toBe("invalid")
    expect(resolveEditPlanOutput(CHAPTERS, undefined)).toEqual({ status: "none", json: CHAPTERS })
  })

  it.each([
    ["null", null],
    ["a string", "edl"],
    ["a future version", { v: 2, kind: "edl", basis: editPlanBasis(TIGHTEN), edl: { segments: [], dropped: [] } }],
    ["an unknown kind", { v: 1, kind: "trim", basis: editPlanBasis(TIGHTEN) }],
    ["no basis", { v: 1, kind: "edl", edl: { segments: [], dropped: [] } }],
    ["no segments", { v: 1, kind: "edl", basis: editPlanBasis(TIGHTEN), edl: { dropped: [] } }],
    ["no dropped", { v: 1, kind: "edl", basis: editPlanBasis(TIGHTEN), edl: { segments: [] } }],
  ])("%s is invalid and ignored", (_label, edit) => {
    const r = resolveEditPlanOutput(TIGHTEN, edit)
    expect(r.status).toBe(edit === null ? "none" : "invalid")
    expect(r.json).toBe(TIGHTEN)
  })

  it("a clip decision with a non-boolean keep or a non-string hook is invalid", () => {
    expect(resolveEditPlanOutput(CLIPS, { ...clipsEdit(CLIPS, []), clips: [{ keep: "yes" }, { keep: true }, { keep: true }] }).status).toBe("invalid")
    expect(resolveEditPlanOutput(CLIPS, { ...clipsEdit(CLIPS, []), clips: [{ keep: true, hook: 3 }, { keep: true }, { keep: true }] }).status).toBe("invalid")
  })
})

// ── validateEditedEdl ───────────────────────────────────────────────────────

describe("validateEditedEdl — what a writer checks before saving an edit", () => {
  it("a well-formed edit on this plan passes", () => {
    const edit = cutEdit(TIGHTEN, { segments: [{ id: "seg-0", inMs: 0, outMs: 9000, video: "cam" }], dropped: [] })
    expect(validateEditedEdl(edit, TIGHTEN)).toEqual({ ok: true, issues: [], warnings: [] })
    expect(validateEditedEdl(clipsEdit(CLIPS, [{ keep: true }, { keep: false }, { keep: true, hook: "h" }]), CLIPS).ok).toBe(true)
  })

  it("names a stale basis", () => {
    const r = validateEditedEdl(cutEdit(CHAPTERS, { segments: [], dropped: [] }), TIGHTEN)
    expect(r.ok).toBe(false)
    expect(r.issues.join(" ")).toMatch(/basis/)
  })

  it("adds the structural EDL issues of the edited cut (TA1 a: well-formed)", () => {
    const edit = cutEdit(TIGHTEN, {
      segments: [{ id: "seg-0", inMs: 0, outMs: 5000, video: "cam" }],
      dropped: [{ inMs: 4000, outMs: 6000, reason: "silence" }],
    })
    const r = validateEditedEdl(edit, TIGHTEN)
    expect(r.ok).toBe(false)
    expect(r.issues.join(" ")).toMatch(/overlaps kept segment/)
  })

  it("names the basis, not the clip count, when the plan was re-run with fewer clips", () => {
    const r = validateEditedEdl(clipsEdit(CLIPS, [{ keep: true }, { keep: false }, { keep: true }]), [CLIPS[0], CLIPS[2]])
    expect(r.ok).toBe(false)
    expect(r.issues.join(" ")).toMatch(/basis/)
    expect(r.issues.join(" ")).not.toMatch(/decisions/)
  })

  it("names the basis, not the plan's kind, when a clip set was re-run as Tighten", () => {
    const r = validateEditedEdl(clipsEdit(CLIPS, [{ keep: true }, { keep: false }, { keep: true }]), TIGHTEN)
    expect(r.ok).toBe(false)
    expect(r.issues.join(" ")).toMatch(/basis/)
    expect(r.issues.join(" ")).not.toMatch(/needs a clip set/)
  })

  it("names a misaligned clip decision list", () => {
    const r = validateEditedEdl(clipsEdit(CLIPS, [{ keep: true }]), CLIPS)
    expect(r.ok).toBe(false)
    expect(r.issues.join(" ")).toMatch(/3 clips/)
  })

  it("names the envelope problem of a junk value", () => {
    expect(validateEditedEdl("nope", TIGHTEN).ok).toBe(false)
    expect(validateEditedEdl({ v: 1, kind: "edl", basis: "x" }, TIGHTEN).issues.length).toBeGreaterThan(0)
  })
})

// ── TA14: a review edit is run-result data ──────────────────────────────────

describe("editedEdl is run-result data (TA14)", () => {
  it("is an EXECUTION_DATA_KEYS member: out of undo, presets, templates and exports; wiped by Clear results", () => {
    expect(EXECUTION_DATA_KEYS.has("editedEdl")).toBe(true)
  })

  it("is persisted: not transient run state", () => {
    expect(TRANSIENT_RUNTIME_KEYS.has("editedEdl")).toBe(false)
  })
})

// ── A landing plan keeps an edit made on the same plan (decided 2026-10-05) ──

describe("editPlanResultPatch — what a result writer writes when a plan lands", () => {
  it("lands the plan", () => {
    expect(editPlanResultPatch(TIGHTEN, undefined).generatedJson).toBe(TIGHTEN)
  })

  it("keeps an edit made on the same plan: the patch never names editedEdl", () => {
    const edit = cutEdit(TIGHTEN, { segments: [], dropped: [] })
    const patch = editPlanResultPatch(TIGHTEN, edit)
    expect(patch).toEqual({ generatedJson: TIGHTEN })
    expect(Object.prototype.hasOwnProperty.call(patch, "editedEdl")).toBe(false)
  })

  it("keeps it when the same plan comes back as another object (a reload, a JSONB round trip)", () => {
    const edit = clipsEdit(CLIPS, [{ keep: true }, { keep: false }, { keep: true }])
    const again = reverseKeysDeep(JSON.parse(JSON.stringify(CLIPS)))
    expect(Object.prototype.hasOwnProperty.call(editPlanResultPatch(again, edit), "editedEdl")).toBe(false)
  })

  it("clears an edit made on a different plan", () => {
    const edit = cutEdit(TIGHTEN, { segments: [], dropped: [] })
    const replanned = { ...TIGHTEN, dropped: [] }
    const patch = editPlanResultPatch(replanned, edit)
    expect(patch).toEqual({ generatedJson: replanned, editedEdl: undefined })
    expect(Object.prototype.hasOwnProperty.call(patch, "editedEdl")).toBe(true)
  })

  it("clears a clip review when the re-plan changes the clip set", () => {
    const edit = clipsEdit(CLIPS, [{ keep: true }, { keep: false }, { keep: true }])
    expect(editPlanResultPatch(CLIPS.slice(0, 2), edit)).toHaveProperty("editedEdl", undefined)
  })

  it.each([
    ["no basis", { v: 1, kind: "edl", edl: { segments: [], dropped: [] } }],
    ["an empty basis", { v: 1, kind: "edl", basis: "", edl: { segments: [], dropped: [] } }],
    ["junk", "nope"],
    ["null", null],
  ])("clears an edit with %s (it names no plan)", (_name, edited) => {
    expect(Object.prototype.hasOwnProperty.call(editPlanResultPatch(TIGHTEN, edited), "editedEdl")).toBe(true)
  })

  it("an edit kept by the patch still applies to the plan that landed", () => {
    const edit = clipsEdit(CLIPS, [{ keep: false }, { keep: true }, { keep: false }])
    const landed = { editedEdl: edit, ...editPlanResultPatch(CLIPS, edit) }
    expect(editPlanSavedOutput(landed)?.json).toEqual([CLIPS[1]])
  })
})

// ── reference FNV-1a-64 (BigInt; the test's own oracle) ─────────────────────

function fnv1a64Reference(text: string): string {
  let h = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (const byte of new TextEncoder().encode(text)) {
    h ^= BigInt(byte)
    h = (h * prime) & 0xffffffffffffffffn
  }
  return h.toString(16).padStart(16, "0")
}
