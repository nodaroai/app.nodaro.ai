import { describe, it, expect } from "vitest"

import {
  applyBeatSettings,
  beatSettings,
  beatSkeleton,
  clampBeatsToBudget,
  describeSettings,
  frameSettingsFromResult,
  isEmptySettings,
  motionSettingsFromResult,
  sceneSettings,
} from "../scene-settings"
import type { Shot, ShotClipResult } from "../shot"
import { pickerByKey } from "../look-pickers"

/**
 * The rule the whole feature rests on: a copy carries SETTINGS, never prose.
 * Everything else is bookkeeping around it.
 */
const mint = (i: number) => `beat-${i}`

const shot = (over: Partial<Shot> = {}): Shot => ({
  id: "s3",
  still: {
    nodeId: "n1",
    url: "https://r2/b.png",
    provider: "nano-banana",
    prompt: "the knight, dawn",
    results: [
      {
        url: "https://r2/a.png",
        prompt: "the knight",
        provider: "qwen",
        aspectRatio: "1:1",
        resolution: "1k",
      },
      {
        url: "https://r2/b.png",
        prompt: "the knight, dawn",
        provider: "nano-banana",
        aspectRatio: "16:9",
        resolution: "2k",
        count: 4,
        negativePrompt: "blur",
        referenceImageUrls: ["https://r2/ref.png"],
      },
    ],
    activeIndex: 1,
  },
  clip: {
    nodeId: "n2",
    url: "https://r2/take.mp4",
    provider: "seedance-2",
    prompt: "he turns",
    results: [
      {
        url: "https://r2/take.mp4",
        provider: "seedance-2",
        prompt: "he turns",
        duration: 8,
        aspectRatio: "21:9",
        resolution: "720p",
        beats: [
          { id: "old-1", seconds: 4, text: "he turns", label: "the turn" },
          { id: "old-2", seconds: 4, text: "he runs", picks: { lighting: "noir" } },
        ],
      },
    ],
    activeIndex: 0,
  },
  look: { atmosphere: "fog" },
  ...over,
})

