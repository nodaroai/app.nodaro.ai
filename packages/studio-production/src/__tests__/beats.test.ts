import { describe, it, expect } from "vitest"
import { videoDurationOptions, videoModelOptions } from "../model-menu"

import {
  BEATS_AUTHOR_CAP_SECONDS,
  beatSecondsOptions,
  beatsCapSeconds,
  beatsFilledToFloor,
  beatsTotalSeconds,
  beatsWithAnother,
  canAddBeat,
  clampBeatSeconds,
  foldBeatsPrompt,
  formatSeconds,
  stripEndTransition,
  withEndTransition,
  nextBeatSeconds,
  renderFloor,
  snapBeatsDuration,
} from "../beats"
import { endTransitionClause, transitionDimensionsFor } from "../transition"
import {
  CAMERA_MOVEMENT_KEY,
  cameraMovementPicker,
  pickerByKey,
} from "../look-pickers"
import {
  composeTransitionHintFromConnections,
  getCharacterFxTerm,
  getTransitionTerm,
} from "@nodaro/prompts"
import { VIDEO_HINT_MODE } from "../direction"
import type { ShotBeat } from "../shot"

describe("motion-beats fold (editor-v2)", () => {
  const beats: ReadonlyArray<ShotBeat> = [
    { id: "b1", seconds: 2, label: "Start image", text: "The button is clicked." },
    { id: "b2", seconds: 4, text: "She is pulled backward." },
  ]

  it("folds ordered windows into one plain prompt", () => {
    expect(foldBeatsPrompt(beats, VIDEO_HINT_MODE)).toBe(
      "0-2s — Start image: The button is clicked.\n2-6s — She is pulled backward.",
    )
  })

  it("folds a beat's picks as REAL catalog hint clauses inside its window", () => {
    const angle = pickerByKey("framingAngleId")!
    const id = angle.catalog[0].id
    const hint = angle.getHint(id)
    expect(hint).toBeTruthy()
    const withPicks: ShotBeat[] = [
      { id: "b1", seconds: 3, text: "She turns.", picks: { framingAngleId: id } },
      { id: "b2", seconds: 2, text: "She runs." },
    ]
    expect(foldBeatsPrompt(withPicks, VIDEO_HINT_MODE)).toBe(
      `0-3s — She turns., ${hint}.\n3-5s — She runs.`,
    )
  })

  it("a LONE shot folds to its prose — no time window", () => {
    // Opening a scene in the shots editor must not change what a one-shot
    // generation sends: one shot IS the scene, so there is no window to
    // describe and the prompt stays what the plain box would have submitted.
    const angle = pickerByKey("framingAngleId")!
    const id = angle.catalog[0].id
    expect(
      foldBeatsPrompt([
        { id: "b1", seconds: 4, text: "She turns.", picks: { framingAngleId: id } },
      ], VIDEO_HINT_MODE),
    ).toBe(`She turns., ${angle.getHint(id)}`)
    // ...and an untouched one folds to nothing at all.
    expect(foldBeatsPrompt([{ id: "b1", seconds: 4, text: "" }], VIDEO_HINT_MODE)).toBe("")
  })

  it("an empty-prose beat still advances the clock but emits no window", () => {
    const sparse: ShotBeat[] = [
      { id: "b1", seconds: 2, text: "" },
      { id: "b2", seconds: 3, text: "Impact." },
    ]
    expect(foldBeatsPrompt(sparse, VIDEO_HINT_MODE)).toBe("2-5s — Impact.")
    expect(beatsTotalSeconds(sparse)).toBe(5)
  })

  // The transition node's whole point is reaching the render. Each of these was
  // a way it silently did not.
  it("folds the catalog's TERM, never the tile's label", () => {
    // 25 of the 82 rows word differently in a prompt than on screen. Folding the
    // label would send the model a different instruction than the scene-level
    // picker does for the very same pick, so this asserts against the catalog's
    // own helper rather than a copied string.
    const iris = pickerByKey("transitionId")!
    const term = getTransitionTerm("iris")
    expect(term).toBeTruthy()
    expect(term).not.toBe(iris.getLabel("iris")) // the divergence is real
    expect(
      foldBeatsPrompt(
        [
          { id: "b1", seconds: 3, text: "The diver pushes off.", transition: { id: "iris" } },
          { id: "b2", seconds: 2, text: "She surfaces." },
        ],
        VIDEO_HINT_MODE,
      ),
    ).toBe(`0-3s — ${term}. The diver pushes off.\n3-5s — She surfaces.`)
  })

  it("a transition LEADS its window, levers and all", () => {
    const term = getTransitionTerm("cross-dissolve")
    expect(
      foldBeatsPrompt(
        [
          {
            id: "b1",
            seconds: 3,
            text: "The diver pushes off.",
            // Two levers, as catalog ids — the platform composes their clauses.
            transition: { id: "cross-dissolve", position: "start", duration: "short" },
          },
          { id: "b2", seconds: 2, text: "She surfaces." },
        ],
        VIDEO_HINT_MODE,
      ),
    ).toBe(
      `0-3s — ${composeTransitionHintFromConnections("cross-dissolve", [], [], { position: "start", duration: "short" }, "compact")}. The diver pushes off.\n3-5s — She surfaces.`,
    )
    // …and those clauses are the catalog's own words, not ours.
    expect(term).toBe("cross-dissolve")
  })

  it("the catalog's own Auto row folds to nothing at all", () => {
    // "auto" means "model decides" — it must fold to exactly what an untouched
    // beat does, or the absence of a choice is described to the model as one.
    const auto: ShotBeat[] = [
      { id: "b1", seconds: 3, text: "The diver pushes off.", transition: { id: "auto" } },
      { id: "b2", seconds: 2, text: "She surfaces." },
    ]
    const untouched: ShotBeat[] = [
      { id: "b1", seconds: 3, text: "The diver pushes off." },
      { id: "b2", seconds: 2, text: "She surfaces." },
    ]
    expect(foldBeatsPrompt(auto, VIDEO_HINT_MODE)).toBe(
      foldBeatsPrompt(untouched, VIDEO_HINT_MODE),
    )
  })

  it("a LONE shot's transition still reaches the prompt", () => {
    // The lone-shot path skips the time window, and skipped the transition with
    // it — on the one shot whose transition is MOST likely set, because it is
    // the scene's own way in.
    expect(
      foldBeatsPrompt(
        [{ id: "b1", seconds: 4, text: "She turns.", transition: { id: "whip-pan" } }],
        VIDEO_HINT_MODE,
      ),
    ).toBe(`${getTransitionTerm("whip-pan")}. She turns.`)
  })

  it("a prose-less window is TERMINATED, so it can't fuse with the next stamp", () => {
    // "Hold, then whip-pan in" is a shot with nothing written in it. Dropping it
    // for having no text discards the only thing the user chose — and emitting
    // it unterminated is worse than dropping it: `Fade to Black 2-5s` reads as
    // one phrase, a fade with a bogus three-second offset welded to its name.
    const sparse: ShotBeat[] = [
      { id: "b1", seconds: 2, text: "", transition: { id: "fade-to-black" } },
      { id: "b2", seconds: 3, text: "Impact." },
    ]
    expect(foldBeatsPrompt(sparse, VIDEO_HINT_MODE)).toBe(
      `0-2s — ${getTransitionTerm("fade-to-black")}.\n2-5s — Impact.`,
    )
  })

  it("a picks-only window earns one too — a window folds iff it has a body", () => {
    // Pre-existing, and the reason the guard is now the body itself rather than
    // a list of fields: a shot with only its cinematic pills set vanished, and
    // every later window's stamp slid over to cover the gap.
    const angle = pickerByKey("framingAngleId")!
    const id = angle.catalog[0].id
    const sparse: ShotBeat[] = [
      { id: "b1", seconds: 2, text: "", picks: { framingAngleId: id } },
      { id: "b2", seconds: 3, text: "Impact." },
    ]
    expect(foldBeatsPrompt(sparse, VIDEO_HINT_MODE)).toBe(
      `0-2s — ${angle.getHint(id)}.\n2-5s — Impact.`,
    )
  })

  it("every window is TERMINATED, so its prose can't run into the next stamp", () => {
    // The bug as shipped: a shot whose prose has no full stop — most of them,
    // since the Camera Movement pill folds LAST as a bare term — ran straight
    // into the next shot's stamp: `… walking together, orbit left 6-14s — …`.
    // Read as one phrase, that is an orbit with a six-second offset welded on,
    // and the two shots have no boundary at all. Every window body now ends a
    // sentence, and each window sits on its own line.
    const movement = cameraMovementPicker()
    const motion = movement.catalog.find((m) => movement.getTerm(m.id).length > 0)!
    const beats: ShotBeat[] = [
      {
        id: "b1",
        seconds: 6,
        text: "Iris and Ana walking together",
        picks: { [CAMERA_MOVEMENT_KEY]: motion.id },
      },
      { id: "b2", seconds: 8, text: "They start running fast" },
    ]
    expect(foldBeatsPrompt(beats, VIDEO_HINT_MODE)).toBe(
      `0-6s — Iris and Ana walking together, ${movement.getTerm(motion.id)}.\n6-14s — They start running fast.`,
    )
  })

  it("prose that already ends a sentence gains no second stop", () => {
    const beats: ShotBeat[] = [
      { id: "b1", seconds: 2, text: "Run!" },
      { id: "b2", seconds: 2, text: "Where to?" },
      { id: "b3", seconds: 2, text: 'She whispers "now."' },
      { id: "b4", seconds: 2, text: "And then…" },
    ]
    expect(foldBeatsPrompt(beats, VIDEO_HINT_MODE)).toBe(
      `0-2s — Run!\n2-4s — Where to?\n4-6s — She whispers "now."\n6-8s — And then…`,
    )
  })

  it("a multi-line shot keeps its own line breaks inside its window", () => {
    // A chip followed by Enter is how the second shot in the report was typed
    // (`Image 6⏎They start running fast.`) — the window wraps it, never
    // flattens it.
    const beats: ShotBeat[] = [
      { id: "b1", seconds: 2, text: "Wide." },
      { id: "b2", seconds: 2, text: "The beach\nThey start running fast." },
    ]
    expect(foldBeatsPrompt(beats, VIDEO_HINT_MODE)).toBe(
      "0-2s — Wide.\n2-4s — The beach\nThey start running fast.",
    )
  })

  it("a shot's unplaced cues fold as neutral tokens at the end of its window (D5/D6)", () => {
    // A cue the user picked but never typed into the prose would be lost at
    // render (the renderer only replaces tokens it FINDS), so the fold places
    // it — and a token already in the prose is never doubled.
    const beats: ShotBeat[] = [
      {
        id: "a",
        seconds: 4,
        text: "she runs [wind]",
        directions: [
          { kind: "sfx", text: "wind" },
          { kind: "music", text: "drums" },
        ],
      },
      { id: "b", seconds: 3, text: "she stops", directions: [{ kind: "speech", text: "Wait!" }] },
    ]
    const folded = foldBeatsPrompt(beats, VIDEO_HINT_MODE)
    expect(folded).toContain("she runs [wind] [drums].")
    // `[Wait!]` already closes a sentence, so the window gains no second stop.
    expect(folded).toContain("she stops [Wait!]")
    expect(folded.match(/\[wind\]/g)).toHaveLength(1)
  })

  it("a lone shot's cues fold too — the bare-content rule places them as well", () => {
    // The one-shot path skips the window but is still the prose the model
    // sees, so a cue with no token has the same nowhere to go.
    expect(
      foldBeatsPrompt(
        [{ id: "a", seconds: 4, text: "she runs", directions: [{ kind: "music", text: "drums" }] }],
        VIDEO_HINT_MODE,
      ),
    ).toBe("she runs [drums]")
  })

  it("snaps the render duration UP to the nearest covering option", () => {
    expect(snapBeatsDuration(7, [5, 10])).toBe(10)
    expect(snapBeatsDuration(5, [5, 10])).toBe(5)
    // Beyond every option → the model's max (never a silent truncate below it).
    expect(snapBeatsDuration(40, [5, 10, 30])).toBe(30)
    expect(snapBeatsDuration(7, [])).toBeUndefined()
  })
})

