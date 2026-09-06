import { describe, it, expect } from "vitest"

import type { Shot, ShotClip, ShotClipResult } from "../shot"
import {
  buildClip,
  buildStill,
  clipResults,
  productionClips,
  productionImageRefs,
  productionStills,
  productionVideoRefs,
  formatCutDuration,
  nextCutName,
  shotDisplayName,
  shotFileName,
  stillDisplayName,
} from "../shot"

/**
 * Unit tests for the pure clip-history helpers — the video mirror of
 * `buildStill`/`stillResults`. The two invariants that matter:
 *   1. SHAPE COLLAPSE — a lone result collapses to the minimal legacy shape (no
 *      `results`/`activeIndex`) so single-clip productions round-trip
 *      byte-identical; >1 carries the list + its `activeIndex`.
 *   2. ACTIVE MIRROR — `url` always equals `results[activeIndex].url` so every
 *      reader (export, card label) keeps working off `clip.url`.
 * Plus: the re-voice provenance + duration on `base` survive `buildClip`.
 */

describe("clipResults", () => {
  it("normalizes a legacy single-`url` clip to a one-result list carrying its context", () => {
    const clip: ShotClip = {
      nodeId: "v1",
      url: "https://r2/clip.mp4",
      provider: "grok-i2v",
      prompt: "move",
      duration: 6,
    }
    // The clip-level fields mirror the active result, so the synthesized take
    // carries them — a bare `{url}` made single-take clips un-extendable (the
    // rail's per-take gate reads `result.provider`).
    expect(clipResults(clip)).toEqual([
      {
        url: "https://r2/clip.mp4",
        prompt: "move",
        provider: "grok-i2v",
        duration: 6,
      },
    ])
  })

  it("returns the explicit results list when present", () => {
    const results: ShotClipResult[] = [
      { url: "https://r2/1.mp4" },
      { url: "https://r2/2.mp4", prompt: "drift" },
    ]
    const clip: ShotClip = {
      nodeId: "v1",
      url: "https://r2/2.mp4",
      provider: "grok-i2v",
      prompt: "move",
      results,
      activeIndex: 1,
    }
    expect(clipResults(clip)).toBe(results)
  })
})