describe("scene settings — what a copy carries", () => {
  it("takes an OPTION's own levers, model and references", () => {
    // Each image in a scene records what made it, so a copy can name which one
    // it means rather than averaging the scene.
    expect(frameSettingsFromResult(shot().still!.results![1])).toEqual({
      provider: "nano-banana",
      aspectRatio: "16:9",
      resolution: "2k",
      count: 4,
      negativePrompt: "blur",
      referenceImageUrls: ["https://r2/ref.png"],
    })
  })

  it("never carries the prompt — that is the work, not the setup", () => {
    const frame = frameSettingsFromResult(shot().still!.results![1])
    expect(JSON.stringify(frame)).not.toContain("knight")
  })

  it("copies the shot breakdown as a SKELETON: timing and picks, no writing", () => {
    const motion = motionSettingsFromResult(shot().clip!.results![0], shot(), mint)
    expect(motion?.beats).toEqual([
      { id: "beat-0", seconds: 4, text: "" },
      { id: "beat-1", seconds: 4, text: "", picks: { lighting: "noir" } },
    ])
    // Fresh ids: the copy is a new list, not a second reference to scene 3's.
    expect(motion?.beats?.map((b) => b.id)).not.toContain("old-1")
  })

  it("carries the scene's END TRANSITION — the take's own, else the scene's", () => {
    // How a scene GOES OUT is SETUP, not writing — the same rule that carries
    // every per-beat `transition` in the skeleton — so it travels with the motion
    // settings. Same rung order as the reference channels: the take's own when it
    // recorded one, else the scene's live pick (an un-rendered scene still has
    // one worth taking).
    const take: ShotClipResult = {
      url: "https://r2/c.mp4",
      endTransition: { id: "fade-to-black" },
    }
    expect(
      motionSettingsFromResult(take, shot({ endTransition: { id: "cut" } }), mint)
        ?.endTransition,
    ).toEqual({ id: "fade-to-black" })
    expect(
      motionSettingsFromResult(undefined, { id: "s4", endTransition: { id: "cut" } }, mint),
    ).toEqual({ endTransition: { id: "cut" } })
    // …and a copy of it is a COPY: the source's node is never handed out by
    // reference.
    const source = shot({ endTransition: { id: "cut" } })
    expect(
      motionSettingsFromResult(undefined, source, mint)?.endTransition,
    ).not.toBe(source.endTransition)
  })

  it("falls back to the SCENE's reference channels for a scene that never rendered", () => {
    // A take records the references it used; the channels belong to the scene,
    // and an un-rendered scene still has settings worth taking.
    const unrendered: Shot = {
      id: "s4",
      directingReferenceUrls: ["https://r2/x.png"],
      directingReferenceVideoUrls: ["https://r2/move.mp4"],
    }
    expect(motionSettingsFromResult(undefined, unrendered, mint)).toEqual({
      referenceImageUrls: ["https://r2/x.png"],
      referenceVideoUrls: ["https://r2/move.mp4"],
    })
  })

  it("reads the scene's ACTIVE option and take by default, or a named one", () => {
    const active = sceneSettings(shot(), mint)
    expect(active.frame?.provider).toBe("nano-banana") // activeIndex 1
    expect(active.motion?.duration).toBe(8)
    expect(active.look).toEqual({ atmosphere: "fog" })

    const first = sceneSettings(shot(), mint, { stillIndex: 0 })
    expect(first.frame?.provider).toBe("qwen")
    expect(first.frame?.resolution).toBe("1k")
  })

  it("a shot's own settings are its window and its picks", () => {
    expect(
      beatSettings({ id: "b1", seconds: 6, text: "he runs", picks: { mood: "tense" } }),
    ).toEqual({ seconds: 6, picks: { mood: "tense" } })
  })

  it("reports an empty scene as nothing to copy", () => {
    expect(isEmptySettings(sceneSettings({ id: "blank" }, mint))).toBe(true)
    expect(isEmptySettings(sceneSettings(shot(), mint))).toBe(false)
  })

  it("says what it will bring, in words, before it happens", () => {
    // "Copy settings" without a receipt is a promise the user can't check.
    const lines = describeSettings(sceneSettings(shot(), mint), (id) =>
      id === "nano-banana" ? "Nano Banana" : id,
    )
    expect(lines).toContain("Frame: Nano Banana · 16:9 · 2k · 4 options")
    expect(lines).toContain("Frame: 1 reference")
    expect(lines).toContain("Motion: 2 shots (timing only)")
    expect(lines).toContain("Scene look: 1 pick")
    // The way OUT travels too, so the receipt has to say so — the rule the
    // per-beat transitions above are named under.
    expect(
      describeSettings(
        { motion: { endTransition: { id: "fade-to-black" } } },
        (id) => id,
      ),
    ).toContain("Motion: end transition")
  })

  it("fits a copied breakdown into the landing model's budget", () => {
    // Scene 3's 30s plan onto a 10s model must not arrive as an impossible
    // total: trim in order, drop what no longer fits rather than keep it at 0.
    const plan = [
      { id: "a", seconds: 10, text: "" },
      { id: "b", seconds: 10, text: "" },
      { id: "c", seconds: 10, text: "" },
    ]
    expect(clampBeatsToBudget(plan, 10, 2)).toEqual([{ id: "a", seconds: 10, text: "" }])
    expect(clampBeatsToBudget(plan, 15, 2)).toEqual([
      { id: "a", seconds: 10, text: "" },
      { id: "b", seconds: 5, text: "" },
    ])
    // Already fits ⇒ untouched, by identity (the common case copies verbatim).
    expect(clampBeatsToBudget(plan, 30, 2)).toBe(plan)
  })

  it("lands one shot's window WITHOUT dropping its siblings", () => {
    // The bug this pins: running the whole list through the budget after
    // patching one shot deletes the shots that no longer fit — with their
    // writing, and beats have no bin. The window bends; the scene does not.
    const scene = [
      { id: "b1", seconds: 4, text: "mine" },
      { id: "b2", seconds: 4, text: "also mine" },
      { id: "b3", seconds: 4, text: "and mine" },
    ]
    const durations = [4, 5, 6, 8, 10] // a 10s budget
    const out = applyBeatSettings(scene, "b1", { seconds: 30 }, durations)
    expect(out.beats).toHaveLength(3)
    expect(out.beats.map((b) => b.text)).toEqual(["mine", "also mine", "and mine"])
    // 10s budget − 8s of siblings ⇒ the largest window that still fits.
    expect(out.seconds).toBe(2)
    expect(out.beats[0].seconds).toBe(out.seconds)
  })

  it("a shot's Character FX node copies with its settings, like its transition does", () => {
    const fx = { id: "werewolf", position: "start" }
    const beat = { id: "b1", seconds: 4, text: "mine", characterFx: fx }
    expect(beatSettings(beat)?.characterFx).toEqual(fx)
    const landed = applyBeatSettings(
      [{ id: "t1", seconds: 4, text: "theirs" }],
      "t1",
      { seconds: 4, characterFx: fx },
      [4, 5, 6, 8, 10],
    )
    expect(landed.beats[0]).toMatchObject({ text: "theirs", characterFx: fx })
    // …and a copied skeleton keeps it — it is setup, not writing.
    expect(beatSkeleton([beat], (i) => `n${i}`)?.[0]).toMatchObject({ text: "", characterFx: fx })
  })

  it("lands a fractional copied window as typed, and a too-long one on the exact room", () => {
    const scene = [
      { id: "b1", seconds: 4, text: "" },
      { id: "b2", seconds: 4.5, text: "" },
    ]
    const durations = [4, 5, 6, 8, 10, 15]
    expect(applyBeatSettings(scene, "b1", { seconds: 1.2 }, durations).seconds).toBe(1.2)
    // 15s budget − 4.5s sibling ⇒ 10.5s, not the 10s a whole-second ladder gives.
    expect(applyBeatSettings(scene, "b1", { seconds: 30 }, durations).seconds).toBe(10.5)
  })

  it("takes the copied window whole when it fits", () => {
    const scene = [{ id: "b1", seconds: 4, text: "" }]
    const out = applyBeatSettings(scene, "b1", { seconds: 8, picks: { mood: "grim" } }, [
      4, 5, 6, 8, 10,
    ])
    expect(out.seconds).toBe(8)
    expect(out.beats[0]).toEqual({
      id: "b1",
      seconds: 8,
      text: "",
      picks: { mood: "grim" },
    })
  })

  it("leaves the list alone when the target shot is gone", () => {
    const scene = [{ id: "b1", seconds: 4, text: "mine" }]
    expect(applyBeatSettings(scene, "deleted", { seconds: 8 }, [4, 8]).beats).toBe(scene)
  })

  it("skeletons nothing when there are no shots", () => {
    expect(beatSkeleton(undefined, mint)).toBeUndefined()
    expect(beatSkeleton([], mint)).toBeUndefined()
  })
})