describe("the shots budget is the MODEL's clip length", () => {
  const durations = (id: string) => videoDurationOptions(id).map((d) => d.value)

  it("reads each model's own ceiling from the catalog", () => {
    // The spread the catalog actually publishes, end to end.
    expect(beatsCapSeconds(durations("seedance-2-5"))).toBe(30)
    expect(beatsCapSeconds(durations("seedance-2"))).toBe(15)
    expect(beatsCapSeconds(durations("veo3"))).toBe(8)
    expect(beatsCapSeconds(durations("minimax"))).toBe(5)
    // No duration lever at all → the authoring fallback, not -Infinity.
    expect(beatsCapSeconds([])).toBe(BEATS_AUTHOR_CAP_SECONDS)
  })

  it("spends the budget down the scene (30s model, 10s first shot → 20s left)", () => {
    const d = durations("seedance-2-5")
    const beats = [
      { seconds: 10 },
      { seconds: 4 },
    ]
    // Shot 1 may grow into everything shot 2 is not using.
    expect(Math.max(...beatSecondsOptions(beats[0], beats, d))).toBe(26)
    // Shot 2's ceiling is the budget minus shot 1 — the user's example.
    expect(Math.max(...beatSecondsOptions(beats[1], beats, d))).toBe(20)
  })

  it("offers every whole second up to the budget, not just the model's clip lengths", () => {
    const veo = durations("veo3") // clips 4, 6, 8 — cap 8
    const beats = [{ seconds: 4 }]
    // A window is prose timing folded into one clip, so it runs every second up
    // to the budget — including the 1, 2, 3, 5, 7 the model can't render as a
    // whole clip on its own.
    expect(beatSecondsOptions(beats[0], beats, veo)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ])
  })

  it("never empties the selector when a shorter-clip model is chosen", () => {
    // Authored 25s on seedance-2-5, then switched to seedance-2 (max 15).
    const beats = [{ seconds: 25 }]
    const opts = beatSecondsOptions(beats[0], beats, durations("seedance-2"))
    expect(opts).toContain(25) // still selectable, so it can be brought down
    expect(opts.filter((o) => o <= 15).length).toBeGreaterThan(0)
  })

  it("stops offering another shot once the budget is spent", () => {
    const d = durations("seedance-2-5")
    expect(canAddBeat([{ seconds: 10 }], d)).toBe(true)
    expect(canAddBeat([{ seconds: 30 }], d)).toBe(false)
    // A single-length model (minimax offers only 5s) fills in one shot.
    expect(canAddBeat([{ seconds: 5 }], durations("minimax"))).toBe(
      false,
    )
  })

  it("EVERY video model can author a scene up to its own maximum", () => {
    // The invariant behind "check all the models": whatever the catalog
    // publishes, a first shot must be able to reach that model's ceiling, and
    // a new shot must open at a length the model can render.
    for (const m of videoModelOptions()) {
      const d = durations(m.id)
      if (d.length === 0) continue
      const cap = beatsCapSeconds(d)
      const first = { id: "b1", seconds: nextBeatSeconds([], d), text: "" }
      expect(d, `${m.id} opens on a renderable length`).toContain(first.seconds)
      expect(
        Math.max(...beatSecondsOptions(first, [first], d)),
        `${m.id} can reach its own ceiling`,
      ).toBe(cap)
    }
  })
})