describe("buildClip", () => {
  it("collapses a lone result to the minimal legacy shape (no results/activeIndex)", () => {
    const clip = buildClip(
      { nodeId: "v1", provider: "grok-i2v", prompt: "move" },
      [{ url: "https://r2/only.mp4" }],
      0,
    )
    expect(clip).toEqual({
      nodeId: "v1",
      url: "https://r2/only.mp4",
      provider: "grok-i2v",
      prompt: "move",
    })
    expect(clip.results).toBeUndefined()
    expect(clip.activeIndex).toBeUndefined()
  })

  it("keeps the list + activeIndex for >1, with url mirroring the active result", () => {
    const results: ShotClipResult[] = [
      { url: "https://r2/1.mp4" },
      { url: "https://r2/2.mp4" },
      { url: "https://r2/3.mp4" },
    ]
    const clip = buildClip({ nodeId: "v1", provider: "p", prompt: "q" }, results, 1)
    expect(clip.results).toBe(results)
    expect(clip.activeIndex).toBe(1)
    expect(clip.url).toBe("https://r2/2.mp4") // mirrors the active result
  })

  it("defaults provider/prompt to empty strings (mirrors buildStill)", () => {
    const clip = buildClip({ nodeId: "v1" }, [{ url: "https://r2/only.mp4" }], 0)
    expect(clip.provider).toBe("")
    expect(clip.prompt).toBe("")
  })

  it("PRESERVES the re-voice provenance + duration through the collapse", () => {
    const clip = buildClip(
      {
        nodeId: "v1",
        provider: "grok-i2v",
        prompt: "move",
        duration: 5,
        revoicedVoiceId: "voice-123",
        revoicedVoiceName: "Rachel",
      },
      [{ url: "https://r2/only.mp4" }],
      0,
    )
    expect(clip.duration).toBe(5)
    expect(clip.revoicedVoiceId).toBe("voice-123")
    expect(clip.revoicedVoiceName).toBe("Rachel")
  })

  it("omits absent optional fields so an un-revoiced single clip stays minimal", () => {
    const clip = buildClip(
      { nodeId: "v1", provider: "grok-i2v", prompt: "move" },
      [{ url: "https://r2/only.mp4" }],
      0,
    )
    expect(clip).not.toHaveProperty("duration")
    expect(clip).not.toHaveProperty("revoicedVoiceId")
    expect(clip).not.toHaveProperty("revoicedVoiceName")
  })

  it("carries per-result provider/duration through (the directing clip-select restore)", () => {
    // ShotClipResult now records the model + length each clip was generated with;
    // buildClip passes the results array through verbatim, so they survive on the
    // (>1) list for handleSelectClip to read back. (A lone result collapses away
    // the list by design — same as prompt/jobId — so use ≥2 here.)
    const results: ShotClipResult[] = [
      { url: "https://r2/1.mp4", provider: "grok-i2v", duration: 5 },
      { url: "https://r2/2.mp4", provider: "veo-3", duration: 8 },
    ]
    const clip = buildClip({ nodeId: "v1" }, results, 1)
    expect(clip.results).toBe(results)
    expect(clip.results?.[0]).toMatchObject({ provider: "grok-i2v", duration: 5 })
    expect(clip.results?.[1]).toMatchObject({ provider: "veo-3", duration: 8 })
  })

  it("KEEPS the list for a lone take made from frames or reference images", () => {
    // The frames a take was animated FROM and the references rail it was sent
    // with live PER-RESULT and have no clip-level mirror, so the minimal
    // collapse DROPPED them: a single frames take reloaded with no start/end
    // frame, a single references take with an empty rail. (The still mirror of
    // this is buildStill's own referenceImageUrls clause.)
    const frames = buildClip(
      { nodeId: "v1", provider: "seedance-2", prompt: "move" },
      [
        {
          url: "https://r2/only.mp4",
          startFrameUrl: "https://r2/start.png",
          endFrameUrl: "https://r2/end.png",
        },
      ],
      0,
    )
    expect(frames.results?.[0]).toMatchObject({
      startFrameUrl: "https://r2/start.png",
      endFrameUrl: "https://r2/end.png",
    })
    expect(frames.activeIndex).toBe(0)

    const refs = buildClip(
      { nodeId: "v1", provider: "seedance-2", prompt: "move" },
      [{ url: "https://r2/only.mp4", referenceImageUrls: ["https://r2/ref.png"] }],
      0,
    )
    expect(refs.results?.[0]?.referenceImageUrls).toEqual(["https://r2/ref.png"])
  })

  it("KEEPS the list for a lone take whose only reference is a video or an audio clip", () => {
    // The same class as the image rail: per-result, no clip-level mirror,
    // written and read by the graph — a lone references take made from a
    // motion or an audio reference alone must not collapse either.
    const video = buildClip(
      { nodeId: "v1", provider: "seedance-2", prompt: "move" },
      [{ url: "https://r2/only.mp4", referenceVideoUrls: ["https://r2/motion.mp4"] }],
      0,
    )
    expect(video.results?.[0]?.referenceVideoUrls).toEqual(["https://r2/motion.mp4"])

    const audio = buildClip(
      { nodeId: "v1", provider: "seedance-2", prompt: "move" },
      [{ url: "https://r2/only.mp4", referenceAudioUrls: ["https://r2/beat.mp3"] }],
      0,
    )
    expect(audio.results?.[0]?.referenceAudioUrls).toEqual(["https://r2/beat.mp3"])
  })

  it("does not mutate the passed results array", () => {
    const results: ShotClipResult[] = [{ url: "https://r2/1.mp4" }, { url: "https://r2/2.mp4" }]
    const frozen = Object.freeze([...results])
    buildClip({ nodeId: "v1" }, frozen, 0)
    expect(results).toEqual([{ url: "https://r2/1.mp4" }, { url: "https://r2/2.mp4" }])
  })
})

