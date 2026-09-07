import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import {
  buildGoldenOps,
  buildGoldenWorkflow,
  reserialize,
} from "../fixtures/build-golden"
import { parseProduction } from "../shot-graph"
import type { WorkflowLike } from "../workflow-like"

/**
 * THE GOLDEN PRODUCTION — the contract fixture (spec §11, plan P1.0).
 *
 * One document that carries every layer a real production has: three shots
 * (a fully-framed one with both histories, its markers, its voice, its beats
 * with a spoken cue and its cast pins; a references-mode clip with no still;
 * a node-less recipe placeholder with a plan), a two-role cast, a film look,
 * a folder, a storyboard with its brief, a soundtrack plan, a final cut and a
 * two-entry bin.
 *
 * It exists so ONE assertion can hold across two repos: the document the
 * studio's client writes and the document the platform's `applyOps` writes are
 * the same bytes. That is only meaningful if the fixture is what the codec
 * itself emits, so it is BUILT — `fixtures/build-golden.ts` constructs the
 * production with the codec's own builders and serializes it; nothing here is
 * hand-typed JSON. The last test in this file is the drift guard that keeps it
 * that way.
 *
 * The three claims:
 *  1. `parse(serialize(parse(g)))` deep-equals `parse(g)` — a save-then-reload
 *     is a fixpoint, so an editing session cannot erode the document.
 *  2. `serialize(parse(g)).settings.studio` is BYTE-equal to the fixture's —
 *     the stronger form, in the serializer's own canonical key order. This is
 *     the assertion the ops route's contract test reuses.
 *  3. `version: 3` and every marker survive the trip. A field written by the
 *     serializer and not read back by the parser is erased on the next save
 *     (the `readVoice` lesson), and a fixture that quietly lost its markers
 *     would still pass (1) and (2).
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(HERE, "..", "fixtures")

const readJson = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8")) as unknown

const golden = readJson("golden-production.json") as WorkflowLike & {
  settings: { studio: Record<string, unknown> }
}

/** The document, parsed — the shape every operation reads. */
const parsed = () => parseProduction(golden)

/** `settings.studio` as the serializer writes it back out. */
const roundTripped = () => reserialize(parsed()).settings.studio

describe("the golden production fixture", () => {
  it("round-trips: parse(serialize(parse(g))) deep-equals parse(g)", () => {
    const once = parsed()
    const twice = parseProduction({
      ...golden,
      ...reserialize(once),
    })
    expect(twice).toEqual(once)
  })

  it("re-serializes byte-identically — settings.studio in canonical key order", () => {
    expect(JSON.stringify(roundTripped())).toBe(
      JSON.stringify(golden.settings.studio),
    )
  })

  it("is a v3 index before and after the trip", () => {
    expect(golden.settings.studio.version).toBe(3)
    expect(roundTripped().version).toBe(3)
  })
})

