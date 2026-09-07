import { describe, it, expect } from "vitest"

import {
  assembleDirectingRequest,
  buildDirectingRequest,
  directingEndFrameSupported,
} from "../directing"
import type { Production } from "../../ops/production"
import { videoModelOptions, videoSupportsPromptOnly } from "../../model-menu"
import type { Shot } from "../../shot"

/**
 * THE ORACLE for this builder is the studio hook's own suite
 * (`src/hooks/useStartDirecting.test.tsx`). Every wire assertion below is ported
 * VERBATIM — only the call shape changed, from `run.mock.calls[0][0]` / `[0][1]`
 * to `req.lane` / `req.params`. What did NOT port asserts about the RESPONSE
 * rather than the wire: the read-only example belt (an app guard), the three
 * toast/`adjustments` disclosures, and the `jobId` half of
 * `expect(started).toMatchObject(…)` — a builder has no job id; its wire halves
 * (`provider`, `duration`) are asserted on `params` here.
 *
 * End-frame is MODEL-GATED: the URL reaches `generate-video` ONLY when the
 * active model declares the catalog `"end-frame"` feature, so a stale URL from a
 * previously-selected end-frame model can NEVER reach an unsupporting one. Real
 * ids keep this a true catalog drift guard (veo3.1 = end-frame; grok-i2v not).
 */

const STILL = "https://r2/still.png"
const END = "https://r2/end.png"

describe("buildDirectingRequest — end-frame gate", () => {
  it("reports endFrameSupported from the catalog for the active model", () => {
    expect(directingEndFrameSupported("veo3.1")).toBe(true)
    expect(directingEndFrameSupported("grok-i2v")).toBe(false)
  })

  it("forwards endFrameUrl + returns the started job for an end-frame model", () => {
    const req = assembleDirectingRequest(
      "pan left",
      { imageUrl: STILL, endFrameUrl: END, duration: 5 },
      { provider: "veo3.1" },
    )
    expect(req?.lane).toBe("generate-video")
    expect(req?.params).toEqual(
      expect.objectContaining({ imageUrl: STILL, endFrameUrl: END }),
    )
    // The wire half of the hook's `expect(started).toMatchObject({ jobId: "v1",
    // provider: "veo3.1", duration: 5 })` — `jobId` is the response's.
    expect(req?.params).toMatchObject({ provider: "veo3.1", duration: 5 })
  })

  it("DROPS a stale endFrameUrl when the model does NOT support end-frame", () => {
    const req = assembleDirectingRequest(
      "pan left",
      { imageUrl: STILL, endFrameUrl: END },
      { provider: "grok-i2v" },
    )
    expect(req).not.toBeNull()
    const payload = req!.params as unknown as { endFrameUrl?: string }
    expect(payload.endFrameUrl).toBeUndefined()
  })

  it("returns null without a start frame on a model that can't run prompt-only", () => {
    // Derived, not pinned: an i2v-only menu model (no t2v mode) keeps the old
    // "nothing to animate from" bail — text alone isn't an input for it.
    const i2vOnly = videoModelOptions().find(
      (o) => !videoSupportsPromptOnly(o.id),
    )
    expect(i2vOnly).toBeDefined()
    const req = assembleDirectingRequest(
      "pan left",
      { imageUrl: "" },
      { provider: i2vOnly!.id },
    )
    expect(req).toBeNull()
  })

  it("starts a PROMPT-ONLY run on the TEXT-TO-VIDEO lane (no frame, no refs)", () => {
    // Lane by inputs (owner ruling 2026-09-04): with nothing but a prompt the run
    // belongs on `/v1/text-to-video` — `/v1/generate-video` is the image-to-video
    // lane and 400s ("imageUrl is required…") on a frame-less, ref-less request.
    const req = assembleDirectingRequest(
      "a lone red balloon drifts",
      { imageUrl: "" },
      { provider: "veo3.1" },
    )
    expect(req?.lane).toBe("text-to-video")
    expect(req?.params).toEqual(expect.objectContaining({ provider: "veo3.1" }))
    const payload = req!.params as unknown as Record<string, unknown>
    expect(payload).not.toHaveProperty("imageUrl")
    expect(payload).not.toHaveProperty("referenceImageUrls")
  })
})

