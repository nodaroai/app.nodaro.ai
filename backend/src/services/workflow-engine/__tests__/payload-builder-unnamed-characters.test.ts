/**
 * Unnamed Character nodes on a WORKFLOW RUN (decided 2026-11-11).
 *
 * A Character node starts with an empty `characterName` and the default label
 * "Character Asset", and keeps them until someone names it. Each such node is
 * its own character, called "Character 1", "Character 2", … in wire order
 * (skipping a number another wired character is already called) — the name
 * the model reads, never "Character Asset" — and two of them are never merged.
 * The editor's Run and panels read the same rule (`wiredCharacterNames`), so
 * the names here are the editor's too (see the editor twin,
 * `frontend/src/lib/__tests__/unnamed-characters-run.test.ts`).
 *
 * Every case runs the real input resolver, then the payload builder, as the
 * orchestrator does — so the images asserted are the ones a run sends.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import { resolveNodeInputs } from "../input-resolver.js"
import { extractSavedNodeOutput } from "../output-extractor.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"
import { buildKling4Request } from "../../../providers/kie/kling4.js"
import { minimaxH3BillableRefImageCount } from "../../../ee/billing/minimax-h3-credits.js"
import type { VideoCharacterReference } from "@nodaro/shared/video"

const portrait = (id: string) => `https://cdn.example/${id}-portrait.png`
const smile = (id: string) => `https://cdn.example/${id}-smile.png`

/** A Character node as the editor creates it: no name, the default label. */
function character(id: string, extra: Record<string, unknown> = {}): SimpleNode {
  return {
    id,
    type: "character",
    data: {
      label: "Character Asset",
      characterName: "",
      description: "",
      sourceImageUrl: portrait(id),
      canonicalDescription: `the ${id} look`,
      expressions: [{ name: "smile", url: smile(id) }],
      ...extra,
    },
  }
}

function run(consumer: SimpleNode, chars: SimpleNode[], opts: { audio?: string[]; extra?: SimpleNode[]; extraEdges?: SimpleEdge[] } = {}) {
  const nodes = [consumer, ...chars, ...(opts.extra ?? [])]
  const edges: SimpleEdge[] = [
    ...chars.map((c) => ({ id: `${c.id}->${consumer.id}`, source: c.id, target: consumer.id, sourceHandle: "characterRef", targetHandle: "assets" })),
    ...(opts.extraEdges ?? []),
  ]
  const nodeStates: Record<string, NodeExecutionState> = {}
  for (const n of nodes.slice(1)) nodeStates[n.id] = { status: "completed", output: extractSavedNodeOutput(n) } as NodeExecutionState
  const inputs = resolveNodeInputs(consumer, edges, nodeStates, nodes)
  if (opts.audio) inputs.referenceAudioUrls = opts.audio
  const r = buildPayload(consumer, "job-1", inputs, undefined, { nodes, edges, nodeStates })
  const p = r.payload as Record<string, unknown>
  return {
    r,
    p,
    prompt: (p.prompt as string | undefined) ?? "",
    refs: p.referenceImageUrls as string[] | undefined,
    subjects: p.characterReferences as VideoCharacterReference[] | undefined,
  }
}

const image = (data: Record<string, unknown> = {}): SimpleNode =>
  ({ id: "gi", type: "generate-image", data: { provider: "nano-banana-pro", prompt: "a portrait in the rain", ...data } })
const video = (provider: string, data: Record<string, unknown> = {}): SimpleNode =>
  ({ id: "gv", type: "generate-video", data: { provider, prompt: "she walks out into the rain", ...data } })