describe("buildStill", () => {
  it("KEEPS the list for a lone still that carries manual reference images", () => {
    // A continuity still IS the previous frame, recorded as its OWN reference — the
    // minimal collapse would DROP referenceImageUrls (they live per-result), losing
    // the Framing-strip auto-fill on shot-select. So the list is kept.
    const still = buildStill(
      { nodeId: "i1", provider: "nano-banana", prompt: "" },
      [{ url: "https://r2/frame.png", referenceImageUrls: ["https://r2/frame.png"] }],
      0,
    )
    expect(still.results).toHaveLength(1)
    expect(still.results?.[0]?.referenceImageUrls).toEqual(["https://r2/frame.png"])
    expect(still.url).toBe("https://r2/frame.png")
  })

  it("KEEPS the list for a lone still that carries a custom name", () => {
    // A renamed image referenced as an image chip lives per-result; the minimal
    // collapse would DROP the name (losing the label + chip binding on reload).
    const still = buildStill(
      { nodeId: "i1", provider: "nano-banana", prompt: "" },
      [{ url: "https://r2/hero.png", name: "Hero astronaut" }],
      0,
    )
    expect(still.results).toHaveLength(1)
    expect(still.results?.[0]?.name).toBe("Hero astronaut")
    expect(still.url).toBe("https://r2/hero.png")
  })

  it("still collapses a truly bare lone still (no chips / no refs / no name)", () => {
    const still = buildStill(
      { nodeId: "i1", provider: "p", prompt: "q" },
      [{ url: "https://r2/only.png" }],
      0,
    )
    expect(still).toEqual({
      nodeId: "i1",
      url: "https://r2/only.png",
      provider: "p",
      prompt: "q",
    })
    expect(still.results).toBeUndefined()
  })
})

describe("stillDisplayName", () => {
  it("derives a 1-based `Ref N` when there is no custom name", () => {
    // `Ref`, never `Image`: "Image N" is the models' own grammar for the N-th
    // ATTACHMENT, and this list's order is not the attachment order.
    expect(stillDisplayName({}, 0)).toBe("Ref 1")
    expect(stillDisplayName({ name: "  " }, 2)).toBe("Ref 3") // blank → derived
  })

  it("uses the trimmed custom name when set", () => {
    expect(stillDisplayName({ name: "  Hero  " }, 5)).toBe("Hero")
  })
})

describe("cut helpers", () => {
  it("nextCutName runs A→Z then falls back to numbers", () => {
    expect(nextCutName(0)).toBe("Cut A")
    expect(nextCutName(3)).toBe("Cut D")
    expect(nextCutName(25)).toBe("Cut Z")
    expect(nextCutName(26)).toBe("Cut 27")
  })

  it("formatCutDuration reads like the panel rows", () => {
    expect(formatCutDuration(48)).toBe("48s")
    expect(formatCutDuration(108)).toBe("1m 48s")
    expect(formatCutDuration(122.4)).toBe("2m 02s")
  })
})

describe("shotDisplayName", () => {
  it("derives the POSITIONAL `Shot N` when there is no custom name (1-based index)", () => {
    expect(shotDisplayName({}, 1)).toBe("Scene 1")
    expect(shotDisplayName({ name: "  " }, 4)).toBe("Scene 4") // blank → derived
  })

  it("uses the trimmed custom name when set", () => {
    expect(shotDisplayName({ name: "  Chariot arrival  " }, 2)).toBe("Chariot arrival")
  })
})

describe("shotFileName", () => {
  it("is the display name + .mp4 — the ONE file-name rule for every surface", () => {
    expect(shotFileName({}, 1)).toBe("Scene 1.mp4")
    expect(shotFileName({ name: "Chariot arrival" }, 2)).toBe("Chariot arrival.mp4")
  })

  it("strips path-hostile characters from a custom name (fallback on all-hostile)", () => {
    expect(shotFileName({ name: 'Act 1/2: "the*chase"' }, 3)).toBe("Act 1-2- -the-chase.mp4")
    expect(shotFileName({ name: "///" }, 5)).toBe("Scene 5.mp4")
  })
})

describe("productionImageRefs", () => {
  const withStill = (
    id: string,
    results: ReadonlyArray<{ url: string; jobId?: string; name?: string }>,
  ): Shot => ({ id, still: buildStill({ nodeId: `n-${id}` }, results, 0) })

  it("numbers distinct images globally across shots and resolves names", () => {
    const shots: Shot[] = [
      withStill("s1", [
        { url: "https://r2/a.png", jobId: "j1", name: "Hero astronaut" },
        { url: "https://r2/b.png", jobId: "j2" },
      ]),
      withStill("s2", [
        { url: "https://r2/c.png", jobId: "j3" },
        { url: "https://r2/a.png", jobId: "j4" }, // duplicate url → dropped
      ]),
      { id: "s3" }, // no still → contributes nothing
    ]
    expect(productionImageRefs(shots)).toEqual([
      { id: "j1", url: "https://r2/a.png", name: "Hero astronaut", shotId: "s1" },
      { id: "j2", url: "https://r2/b.png", name: "Ref 2", shotId: "s1" },
      { id: "j3", url: "https://r2/c.png", name: "Ref 3", shotId: "s2" },
    ])
  })

  it("falls back to a per-shot index id for an upload (lone result, no jobId)", () => {
    expect(
      productionImageRefs([withStill("s1", [{ url: "https://r2/u.png" }])]),
    ).toEqual([{ id: "s1:0", url: "https://r2/u.png", name: "Ref 1", shotId: "s1" }])
  })
})