/**
 * The LANE is chosen from the inputs (`video-lane`), never hardcoded — the
 * defect this fixes is that every directing run went to `/v1/generate-video`,
 * which since platform #1154 is the image-to-video lane and refuses a run with no
 * `imageUrl` it can't exempt.
 */
describe("buildDirectingRequest — the platform lane comes from the inputs", () => {
  it("keeps a references-only run on generate-video for an image-REQUIRED, ref-capable model", () => {
    // kling-3-omni is on the platform's image-required guard, so /v1/text-to-video
    // would 400 `image_required`; the i2v lane's `hasMultimodalRef` exemption is
    // exactly what lets its reference-only run through.
    const req = assembleDirectingRequest(
      "she turns",
      { referenceImageUrls: ["https://r2/i1.png"] },
      { provider: "kling-3-omni" },
    )
    expect(req?.lane).toBe("generate-video")
    expect(req?.params).toEqual(
      expect.objectContaining({ referenceImageUrls: ["https://r2/i1.png"] }),
    )
  })

  it("keeps a PROMPTLESS references run on generate-video (the t2v lane requires a prompt)", () => {
    // `/v1/text-to-video` declares `prompt: min(1)`; `/v1/generate-video`'s
    // prompt is optional, so a promptless refs submit stays on the i2v lane.
    const req = assembleDirectingRequest(
      "   ",
      { referenceImageUrls: ["https://r2/i1.png"] },
      { provider: "seedance-2-5" },
    )
    expect(req?.lane).toBe("generate-video")
  })

  it("returns null when the platform would accept no run at all", () => {
    // The CTA's disabled state — the fifth row of the matrix: nothing supplied.
    const req = assembleDirectingRequest("   ", {}, { provider: "veo3.1" })
    expect(req).toBeNull()
  })
})

describe("buildDirectingRequest — reference media channels (image / video / audio)", () => {
  it("forwards all three reference kinds to generate-video", () => {
    const req = assembleDirectingRequest(
      "match the motion",
      {
        imageUrl: STILL,
        referenceImageUrls: ["https://r2/i1.png"],
        referenceVideoUrls: ["https://r2/v1.mp4"],
        referenceAudioUrls: ["https://r2/a1.mp3"],
      },
      { provider: "seedance-2" },
    )
    expect(req?.lane).toBe("generate-video")
    expect(req?.params).toEqual(
      expect.objectContaining({
        referenceImageUrls: ["https://r2/i1.png"],
        referenceVideoUrls: ["https://r2/v1.mp4"],
        referenceAudioUrls: ["https://r2/a1.mp3"],
      }),
    )
  })

  it("animates from VIDEO references alone on the TEXT-TO-VIDEO lane (no start frame)", () => {
    // seedance-2 is t2v-addressable, so a frame-less references run belongs on
    // `/v1/text-to-video` — the references ride it just as they do the i2v lane.
    const req = assembleDirectingRequest(
      "a moody pan",
      { referenceVideoUrls: ["https://r2/v1.mp4"] },
      { provider: "seedance-2" },
    )
    expect(req?.lane).toBe("text-to-video")
    const payload = req!.params as unknown as { imageUrl?: string; referenceVideoUrls?: readonly string[] }
    expect(payload.imageUrl).toBeUndefined()
    expect(payload.referenceVideoUrls).toEqual(["https://r2/v1.mp4"])
  })

  it("KEEPS the end frame alongside references (the server folds the frames)", () => {
    // Owner ruling 2026-09-04, replacing the old "refs drop the end frame" rule:
    // with a start frame present the run is the image-to-video lane, and the
    // platform folds start + end INTO the references itself.
    const req = assembleDirectingRequest(
      "she speaks",
      {
        imageUrl: STILL,
        endFrameUrl: END,
        referenceAudioUrls: ["https://r2/a1.mp3"],
      },
      { provider: "veo3.1" },
    )
    expect(req?.lane).toBe("generate-video")
    const payload = req!.params as unknown as {
      imageUrl?: string
      endFrameUrl?: string
      referenceAudioUrls?: readonly string[]
    }
    expect(payload.imageUrl).toBe(STILL)
    expect(payload.endFrameUrl).toBe(END)
    expect(payload.referenceAudioUrls).toEqual(["https://r2/a1.mp3"])
  })

  it("sends an END frame with references and NO start frame (seedance-2-5)", () => {
    const req = assembleDirectingRequest(
      "she turns",
      { endFrameUrl: END, referenceImageUrls: ["https://r2/i1.png"] },
      { provider: "seedance-2-5" },
    )
    expect(req?.lane).toBe("generate-video")
    const payload = req!.params as unknown as {
      imageUrl?: string
      endFrameUrl?: string
      referenceImageUrls?: readonly string[]
    }
    expect(payload.imageUrl).toBeUndefined()
    expect(payload.endFrameUrl).toBe(END)
    expect(payload.referenceImageUrls).toEqual(["https://r2/i1.png"])
  })

  it("sends an END frame ALONE to generate-video — no imageUrl, no references", () => {
    const req = assembleDirectingRequest(
      "she turns",
      { endFrameUrl: END },
      { provider: "seedance-2-5" },
    )
    expect(req?.lane).toBe("generate-video")
    const payload = req!.params as unknown as {
      imageUrl?: string
      endFrameUrl?: string
      referenceImageUrls?: readonly string[]
    }
    expect(payload.imageUrl).toBeUndefined()
    expect(payload.endFrameUrl).toBe(END)
    expect(payload.referenceImageUrls).toBeUndefined()
  })

  it("keeps an END frame BESIDE references on a model that can't fold it alone (veo3.1)", () => {
    // The lone-frame case above is gated on the provider FOLDING the frame; this
    // one never was. VEO ships `[imageUrl, endFrameUrl]` verbatim, so its refs +
    // end-frame run must stay on the lane that HAS the field.
    const req = assembleDirectingRequest(
      "she turns",
      { endFrameUrl: END, referenceImageUrls: ["https://r2/i1.png"] },
      { provider: "veo3.1" },
    )
    expect(req?.lane).toBe("generate-video")
    const payload = req!.params as unknown as {
      imageUrl?: string
      endFrameUrl?: string
      referenceImageUrls?: readonly string[]
    }
    expect(payload.imageUrl).toBeUndefined()
    expect(payload.endFrameUrl).toBe(END)
    expect(payload.referenceImageUrls).toEqual(["https://r2/i1.png"])
  })

  it("sends start + end + references TOGETHER on seedance-2-5", () => {
    const req = assembleDirectingRequest(
      "she turns",
      {
        imageUrl: STILL,
        endFrameUrl: END,
        referenceImageUrls: ["https://r2/i1.png"],
      },
      { provider: "seedance-2-5" },
    )
    expect(req?.lane).toBe("generate-video")
    expect(req?.params).toEqual(
      expect.objectContaining({
        imageUrl: STILL,
        endFrameUrl: END,
        referenceImageUrls: ["https://r2/i1.png"],
      }),
    )
  })
})