describe("adding a shot when the budget is already spent", () => {
  // The reported bug: a scene OPENS with one seeded shot at the scene's clip
  // length, and on a model whose longest clip IS that length "+ Add shot" was
  // dead on arrival — a button that reads as broken. Wanting a second shot
  // there means splitting the clip.
  const mk = (seconds: number) => ({ id: `b${seconds}`, seconds, text: "" })

  it("appends normally while there is room", () => {
    const out = beatsWithAnother([mk(4)], [4, 5, 6, 8, 10], (s) => mk(s))
    expect(out).toHaveLength(2)
    expect(out!.map((b) => b.seconds)).toEqual([4, 4])
  })

  it("SPLITS the budget instead of refusing when it is full", () => {
    // One 10s shot on a 10s model: the newcomer takes the shortest window (1s)
    // and the sitting shot gives up exactly that much — nothing is deleted.
    const out = beatsWithAnother([mk(10)], [4, 5, 6, 8, 10], (s) => mk(s))
    expect(out).toHaveLength(2)
    expect(out!.reduce((sum, b) => sum + b.seconds, 0)).toBeLessThanOrEqual(10)
    expect(out![1].seconds).toBe(1)
    expect(out![0].seconds).toBe(9)
  })

  it("keeps every shot's length a whole second within the budget", () => {
    const out = beatsWithAnother([mk(8)], [4, 6, 8], (s) => mk(s))
    for (const b of out!) {
      expect(Number.isInteger(b.seconds)).toBe(true)
      expect(b.seconds).toBeGreaterThanOrEqual(1)
    }
    expect(out!.reduce((sum, b) => sum + b.seconds, 0)).toBeLessThanOrEqual(8)
  })

  it("refuses only when the budget is full and the last shot is already 1s", () => {
    // Nothing left to free: the trailing shot is the 1s minimum and the budget
    // is spent, so even a split can't seat another.
    expect(beatsWithAnother([mk(7), mk(1)], [4, 8], (s) => mk(s))).toBeNull()
    // But a full budget whose last shot still has slack CAN split now that
    // windows go down to 1s — the old blanket refusal was too eager.
    const out = beatsWithAnother([mk(4), mk(4)], [4, 8], (s) => mk(s))
    expect(out).not.toBeNull()
    expect(out!.reduce((sum, b) => sum + b.seconds, 0)).toBeLessThanOrEqual(8)
  })
})

