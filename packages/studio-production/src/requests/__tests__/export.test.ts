/**
 * `planExport` — the film export, as a PLAN of steps an agent runs (D8).
 *
 * The oracle is `src/hooks/useExport.ts` in the studio app (the `exportMp4` +
 * `upscale4k` callbacks): the step ORDER, each step's PARAMS and the two credit
 * model ids are read off that hook line by line. The hook has no test of its
 * own in the studio repo — it is a React hook wired to a live client — so these
 * cases are not a port of assertions but a pin of the hook's observable wire,
 * written the way the ported suites are: fixtures built with the codec's own
 * builders, never hand-typed JSON.
 *
 * What the plan must preserve from the hook, and each case below pins one:
 *  - only shots WITH a clip take part, in timeline order, by `clip.url` (the
 *    mirror of the active take);
 *  - a shot whose `voice` has a url gets its own `merge-video-audio` FIRST, and
 *    the concatenate consumes that step's output at exactly that position;
 *  - `combine-videos` always carries `transition: "cut"` and `audioMode`
 *    `"keep"` when ANY clip is voiced, else `"remove"`;
 *  - a soundtrack muxes OVER the combined video with
 *    `keepOriginalAudio === hasVoice`;
 *  - the 4K upscale is `{ upscaleFactor: "4", provider: "topaz" }` over the LAST
 *    video, and only when asked;
 *  - fewer than two clips cannot export at all (`combine-videos` needs 2).
 */
import { describe, expect, it } from "vitest"

import type { Production } from "../../ops/production"
import type { Shot, ShotVoice } from "../../shot"
import { buildClip } from "../../shot-clip"
import { planExport } from "../export"

/** A shot carrying one clip take (built through the codec, like the app does). */
function clipShot(id: string, voice?: ShotVoice): Shot {
  const clip = buildClip(
    { nodeId: `generate-video-${id}`, provider: "seedance-1-pro", prompt: `move ${id}` },
    [{ url: `https://r2.example/${id}.mp4`, jobId: `job-${id}` }],
    0,
  )
  return { id, clip, ...(voice ? { voice } : {}) }
}

/** A shot with a still and no clip — the export must step right over it. */
function stillShot(id: string): Shot {
  return {
    id,
    still: {
      nodeId: `generate-image-${id}`,
      url: `https://r2.example/${id}.png`,
      provider: "nano-banana",
      prompt: `frame ${id}`,
    },
  }
}

const voice = (id: string): ShotVoice => ({
  url: `https://r2.example/${id}.mp3`,
  text: "a line",
})

const production = (shots: Shot[], rest: Partial<Production> = {}): Production => ({
  shots,
  ...rest,
})

/** Prices for the three credit models the plan can name. */
const COSTS = {
  "merge-video-audio": 2,
  "combine-videos": 10,
  "topaz-video": 400,
}

describe("planExport — what can export", () => {
  it("cannot export with fewer than two clips, and plans nothing", () => {
    for (const shots of [[], [stillShot("s1")], [clipShot("s1"), stillShot("s2")]]) {
      const plan = planExport(production(shots))
      expect(plan.canExport).toBe(false)
      expect(plan.steps).toEqual([])
      expect(plan.resultStepId).toBeNull()
      expect(plan.estimate).toBeNull()
    }
  })

  it("can export as soon as two shots have a clip", () => {
    const plan = planExport(production([clipShot("s1"), clipShot("s2")]))
    expect(plan.canExport).toBe(true)
  })
})