/**
 * Bound `@`-entity chips ride the STRUCTURED `connectedReferences` channel —
 * `/v1/generate-video` binds each to its `@image_N` attachment + identity directive
 * server-side (canvas-parity), so studio sends the chips verbatim and leaves the
 * MODEL prompt raw (no prose "Reference images:" guide appended). A chips-only run
 * (no start frame, no flat refs) is a valid references-mode gen and must fire.
 */
describe("buildDirectingRequest — connectedReferences (server-side binding)", () => {
  const chip = {
    id: "muli",
    defaultName: "Muli",
    source: "wired-character" as const,
    url: "https://r2/muli.png",
  }

  it("forwards connectedReferences and leaves the prompt RAW (no appended guide)", () => {
    const req = assembleDirectingRequest(
      "Muli walks forward",
      { imageUrl: STILL, connectedReferences: [chip] },
      { provider: "seedance-2" },
    )
    const payload = req!.params as unknown as { connectedReferences?: unknown; prompt?: string }
    expect(payload.connectedReferences).toEqual([chip])
    // The model prompt is the trimmed RAW text — no "Reference images: …" bridge.
    expect(payload.prompt).toBe("Muli walks forward")
    expect(payload.prompt).not.toMatch(/reference image/i)
  })

  it("forwards the cinematic DIRECTION as ids, never as prompt text", () => {
    const direction = { cameraMotion: "dolly-in", colorLook: "warm", transition: ["iris"] }
    const req = assembleDirectingRequest(
      "She turns.",
      { imageUrl: STILL, direction },
      { provider: "seedance-2" },
    )
    const payload = req!.params as unknown as { direction?: unknown; prompt?: string }
    expect(payload.direction).toEqual(direction)
    expect(payload.prompt).toBe("She turns.")
  })

  it("never sends an EMPTY direction object", () => {
    const withEmpty = assembleDirectingRequest(
      "She turns.",
      { imageUrl: STILL, direction: {} },
      { provider: "seedance-2" },
    )
    expect(withEmpty!.params as unknown as Record<string, unknown>).not.toHaveProperty("direction")
    const without = assembleDirectingRequest(
      "She turns.",
      { imageUrl: STILL },
      { provider: "seedance-2" },
    )
    expect(without!.params as unknown as Record<string, unknown>).not.toHaveProperty("direction")
  })

  it("fires from connectedReferences ALONE — on the text-to-video lane with no end frame", () => {
    const req = assembleDirectingRequest(
      "she turns",
      { connectedReferences: [chip] },
      { provider: "veo3.1" },
    )
    expect(req?.lane).toBe("text-to-video")
    const payload = req!.params as unknown as {
      imageUrl?: string
      endFrameUrl?: string
      connectedReferences?: readonly unknown[]
    }
    expect(payload.imageUrl).toBeUndefined()
    expect(payload.endFrameUrl).toBeUndefined()
    expect(payload.connectedReferences).toHaveLength(1)
  })

  it("carries an END frame beside chips-only references — on the image-to-video lane", () => {
    const req = assembleDirectingRequest(
      "she turns",
      { endFrameUrl: END, connectedReferences: [chip] },
      { provider: "veo3.1" },
    )
    expect(req?.lane).toBe("generate-video")
    const payload = req!.params as unknown as {
      imageUrl?: string
      endFrameUrl?: string
      connectedReferences?: readonly unknown[]
    }
    expect(payload.imageUrl).toBeUndefined()
    expect(payload.endFrameUrl).toBe(END)
    expect(payload.connectedReferences).toHaveLength(1)
  })
})