describe("1-second windows and filling to the render floor", () => {
  const durations = (id: string) => videoDurationOptions(id).map((d) => d.value)
  let n = 0
  const mk = (seconds: number): ShotBeat => ({ id: `t${n++}`, seconds, text: "" })

  it("offers a 1s window on every model that has a duration lever", () => {
    for (const m of videoModelOptions()) {
      const d = durations(m.id)
      if (d.length === 0) continue
      const first = mk(nextBeatSeconds([], d))
      expect(
        beatSecondsOptions(first, [first], d),
        `${m.id} offers a 1s window`,
      ).toContain(1)
    }
  })

  it("reports the model's shortest real clip as the render floor", () => {
    expect(renderFloor(durations("seedance-2-5"))).toBe(4)
    expect(renderFloor(durations("kling-3.0"))).toBe(3)
    expect(renderFloor(durations("minimax"))).toBe(5)
    // No duration lever → no real floor to fill to.
    expect(renderFloor([])).toBeUndefined()
  })

  it("appends a filler shot when a window drops the total below the floor", () => {
    // The user's example: one shot at 1s on a 4s-floor model gains a 3s shot 2.
    const out = beatsFilledToFloor([mk(1)], durations("seedance-2-5"), mk)
    expect(out).toHaveLength(2)
    expect(out.map((b) => b.seconds)).toEqual([1, 3])
    expect(out.reduce((s, b) => s + b.seconds, 0)).toBe(4)
  })

  it("fills only the remaining gap, from any total below the floor", () => {
    // Two 1s shots (total 2) on a 4s floor → a 2s filler completes the clip.
    const out = beatsFilledToFloor([mk(1), mk(1)], durations("seedance-2-5"), mk)
    expect(out).toHaveLength(3)
    expect(out[2].seconds).toBe(2)
    expect(out.reduce((s, b) => s + b.seconds, 0)).toBe(4)
  })

  it("leaves a scene that already fills a clip untouched (never fires above the floor)", () => {
    const atFloor = [mk(4)]
    expect(beatsFilledToFloor(atFloor, durations("seedance-2-5"), mk)).toBe(atFloor)
    const above = [mk(6)]
    expect(beatsFilledToFloor(above, durations("seedance-2-5"), mk)).toBe(above)
  })

  it("never fills for a model with no duration lever (no real floor)", () => {
    const beats = [mk(1)]
    expect(beatsFilledToFloor(beats, [], mk)).toBe(beats)
  })
})

