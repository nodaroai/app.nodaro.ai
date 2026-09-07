import { describe, it, expect } from "vitest"

import example from "../fixtures/example.json"
import { EXAMPLE_LIBRARY } from "../fixtures/library"
import { mapDocument, resolveMentions } from "../import"
import { buildFormatRegistry } from "../registry"
import { productionDocumentSchema } from "../schema"

/**
 * Stage 5 of the import pipeline (spec §6.5) — MAP: a repaired document
 * becomes the store's own shots, folders and plans. Split out of
 * `import.test.ts` in the follow-ups fix wave once that file passed the
 * 800-line house cap, one file per pipeline stage.
 *
 * The local builders below are this file's OWN copies rather than an import
 * from a sibling: importing a `.test.ts` file would re-run its `describe`/`it`
 * blocks a second time — the same standalone-with-local-fixtures precedent
 * `production-bundle.recipe.test.ts` set. Every case is a PURE MOVE.
 */

const REGISTRY = buildFormatRegistry()

/** repair is not needed for documents already written in the live vocabulary. */
const mapped = (raw: unknown, library = EXAMPLE_LIBRARY) => {
  const doc = productionDocumentSchema().parse(raw)
  return mapDocument(doc, resolveMentions(doc, library).bindings, REGISTRY)
}