/**
 * Native audio rides the CANONICAL `sound` boolean: the server's
 * `applyVideoAudioToggle` maps it onto each model's own field, and billing keys
 * off the SAME flag. Sent EXPLICITLY both ways for toggleable models — with
 * `defaultOn` models (kling-3.0) an OMITTED flag means audio ON + the `:audio`
 * credit tier. Always-on (VEO) / silent models get no toggle at all.
 */
describe("buildDirectingRequest — native audio (canonical sound lever)", () => {
  it("sends the canonical `sound: true` for Seedance (server maps to generate_audio)", () => {
    const req = assembleDirectingRequest(
      "she speaks",
      { imageUrl: STILL, sound: true },
      { provider: "seedance-2" },
    )
    const payload = req!.params as unknown as { generateAudio?: boolean; sound?: boolean }
    expect(payload.sound).toBe(true)
    expect(payload.generateAudio).toBeUndefined()
  })

  it("sends `sound: true` for Kling", () => {
    const req = assembleDirectingRequest(
      "ambient",
      { imageUrl: STILL, sound: true },
      { provider: "kling-3.0" },
    )
    const payload = req!.params as unknown as { sound?: boolean; generateAudio?: boolean }
    expect(payload.sound).toBe(true)
    expect(payload.generateAudio).toBeUndefined()
  })

  it("sends an EXPLICIT `sound: false` when voice is off (defaultOn billing guard)", () => {
    const req = assembleDirectingRequest(
      "silent b-roll",
      { imageUrl: STILL, sound: false },
      { provider: "kling-3.0" },
    )
    const payload = req!.params as unknown as { sound?: boolean }
    expect(payload.sound).toBe(false)
  })

  it("sends NO audio toggle for an always-on model (veo)", () => {
    const req = assembleDirectingRequest(
      "she speaks",
      { imageUrl: STILL, sound: true },
      { provider: "veo3.1" },
    )
    const payload = req!.params as unknown as { sound?: boolean; generateAudio?: boolean }
    expect(payload.sound).toBeUndefined()
    expect(payload.generateAudio).toBeUndefined()
  })

  it("sends NO audio toggle when the caller expressed no intent", () => {
    const req = assembleDirectingRequest(
      "silent b-roll",
      { imageUrl: STILL },
      { provider: "seedance-2" },
    )
    const payload = req!.params as unknown as { sound?: boolean; generateAudio?: boolean }
    expect(payload.sound).toBeUndefined()
    expect(payload.generateAudio).toBeUndefined()
  })
})