/**
 * The beats fold carries the SAME verbosity policy as the rest of the directing
 * prompt: a shot's Camera Movement is an instruction (compact term), while its
 * framing/look picks stay full description. Pinned against the catalog's own
 * getters so a mis-threaded mode shows up as a wrong STRING, not a silent
 * paragraph in the middle of a timed window.
 */
describe("motion-beats fold — verbosity", () => {
  const movement = cameraMovementPicker()
  // A movement whose term genuinely differs from its hint (so the assertion
  // cannot pass on an entry where the two strings coincide).
  const motion = movement.catalog.find(
    (m) =>
      movement.getTerm(m.id).length > 0 &&
      movement.getTerm(m.id) !== movement.getHint(m.id),
  )!

  it("folds a Camera Movement pick to its COMPACT term under the video policy", () => {
    const beat = {
      id: "b1",
      seconds: 4,
      text: "She turns.",
      picks: { [CAMERA_MOVEMENT_KEY]: motion.id },
    }
    expect(foldBeatsPrompt([beat], VIDEO_HINT_MODE)).toBe(
      `She turns., ${movement.getTerm(motion.id)}`,
    )
    // ...and the full hint it replaced is a DIFFERENT, longer string.
    expect(foldBeatsPrompt([beat], "full")).toBe(
      `She turns., ${movement.getHint(motion.id)}`,
    )
  })

  it("keeps a LOOK pick full in the same beat as a compact motion pick", () => {
    const angle = pickerByKey("framingAngleId")!
    const angleId = angle.catalog.find((e) => angle.getHint(e.id).length > 0)!.id
    const folded = foldBeatsPrompt(
      [
        {
          id: "b1",
          seconds: 4,
          text: "She turns.",
          picks: { framingAngleId: angleId, [CAMERA_MOVEMENT_KEY]: motion.id },
        },
      ],
      VIDEO_HINT_MODE,
    )
    expect(folded).toContain(angle.getHint(angleId))
    expect(folded).toContain(movement.getTerm(motion.id))
    expect(folded).not.toContain(movement.getHint(motion.id))
  })
})

/**
 * A transition happens INSIDE its shot's window, so it cannot outlast it. The
 * shot's length moves on its own — shortening a window, splitting the budget
 * for a new shot, copying a shorter shot's settings — so this is derived at the
 * fold rather than clamped wherever `seconds` changes.
 */
describe("a transition cannot outlast the shot it introduces", () => {
  it("drops a duration the window is too short to hold", () => {
    const term = getTransitionTerm("seamless-match")
    // 1.5s of dissolve into a 1s shot: the model would be told to spend longer
    // arriving than the segment lasts.
    expect(
      foldBeatsPrompt(
        [
          {
            id: "b1",
            seconds: 1,
            text: "She turns.",
            transition: { id: "seamless-match", position: "start", duration: "long" },
          },
          { id: "b2", seconds: 8, text: "She runs." },
        ],
        VIDEO_HINT_MODE,
      ),
    ).toBe(
      `0-1s — ${composeTransitionHintFromConnections("seamless-match", [], [], { position: "start" }, "compact")}. She turns.\n1-9s — She runs.`,
    )
  })

  it("keeps one the window CAN hold", () => {
    const term = getTransitionTerm("seamless-match")
    expect(
      foldBeatsPrompt(
        [
          {
            id: "b1",
            seconds: 2,
            text: "She turns.",
            transition: { id: "seamless-match", duration: "medium" },
          },
          { id: "b2", seconds: 8, text: "She runs." },
        ],
        VIDEO_HINT_MODE,
      ),
    ).toBe(
      `0-2s — ${composeTransitionHintFromConnections("seamless-match", [], [], { duration: "medium" }, "compact")}. She turns.\n2-10s — She runs.`,
    )
  })
})

/**
 * The scene's END transition closes the fold — the way OUT of the whole clip,
 * appended to the LAST window (or to a lone shot's prose). It is the scene's,
 * not a shot's, so it survives a split, a merge and a reorder.
 */