describe("planExport — the concatenate", () => {
  it("stitches the clip urls in timeline order, with audio removed when nothing is voiced", () => {
    const plan = planExport(production([clipShot("s1"), clipShot("s2"), clipShot("s3")]))
    expect(plan.steps).toHaveLength(1)
    const [combine] = plan.steps
    expect(combine.node).toBe("combine-videos")
    expect(combine.params).toEqual({
      videoUrls: [
        "https://r2.example/s1.mp4",
        "https://r2.example/s2.mp4",
        "https://r2.example/s3.mp4",
      ],
      transition: "cut",
      audioMode: "remove",
    })
    expect(plan.resultStepId).toBe(combine.id)
  })

  it("steps over a shot with no clip and keeps the remaining order", () => {
    const plan = planExport(
      production([stillShot("a"), clipShot("s1"), stillShot("b"), clipShot("s2")]),
    )
    const [combine] = plan.steps
    expect(combine.node).toBe("combine-videos")
    expect(combine.params).toMatchObject({
      videoUrls: ["https://r2.example/s1.mp4", "https://r2.example/s2.mp4"],
    })
  })

  it("ignores a voiceover on a shot that has no clip", () => {
    const shots = [clipShot("s1"), clipShot("s2"), { ...stillShot("s3"), voice: voice("s3") }]
    const plan = planExport(production(shots))
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0].params).toMatchObject({ audioMode: "remove" })
  })
})

describe("planExport — voiceovers", () => {
  it("muxes each voiced clip first and stitches that step's output at its own position", () => {
    const plan = planExport(
      production([clipShot("s1"), clipShot("s2", voice("s2")), clipShot("s3")]),
    )
    expect(plan.steps).toHaveLength(2)

    const [mux, combine] = plan.steps
    expect(mux.node).toBe("merge-video-audio")
    expect(mux.params).toEqual({
      videoUrl: "https://r2.example/s2.mp4",
      audioUrl: "https://r2.example/s2.mp3",
    })

    expect(combine.node).toBe("combine-videos")
    expect(combine.params).toEqual({
      videoUrls: [
        "https://r2.example/s1.mp4",
        { fromStep: mux.id },
        "https://r2.example/s3.mp4",
      ],
      transition: "cut",
      audioMode: "keep",
    })
  })

  it("gives every voiced clip its own step, in timeline order", () => {
    const plan = planExport(
      production([clipShot("s1", voice("s1")), clipShot("s2"), clipShot("s3", voice("s3"))]),
    )
    expect(plan.steps.map((s) => s.node)).toEqual([
      "merge-video-audio",
      "merge-video-audio",
      "combine-videos",
    ])
    const combine = plan.steps[2]
    expect(combine.params).toMatchObject({
      videoUrls: [
        { fromStep: plan.steps[0].id },
        "https://r2.example/s2.mp4",
        { fromStep: plan.steps[1].id },
      ],
      audioMode: "keep",
    })
  })

  it("does not mux a voice row that carries no url", () => {
    const shots = [clipShot("s1", { url: "", text: "unspoken" }), clipShot("s2")]
    const plan = planExport(production(shots))
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0].params).toMatchObject({ audioMode: "remove" })
  })
})

describe("planExport — the soundtrack", () => {
  const music = { url: "https://r2.example/track.mp3", prompt: "a slow synth" }

  it("muxes the soundtrack over the combined video, dropping the (absent) voice track", () => {
    const plan = planExport(production([clipShot("s1"), clipShot("s2")], { music }))
    expect(plan.steps.map((s) => s.node)).toEqual(["combine-videos", "merge-video-audio"])
    const [combine, soundtrack] = plan.steps
    expect(soundtrack.params).toEqual({
      videoUrl: { fromStep: combine.id },
      audioUrl: music.url,
      keepOriginalAudio: false,
    })
    expect(plan.resultStepId).toBe(soundtrack.id)
  })

  it("keeps the original audio when a clip is voiced", () => {
    const plan = planExport(
      production([clipShot("s1", voice("s1")), clipShot("s2")], { music }),
    )
    const soundtrack = plan.steps[plan.steps.length - 1]
    expect(soundtrack.params).toMatchObject({ keepOriginalAudio: true })
  })
})