describe("two unnamed Character nodes stay two characters", () => {
  it("Generate Image sends both portraits and both identities", () => {
    const { prompt, refs } = run(image(), [character("u1"), character("u2")])
    expect(refs).toEqual([portrait("u1"), portrait("u2")])
    expect(prompt).toContain("(Character 1) — the u1 look")
    expect(prompt).toContain("(Character 2) — the u2 look")
    expect(prompt).not.toContain("Character Asset")
  })

  it("Kling 4.0 gets two subjects with different names", () => {
    const { subjects } = run(video("kling-4"), [character("u1"), character("u2")])
    expect(subjects?.map((s) => [s.name, s.imageUrl, s.extraImageUrls])).toEqual([
      ["Character 1", portrait("u1"), [smile("u1")]],
      ["Character 2", portrait("u2"), [smile("u2")]],
    ])
  })

  it("Kling 4.0 Flash binds voice clips 1 and 2 to characters 1 and 2", () => {
    const { p, subjects } = run(video("kling-4-flash"), [character("u1"), character("u2")], { audio: ["https://cdn.example/a1.mp3", "https://cdn.example/a2.mp3"] })
    const req = buildKling4Request({
      provider: "kling-4-flash",
      prompt: p.prompt as string,
      durationSec: 5,
      referenceImageUrls: p.referenceImageUrls as string[],
      referenceAudioUrls: p.referenceAudioUrls as string[],
      characterReferences: subjects,
    })
    expect((req.input.elements as Array<{ name: string; voice_url?: string }>).map((e) => [e.name, e.voice_url])).toEqual([
      ["Character_1", "https://cdn.example/a1.mp3"],
      ["Character_2", "https://cdn.example/a2.mp3"],
    ])
  })

  it("each keeps its own elements (held prop) on its own bullet", () => {
    const heldA: SimpleNode = { id: "hp-a", type: "held-prop", data: { heldProp: "smartphone" } }
    const heldB: SimpleNode = { id: "hp-b", type: "held-prop", data: { heldProp: "umbrella" } }
    const { prompt } = run(image(), [character("u1"), character("u2")], {
      extra: [heldA, heldB],
      extraEdges: [
        { id: "hp-a->u1", source: "hp-a", target: "u1", targetHandle: "assets" },
        { id: "hp-b->u2", source: "hp-b", target: "u2", targetHandle: "assets" },
      ],
    })
    const bullet = (n: number) => prompt.split("\n").find((l) => l.includes(`(Character ${n})`)) ?? ""
    expect(bullet(1)).toMatch(/smartphone/i)
    expect(bullet(1)).not.toMatch(/umbrella/i)
    expect(bullet(2)).toMatch(/umbrella/i)
    expect(bullet(2)).not.toMatch(/smartphone/i)
  })
})

describe("what an unnamed Character is called", () => {
  it("one unnamed node is Character 1; 'Character Asset' never reaches the model", () => {
    for (const consumer of [image(), video("minimax-h3"), video("seedance-2"), video("gemini-omni-flash"), video("kling-4")]) {
      const { prompt, subjects } = run(consumer, [character("u1")])
      expect(prompt, consumer.data.provider as string).toContain("Character 1")
      expect(prompt, consumer.data.provider as string).not.toContain("Character Asset")
      if (subjects) expect(subjects.map((s) => s.name)).toEqual(["Character 1"])
    }
  })

  it("a label someone typed is the name", () => {
    const { prompt } = run(image(), [character("u1", { label: "Hero" })])
    expect(prompt).toContain("(Hero) — the u1 look")
  })

  it("the default label from February–June 2026 ('Character') is unnamed too", () => {
    const { prompt } = run(image(), [character("u1", { label: "Character" })])
    expect(prompt).toContain("(Character 1) — the u1 look")
  })

  it("an unnamed node beside a node named 'Character 1' becomes Character 2", () => {
    const { subjects } = run(video("kling-4"), [character("u1"), character("n1", { characterName: "Character 1" })])
    expect(subjects?.map((s) => [s.name, s.imageUrl])).toEqual([
      ["Character 2", portrait("u1")],
      ["Character 1", portrait("n1")],
    ])
  })

  it("the same typed name on two nodes is still one character", () => {
    const { subjects } = run(video("kling-4"), [character("a", { characterName: "Maya" }), character("b", { characterName: "Maya" })])
    expect(subjects?.map((s) => s.name)).toEqual(["Maya"])
  })

  it("a mixed list (named, unnamed, named, unnamed) — the same names the editor gives", () => {
    const { subjects } = run(video("kling-4"), [
      character("a", { characterName: "Maya" }),
      character("b"),
      character("c", { characterName: "Leo" }),
      character("d"),
    ])
    expect(subjects?.map((s) => s.name)).toEqual(["Maya", "Character 1", "Leo", "Character 2"])
  })
})

/**
 * What a stored workflow with ONE unnamed Character sends on its next run that
 * it did not before: before, the node was left out of the character treatment
 * and its portrait went as a plain reference image. Now it is a character like
 * any named one — so every media field equals the same node's WITH a name.
 */