describe("productionVideoRefs", () => {
  const withClip = (
    id: string,
    name: string | undefined,
    results: ReadonlyArray<{ url: string; jobId?: string; name?: string }>,
  ): Shot => ({
    id,
    ...(name ? { name } : {}),
    clip: buildClip({ nodeId: `n-${id}` }, results, 0),
  })

  it("names a take by its SCENE, because these rows are read project-wide", () => {
    const shots: Shot[] = [
      withClip("s1", undefined, [
        { url: "https://r2/a.mp4", jobId: "j1" },
        { url: "https://r2/b.mp4", jobId: "j2", name: "The dive" },
      ]),
      withClip("s2", "Rooftop chase", [
        { url: "https://r2/c.mp4", jobId: "j3" },
        { url: "https://r2/a.mp4", jobId: "j4" }, // duplicate url → dropped
      ]),
      { id: "s3" }, // no clip → contributes nothing
    ]
    expect(productionVideoRefs(shots).map((v) => `${v.id}:${v.name}`)).toEqual([
      "j1:Scene 1 · Take 1",
      "j2:The dive", // a custom take name wins outright
      "j3:Rooftop chase · Take 1",
    ])
  })

  it("posters a take with the frame it was animated FROM", () => {
    const shots: Shot[] = [
      {
        id: "s1",
        clip: buildClip(
          { nodeId: "n1" },
          [
            { url: "https://r2/a.mp4", startFrameUrl: "https://r2/start.png" },
            { url: "https://r2/b.mp4" },
          ],
          0,
        ),
      },
    ]
    expect(productionVideoRefs(shots).map((v) => v.posterUrl)).toEqual([
      "https://r2/start.png",
      null,
    ])
  })

  it("is the same walk productionClips projects (they can't disagree)", () => {
    const shots: Shot[] = [
      withClip("s1", undefined, [
        { url: "https://r2/a.mp4", jobId: "j1" },
        { url: "https://r2/b.mp4" },
      ]),
    ]
    expect(productionClips(shots)).toEqual(
      productionVideoRefs(shots).map(({ id, url }) => ({ id, url })),
    )
  })
})

describe("productionStills", () => {
  // Minimal Shot stubs — the helper only reads `id` + `still` (Shot's other fields
  // are optional). buildStill keeps the results list for >1 generations; a lone
  // result collapses to the legacy shape (no jobId).
  const withStill = (
    id: string,
    results: ReadonlyArray<{ url: string; jobId?: string }>,
  ): Shot => ({ id, still: buildStill({ nodeId: `n-${id}` }, results, 0) })

  it("collects EVERY result across shots (not just the active still), de-duped by url", () => {
    const shots: Shot[] = [
      withStill("s1", [
        { url: "https://r2/a.png", jobId: "j1" },
        { url: "https://r2/b.png", jobId: "j2" },
      ]),
      withStill("s2", [
        { url: "https://r2/c.png", jobId: "j3" },
        { url: "https://r2/a.png", jobId: "j4" }, // duplicate url across shots
      ]),
      { id: "s3" }, // no still → contributes nothing
    ]
    expect(productionStills(shots)).toEqual([
      { id: "j1", url: "https://r2/a.png" },
      { id: "j2", url: "https://r2/b.png" },
      { id: "j3", url: "https://r2/c.png" },
      // the second a.png (s2/j4) is dropped by the de-dup
    ])
  })

  it("falls back to a per-shot index id for an upload (a lone result has no jobId)", () => {
    expect(
      productionStills([withStill("s1", [{ url: "https://r2/u.png" }])]),
    ).toEqual([{ id: "s1:0", url: "https://r2/u.png" }])
  })
})
