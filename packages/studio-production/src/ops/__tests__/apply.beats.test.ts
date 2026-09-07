/**
 * The `beats` section — the scene's prose and its cues.
 *
 * PORTED, assertion-for-assertion, from the studio store's own suite
 * (`src/store/production-store.test.ts` → `describe("patchShotEndTransition")`
 * L1717 and `describe("setShotScenePrompt")` L1750). Only the call shape moves:
 * `get().setShots([…]); get().patchShotEndTransition("a", END)` becomes
 * `beatsHandlers.set_end_transition(production, op, ctx)`. The expectations are
 * the studio's, unchanged — that suite IS the specification of these reducers,
 * so an "improved" expectation here would be a silent behaviour change.
 *
 * `set_beats` has NO store oracle: the only `setShotBeats` test in the studio
 * repo is a React write-through harness over the beats editor
 * (`src/components/composer/beats-editor-echo.test.tsx`), which plays the
 * reducer rather than testing it. Its cases below are written from
 * `production-store-scene.ts`'s `setShotBeats` behaviour — the same four rules
 * its two siblings are tested on (writes on that shot alone, copies the
 * caller's objects, an empty write DROPS the field, a no-op keeps the array).
 *
 * The one generalisation the operation vocabulary adds over the reducers: an
 * unknown `shotId` is a caller mistake, so it throws `op_target_missing` where
 * the store silently no-ops. No studio assertion covers that case, so nothing
 * is contradicted.
 */
import { describe, expect, it } from "vitest"

import { isOpError, OpError } from "../errors"
import type { Production } from "../production"
import type { OpClass, OpContext } from "../types"
import { beatsHandlers, beatsOpClasses, beatsOpSchemas } from "../sections/beats"

import type { Shot, ShotBeat } from "../../shot"

/** The studio suite's own still-only shot fixture (stable ids for assertions). */
const stillOnly = (id: string): Shot => ({
  id,
  still: {
    nodeId: `generate-image-${id}`,
    url: `https://r2.example/${id}.png`,
    provider: "nano-banana",
    prompt: `prompt ${id}`,
  },
})

/** A production standing over the given shots — what the store's `shots` is. */
const prod = (shots: Shot[]): Production => ({ shots })

const ctx: OpContext = { now: "2026-09-06T12:00:00.000Z", mintId: () => "id-1" }

// ── set_end_transition — ported from `describe("patchShotEndTransition")` ────

describe("set_end_transition", () => {
  const END = { id: "cross-dissolve", duration: "short" } as const

  it("stores the scene's end transition on that shot alone", () => {
    const before = prod([stillOnly("a"), stillOnly("b")])
    const prev = before.shots
    const { production } = beatsHandlers.set_end_transition(
      before,
      { op: "set_end_transition", shotId: "a", transition: END },
      ctx,
    )
    expect(production.shots[0].endTransition).toEqual(END)
    expect(production.shots[1].endTransition).toBeUndefined()
    expect(Object.is(prev, production.shots)).toBe(false)
  })

  it("copies the node — the store never aliases the caller's object", () => {
    const before = prod([stillOnly("a")])
    const node = { ...END }
    const { production } = beatsHandlers.set_end_transition(
      before,
      { op: "set_end_transition", shotId: "a", transition: node },
      ctx,
    )
    expect(Object.is(production.shots[0].endTransition, node)).toBe(false)
  })

  it("a null write DELETES the field — a cleared node is NO node", () => {
    const before = prod([{ ...stillOnly("a"), endTransition: { ...END } }])
    const { production } = beatsHandlers.set_end_transition(
      before,
      { op: "set_end_transition", shotId: "a", transition: null },
      ctx,
    )
    expect("endTransition" in production.shots[0]).toBe(false)
  })

  it("clearing a shot that has none changes nothing (no re-render churn)", () => {
    const before = prod([stillOnly("a")])
    const prev = before.shots
    const { production, warnings } = beatsHandlers.set_end_transition(
      before,
      { op: "set_end_transition", shotId: "a", transition: null },
      ctx,
    )
    expect(Object.is(prev, production.shots)).toBe(true)
    expect(warnings?.length).toBe(1)
  })

  it("leaves the input document untouched", () => {
    const before = prod([stillOnly("a")])
    beatsHandlers.set_end_transition(
      before,
      { op: "set_end_transition", shotId: "a", transition: END },
      ctx,
    )
    expect(before.shots[0].endTransition).toBeUndefined()
  })

  it("names the shot in its receipt", () => {
    const before = prod([{ ...stillOnly("a"), name: "Rooftop" }, stillOnly("b")])
    expect(
      beatsHandlers.set_end_transition(
        before,
        { op: "set_end_transition", shotId: "a", transition: END },
        ctx,
      ).receipt,
    ).toEqual({
      op: "set_end_transition",
      summary: "Set the end transition on Rooftop.",
    })
    expect(
      beatsHandlers.set_end_transition(
        before,
        { op: "set_end_transition", shotId: "b", transition: null },
        ctx,
      ).receipt.summary,
    ).toBe("Cleared the end transition on Shot 2.")
  })

  it("throws op_target_missing for a shot that is not in the production", () => {
    const before = prod([stillOnly("a")])
    expect(() =>
      beatsHandlers.set_end_transition(
        before,
        { op: "set_end_transition", shotId: "nope", transition: END },
        ctx,
      ),
    ).toThrow(OpError)
  })

  it("refuses a lever-only node — a transition IS its catalog pick", () => {
    // `readTransition` DROPS an id-less node at the next load, so a write the
    // document would erase on reload is refused at the schema instead.
    expect(
      beatsOpSchemas.set_end_transition.safeParse({
        op: "set_end_transition",
        shotId: "a",
        transition: { position: "start" },
      }).success,
    ).toBe(false)
  })
})