describe("one unnamed Character: the next run treats it exactly as a named one", () => {
  const same = (consumer: SimpleNode) => {
    const unnamed = run(consumer, [character("u1")])
    const named = run(consumer, [character("u1", { characterName: "Character 1" })])
    expect(unnamed.p.imageUrl, consumer.data.provider as string).toEqual(named.p.imageUrl)
    expect(unnamed.refs).toEqual(named.refs)
    expect(unnamed.subjects).toEqual(named.subjects)
    expect(unnamed.r.modelIdentifier).toBe(named.r.modelIdentifier)
    expect(unnamed.r.jobName).toBe(named.r.jobName)
    expect(unnamed.prompt).toBe(named.prompt)
    return unnamed
  }

  it("Generate Image: the same one portrait, now with the identity bullet", () => {
    const { refs, prompt } = same(image())
    expect(refs).toEqual([portrait("u1")])
    expect(prompt).toContain("(Character 1) — the u1 look")
  })

  it("Generate Video, MiniMax H3 / Seedance 2: the same one reference image, no start frame; H3's billed image count stays 1", () => {
    for (const provider of ["minimax-h3", "seedance-2"]) {
      const { p, refs, r } = same(video(provider))
      expect(p.imageUrl, provider).toBeUndefined()
      expect(refs).toEqual([portrait("u1")])
      expect(r.jobName).toBe("text-to-video")
      expect(minimaxH3BillableRefImageCount({ referenceImageUrls: refs, firstFrameUrl: p.imageUrl })).toBe(1)
    }
  })

  // The payload's imageUrl is set too, exactly as for a named character today;
  // the job stays text-to-video, whose worker never reads imageUrl
  // (workers/handlers/video-ai.ts handleTextToVideo), so the model still gets
  // the portrait once, as a reference image.
  it("Generate Video, Gemini Omni with no start frame: the same one reference image and job — as a named character's", () => {
    for (const provider of ["gemini-omni-flash", "gemini-omni-video"]) {
      const { p, refs, r } = same(video(provider))
      expect(p.imageUrl, provider).toBe(portrait("u1"))
      expect(refs).toEqual([portrait("u1")])
      expect(r.jobName).toBe("text-to-video")
    }
  })

  it("Generate Video, any model with a start frame: the start frame is untouched, the portrait stays one reference", () => {
    const start: SimpleNode = { id: "st", type: "upload-image", data: { imageUrl: "https://cdn.example/start.png", url: "https://cdn.example/start.png" } }
    for (const provider of ["minimax-h3", "gemini-omni-flash"]) {
      const { p, refs } = run(video(provider), [character("u1")], {
        extra: [start],
        extraEdges: [{ id: "st->gv", source: "st", target: "gv", sourceHandle: "image", targetHandle: "startFrame" }],
      })
      expect(p.imageUrl, provider).toBe("https://cdn.example/start.png")
      expect(refs).toEqual([portrait("u1")])
    }
  })

  it("Kling 4.0: the same reference image, plus a named subject (portrait + its variants); the price id is unchanged", () => {
    const { refs, subjects, r } = same(video("kling-4"))
    expect(refs).toEqual([portrait("u1")])
    expect(subjects).toEqual([{ imageUrl: portrait("u1"), extraImageUrls: [smile("u1")], description: "the u1 look", name: "Character 1" }])
    expect(r.modelIdentifier).toBe("kling-4:5s:720p")
  })

  it("Kling 4.0 / Flash: KIE gets the portrait as a subject instead of an image seat — the same number of materials", () => {
    for (const provider of ["kling-4", "kling-4-flash"] as const) {
      const audio = ["https://cdn.example/a1.mp3"]
      const { p, subjects } = run(video(provider), [character("u1")], { audio })
      const request = (characterReferences: VideoCharacterReference[] | undefined) =>
        buildKling4Request({
          provider,
          prompt: p.prompt as string,
          durationSec: 5,
          referenceImageUrls: p.referenceImageUrls as string[],
          referenceAudioUrls: audio,
          characterReferences,
        })
      // Before: the unnamed node was no character — its portrait one image seat.
      const before = request([])
      expect(before.input.image_urls, provider).toEqual([portrait("u1")])
      expect(before.input.elements).toBeUndefined()
      // Now: that seat IS the subject (portrait + its smile), so it leaves the
      // image list — one subject where there was one image.
      const after = request(subjects)
      expect(after.input.image_urls, provider).toBeUndefined()
      const elements = after.input.elements as Array<{ name: string; image_urls: string[]; voice_url?: string }>
      expect(elements.map((e) => [e.name, e.image_urls])).toEqual([["Character_1", [portrait("u1"), smile("u1")]]])
      if (provider === "kling-4-flash") {
        // Flash: the clip that had no character to carry it now is Character 1's voice.
        expect(before.notes).toContain("dropped reference audio clip 1: no character 1 is connected to carry it")
        expect(elements[0]!.voice_url).toBe(audio[0])
        expect(after.notes).toEqual([])
      } else {
        expect(after.input.voices).toEqual(before.input.voices)
      }
    }
  })

})

/**
 * One image per character (decided 2026-11-11): the portrait IS the node's
 * output — `entityImageUrl`: the starred default asset, else the active
 * generated result, else the source image — so a node with a source image and a
 * generated result but no starred asset sends ONE image, not the source as the
 * portrait plus the result as a plain reference.
 */