describe("the scene's end transition closes the fold", () => {
  const endClause = (t: Parameters<typeof endTransitionClause>[0], s: number) =>
    endTransitionClause(t, s)

  it("ends the LAST window, after that window's own stop", () => {
    expect(
      foldBeatsPrompt(
        [
          { id: "b1", seconds: 4, text: "She turns." },
          { id: "b2", seconds: 6, text: "She runs." },
        ],
        VIDEO_HINT_MODE,
        { id: "fade-to-black" },
      ),
    ).toBe(
      `0-4s — She turns.\n4-10s — She runs. ${endClause({ id: "fade-to-black" }, 10)}.`,
    )
  })

  it("closes a LONE shot's prose too — one shot IS the scene", () => {
    expect(
      foldBeatsPrompt([{ id: "b1", seconds: 4, text: "She turns." }], VIDEO_HINT_MODE, {
        id: "fade-to-black",
      }),
    ).toBe(`She turns. ${endClause({ id: "fade-to-black" }, 4)}.`)
  })

  it("folds byte-identically when the scene has none", () => {
    const beats = [
      { id: "b1", seconds: 4, text: "She turns." },
      { id: "b2", seconds: 6, text: "She runs." },
    ]
    expect(foldBeatsPrompt(beats, VIDEO_HINT_MODE, undefined)).toBe(
      foldBeatsPrompt(beats, VIDEO_HINT_MODE),
    )
    expect(foldBeatsPrompt(beats, VIDEO_HINT_MODE, { id: "auto" })).toBe(
      foldBeatsPrompt(beats, VIDEO_HINT_MODE),
    )
  })

  it("is measured against the WHOLE scene, not the last window", () => {
    // A 3s dissolve out of a 10s scene fits, even though the last window is 2s
    // — the way out belongs to the clip, not to the shot before it.
    expect(
      foldBeatsPrompt(
        [
          { id: "b1", seconds: 8, text: "She turns." },
          { id: "b2", seconds: 2, text: "She runs." },
        ],
        VIDEO_HINT_MODE,
        { id: "fade-to-black", duration: "long" },
      ),
    ).toContain(endClause({ id: "fade-to-black", duration: "long" }, 10))
  })

  it("leaves a between-shot transition leading its own window", () => {
    const folded = foldBeatsPrompt(
      [
        { id: "b1", seconds: 4, text: "She turns." },
        {
          id: "b2",
          seconds: 6,
          text: "She runs.",
          transition: { id: "whip-pan" },
        },
      ],
      VIDEO_HINT_MODE,
      { id: "fade-to-black" },
    )
    expect(folded).toContain(`4-10s — ${getTransitionTerm("whip-pan")}. She runs.`)
    expect(folded.endsWith(`${endClause({ id: "fade-to-black" }, 10)}.`)).toBe(true)
  })

  it("closes prose that ends in whitespace — a textarea's trailing newline", () => {
    // `ENDS_SENTENCE` anchors at the very end and carries no `m` flag, so an
    // untrimmed trailing newline reads as "no stop" and folded a bare `.` onto
    // its own line: `She turns.\n. fade to black…`.
    expect(withEndTransition("She turns.\n", { id: "fade-to-black" }, 10)).toBe(
      `She turns. ${endTransitionClause({ id: "fade-to-black" }, 10)}.`,
    )
    // …and whitespace-ONLY prose is nothing, so the clause stands alone.
    expect(withEndTransition("  \n ", { id: "fade-to-black" }, 10)).toBe(
      `${endTransitionClause({ id: "fade-to-black" }, 10)}.`,
    )
  })

  it("is the whole prose when the shots say nothing at all", () => {
    expect(
      foldBeatsPrompt([{ id: "b1", seconds: 4, text: "" }], VIDEO_HINT_MODE, {
        id: "fade-to-black",
      }),
    ).toBe(`${endClause({ id: "fade-to-black" }, 4)}.`)
  })
})

/**
 * The INVERSE — the seed's half of the pair. A take stores the SUBMITTED
 * string, the clause included, so handing that string back to the box while the
 * scene's pill re-appends the clause would fold it TWICE (and once more per
 * cycle, because the seed always comes from the active take). Exactly the
 * `stripScenePrompt` contract, at the other end of the prose.
 */
describe("stripEndTransition — the seed takes back what the fold appended", () => {
  const END = { id: "fade-to-black", duration: "long" }

  it("takes back the clause the fold appended", () => {
    expect(stripEndTransition(withEndTransition("She turns.", END, 10), END)).toBe(
      "She turns.",
    )
  })

  it("…and the one it appended with the duration DROPPED by the fits-gate", () => {
    // A 3s dissolve doesn't fit a 2s clip, so the fold left the lever out. The
    // strip never learns the length the take was folded at, so it must take
    // back either wording.
    expect(stripEndTransition(withEndTransition("She turns.", END, 2), END)).toBe(
      "She turns.",
    )
  })

  it("strips a clause-only prose back to nothing", () => {
    expect(stripEndTransition(withEndTransition("", END, 10), END)).toBe("")
  })

  it("hands back untouched anything it did not fold", () => {
    const folded = withEndTransition("She turns.", END, 10)
    expect(stripEndTransition("She turns.", END)).toBe("She turns.")
    expect(stripEndTransition(folded, undefined)).toBe(folded)
    // A DIFFERENT node's clause is somebody else's text — conservative, like
    // `stripScenePrompt`: only an exact match of what this node folds comes off.
    expect(stripEndTransition(folded, { id: "whip-pan" })).toBe(folded)
  })
})