describe("what the golden production carries", () => {
  it("has three shots — framed, references-mode, and a recipe placeholder", () => {
    const { shots } = parsed()
    expect(shots.map((s) => s.id)).toEqual(["shot-1", "shot-2", "shot-3"])

    // Shot 1 — both histories, and they are independent lists.
    expect(shots[0].still?.results).toHaveLength(3)
    expect(shots[0].still?.activeIndex).toBe(1)
    expect(shots[0].clip?.results).toHaveLength(2)
    expect(shots[0].startFrame).toBeTruthy()
    expect(shots[0].endFrame).toBeTruthy()

    // Shot 2 — a references-mode clip has no still; its references ARE the input.
    expect(shots[1].still).toBeUndefined()
    expect(shots[1].clip).toBeDefined()
    expect(shots[1].directingReferenceUrls?.length).toBeGreaterThan(0)
    expect(shots[1].directingReferenceVideoUrls?.length).toBeGreaterThan(0)
    expect(shots[1].directingReferenceAudioUrls?.length).toBeGreaterThan(0)

    // Shot 3 — a recipe shot is a NODE-LESS placeholder entry with a plan.
    expect(shots[2].still).toBeUndefined()
    expect(shots[2].clip).toBeUndefined()
    expect(shots[2].recipe?.framing?.prompt).toBeTruthy()
    expect(shots[2].plan?.frame?.prompt).toBeTruthy()
    expect(shots[2].plan?.motion?.prompt).toBeTruthy()
    expect(shots[2].plan?.voice?.text).toBeTruthy()
    const entries = golden.settings.studio.shots as ReadonlyArray<
      Record<string, unknown>
    >
    expect(entries[2].imageNodeId).toBeUndefined()
    expect(entries[2].videoNodeId).toBeUndefined()
  })

  it("keeps every marker, cue and pin through the round trip", () => {
    const before = parsed()
    const after = parseProduction({ ...golden, ...reserialize(before) })

    // The in-flight animate marker — the resume context a long render needs.
    expect(after.shots[0].pendingClips).toHaveLength(1)
    expect(after.shots[0].pendingClips?.[0].jobId).toBe("job-clip-pending-1")
    expect(after.shots[0].pendingClips?.[0].startedAt).toBe(
      before.shots[0].pendingClips?.[0].startedAt,
    )

    // The voiceover, its tuned delivery, and the beats' spoken cue.
    expect(after.shots[0].voice?.url).toBeTruthy()
    expect(after.shots[0].voice?.delivery).toBeDefined()
    const cues = after.shots[0].beats?.flatMap((b) => b.directions ?? []) ?? []
    expect(cues.some((d) => d.kind === "speech")).toBe(true)

    // The scene's own authoring state and its cast pins.
    expect(after.shots[0].scenePrompt).toBeTruthy()
    expect(after.shots[0].endTransition?.id).toBeTruthy()
    expect(Object.keys(after.shots[0].castLook ?? {})).toHaveLength(1)
    expect(after.shots[0].look).toBeDefined()
  })

  it("carries the production layers — cast, film, folder, storyboard, plan, cut, bin", () => {
    const p = parsed()

    // Two roles, one of them carrying the role phrase its reference rides with.
    expect(Object.keys(p.cast ?? {})).toHaveLength(2)
    const members = Object.values(p.cast ?? {})
    expect(members.map((m) => m.kind).sort()).toEqual(["character", "location"])
    expect(members.filter((m) => m.defaultRole).length).toBe(1)

    expect(p.film).toBeDefined()
    expect(p.folders).toHaveLength(1)
    expect(p.storyboard?.brief).toBeTruthy()
    expect(p.musicPlan?.prompt).toBeTruthy()
    expect(p.cuts).toHaveLength(1)
    expect(p.cuts?.[0].final).toBe(true)

    // The bin holds one deleted image and one deleted take.
    expect(p.trash).toHaveLength(2)
    expect(p.trash?.map((t) => t.kind).sort()).toEqual(["clip", "still"])

    // Absent by design: an archived production is filtered off the dashboard,
    // and sharing flips only through the audience-gated route (D3.5).
    expect(p.archived).toBeUndefined()
    expect(p.shared).toBeUndefined()
    expect(golden.settings.studio.archived).toBeUndefined()
    expect(golden.settings.studio.shared).toBeUndefined()
  })
})

/**
 * The op SCRIPT that rides beside the fixture. `applyOps` is the integrator's,
 * so these are the claims the script can make on its own: it is a well-formed
 * batch, it names only ops this build has, and it exercises every section — the
 * property that makes `golden-after-ops.json` a contract rather than a sample.
 */