describe("a Character sends one image: its output is its portrait", () => {
  const RESULT = "https://cdn.example/u1-result.png"
  const DEFAULT = "https://cdn.example/u1-default.png"
  const generated = { generatedResults: [{ url: RESULT }], activeResultIndex: 0 }

  it("source image + generated result, no starred asset: exactly the result, one identity — unnamed and named", () => {
    for (const extra of [generated, { ...generated, characterName: "Maya" }]) {
      const { refs, prompt } = run(image(), [character("u1", extra)])
      expect(refs).toEqual([RESULT])
      expect(prompt.match(/^- Image \d/gm)).toHaveLength(1)
    }
  })

  it("a starred default asset, or only a source image: unchanged", () => {
    expect(run(image(), [character("u1", { ...generated, defaultAssetUrl: DEFAULT })]).refs).toEqual([DEFAULT])
    expect(run(image(), [character("u1")]).refs).toEqual([portrait("u1")])
  })

  it("on video the same one image: the reference seat and the character are the result", () => {
    const { refs, p } = run(video("minimax-h3"), [character("u1", generated)])
    expect(refs).toEqual([RESULT])
    expect(minimaxH3BillableRefImageCount({ referenceImageUrls: refs, firstFrameUrl: p.imageUrl })).toBe(1)
  })

  it("Kling 4.0's subject starts with that portrait, and its seat becomes the subject", () => {
    const { p, subjects } = run(video("kling-4"), [character("u1", generated)])
    expect(subjects?.[0]).toMatchObject({ name: "Character 1", imageUrl: RESULT, extraImageUrls: [smile("u1")] })
    const req = buildKling4Request({ provider: "kling-4", prompt: p.prompt as string, durationSec: 5, referenceImageUrls: p.referenceImageUrls as string[], characterReferences: subjects })
    expect(req.input.image_urls).toBeUndefined()
    expect((req.input.elements as Array<{ image_urls: string[] }>)[0]!.image_urls).toEqual([RESULT, smile("u1")])
  })
})

/**
 * A mention saved before unnamed characters were numbered (decided
 * 2026-11-11): with exactly ONE unnamed character wired, `@character-asset:N…`
 * and `@character:N…` read as that character; with two or more they stay plain
 * text (nothing resolves them).
 */
describe("old @character-asset / @character mentions", () => {
  it("one unnamed character: the mention resolves on Generate Image and on video", () => {
    const img = run(image({ prompt: "make @character-asset:1 smile" }), [character("u1")])
    expect(img.prompt).not.toContain("@character-asset")
    expect(img.prompt).toContain("make Character 1 smile")
    expect(img.refs).toEqual([portrait("u1")])
    const vid = run(video("seedance-2", { prompt: "@character:1:smile waves" }), [character("u1"), character("n", { characterName: "Leo" })])
    expect(vid.prompt).not.toContain("@character:1")
    expect(vid.r.payload.referenceImageUrls).toContain(smile("u1"))
  })

  it("two unnamed characters: the mention stays plain text", () => {
    const { prompt } = run(image({ prompt: "make @character-asset:1 smile" }), [character("u1"), character("u2")])
    expect(prompt).toContain("make @character-asset:1 smile")
    const vid = run(video("kling-4", { prompt: "make @character:1 smile" }), [character("u1"), character("u2")])
    expect(vid.prompt).toContain("@character:1")
  })

  it("a node labelled 'Character' (the retired default) follows the same rule", () => {
    const one = run(image({ prompt: "make @character:1 smile" }), [character("u1", { label: "Character" })])
    expect(one.prompt).toContain("make Character 1 smile")
    const two = run(image({ prompt: "make @character:1 smile" }), [character("u1", { label: "Character" }), character("u2")])
    expect(two.prompt).toContain("make @character:1 smile")
  })
})

/**
 * A typed name the slug cannot spell (decided 2026-11-11) is a real name: the
 * model reads it as typed, and the character is keyed `character-N` from the
 * unnamed sequence so it is included and mentionable.
 */
describe("non-Latin character names are included", () => {
  for (const [locale, typed] of [["he", "מאיה"], ["ja", "マヤ"], ["ko", "마야"]] as const) {
    it(`${locale}: "${typed}" beside an unnamed node and a Latin-named one`, () => {
      const chars = [character("u1"), character("x", { characterName: typed }), character("l", { characterName: "Leo" })]
      const img = run(image(), chars)
      expect(img.refs).toEqual([portrait("u1"), portrait("x"), portrait("l")])
      expect(img.prompt).toContain("(Character 1) — the u1 look")
      expect(img.prompt).toContain(`(${typed}) — the x look`)
      expect(img.prompt).toContain("(Leo) — the l look")
      const kling = run(video("kling-4"), chars)
      expect(kling.subjects?.map((s) => s.name)).toEqual(["Character 1", typed, "Leo"])
      // Its mention key resolves: @character-2 is this character.
      const mentioned = run(video("seedance-2", { prompt: "@character-2:1:smile waves" }), chars)
      expect(mentioned.prompt).not.toContain("@character-2")
      expect(mentioned.r.payload.referenceImageUrls).toContain(smile("x"))
    })
  }
})