/**
 * Windows are TENTHS of a second. The menu still offers whole seconds; a typed
 * length ("Custom…") may be 1.2s. Every rule the whole-second windows obeyed
 * holds at the finer grain: the total cannot exceed the model's budget, a
 * transition cannot outlast its shot, sums never drift into 3.7000000000000002.
 */
describe("shot windows in tenths of a second", () => {
  const upTo15 = Array.from({ length: 15 }, (_, i) => i + 1) // a 15s model, 1s floor
  const lone = [{ id: "b1", seconds: 4, text: "" }]

  it("formats a window's edges without floating-point noise", () => {
    expect(formatSeconds(1.2)).toBe("1.2")
    expect(formatSeconds(0.1 + 0.2)).toBe("0.3")
    expect(formatSeconds(3)).toBe("3")
    expect(formatSeconds(1.25)).toBe("1.3")
  })

  it("folds fractional windows with exact edges", () => {
    const beats: ShotBeat[] = [
      { id: "b1", seconds: 1.2, text: "A." },
      { id: "b2", seconds: 2.5, text: "B." },
      { id: "b3", seconds: 0.3, text: "C." },
    ]
    expect(foldBeatsPrompt(beats, VIDEO_HINT_MODE)).toBe(
      "0-1.2s — A.\n1.2-3.7s — B.\n3.7-4s — C.",
    )
  })

  it("sums windows without drift", () => {
    expect(
      beatsTotalSeconds([
        { id: "a", seconds: 0.1, text: "" },
        { id: "b", seconds: 0.2, text: "" },
      ]),
    ).toBe(0.3)
  })

  describe("a typed window is clamped, never rejected", () => {
    it("rounds to a tenth", () => {
      expect(clampBeatSeconds(1.25, lone[0], lone, upTo15)).toBe(1.3)
    })

    it("cannot exceed the model's budget — 15.2s on a 15s model is 15s", () => {
      expect(clampBeatSeconds(15.2, lone[0], lone, upTo15)).toBe(15)
    })

    it("cannot exceed the room its siblings leave — exactly, with fractional siblings", () => {
      const two = [
        { id: "b1", seconds: 4, text: "" },
        { id: "b2", seconds: 4, text: "" },
      ]
      expect(clampBeatSeconds(12, two[0], two, upTo15)).toBe(11)
      const frac = [
        { id: "b1", seconds: 4, text: "" },
        { id: "b2", seconds: 13.9, text: "" },
      ]
      expect(clampBeatSeconds(5, frac[0], frac, upTo15)).toBe(1.1)
    })

    it("never goes below a tenth", () => {
      expect(clampBeatSeconds(0.04, lone[0], lone, upTo15)).toBe(0.1)
    })

    it("keeps the current window on nonsense, or when the siblings already fill the budget", () => {
      expect(clampBeatSeconds(Number.NaN, lone[0], lone, upTo15)).toBe(4)
      expect(clampBeatSeconds(0, lone[0], lone, upTo15)).toBe(4)
      expect(clampBeatSeconds(-3, lone[0], lone, upTo15)).toBe(4)
      const full = [
        { id: "b1", seconds: 4, text: "" },
        { id: "b2", seconds: 15, text: "" },
      ]
      expect(clampBeatSeconds(2, full[0], full, upTo15)).toBe(4)
    })
  })

  it("the menu stays whole seconds; a fractional window is offered as itself", () => {
    const beats = [
      { id: "b1", seconds: 1.2, text: "" },
      { id: "b2", seconds: 13.9, text: "" },
    ]
    // 15 − 13.9 leaves 1.1s of room: the ladder fits [1]; the shot's own 1.2 is
    // always offered (it is what the shot HAS), and nothing in between.
    expect(beatSecondsOptions(beats[0], beats, upTo15)).toEqual([1, 1.2])
  })

  it("fills the clip with a fractional filler, and never with a sliver below a tenth", () => {
    const floor4 = [4, 5, 6, 8, 10]
    const create = (s: number) => ({ id: "f", seconds: s, text: "" })
    expect(
      beatsFilledToFloor([{ id: "b1", seconds: 1.2, text: "" }], floor4, create),
    ).toEqual([
      { id: "b1", seconds: 1.2, text: "" },
      { id: "f", seconds: 2.8, text: "" },
    ])
    // A window that isn't a tenth can only come from outside the editor (the
    // graph is canvas-editable); the gap it leaves is not worth a shot.
    const odd = [{ id: "b1", seconds: 3.96, text: "" }]
    expect(beatsFilledToFloor(odd, floor4, create)).toBe(odd)
  })

  it("snaps a fractional total UP to the covering render length", () => {
    expect(snapBeatsDuration(14.2, [5, 10, 15])).toBe(15)
    expect(snapBeatsDuration(0.3, [5, 10, 15])).toBe(5)
  })

  it("splits a fractional budget for another shot", () => {
    const rows = [
      { id: "a", seconds: 7.5, text: "" },
      { id: "b", seconds: 7.5, text: "" },
    ]
    const out = beatsWithAnother(rows, upTo15, (s) => ({ id: "c", seconds: s, text: "" }))!
    expect(out.map((b) => b.seconds)).toEqual([7.5, 6, 1])
    expect(beatsTotalSeconds(out)).toBeLessThanOrEqual(15)
  })

  it("a transition cannot outlast a fractional shot either", () => {
    expect(
      transitionDimensionsFor(1.2)
        .find((d) => d.field === "duration")!
        .options.map((o) => o.id),
    ).toEqual(["auto", "instant", "short"])
    const term = getTransitionTerm("seamless-match")
    expect(
      foldBeatsPrompt(
        [
          {
            id: "b1",
            seconds: 1.2,
            text: "She turns.",
            transition: { id: "seamless-match", duration: "long" },
          },
          { id: "b2", seconds: 8, text: "She runs." },
        ],
        VIDEO_HINT_MODE,
      ),
    ).toBe(`0-1.2s — ${term}. She turns.\n1.2-9.2s — She runs.`)
  })
})