/**
 * G10 — A COPY CARRIES IDS, NEVER CATALOG PROSE.
 *
 * The reason the copy exists at all: paste a scene's setup, re-generate, and
 * get today's catalog wording rather than the phrasing frozen into an old
 * prompt. That only holds if the copy travels as picker ids — and if the ids it
 * takes are the ones that actually PRODUCED the named option, not whatever the
 * source scene has been re-picked to since.
 */
describe("scene settings — the look travels as ids (G10)", () => {
  const LOOK = { colorLookId: "warm", atmosphereId: ["fog"] }

  it("takes the look ids off the OPTION, with its prompt format", () => {
    const f = frameSettingsFromResult({
      url: "https://r2/a.png",
      provider: "qwen",
      promptFormat: 2,
      look: LOOK,
    })
    expect(f?.look).toEqual(LOOK)
    expect(f?.promptFormat).toBe(2)
  })

  it("takes the take's look ids too", () => {
    const m = motionSettingsFromResult(
      {
        url: "https://r2/t.mp4",
        provider: "seedance-2",
        promptFormat: 2,
        look: { ...LOOK, cameraMotionId: "dolly-in" },
      },
      undefined,
      mint,
    )
    expect(m?.look).toEqual({ ...LOOK, cameraMotionId: "dolly-in" })
    expect(m?.promptFormat).toBe(2)
  })

  it("carries the layer split too, without changing what a copy APPLIES (D-A1)", () => {
    // The split rides along so a copy does not quietly lose which surface each
    // id came from. What the copy DOES is untouched: it hands over the scene
    // look, and the film half of a copy is still unmodelled — asserted here so
    // the carry-only decision cannot drift into a silent film write.
    const filmLook = { colorLookId: "warm" }
    const sceneLook = { atmosphereId: ["fog"] }
    const result = {
      url: "https://r2/a.png",
      provider: "qwen",
      promptFormat: 2 as const,
      look: LOOK,
      filmLook,
      sceneLook,
    }
    const f = frameSettingsFromResult(result)
    expect(f?.filmLook).toEqual(filmLook)
    expect(f?.sceneLook).toEqual(sceneLook)

    const m = motionSettingsFromResult(
      { ...result, url: "https://r2/t.mp4", provider: "seedance-2" },
      undefined,
      mint,
    )
    expect(m?.filmLook).toEqual(filmLook)
    expect(m?.sceneLook).toEqual(sceneLook)

    const s = sceneSettings(
      shot({
        still: {
          nodeId: "n1",
          url: "https://r2/a.png",
          provider: "qwen",
          prompt: "the knight",
          results: [{ ...result, prompt: "the knight" }],
          activeIndex: 0,
        },
      }),
      mint,
    )
    // The scene-level look is still the OPTION's merged ids — no new top-level
    // layer key, and no change to what the paste applies.
    expect(s.look).toEqual(LOOK)
    expect(s).not.toHaveProperty("filmLook")
    expect(s).not.toHaveProperty("sceneLook")
  })

  it("F5: the scene look is the OPTION's, not the live one it was re-picked to", () => {
    // Copying "the settings of scene 3" after changing its look used to hand
    // over ids that never made that image.
    const s = sceneSettings(
      shot({
        look: { colorLookId: "cold" },
        still: {
          nodeId: "n1",
          url: "https://r2/a.png",
          provider: "qwen",
          prompt: "the knight",
          results: [
            {
              url: "https://r2/a.png",
              prompt: "the knight",
              promptFormat: 2,
              look: LOOK,
            },
          ],
          activeIndex: 0,
        },
      }),
      mint,
    )
    expect(s.look).toEqual(LOOK)
  })

  it("falls back to the LIVE scene look for a legacy option", () => {
    // A pre-S2 option has no ids of its own — the scene's own look is the best
    // answer there, and clearing would be strictly worse than the old behavior.
    const s = sceneSettings(shot({ look: { colorLookId: "cold" } }), mint)
    expect(s.look).toEqual({ colorLookId: "cold" })
  })

  it("carries NO catalog prose anywhere in the copy", () => {
    const s = sceneSettings(
      shot({
        still: {
          nodeId: "n1",
          url: "https://r2/a.png",
          provider: "qwen",
          prompt: "the knight",
          results: [
            {
              url: "https://r2/a.png",
              prompt: "the knight",
              promptFormat: 2,
              look: { colorLookId: "warm" },
            },
          ],
          activeIndex: 0,
        },
      }),
      mint,
    )
    const blob = JSON.stringify(s)
    const warm = pickerByKey("colorLookId")!.getHint("warm")
    if (warm) expect(blob).not.toContain(warm)
    // The id itself IS there — that is the whole point.
    expect(blob).toContain("warm")
  })

  it("describeSettings names a stage's own look picks", () => {
    const lines = describeSettings(
      { frame: { look: LOOK, provider: "qwen" } },
      (id) => id,
    )
    expect(lines.some((l) => /Frame: 2 look picks/.test(l))).toBe(true)
  })
})