// ── set_scene_prompt — ported from `describe("setShotScenePrompt")` ──────────

describe("set_scene_prompt", () => {
  const SCENE = "A rain-soaked rooftop chase. Keep it grim — no slow motion."

  it("stores the scene's standing description on that shot alone", () => {
    const before = prod([stillOnly("a"), stillOnly("b")])
    const prev = before.shots
    const { production } = beatsHandlers.set_scene_prompt(
      before,
      { op: "set_scene_prompt", shotId: "a", text: SCENE },
      ctx,
    )
    expect(production.shots[0].scenePrompt).toBe(SCENE)
    expect(production.shots[1].scenePrompt).toBeUndefined()
    expect(Object.is(prev, production.shots)).toBe(false)
  })

  it("a blank write DELETES the field — an empty string is never stored", () => {
    const before = prod([{ ...stillOnly("a"), scenePrompt: SCENE }])
    const { production } = beatsHandlers.set_scene_prompt(
      before,
      { op: "set_scene_prompt", shotId: "a", text: "   \n " },
      ctx,
    )
    expect("scenePrompt" in production.shots[0]).toBe(false)
  })

  it("clearing a shot that has none changes nothing (no re-render churn)", () => {
    const before = prod([stillOnly("a")])
    const prev = before.shots
    const { production, warnings } = beatsHandlers.set_scene_prompt(
      before,
      { op: "set_scene_prompt", shotId: "a", text: "" },
      ctx,
    )
    expect(Object.is(prev, production.shots)).toBe(true)
    expect(warnings?.length).toBe(1)
  })

  it("stores the text AS TYPED — only emptiness is normalized", () => {
    const before = prod([stillOnly("a")])
    const { production } = beatsHandlers.set_scene_prompt(
      before,
      { op: "set_scene_prompt", shotId: "a", text: `  ${SCENE} ` },
      ctx,
    )
    expect(production.shots[0].scenePrompt).toBe(`  ${SCENE} `)
  })

  it("names the shot in its receipt", () => {
    const before = prod([stillOnly("a")])
    expect(
      beatsHandlers.set_scene_prompt(
        before,
        { op: "set_scene_prompt", shotId: "a", text: SCENE },
        ctx,
      ).receipt,
    ).toEqual({
      op: "set_scene_prompt",
      summary: "Set the scene description on Shot 1.",
    })
    expect(
      beatsHandlers.set_scene_prompt(
        prod([{ ...stillOnly("a"), scenePrompt: SCENE }]),
        { op: "set_scene_prompt", shotId: "a", text: "" },
        ctx,
      ).receipt.summary,
    ).toBe("Cleared the scene description on Shot 1.")
  })

  it("throws op_target_missing for a shot that is not in the production", () => {
    const before = prod([stillOnly("a")])
    try {
      beatsHandlers.set_scene_prompt(
        before,
        { op: "set_scene_prompt", shotId: "nope", text: SCENE },
        ctx,
      )
      expect.unreachable()
    } catch (error) {
      expect(isOpError(error)).toBe(true)
      if (!isOpError(error)) throw error
      expect(error.code).toBe("op_target_missing")
    }
  })
})

// ── set_beats — no store oracle; written from the reducer's behaviour ────────