describe("buildDirectingRequest — resolution lever", () => {
  it("forwards a supplied resolution verbatim", () => {
    const req = assembleDirectingRequest(
      "dolly in",
      { imageUrl: STILL, resolution: "1080p" },
      { provider: "seedance-2" },
    )
    expect(req?.params).toEqual(
      expect.objectContaining({ resolution: "1080p" }),
    )
  })

  it("OMITS the resolution field entirely when none is supplied (Auto — the provider's own default renders)", () => {
    const req = assembleDirectingRequest(
      "dolly in",
      { imageUrl: STILL },
      { provider: "seedance-2" },
    )
    expect(req!.params as unknown as Record<string, unknown>).not.toHaveProperty("resolution")
  })
})

/**
 * THE DESCRIBED CHANNEL, directing side — the same negative guard the framing
 * submit carries: its own channel, and nothing url-less on
 * `connectedReferences`, on WHICHEVER lane the run takes.
 */
describe("buildDirectingRequest — described references", () => {
  const NATALIE = { name: "Natalie", description: "auburn hair, late 30s" }

  it("rides text-to-video with no references at all — words attach nothing", () => {
    const req = assembleDirectingRequest(
      "Natalie walks in",
      { describedReferences: [NATALIE] },
      { provider: "veo3.1" },
    )
    // A described role is NOT a reference for the lane decision: this is a
    // prompt-only run, and it stays one.
    expect(req?.lane).toBe("text-to-video")
    const body = req!.params as unknown as Record<string, unknown>
    expect(body.describedReferences).toEqual([NATALIE])
    expect(body.connectedReferences).toBeUndefined()
  })

  it("rides the image-to-video lane beside a start frame, too", () => {
    const req = assembleDirectingRequest(
      "Natalie walks in",
      { imageUrl: STILL, describedReferences: [NATALIE] },
      { provider: "veo3.1" },
    )
    expect(req?.lane).toBe("generate-video")
    const body = req!.params as unknown as Record<string, unknown>
    expect(body.describedReferences).toEqual([NATALIE])
  })

  it("a role with NO words is dropped, and an all-wordless list omits the key", () => {
    const first = assembleDirectingRequest(
      "Natalie walks in",
      {
        imageUrl: STILL,
        describedReferences: [NATALIE, { name: "Nobody", description: "  " }],
      },
      { provider: "veo3.1" },
    )
    expect((first!.params as unknown as Record<string, unknown>).describedReferences).toEqual([
      NATALIE,
    ])
    const second = assembleDirectingRequest(
      "Nobody walks in",
      {
        imageUrl: STILL,
        describedReferences: [{ name: "Nobody", description: "" }],
      },
      { provider: "veo3.1" },
    )
    expect("describedReferences" in (second!.params as unknown as Record<string, unknown>)).toBe(
      false,
    )
  })
})

/**
 * The OUTER builder — the document half: it reads the shot the way the studio's
 * render seam does (frames, rails, scene prompt, plan levers), binds the prose,
 * and hands the result to {@link assembleDirectingRequest}. The PERSISTED prose
 * is never rewritten: `{ref:…}` exists only on the wire.
 */