describe("the golden op script", () => {
  /** §6 / `ops/SECTIONS.md`, section → its ops. The one list this file owns. */
  const SECTIONS: Readonly<Record<string, ReadonlyArray<string>>> = {
    production: [
      "set_name",
      "set_thumbnail",
      "set_archived",
      "select_shot",
      "set_film",
      "set_music_plan",
      "set_music",
      "clear_music",
      "set_storyboard",
    ],
    folders: ["add_folder", "rename_folder", "remove_folder", "move_shot_to_folder"],
    shots: [
      "add_shot",
      "remove_shot",
      "duplicate_shot",
      "move_shot",
      "rename_shot",
      "insert_shots",
      "set_plan",
    ],
    beats: ["set_scene_prompt", "set_beats", "set_end_transition"],
    looks: ["set_look", "set_cast_look", "set_cast_look_map"],
    stills: [
      "add_still_result",
      "set_active_still",
      "remove_still_result",
      "rename_still_result",
    ],
    clips: [
      "add_clip_result",
      "set_active_clip",
      "remove_clip_result",
      "rename_clip_result",
    ],
    frames: [
      "set_start_frame",
      "set_end_frame",
      "set_directing_references",
      "add_pending_clip",
      "remove_pending_clip",
    ],
    voice: ["set_voice", "clear_voice"],
    cast: [
      "enroll_cast",
      "remove_cast_member",
      "rename_cast_member",
      "recast_cast_member",
      "set_cast_role",
      "mint_cast_from_chips",
    ],
    trash: ["restore_trashed", "purge_trashed", "clear_trash"],
    cuts: ["add_cut", "rename_cut", "delete_cut", "mark_cut_final", "duplicate_cut"],
  }

  const ops = readJson("golden-ops.json") as ReadonlyArray<{ op: string }>

  it("is a well-formed batch of at least forty operations", () => {
    expect(Array.isArray(ops)).toBe(true)
    expect(ops.length).toBeGreaterThanOrEqual(40)
    for (const op of ops) expect(typeof op.op).toBe("string")
  })

  it("exercises every operation of every section, and nothing this build lacks", () => {
    const named = new Set(ops.map((o) => o.op))
    const known = new Set(Object.values(SECTIONS).flat())

    const missing = Object.entries(SECTIONS).flatMap(([section, names]) =>
      names.filter((name) => !named.has(name)).map((name) => `${section}.${name}`),
    )
    expect(missing).toEqual([])

    // `land_job` and the pending-STILL markers land in P1.2; a script naming one
    // would fail the integrator's acceptance run with `op_not_implemented`.
    expect([...named].filter((name) => !known.has(name))).toEqual([])
  })

  it("addresses only shots, folders, cuts, cast rows and bin entries the fixture has", () => {
    const p = parsed()
    const shotIds = new Set(p.shots.map((s) => s.id))
    const trashIds = new Set((p.trash ?? []).map((t) => t.id))
    const castKeys = new Set(Object.keys(p.cast ?? {}))
    // Only the ops that address something the FIXTURE must already carry — an
    // op addressing an id a previous op minted is the batch's own business.
    for (const op of ops as ReadonlyArray<Record<string, unknown>>) {
      if (op.op === "restore_trashed" || op.op === "purge_trashed") {
        expect(trashIds.has(op.trashId as string)).toBe(true)
      }
      if (op.op === "remove_pending_clip" || op.op === "clear_voice") {
        expect(shotIds.has(op.shotId as string)).toBe(true)
      }
      if (op.op === "set_cast_look" && op.look === null) {
        expect(castKeys.has(op.key as string)).toBe(true)
      }
    }
  })
})

/**
 * The DRIFT guard. Both fixtures are generated — the production by running the
 * codec's own builders and serializer, the op script beside it so every id it
 * addresses is one the document really has. Committing the bytes is what lets
 * two repos compare against the same document; regenerating them is a one-line
 * script run (`tsx src/fixtures/build-golden.ts`), and this test is what says
 * when it is due.
 */
describe("the committed fixtures are what the builder renders", () => {
  it("golden-production.json is a fresh serialize of the built production", () => {
    expect(buildGoldenWorkflow()).toEqual(golden)
  })

  it("golden-ops.json is the script the builder writes", () => {
    expect(buildGoldenOps()).toEqual(readJson("golden-ops.json"))
  })
})