describe("set_beats", () => {
  const beat = (id: string): ShotBeat => ({
    id,
    seconds: 4,
    text: `beat ${id}`,
    picks: { cameraMotion: "dolly-in" },
  })

  it("stores the beats on that shot alone", () => {
    const before = prod([stillOnly("a"), stillOnly("b")])
    const prev = before.shots
    const { production } = beatsHandlers.set_beats(
      before,
      { op: "set_beats", shotId: "a", beats: [beat("b1"), beat("b2")] },
      ctx,
    )
    expect(production.shots[0].beats?.length).toBe(2)
    expect(production.shots[1].beats).toBeUndefined()
    expect(Object.is(prev, production.shots)).toBe(false)
  })

  it("copies every beat and its picks — never aliases the caller's objects", () => {
    const before = prod([stillOnly("a")])
    const beats = [beat("b1")]
    const { production } = beatsHandlers.set_beats(
      before,
      { op: "set_beats", shotId: "a", beats },
      ctx,
    )
    const stored = production.shots[0].beats
    expect(stored?.[0]).toEqual(beats[0])
    expect(Object.is(stored?.[0], beats[0])).toBe(false)
    expect(Object.is(stored?.[0]?.picks, beats[0].picks)).toBe(false)
  })

  it("an empty list DELETES the field — a beat-less shot serializes byte-identical", () => {
    const before = prod([{ ...stillOnly("a"), beats: [beat("b1")] }])
    const { production } = beatsHandlers.set_beats(
      before,
      { op: "set_beats", shotId: "a", beats: [] },
      ctx,
    )
    expect("beats" in production.shots[0]).toBe(false)
  })

  it("clearing a shot that has none changes nothing (no re-render churn)", () => {
    const before = prod([stillOnly("a")])
    const prev = before.shots
    const { production, warnings } = beatsHandlers.set_beats(
      before,
      { op: "set_beats", shotId: "a", beats: [] },
      ctx,
    )
    expect(Object.is(prev, production.shots)).toBe(true)
    expect(warnings?.length).toBe(1)
  })

  it("keeps a beat without picks exactly as it came", () => {
    const before = prod([stillOnly("a")])
    const bare: ShotBeat = { id: "b1", seconds: 2.5, text: "" }
    const { production } = beatsHandlers.set_beats(
      before,
      { op: "set_beats", shotId: "a", beats: [bare] },
      ctx,
    )
    expect(production.shots[0].beats?.[0]).toEqual(bare)
    expect("picks" in (production.shots[0].beats?.[0] ?? {})).toBe(false)
  })

  it("names the shot in its receipt", () => {
    const before = prod([stillOnly("a")])
    expect(
      beatsHandlers.set_beats(
        before,
        { op: "set_beats", shotId: "a", beats: [beat("b1"), beat("b2")] },
        ctx,
      ).receipt,
    ).toEqual({ op: "set_beats", summary: "Set 2 beats on Shot 1." })
    expect(
      beatsHandlers.set_beats(
        prod([{ ...stillOnly("a"), beats: [beat("b1")] }]),
        { op: "set_beats", shotId: "a", beats: [] },
        ctx,
      ).receipt.summary,
    ).toBe("Cleared the beats on Shot 1.")
  })

  it("throws op_target_missing for a shot that is not in the production", () => {
    const before = prod([stillOnly("a")])
    expect(() =>
      beatsHandlers.set_beats(
        before,
        { op: "set_beats", shotId: "nope", beats: [beat("b1")] },
        ctx,
      ),
    ).toThrow(OpError)
  })

  it("carries a beat's chips and audio cues through untouched", () => {
    const rich: ShotBeat = {
      id: "b1",
      seconds: 6,
      text: "@kira turns",
      references: [
        {
          id: "ref-1",
          defaultName: "Kira",
          source: "wired-character",
          url: "https://r2.example/kira.png",
        },
      ],
      directions: [{ kind: "sfx", text: "thunder" }],
      transition: { id: "cross-dissolve" },
      characterFx: { id: "werewolf" },
      label: "Beginning of the turn",
    }
    const parsed = beatsOpSchemas.set_beats.safeParse({
      op: "set_beats",
      shotId: "a",
      beats: [rich],
    })
    expect(parsed.success).toBe(true)
    const { production } = beatsHandlers.set_beats(
      prod([stillOnly("a")]),
      { op: "set_beats", shotId: "a", beats: [rich] },
      ctx,
    )
    expect(production.shots[0].beats?.[0]).toEqual(rich)
  })
})

// ── the section's own contract ───────────────────────────────────────────────

describe("the beats section", () => {
  it("declares a confirmation class for every op it declares", () => {
    expect(Object.keys(beatsOpClasses)).toEqual(Object.keys(beatsOpSchemas))
    const classes: ReadonlyArray<OpClass> = Object.values(beatsOpClasses)
    expect(classes).toEqual(["S", "S", "S"])
  })

  it("declares a handler for every op it declares", () => {
    expect(Object.keys(beatsHandlers)).toEqual(Object.keys(beatsOpSchemas))
  })
})