describe("buildDirectingRequest — over the document", () => {
  const CHIP = {
    id: "muli",
    defaultName: "Muli",
    source: "wired-character" as const,
    url: "https://r2/muli.png",
  }

  function productionOf(shot: Shot): Production {
    return { shots: [shot] }
  }

  function shotWith(extra: Partial<Shot> = {}): Shot {
    return { id: "s1", ...extra } as Shot
  }

  it("animates a framed shot from its still on the image-to-video lane", () => {
    const production = productionOf(
      shotWith({
        still: {
          nodeId: "generate-image-1",
          url: STILL,
          prompt: "a lighthouse",
          provider: "seedream-4",
        },
        plan: { motion: { prompt: "slow dolly in" } },
      }),
    )
    const built = buildDirectingRequest(production, "s1", { provider: "veo3.1" })
    expect(built?.lane).toBe("generate-video")
    expect(built?.params.imageUrl).toBe(STILL)
    expect(built?.params.prompt).toBe("slow dolly in")
  })

  it("prepends the scene prompt as its own paragraph", () => {
    const production = productionOf(
      shotWith({
        still: {
          nodeId: "generate-image-1",
          url: STILL,
          prompt: "a lighthouse",
          provider: "seedream-4",
        },
        scenePrompt: "A storm at sea.",
        plan: { motion: { prompt: "slow dolly in" } },
      }),
    )
    const built = buildDirectingRequest(production, "s1", { provider: "veo3.1" })
    expect(built?.params.prompt).toBe("A storm at sea.\n\nslow dolly in")
    // A take stores the SUBMITTED string, folds included — the restore path is
    // what takes the paragraph back off (`stripScenePrompt`), so a marker that
    // dropped it here would seed a shorter prompt than the clip was made from.
    expect(built?.marker.prompt).toBe("A storm at sea.\n\nslow dolly in")
    expect(built?.marker.scenePrompt).toBe("A storm at sea.")
  })

  it("binds a chip at its own position on the WIRE and leaves the persisted prose alone", () => {
    const production = productionOf(
      shotWith({
        still: {
          nodeId: "generate-image-1",
          url: STILL,
          prompt: "a lighthouse",
          provider: "seedream-4",
        },
        plan: { motion: { prompt: "Muli walks forward", input: "references" } },
      }),
    )
    const built = buildDirectingRequest(
      production,
      "s1",
      { provider: "seedance-2" },
      { chips: [CHIP] },
    )
    expect(built?.params.prompt).toBe("Muli ({ref:muli}) walks forward")
    expect(built?.params.connectedReferences).toEqual([CHIP])
    // WIRE-ONLY: the document's own prose, and the marker that restores it,
    // still say the plain name.
    expect(production.shots[0].plan?.motion?.prompt).toBe("Muli walks forward")
    expect(built?.marker.prompt).toBe("Muli walks forward")
    // …and the marker records the chips the WIRE used, so a render finishing
    // after a reload lands a clip WITH its references instead of plain text.
    expect(built?.marker.references).toEqual([CHIP])
  })

  it("carries the direction ids onto the wire, never as prompt text", () => {
    const direction = { cameraMotion: "dolly-in", colorLook: "warm" }
    const production = productionOf(
      shotWith({
        still: {
          nodeId: "generate-image-1",
          url: STILL,
          prompt: "a lighthouse",
          provider: "seedream-4",
        },
        plan: { motion: { prompt: "She turns." } },
      }),
    )
    const built = buildDirectingRequest(production, "s1", {
      provider: "seedance-2",
      direction,
    })
    expect(built?.params.direction).toEqual(direction)
    expect(built?.params.prompt).toBe("She turns.")
  })

  it("sends the shot's END frame only in the modes that own one", () => {
    const shot = shotWith({
      still: {
        nodeId: "generate-image-1",
        url: STILL,
        prompt: "a lighthouse",
        provider: "seedream-4",
      },
      endFrame: END,
      plan: { motion: { prompt: "she turns" } },
    })
    const startEnd = buildDirectingRequest(
      productionOf(shot),
      "s1",
      { provider: "veo3.1" },
      { mode: "start-end" },
    )
    expect(startEnd?.params.endFrameUrl).toBe(END)
    const startOnly = buildDirectingRequest(
      productionOf(shot),
      "s1",
      { provider: "veo3.1" },
      { mode: "start" },
    )
    expect(startOnly?.params.endFrameUrl).toBeUndefined()
  })

  it("returns null when the shot offers the platform nothing (the CTA's disabled state)", () => {
    const production = productionOf(shotWith({}))
    expect(
      buildDirectingRequest(production, "s1", { provider: "veo3.1" }),
    ).toBeNull()
  })

  it("refuses a shot id the production does not have", () => {
    const production = productionOf(shotWith({}))
    expect(() =>
      buildDirectingRequest(production, "nope", { provider: "veo3.1" }),
    ).toThrow(/nope/)
  })

  it("folds the shot breakdown into one prompt, one window per line", () => {
    const production = productionOf(
      shotWith({
        still: {
          nodeId: "generate-image-1",
          url: STILL,
          prompt: "a lighthouse",
          provider: "seedream-4",
        },
        beats: [
          { id: "b1", seconds: 2, text: "The button is clicked." },
          { id: "b2", seconds: 4, text: "She is pulled backward." },
        ],
        plan: { motion: { prompt: "ignored once the shots own the prose" } },
      }),
    )
    const built = buildDirectingRequest(production, "s1", { provider: "veo3.1" })
    expect(built?.params.prompt).toBe(
      "0-2s — The button is clicked.\n2-6s — She is pulled backward.",
    )
    // The marker keeps the shots themselves — the editor is non-blocking, so a
    // take must record the breakdown it was actually made from.
    expect(built?.marker.beats).toHaveLength(2)
  })

  it("renders a `/` cue into the model's own audio syntax and keeps the marker neutral", () => {
    const production = productionOf(
      shotWith({
        still: {
          nodeId: "generate-image-1",
          url: STILL,
          prompt: "a lighthouse",
          provider: "seedream-4",
        },
        plan: {
          motion: {
            prompt: "She turns. [thunder rolls]",
            directions: [{ kind: "sfx" as const, text: "thunder rolls" }],
          },
        },
      }),
    )
    const built = buildDirectingRequest(production, "s1", { provider: "seedance-2" })
    // The neutral `[text]` token is gone from the wire — the model reads its own
    // syntax instead.
    expect(built?.params.prompt).not.toContain("[thunder rolls]")
    expect(built?.params.prompt).toContain("thunder rolls")
    // …and the marker keeps the NEUTRAL prose, so a restore rebuilds the chips
    // and a model switch re-renders them correctly.
    expect(built?.marker.prompt).toBe("She turns. [thunder rolls]")
    expect(built?.marker.directions).toEqual([
      { kind: "sfx", text: "thunder rolls" },
    ])
  })

  it("seeds a references run with the shot's own still when nothing is attached", () => {
    const production = productionOf(
      shotWith({
        still: {
          nodeId: "generate-image-1",
          url: STILL,
          prompt: "a lighthouse",
          provider: "seedream-4",
        },
        plan: { motion: { prompt: "she turns", input: "references" } },
      }),
    )
    const built = buildDirectingRequest(production, "s1", { provider: "seedance-2-5" })
    // The plain "frame → Animate" flow on a references-default model drives the
    // shot AS A REFERENCE, not as a locked start keyframe.
    expect(built?.params.imageUrl).toBeUndefined()
    expect(built?.params.referenceImageUrls).toEqual([STILL])
  })

  it("dedupes a rail image already riding as a frame", () => {
    const production = productionOf(
      shotWith({
        still: {
          nodeId: "generate-image-1",
          url: STILL,
          prompt: "a lighthouse",
          provider: "seedream-4",
        },
        startFrame: STILL,
        directingReferenceUrls: [STILL, "https://r2/other.png"],
        plan: { motion: { prompt: "she turns", input: "references" } },
      }),
    )
    const built = buildDirectingRequest(production, "s1", { provider: "seedance-2-5" })
    // The same picture must not go out twice.
    expect(built?.params.imageUrl).toBe(STILL)
    expect(built?.params.referenceImageUrls).toEqual(["https://r2/other.png"])
  })

  it("drops the reference rails outside references mode", () => {
    const production = productionOf(
      shotWith({
        still: {
          nodeId: "generate-image-1",
          url: STILL,
          prompt: "a lighthouse",
          provider: "seedream-4",
        },
        directingReferenceUrls: ["https://r2/other.png"],
        directingReferenceVideoUrls: ["https://r2/v1.mp4"],
        plan: { motion: { prompt: "she turns", input: "start" } },
      }),
    )
    const built = buildDirectingRequest(production, "s1", { provider: "seedance-2-5" })
    expect(built?.params.imageUrl).toBe(STILL)
    expect(built?.params.referenceImageUrls).toBeUndefined()
    expect(built?.params.referenceVideoUrls).toBeUndefined()
  })

  it("draws a marker the caller finishes with the job id and ctx.now", () => {
    const production = productionOf(
      shotWith({
        still: {
          nodeId: "generate-image-1",
          url: STILL,
          prompt: "a lighthouse",
          provider: "seedream-4",
        },
        plan: { motion: { prompt: "she turns" } },
      }),
    )
    const built = buildDirectingRequest(production, "s1", {
      provider: "veo3.1",
      duration: 5,
      aspectRatio: "16:9",
      resolution: "1080p",
    })
    expect(built?.marker).toEqual({
      provider: "veo3.1",
      prompt: "she turns",
      duration: 5,
      aspectRatio: "16:9",
      resolution: "1080p",
    })
    // Nothing ambient: the draft carries neither the job id nor a clock read.
    expect(built?.marker).not.toHaveProperty("jobId")
    expect(built?.marker).not.toHaveProperty("startedAt")
  })
})