describe("a Character FX node on a shot", () => {
  const term = getCharacterFxTerm("werewolf")

  it("folds as the window's trailing hint — after the prose and its picks", () => {
    expect(
      foldBeatsPrompt(
        [
          { id: "b1", seconds: 3, text: "She turns.", characterFx: { id: "werewolf" } },
          { id: "b2", seconds: 2, text: "She runs." },
        ],
        VIDEO_HINT_MODE,
      ),
    ).toBe(`0-3s — She turns., ${term}.\n3-5s — She runs.`)
  })

  it("an effect-only shot still earns its window (a window folds iff it has a body)", () => {
    expect(
      foldBeatsPrompt(
        [
          { id: "b1", seconds: 2, text: "", characterFx: { id: "werewolf" } },
          { id: "b2", seconds: 3, text: "Impact." },
        ],
        VIDEO_HINT_MODE,
      ),
    ).toBe(`0-2s — ${term}.\n2-5s — Impact.`)
  })

  it("the way in, then what happens, then what happens to the subject", () => {
    const enter = getTransitionTerm("cross-dissolve")
    expect(
      foldBeatsPrompt(
        [
          {
            id: "b1",
            seconds: 3,
            text: "She turns.",
            transition: { id: "cross-dissolve" },
            characterFx: { id: "werewolf" },
          },
          { id: "b2", seconds: 2, text: "She runs." },
        ],
        VIDEO_HINT_MODE,
      ),
    ).toBe(`0-3s — ${enter}. She turns., ${term}.\n3-5s — She runs.`)
  })

  it("an unset node folds byte-identically to no node at all", () => {
    const bare: ShotBeat[] = [
      { id: "b1", seconds: 3, text: "She turns." },
      { id: "b2", seconds: 2, text: "She runs." },
    ]
    const auto: ShotBeat[] = [
      { ...bare[0], characterFx: { id: "auto", position: "start" } },
      bare[1],
    ]
    expect(foldBeatsPrompt(auto, VIDEO_HINT_MODE)).toBe(foldBeatsPrompt(bare, VIDEO_HINT_MODE))
  })

  it("an effect chip in the prose folds WHERE it sits, not at the window's end", () => {
    // "Type / where it happens": the chip's place in the sentence is the
    // moment; the platform's composition lands there.
    expect(
      foldBeatsPrompt(
        [
          {
            id: "b1",
            seconds: 3,
            text: "Woman 6 loses her footing and falls, [fx:werewolf] and lies still",
            characterFx: { id: "werewolf" },
          },
          { id: "b2", seconds: 2, text: "She runs." },
        ],
        VIDEO_HINT_MODE,
      ),
    ).toBe(`0-3s — Woman 6 loses her footing and falls, ${term} and lies still.\n3-5s — She runs.`)
  })

  it("a chip folds ONCE — no trailing clause when the token already placed it", () => {
    const folded = foldBeatsPrompt(
      [
        { id: "b1", seconds: 3, text: "She falls, [fx:werewolf]", characterFx: { id: "werewolf" } },
        { id: "b2", seconds: 2, text: "She runs." },
      ],
      VIDEO_HINT_MODE,
    )
    expect(folded.split(term)).toHaveLength(2)
  })

  it("a node WITHOUT a chip (authored before the / command) still folds at the end", () => {
    expect(
      foldBeatsPrompt(
        [
          { id: "b1", seconds: 3, text: "She falls.", characterFx: { id: "werewolf" } },
          { id: "b2", seconds: 2, text: "She runs." },
        ],
        VIDEO_HINT_MODE,
      ),
    ).toBe(`0-3s — She falls., ${term}.\n3-5s — She runs.`)
  })

  it("a LONE shot keeps the lone-shot rule — the clause rides its prose, no window", () => {
    expect(
      foldBeatsPrompt(
        [{ id: "b1", seconds: 4, text: "She turns.", characterFx: { id: "werewolf" } }],
        VIDEO_HINT_MODE,
      ),
    ).toBe(`She turns., ${term}`)
  })
})