describe("planExport — the 4K upscale", () => {
  const music = { url: "https://r2.example/track.mp3", prompt: "a slow synth" }

  it("is absent unless asked for", () => {
    const plan = planExport(production([clipShot("s1"), clipShot("s2")]))
    expect(plan.steps.map((s) => s.node)).not.toContain("video-upscale")
  })

  it("upscales the combined video when there is no soundtrack", () => {
    const plan = planExport(production([clipShot("s1"), clipShot("s2")]), {
      upscale: true,
    })
    const [combine, upscale] = plan.steps
    expect(upscale.node).toBe("video-upscale")
    expect(upscale.params).toEqual({
      videoUrl: { fromStep: combine.id },
      upscaleFactor: "4",
      provider: "topaz",
    })
    expect(plan.resultStepId).toBe(upscale.id)
  })

  it("upscales the SOUNDTRACKED video when there is one", () => {
    const plan = planExport(production([clipShot("s1"), clipShot("s2")], { music }), {
      upscale: true,
    })
    const [, soundtrack, upscale] = plan.steps
    expect(upscale.node).toBe("video-upscale")
    expect(upscale.params).toMatchObject({ videoUrl: { fromStep: soundtrack.id } })
    expect(plan.resultStepId).toBe(upscale.id)
  })
})

describe("planExport — attribution", () => {
  it("attributes every step to the production's workflow when it is given", () => {
    const plan = planExport(
      production([clipShot("s1", voice("s1")), clipShot("s2")], {
        music: { url: "https://r2.example/track.mp3", prompt: "" },
      }),
      { upscale: true, workflowId: "wf-1" },
    )
    expect(plan.steps).toHaveLength(4)
    for (const step of plan.steps) {
      expect(step.params).toMatchObject({ workflowId: "wf-1" })
    }
  })

  it("carries no workflowId key at all when none is given", () => {
    const plan = planExport(production([clipShot("s1"), clipShot("s2")]))
    expect(Object.keys(plan.steps[0].params)).not.toContain("workflowId")
  })
})

describe("planExport — the credit estimate", () => {
  it("prices each step from ctx.modelCosts and sums them", () => {
    const plan = planExport(
      production([clipShot("s1", voice("s1")), clipShot("s2")]),
      { upscale: true },
      { modelCosts: COSTS },
    )
    expect(plan.steps.map((s) => s.creditModel)).toEqual([
      "merge-video-audio",
      "combine-videos",
      "topaz-video",
    ])
    expect(plan.steps.map((s) => s.credits)).toEqual([2, 10, 400])
    expect(plan.estimate).toBe(412)
    expect(plan.unpriced).toEqual([])
  })

  it("refuses to guess: one missing price leaves the whole estimate null", () => {
    const { "topaz-video": _drop, ...partial } = COSTS
    const plan = planExport(
      production([clipShot("s1"), clipShot("s2")]),
      { upscale: true },
      { modelCosts: partial },
    )
    expect(plan.steps.map((s) => s.credits)).toEqual([10, null])
    expect(plan.estimate).toBeNull()
    expect(plan.unpriced).toEqual(["topaz-video"])
  })

  it("has no estimate at all without model costs", () => {
    const plan = planExport(production([clipShot("s1"), clipShot("s2")]))
    expect(plan.steps[0].credits).toBeNull()
    expect(plan.estimate).toBeNull()
    expect(plan.unpriced).toEqual(["combine-videos"])
  })

  it("names an unpriced model once, however many steps use it", () => {
    const plan = planExport(
      production([clipShot("s1", voice("s1")), clipShot("s2", voice("s2"))]),
      undefined,
      { modelCosts: { "combine-videos": 10 } },
    )
    expect(plan.unpriced).toEqual(["merge-video-audio"])
  })
})

describe("planExport — purity", () => {
  it("never touches the production it was handed", () => {
    const p = production([clipShot("s1", voice("s1")), clipShot("s2")], {
      music: { url: "https://r2.example/track.mp3", prompt: "x" },
    })
    const before = structuredClone(p)
    planExport(p, { upscale: true, workflowId: "wf-1" }, { modelCosts: COSTS })
    expect(p).toEqual(before)
  })

  it("plans the same steps twice for the same input (no clock, no randomness)", () => {
    const p = production([clipShot("s1", voice("s1")), clipShot("s2")])
    expect(planExport(p, { upscale: true })).toEqual(planExport(p, { upscale: true }))
  })
})