describe("scene settings — an imported scene can be copied before it renders", () => {
  /** A scene as an import lands it: a plan, shots, no results. */
  const imported: Shot = {
    id: "s9",
    plan: {
      frame: {
        prompt: "@Natalie sprints down a narrow Roman alley",
        provider: "gpt-image-2",
        aspectRatio: "16:9",
        count: 2,
      },
      motion: {
        prompt: "she keeps running",
        provider: "seedance-2",
        duration: 10,
        cameraMotionId: "tracking-shot",
      },
    },
    beats: [{ id: "b1", seconds: 4, text: "she sprints toward camera" }],
    look: { atmosphereId: ["fog"] },
  }

  it("takes the plan's levers when the stage has no result", () => {
    const s = sceneSettings(imported, mint)
    expect(s.frame).toEqual({ provider: "gpt-image-2", aspectRatio: "16:9", count: 2 })
    expect(s.motion?.provider).toBe("seedance-2")
    expect(s.motion?.duration).toBe(10)
  })

  it("still carries the scene's own shots and look beside the plan", () => {
    const s = sceneSettings(imported, mint)
    expect(s.motion?.beats).toEqual([{ id: "beat-0", seconds: 4, text: "" }])
    expect(s.look).toEqual({ atmosphereId: ["fog"] })
  })

  it("carries no prose — a plan-sourced copy obeys SETTINGS, NOT PROSE", () => {
    const s = sceneSettings(imported, mint)
    expect("prompt" in s.frame!).toBe(false)
    expect("prompt" in s.motion!).toBe(false)
    expect("cameraMotionId" in s.motion!).toBe(false)
    expect(s.motion?.beats?.[0].text).toBe("")
  })

  it("prefers what the scene ACTUALLY rendered with over what it planned", () => {
    // A scene rendered after import shows its render, not its plan.
    const rendered = { ...shot(), plan: imported.plan }
    const s = sceneSettings(rendered, mint)
    expect(s.frame?.provider).toBe("nano-banana")
    expect(s.motion?.provider).toBe("seedance-2")
    expect(s.motion?.duration).toBe(8)
  })

  it("leaves a plan-less scene exactly as it was", () => {
    // Pinned, not self-compared: the motion branch changed shape (a merge plus
    // a non-empty gate), so this is what protects copy-settings in production.
    const s = sceneSettings(shot(), mint)
    expect(s.frame?.provider).toBe("nano-banana")
    expect(s.motion?.provider).toBe("seedance-2")
    expect(s.motion?.duration).toBe(8)
    expect(s.motion?.beats).toHaveLength(2)
    expect(s.look).toEqual({ atmosphere: "fog" })
    expect(sceneSettings({ id: "bare" }, mint)).toEqual({})
  })
})