describe("map", () => {
  it("mints a fresh id for every scene and shot", () => {
    const first = mapped(example)
    const second = mapped(example)
    expect(first.shots[0].id).not.toBe(second.shots[0].id)
    expect(first.shots[0].beats?.[0].id).not.toBe(second.shots[0].beats?.[0].id)
  })

  it("carries the framing plan, with the document's `model` as the provider", () => {
    const { shots } = mapped(example)
    expect(shots[0].plan?.frame).toEqual({
      prompt: "@Natalie sprints down a narrow Roman alley, SUV headlights behind her",
      provider: "gpt-image-2",
      aspectRatio: "16:9",
      resolution: "2K",
      count: 2,
      // D7's worked example exercises frame.subject too (D1) — the fixture's
      // own hairColor + outfit picks.
      subject: { hairColor: "hair-auburn", outfit: "outfit-streetwear" },
      references: [
        {
          id: "char-natalie",
          defaultName: "Natalie",
          source: "wired-character",
          url: "https://r2.example/natalie.png",
        },
      ],
    })
  })

  it("carries the framing plan's subject map (D9)", () => {
    const hair = REGISTRY.subject.find((d) => d.field === "hairColor")!.options[0].id
    const { shots } = mapped({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [{ frame: { prompt: "a", subject: { hairColor: hair } } }],
    })
    expect(shots[0].plan?.frame?.subject).toEqual({ hairColor: hair })
  })

  it("carries `promptBaked` onto the plan, and only beside a prompt", () => {
    // Without this the Composer cannot tell an imported LEGACY prompt (look
    // clauses already in the words) from authored intent, and the scene's
    // restored `look` folds over it a second time on the first Generate (D4).
    const baked = mapped({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [{ frame: { prompt: "an alley, golden hour", promptBaked: true } }],
    })
    expect(baked.shots[0].plan?.frame).toEqual({
      prompt: "an alley, golden hour",
      promptBaked: true,
    })
    // Absent ⇒ raw: a hand-authored document keeps its look, exactly like a
    // draft or a storyboard breakdown does.
    const raw = mapped({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [{ frame: { prompt: "an alley" } }],
    })
    expect(raw.shots[0].plan?.frame).toEqual({ prompt: "an alley" })
    // …and a hand-authored `false` lands on that same safe answer rather than
    // failing the whole import over a provenance hint.
    const denied = mapped({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [{ frame: { prompt: "an alley", promptBaked: false } }],
    })
    expect(denied.shots[0].plan?.frame).toEqual({ prompt: "an alley" })
  })

  it("carries the motion plan including the camera movement", () => {
    const { shots } = mapped(example)
    expect(shots[0].plan?.motion).toEqual({
      provider: "seedance-2",
      aspectRatio: "16:9",
      resolution: "1080p",
      duration: 10,
      cameraMotionId: "tracking-shot",
      // D7's worked example exercises motion.input too (D3).
      input: "start",
    })
  })

  it("carries the directing plan's input mode (D3)", () => {
    const { shots } = mapped({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [{ motion: { prompt: "she runs", input: "references" } }],
    })
    expect(shots[0].plan?.motion?.input).toBe("references")
  })

  it("carries the scene voice onto the plan (D4)", () => {
    const { shots } = mapped({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [
        {
          frame: { prompt: "an alley" },
          voice: {
            text: "Go now",
            casting: "male, urgent",
            voiceId: "rachel-1",
            voiceType: "premade",
            ttsProvider: "elevenlabs-v3",
            model: "eleven_v3",
            delivery: { speed: 1.1, stability: 0.6 },
          },
        },
      ],
    })
    expect(shots[0].plan?.voice).toEqual({
      text: "Go now",
      casting: "male, urgent",
      voiceId: "rachel-1",
      voiceType: "premade",
      ttsProvider: "elevenlabs-v3",
      model: "eleven_v3",
      delivery: { speed: 1.1, stability: 0.6 },
    })
  })

  it("does not synthesize plan.voice for a scene that carries none (D4)", () => {
    const { shots } = mapped({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [{ frame: { prompt: "an alley" } }],
    })
    expect(shots[0].plan?.voice).toBeUndefined()
  })

  it("lands the motion reference channels on the SHOT, not in the plan", () => {
    const { shots } = mapped({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [
        {
          motion: {
            prompt: "she runs",
            referenceImageUrls: ["https://r2.example/a.png"],
            referenceVideoUrls: ["https://r2.example/b.mp4"],
            referenceAudioUrls: ["https://r2.example/c.mp3"],
          },
        },
      ],
    })
    expect(shots[0].directingReferenceUrls).toEqual(["https://r2.example/a.png"])
    expect(shots[0].directingReferenceVideoUrls).toEqual(["https://r2.example/b.mp4"])
    expect(shots[0].directingReferenceAudioUrls).toEqual(["https://r2.example/c.mp3"])
    expect(shots[0].plan?.motion).toEqual({ prompt: "she runs" })
  })

  it("builds beats with their prose, picks, transition and effect", () => {
    const { shots } = mapped(example)
    const [first, second] = shots[0].beats ?? []
    expect(first).toMatchObject({
      seconds: 4,
      label: "Sprint",
      // D7's worked example gives this shot two audio cues (D3) — neither
      // cue's content is already in the prose, so the importer's own
      // `withDirectionTokens` appends both bracket tokens, in cue order.
      text: "she sprints toward camera [Go, go, go!] [heavy rain hammering the cobblestones, distant thunder]",
      picks: { framingId: "wide-shot" },
      transition: { id: "cross-dissolve" },
    })
    expect(second).toMatchObject({
      seconds: 6,
      text: "the SUV swerves",
      characterFx: { id: "werewolf", position: "start", intensity: "crazy" },
    })
    expect(first.id).not.toBe(second.id)
  })

  it("lands `motion.endTransition` on the SCENE, not in its plan", () => {
    // The way OUT is authoring state the shot owns — the same seat `beats` and
    // `scenePrompt` take, and for the same reason: a plan holding a second copy
    // would drift from the one the composer writes.
    const { shots } = mapped(example)
    expect(shots[0].endTransition).toEqual({ id: "cross-dissolve", duration: "short" })
    expect("endTransition" in (shots[0].plan?.motion ?? {})).toBe(false)
  })

  it("copies the end transition — the store never aliases the document", () => {
    const doc = JSON.parse(JSON.stringify(example)) as typeof example
    const { shots } = mapped(doc)
    expect(
      Object.is(
        shots[0].endTransition,
        (doc.scenes[0] as { motion?: { endTransition?: unknown } }).motion?.endTransition,
      ),
    ).toBe(false)
  })

  it("resolves folders by name and creates the ones the list omits", () => {
    const { shots, folders } = mapped({
      format: "nodaro-studio-production",
      version: 1,
      folders: ["Act 1"],
      scenes: [
        { folder: "Act 1", frame: { prompt: "a" } },
        { folder: "Act 2", frame: { prompt: "b" } },
      ],
    })
    expect(folders.map((f) => f.name)).toEqual(["Act 1", "Act 2"])
    expect(shots[0].folderId).toBe(folders[0].id)
    expect(shots[1].folderId).toBe(folders[1].id)
  })

  it("collapses two folders sharing a name into one", () => {
    const { folders } = mapped({
      format: "nodaro-studio-production",
      version: 1,
      folders: ["Act 1", "Act 1"],
      scenes: [{ frame: { prompt: "a" } }],
    })
    expect(folders).toHaveLength(1)
  })

  it("writes a multi-pick key as an array and a single-pick key as an id", () => {
    const { shots, film } = mapped(example)
    expect(shots[0].look).toEqual({
      "lighting-time-of-day": "golden-hour",
      atmosphereId: ["fog", "light-rain"],
    })
    expect(film).toEqual({ cameraFormatId: "arri-alexa", colorLookId: "teal-orange" })
  })

  it("leaves a shots-only scene without a plan", () => {
    const { shots } = mapped({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [{ shots: [{ seconds: 4, text: "she runs" }] }],
    })
    expect(shots[0].plan).toBeUndefined()
    expect(shots[0].beats).toHaveLength(1)
  })

  it("lands the scene's generic prompt on the SHOT, beside its shots", () => {
    const { shots } = mapped({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [
        {
          motion: { scenePrompt: "  A rain-soaked rooftop chase.  " },
          shots: [{ seconds: 4, text: "she runs" }],
        },
      ],
    })
    // Trimmed on the way in, the way export writes it and the store keeps it —
    // a whitespace-only draft would otherwise land as a field the next save
    // silently drops.
    expect(shots[0].scenePrompt).toBe("A rain-soaked rooftop chase.")
    expect(shots[0].plan?.motion).toBeUndefined()
    expect(shots[0].beats).toHaveLength(1)
  })

  it("ignores a blank scene prompt", () => {
    const { shots } = mapped({
      format: "nodaro-studio-production",
      version: 1,
      scenes: [{ motion: { scenePrompt: "   ", prompt: "she runs" } }],
    })
    expect(shots[0].scenePrompt).toBeUndefined()
  })
})
