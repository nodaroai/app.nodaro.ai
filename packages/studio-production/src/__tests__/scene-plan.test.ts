import { describe, it, expect } from "vitest"

import {
  isEmptyPlan,
  planToSceneSettings,
  readPlan,
  type PlanFrame,
  type PlanMotion,
  type PlanVoice,
  type ScenePlan,
} from "../scene-plan"

/**
 * A plan is the authored intent of a scene that has not rendered yet — the one
 * durable home an import can land on. Two rules carry the weight: the reader
 * never throws on an untrusted blob, and a plan used as a COPY source carries
 * settings, never prose.
 */
const plan: ScenePlan = {
  frame: {
    prompt: "@Natalie sprints down a narrow Roman alley",
    provider: "gpt-image-2",
    aspectRatio: "16:9",
    resolution: "2K",
    count: 2,
    references: [
      {
        id: "c1",
        defaultName: "Natalie",
        source: "wired-character",
        url: "https://r2.example/natalie.png",
      },
    ],
  },
  motion: {
    prompt: "she keeps running",
    provider: "seedance-2",
    resolution: "1080p",
    duration: 10,
    cameraMotionId: "tracking-shot",
  },
}

describe("isEmptyPlan", () => {
  it("is empty when there is nothing to keep", () => {
    expect(isEmptyPlan(undefined)).toBe(true)
    expect(isEmptyPlan({})).toBe(true)
    expect(isEmptyPlan({ frame: {}, motion: {} })).toBe(true)
  })

  it("is not empty once a stage carries one field", () => {
    expect(isEmptyPlan({ frame: { prompt: "a knight" } })).toBe(false)
  })

  it("is not empty once the scene carries a voice (D4)", () => {
    expect(isEmptyPlan({ voice: { text: "Go" } })).toBe(false)
  })
})

describe("readPlan", () => {
  it("round-trips a plan the editor wrote", () => {
    expect(readPlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan)
  })

  it("returns a COPY, never the blob it was handed", () => {
    const raw = JSON.parse(JSON.stringify(plan))
    const read = readPlan(raw)
    expect(read).not.toBe(raw)
    expect(read?.frame?.references).not.toBe(raw.frame.references)
  })

  it("drops fields of the wrong type instead of trusting them", () => {
    expect(
      readPlan({
        frame: { prompt: "a knight", count: "two", aspectRatio: 16 },
        motion: { duration: "ten", provider: "seedance-2" },
      }),
    ).toEqual({ frame: { prompt: "a knight" }, motion: { provider: "seedance-2" } })
  })

  it("drops unknown keys — a newer studio's plan opens in an older one", () => {
    expect(readPlan({ frame: { prompt: "a knight", grainId: "35mm" } })).toEqual({
      frame: { prompt: "a knight" },
    })
  })

  it("narrows motion's directions through readVoiceDirections (R16)", () => {
    expect(
      readPlan({
        motion: {
          prompt: "x [wind]",
          directions: [
            { kind: "sfx", text: "wind" },
            { kind: "nope", text: "y" },
          ],
        },
      }),
    ).toEqual({
      motion: { prompt: "x [wind]", directions: [{ kind: "sfx", text: "wind" }] },
    })
  })

  it("is undefined for an empty or malformed blob, and never throws", () => {
    expect(readPlan(undefined)).toBeUndefined()
    expect(readPlan("nonsense")).toBeUndefined()
    expect(readPlan([])).toBeUndefined()
    expect(readPlan({})).toBeUndefined()
    expect(readPlan({ frame: {}, motion: "nonsense" })).toBeUndefined()
  })

  it("narrows the subject map — non-empty strings/arrays kept, everything else dropped (D9)", () => {
    expect(
      readPlan({
        frame: {
          subject: {
            hairColor: "auburn",
            tags: ["a", "b"],
            bad: 3,
            empty: "",
            emptyArr: [],
          },
        },
      }),
    ).toEqual({
      frame: { subject: { hairColor: "auburn", tags: ["a", "b"] } },
    })
  })

  it("drops an empty subject map entirely, and a non-object subject", () => {
    expect(readPlan({ frame: { prompt: "p", subject: {} } })).toEqual({
      frame: { prompt: "p" },
    })
    expect(readPlan({ frame: { prompt: "p", subject: "nonsense" } })).toEqual({
      frame: { prompt: "p" },
    })
  })

  it("narrows motion.input to one of the four directing modes, dropping anything else (D3)", () => {
    expect(readPlan({ motion: { prompt: "p", input: "start" } })).toEqual({
      motion: { prompt: "p", input: "start" },
    })
    expect(readPlan({ motion: { prompt: "p", input: "sideways" } })).toEqual({
      motion: { prompt: "p" },
    })
    expect(readPlan({ motion: { prompt: "p", input: 3 } })).toEqual({
      motion: { prompt: "p" },
    })
  })

  it("narrows a persisted voice, dropping one with no text (D4)", () => {
    expect(
      readPlan({
        voice: {
          text: "Go now",
          casting: "male, urgent",
          voiceId: "rachel-1",
          voiceType: "premade",
          ttsProvider: "elevenlabs-v3",
          model: "eleven_v3",
          delivery: { speed: 1.1, stability: 0.6 },
        },
      }),
    ).toEqual({
      voice: {
        text: "Go now",
        casting: "male, urgent",
        voiceId: "rachel-1",
        voiceType: "premade",
        ttsProvider: "elevenlabs-v3",
        model: "eleven_v3",
        delivery: { speed: 1.1, stability: 0.6 },
      },
    })
    // No text ⇒ no voice at all — mirrors the format's own `repairVoice`.
    expect(readPlan({ frame: { prompt: "p" }, voice: { text: "" } })).toEqual({
      frame: { prompt: "p" },
    })
    expect(readPlan({ voice: {} })).toBeUndefined()
  })

  it("drops an unrecognised voiceType / ttsProvider on a persisted voice, keeping the rest", () => {
    expect(
      readPlan({ voice: { text: "Go", voiceType: "robot", ttsProvider: "acme" } }),
    ).toEqual({ voice: { text: "Go" } })
  })

  it("trims text and casting, mirroring the format's own repairVoice (R38-3)", () => {
    expect(readPlan({ voice: { text: "  Go now  ", casting: "  male, urgent  " } })).toEqual({
      voice: { text: "Go now", casting: "male, urgent" },
    })
    // A canvas-edited whitespace-only line is no line at all.
    expect(readPlan({ frame: { prompt: "p" }, voice: { text: "   " } })).toEqual({
      frame: { prompt: "p" },
    })
    // Whitespace-only casting drops the KEY, not the whole voice.
    expect(readPlan({ voice: { text: "Go", casting: "   " } })).toEqual({
      voice: { text: "Go" },
    })
  })

  it("clamps a persisted voice's delivery levers, like the importer's own repair (D4)", () => {
    expect(readPlan({ voice: { text: "Go", delivery: { speed: 3 } } })).toEqual({
      voice: { text: "Go", delivery: { speed: 1.2 } },
    })
  })
})