/**
 * THE CAST PINS travel with a copy (cast registry, D6f / C4) — setup in exactly
 * this file's sense: which view of each role the scene uses, never what it says.
 */
describe("copy settings — the scene's cast pins", () => {
  const pinned = {
    id: "s1",
    castLook: {
      abi: { url: "https://r2.example/hat.png", label: "hat" },
      park: { url: "https://r2.example/dusk.png" },
    },
  } as const

  it("carries the pins verbatim, and copies rather than aliasing", () => {
    const s = sceneSettings(pinned, mint)
    expect(s.castLook).toEqual(pinned.castLook)
    expect(s.castLook).not.toBe(pinned.castLook)
  })

  it("a scene with ONLY pins is not 'nothing to copy'", () => {
    expect(isEmptySettings(sceneSettings(pinned, mint))).toBe(false)
  })

  it("an un-pinned scene carries no `castLook` key at all", () => {
    expect(sceneSettings({ id: "bare" }, mint).castLook).toBeUndefined()
    expect(sceneSettings({ id: "empty", castLook: {} }, mint).castLook).toBeUndefined()
  })

  it("the receipt SAYS so — a copy with no blurb is a promise with no receipt", () => {
    const lines = describeSettings(sceneSettings(pinned, mint), (id) => id)
    expect(lines).toContain("Cast: 2 pinned looks")
  })
})