describe("planToSceneSettings", () => {
  it("carries the levers a copy needs", () => {
    expect(planToSceneSettings(plan)).toEqual({
      frame: {
        provider: "gpt-image-2",
        aspectRatio: "16:9",
        resolution: "2K",
        count: 2,
        references: plan.frame!.references,
      },
      motion: { provider: "seedance-2", resolution: "1080p", duration: 10 },
    })
  })

  it("never carries prose — SETTINGS, NOT PROSE holds for a plan too", () => {
    const copied = planToSceneSettings(plan)
    expect("prompt" in copied.frame!).toBe(false)
    expect("prompt" in copied.motion!).toBe(false)
  })

  it("drops cameraMotionId — the clip-level pick has no seat in a copy", () => {
    expect("cameraMotionId" in planToSceneSettings(plan).motion!).toBe(false)
  })

  it("drops input — the directing input mode has no seat in a copy either (D3)", () => {
    const copied = planToSceneSettings({
      motion: { input: "start", provider: "seedance-2" },
    })
    expect("input" in copied.motion!).toBe(false)
    expect(copied.motion).toEqual({ provider: "seedance-2" })
  })

  it("KEEPS the Structured Subject picks — a copy moves who is in the scene (D9)", () => {
    // `omitProse` subtracts prose and prose-adjacent levers; `subject` is
    // neither, and it is now a `FrameSettings` field, so it rides a copy the
    // way the references beside it do. Pinned because the whole point of
    // `omitProse` being SUBTRACTIVE is that a new lever must arrive for free.
    const copied = planToSceneSettings({
      frame: { prompt: "a knight", subject: { type: "woman", ethnicity: ["asian-any"] } },
    })
    expect(copied.frame?.subject).toEqual({ type: "woman", ethnicity: ["asian-any"] })
  })

  it("omits a stage that would carry nothing but prose", () => {
    expect(planToSceneSettings({ motion: { prompt: "she runs" } })).toEqual({})
  })
})

describe("readPlan — every plan field survives the round trip", () => {
  it("keeps every field of a fully-populated plan", () => {
    const frame: Required<PlanFrame> = {
      prompt: "p",
      promptBaked: true,
      negativePrompt: "n",
      provider: "gpt-image-2",
      aspectRatio: "16:9",
      resolution: "2K",
      count: 2,
      references: [
        {
          id: "c1",
          defaultName: "Natalie",
          source: "wired-character",
          url: "https://r2.example/n.png",
        },
      ],
      referenceImageUrls: ["https://r2.example/r.png"],
      subject: { hairColor: "auburn", tags: ["a", "b"] },
    }
    const motion: Required<PlanMotion> = {
      prompt: "p",
      negativePrompt: "n",
      provider: "seedance-2",
      aspectRatio: "16:9",
      resolution: "1080p",
      duration: 10,
      cameraMotionId: "tracking-shot",
      input: "start",
      references: [
        { id: "c1", defaultName: "Natalie", source: "wired-character", url: "" },
      ],
      directions: [{ kind: "sfx", text: "wind" }],
    }
    // Non-default delivery values (a lever AT its default is pruned by
    // `readDeliverySettings`, which would not round-trip against a fixture
    // that used them).
    const voice: Required<PlanVoice> = {
      text: "p",
      casting: "male, urgent",
      voiceId: "rachel-1",
      voiceType: "premade",
      ttsProvider: "elevenlabs-v3",
      model: "eleven_v3",
      delivery: { speed: 1.1, stability: 0.6, similarityBoost: 0.8, style: 0.2 },
    }
    // Compile-breaking when a lever is added to FrameSettings/MotionSettings,
    // and RED until `readPlan` is taught to read it: serialize copies by SPREAD,
    // so a field the reader doesn't enumerate is silent data loss on reload.
    // Every value here is a non-empty string / finite number / valid reference —
    // the narrowers legitimately drop anything else (`directions` is non-empty
    // for the same reason: `readVoiceDirections` drops an EMPTY array back to
    // `undefined`, which would not round-trip against a `[]` fixture).
    expect(readPlan(JSON.parse(JSON.stringify({ frame, motion, voice })))).toEqual({
      frame,
      motion,
      voice,
    })
  })
})
