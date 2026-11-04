import { describe, expect, it } from "vitest"
import type { QuoteRecord, ReuseEntryView } from "../records.js"
import { LOCAL_ROUTES, quoteLineOf, reusedOf, stepOf, type StepIdentity } from "../steps.js"

const RUN = "00000000-0000-4000-8000-0000000000a1"
const OTHER_RUN = "00000000-0000-4000-8000-0000000000b2"
const RENDER_JOB = "00000000-0000-4000-8000-0000000000c3"

/** A quote carrying every in-hold line, and no extras. */
const QUOTE: QuoteRecord = {
  totalCredits: 2000,
  expectedCredits: 1500,
  breakdown: {
    base: 40, motion: 1000, motionExpected: 800, motionHd: 600, references: 200,
    referenceAudio: 30, prompt: 20, privacy: 60, styleRefs: 50,
  },
  privacyCredits: null,
  referencesRetryCredits: null,
}

const withExtras: QuoteRecord = { ...QUOTE, privacyCredits: 60, referencesRetryCredits: 90 }
/** Full Quality's quotes: Pulse's new take, Prism's 1080p finalize. */
const PULSE_FQ: QuoteRecord = { totalCredits: 600, expectedCredits: null, breakdown: { base: 40, motion: 560 }, privacyCredits: null, referencesRetryCredits: null }
const PRISM_FQ: QuoteRecord = { totalCredits: 640, expectedCredits: null, breakdown: { base: 40, motionHd: 600 }, privacyCredits: null, referencesRetryCredits: null }

const row = (step_key: string | null, route: string, depth = 1) => ({ depth, route, step_key })
const at = (key: string) => key.replace("R", RUN)

type Case = [key: string | null, route: string, depth: number, expected: Omit<StepIdentity, "local">, local: boolean, line: string | null]

const step = (name: string, kind: StepIdentity["kind"], role: number | null = null, round: StepIdentity["round"] = "first") => ({ name, role, kind, round })

// One row per key form of the step-name table, on a run that is not a depth-map run.
const TABLE: Case[] = [
  [null, "cast-swap", 0, step("Run", "base"), false, "base"],
  ["cast-swap-child:R", "generate-video", 1, step("Render", "render"), false, "motion"],
  ["cast-swap-child:R:masked", "generate-video", 1, step("Render — masked retry", "render", null, "retry"), false, "motion"],
  ["cast-swap-child:R:sheets", "generate-video", 1, step("Render — sheet retry", "render", null, "regen"), false, "motion"],
  ["cast-swap-child:R:clip-body", "generate-video", 1, step("Render — body-from-the-clip retry", "render", null, "retry"), false, "motion"],
  ["cast-swap-child:R:vocals", "audio-separation", 1, step("Vocals split", "vocals"), false, "referenceAudio"],
  ["cast-swap-fq-child:R", "video-upscale", 1, step("1080p render", "render-hd"), false, "motionHd"],
  ["cast-swap-fq-child:R", "generate-video", 1, step("1080p take", "render-hd"), false, "motionHd"],
  ["cast-swap-prep:R:0", "image-to-image", 1, step("Reference sheet", "sheet", 0), false, "references"],
  ["cast-swap-prep:R:1:retry1", "image-to-image", 1, step("Reference sheet", "sheet", 1), false, "references"],
  ["cast-swap-prep:R:0:head", "image-to-image", 1, step("Reference sheet — head close-up", "sheet", 0), false, "references"],
  ["cast-swap-prep:R:0:head-sheet", "image-to-image", 1, step("Reference sheet", "sheet", 0), false, "references"],
  ["cast-swap-prep:R:2:regen", "image-to-image", 1, step("Reference sheet", "sheet", 2, "regen"), false, "references"],
  ["cast-swap-prep:R:2:regen:retry1", "image-to-image", 1, step("Reference sheet", "sheet", 2, "regen"), false, "references"],
  ["cast-swap-prep:R:2:regen:head", "image-to-image", 1, step("Reference sheet — head close-up", "sheet", 2, "regen"), false, "references"],
  ["cast-swap-prep:R:2:regen:head-sheet", "image-to-image", 1, step("Reference sheet", "sheet", 2, "regen"), false, "references"],
  ["cast-swap-clipbody:R:0", "image-to-image", 1, step("Body from the clip — picture", "clip-body-picture", 0), false, "references"],
  ["cast-swap-clipbody:R:0:retry2", "image-to-image", 1, step("Body from the clip — picture", "clip-body-picture", 0), false, "references"],
  ["cast-swap-clipbody:R:1:regen", "image-to-image", 1, step("Body from the clip — picture", "clip-body-picture", 1, "regen"), false, "references"],
  ["cast-swap-clipbody:R:1:regen:retry1", "image-to-image", 1, step("Body from the clip — picture", "clip-body-picture", 1, "regen"), false, "references"],
  ["cast-swap-stylerefs:R:0", "image-to-image", 1, step("Styled role picture", "styled-picture", 0), false, "styleRefs"],
  ["cast-swap-stylerefs:R:3:retry1", "image-to-image", 1, step("Styled role picture", "styled-picture", 3), false, "styleRefs"],
  ["cast-swap-llm:R:photo-labels:1:1:0a1b2c3d", "llm-chat", 1, step("Photo labels", "labels", 1), false, "references"],
  ["cast-swap-llm:R:engine-prompt:run:1:0a1b2c3d", "llm-chat", 1, step("Engine prompt", "engine-prompt"), false, "prompt"],
  ["cast-swap-llm:R:clip-body-pick:run:1:0a1b2c3d", "llm-chat", 1, step("Body from the clip — frame pick", "clip-body-llm"), false, "references"],
  ["cast-swap-llm:R:clip-body-describe:run:1:0a1b2c3d", "llm-chat", 1, step("Body from the clip — words", "clip-body-llm"), false, "references"],
  ["cast-swap-llm:R:clip-body-words:run:2:0a1b2c3d", "llm-chat", 1, step("Body from the clip — words", "clip-body-llm"), false, "references"],
  ["cast-swap-llm:R:shot-list:run:1:0a1b2c3d", "llm-chat", 1, step("Shot list", "scene"), false, "prompt"],
  ["cast-swap-llm:R:scene-description:run:1:0a1b2c3d", "llm-chat", 1, step("Scene description", "scene"), false, "prompt"],
  ["cast-swap-llm:R:scene-rewrite:run:2:0a1b2c3d", "llm-chat", 1, step("Scene rewrite", "scene"), false, "prompt"],
  ["cast-swap-mask:R:first", "video-mask", 2, step("Face mask", "masking"), false, "privacy"],
  ["cast-swap-mask:R:retry", "video-mask", 2, step("Face mask (retry)", "masking", null, "retry"), false, "privacy"],
  ["cast-swap-mask-main:R:first", "mask-erase", 2, step("Face mask", "masking"), true, "privacy"],
  ["cast-swap-depth:R:first", "video-depth", 2, step("Face depth", "masking"), false, "privacy"],
  ["cast-swap-depth-gray:R:retry", "video-depth", 2, step("Face depth (retry)", "masking", null, "retry"), false, "privacy"],
  ["cast-swap-depth-clip:R:first", "video-depth", 1, step("Depth map", "depth-map"), false, "privacy"],
  ["cast-swap-depth-composite:R:first", "mask-composite", 2, step("Depth composite", "masking"), true, "privacy"],
  ["cast-swap-blur:R:retry", "mask-composite", 2, step("Blur (retry)", "masking", null, "retry"), true, "privacy"],
  ["cast-swap-keep-people:R:first", "mask-composite", 2, step("Keep-people composite", "masking"), true, "privacy"],
  ["cast-swap-face-mesh:R:first", "video-face-mesh", 2, step("Face mesh", "masking"), true, "privacy"],
  ["cast-swap-depth-mesh:R:retry", "video-face-mesh", 2, step("Face mesh (retry)", "masking", null, "retry"), true, "privacy"],
  ["cast-swap-mask-outline:R:first", "mask-outline", 2, step("Role outlines", "masking"), true, "privacy"],
  ["cast-swap-mask-erase:R:first", "mask-erase", 2, step("Mask erase", "masking"), true, "privacy"],
  ["cast-swap-llm:R:make-shot-list:run:1:0a1b2c3d", "llm-chat", 1, step("LLM call (make-shot-list)", "other"), false, null],
  [null, "generate-image", 1, step("Other step (generate-image)", "other"), false, null],
]

describe("stepOf and quoteLineOf, per key form", () => {
  it.each(TABLE)("%s (%s, depth %i)", (key, route, depth, expected, local, line) => {
    const identity = stepOf(row(key === null ? null : at(key), route, depth), RUN, false)
    expect(identity).toEqual({ ...expected, local })
    expect(quoteLineOf(identity, { quote: QUOTE, depthMapRun: false })).toBe(line)
  })

  it("names a Full Quality try's own row Full Quality, whatever its key", () => {
    expect(stepOf(row(`cast-swap-fq:${OTHER_RUN}:2`, "cast-swap-full-quality", 0), RUN, true)).toEqual({
      name: "Full Quality", role: null, kind: "base", round: "first", local: false,
    })
  })

  it("local is the route's: only the routes that run on our own machines", () => {
    expect([...LOCAL_ROUTES]).toEqual(["mask-composite", "mask-erase", "mask-outline", "video-face-mesh"])
    expect(stepOf(row(null, "mask-outline"), RUN, false)).toMatchObject({ name: "Other step (mask-outline)", kind: "other", local: true })
  })

  it("an unknown prefix is Other step (generate-image)", () => {
    expect(stepOf(row(at("cast-swap-thing:R:0"), "generate-image"), RUN, false)).toEqual({
      name: "Other step (generate-image)", role: null, kind: "other", round: "first", local: false,
    })
  })

  it("a key that holds another run's id is Other step", () => {
    for (const key of [`cast-swap-child:${OTHER_RUN}`, `cast-swap-prep:${OTHER_RUN}:0`, `cast-swap-mask:${OTHER_RUN}:first`]) {
      expect(stepOf(row(key, "generate-video"), RUN, false).name).toBe("Other step (generate-video)")
    }
  })

  it("the run's id matches whatever its letters' case", () => {
    expect(stepOf(row(`cast-swap-child:${RUN.toUpperCase()}`, "generate-video"), RUN, false).name).toBe("Render")
  })

  it("matches a prefix as a whole token, and a key's form exactly: anything else is Other step", () => {
    for (const key of [
      "cast-swap-depth-clipper:R:first",
      "cast-swap-mask:R",
      "cast-swap-mask:R:second",
      "cast-swap-mask:R:first:2",
      "cast-swap-child:R:other",
      "cast-swap-child:R:masked:2",
      "cast-swap-fq-child:R:2",
      "cast-swap-prep:R",
      "cast-swap-prep:R:x",
      "cast-swap-prep:R:01",
      "cast-swap-prep:R:0:regen:regen",
      "cast-swap-prep:R:0:retry0",
      "cast-swap-prep:R:0:head:retry1",
      "cast-swap-clipbody:R:0:head",
      "cast-swap-stylerefs:R:0:regen",
      "cast-swap-llm:R",
      "cast-swap-llm:R::run:1:0a1b2c3d",
      "cast-swap-child:R:constructor",
      "fp:0a1b2c3d4e5f",
      "",
    ]) {
      expect(stepOf(row(at(key), "generate-image"), RUN, false), key).toMatchObject({ name: "Other step (generate-image)", kind: "other" })
    }
  })

  it("Photo labels reads its role from the key's scope, none when the scope is not a role", () => {
    expect(stepOf(row(at("cast-swap-llm:R:photo-labels:run:1:0a1b2c3d"), "llm-chat"), RUN, false)).toMatchObject({ name: "Photo labels", role: null })
  })
})

describe("quoteLineOf, its branches", () => {
  const ident = (key: string, route = "video-mask") => stepOf(row(at(key), route), RUN, false)

  it("a retry masking step goes to privacyCredits with that extra, to privacy without it", () => {
    for (const key of ["cast-swap-mask:R:retry", "cast-swap-blur:R:retry", "cast-swap-depth-clip:R:retry"]) {
      expect(quoteLineOf(ident(key), { quote: withExtras, depthMapRun: false }), key).toBe("privacyCredits")
      expect(quoteLineOf(ident(key), { quote: QUOTE, depthMapRun: false }), key).toBe("privacy")
    }
    expect(quoteLineOf(ident("cast-swap-mask:R:first"), { quote: withExtras, depthMapRun: false })).toBe("privacy")
  })

  it("a regen sheet (or body-from-the-clip picture) goes to referencesRetryCredits when recorded, else references", () => {
    for (const key of ["cast-swap-prep:R:0:regen", "cast-swap-prep:R:0:regen:head", "cast-swap-clipbody:R:1:regen:retry1"]) {
      expect(quoteLineOf(ident(key, "image-to-image"), { quote: withExtras, depthMapRun: false }), key).toBe("referencesRetryCredits")
      expect(quoteLineOf(ident(key, "image-to-image"), { quote: QUOTE, depthMapRun: false }), key).toBe("references")
    }
    expect(quoteLineOf(ident("cast-swap-prep:R:0:retry1", "image-to-image"), { quote: withExtras, depthMapRun: false })).toBe("references")
  })

  it("a scene step goes to privacy on a depth-map run, to prompt otherwise", () => {
    for (const key of ["cast-swap-llm:R:shot-list:run:1:0a1b2c3d", "cast-swap-llm:R:scene-description:run:1:0a1b2c3d", "cast-swap-llm:R:scene-rewrite:run:1:0a1b2c3d"]) {
      expect(quoteLineOf(ident(key, "llm-chat"), { quote: QUOTE, depthMapRun: true }), key).toBe("privacy")
      expect(quoteLineOf(ident(key, "llm-chat"), { quote: QUOTE, depthMapRun: false }), key).toBe("prompt")
    }
  })

  it("a Full Quality Pulse take goes to motion; Prism's 1080p render to motionHd", () => {
    const take = stepOf(row(at("cast-swap-fq-child:R"), "generate-video"), RUN, true)
    expect(take.name).toBe("1080p take")
    expect(quoteLineOf(take, { quote: PULSE_FQ, depthMapRun: false })).toBe("motion")
    const render = stepOf(row(at("cast-swap-fq-child:R"), "video-upscale"), RUN, true)
    expect(quoteLineOf(render, { quote: PRISM_FQ, depthMapRun: false })).toBe("motionHd")
  })

  it("without a recorded quote, no step has a line", () => {
    for (const [key, route, depth] of TABLE) {
      const identity = stepOf(row(key === null ? null : at(key), route, depth), RUN, false)
      expect(quoteLineOf(identity, { quote: null, depthMapRun: true })).toBeNull()
    }
  })

  it("a step whose line the run's quote does not carry is on no line, never on a line the quote lacks", () => {
    const on = (key: string, route: string, quote: QuoteRecord, depthMapRun = false) => quoteLineOf(ident(key, route), { quote, depthMapRun })
    // Pulse's Full Quality quote carries base and motion only.
    expect(on("cast-swap-mask:R:first", "video-mask", PULSE_FQ)).toBeNull()
    expect(on("cast-swap-mask:R:retry", "video-mask", PULSE_FQ)).toBeNull()
    expect(on("cast-swap-llm:R:engine-prompt:run:1:0a1b2c3d", "llm-chat", PULSE_FQ)).toBeNull()
    expect(on("cast-swap-llm:R:scene-description:run:1:0a1b2c3d", "llm-chat", PULSE_FQ, true)).toBeNull()
    expect(on("cast-swap-prep:R:0:regen", "image-to-image", PULSE_FQ)).toBeNull()
    expect(on("cast-swap-stylerefs:R:0", "image-to-image", PULSE_FQ)).toBeNull()
    expect(on("cast-swap-child:R:vocals", "audio-separation", PULSE_FQ)).toBeNull()
    expect(on("cast-swap-child:R", "generate-video", PULSE_FQ)).toBe("motion")
    expect(quoteLineOf(stepOf(row(null, "cast-swap", 0), RUN, false), { quote: PULSE_FQ, depthMapRun: false })).toBe("base")
    // A recorded extra is a line of its own: a retry goes there whatever the breakdown carries.
    expect(on("cast-swap-mask:R:retry", "video-mask", { ...PULSE_FQ, privacyCredits: 50 })).toBe("privacyCredits")
    expect(on("cast-swap-prep:R:0:regen", "image-to-image", { ...PULSE_FQ, referencesRetryCredits: 30 })).toBe("referencesRetryCredits")
  })

  it("a 1080p step is on motionHd, else motion, else no line", () => {
    const hd = stepOf(row(at("cast-swap-fq-child:R"), "video-upscale"), RUN, true)
    expect(quoteLineOf(hd, { quote: { ...PULSE_FQ, breakdown: { base: 40 } }, depthMapRun: false })).toBeNull()
  })
})

describe("reusedOf", () => {
  const entry = (step: string, over: Partial<ReuseEntryView> = {}): ReuseEntryView => ({ step, role: null, attempt: null, jobId: null, ref: null, ...over })

  it("names each kept step and gives it its quote line", () => {
    expect(
      reusedOf(
        [
          entry("reference-sheet", { role: 1 }),
          entry("photo-labels", { role: 0 }),
          entry("clip-body-picture", { role: 2 }),
          entry("styled-picture", { role: 0 }),
          entry("vocals"),
          entry("face-mask", { attempt: "first" }),
          entry("depth"),
          entry("new-thing", { role: 4 }),
        ],
        { quote: QUOTE },
      ),
    ).toEqual([
      { step: "reference-sheet", name: "Reference sheet (kept)", role: 1, jobId: null, count: 1, quoteLine: "references" },
      { step: "photo-labels", name: "Photo labels (kept)", role: 0, jobId: null, count: 1, quoteLine: "references" },
      { step: "clip-body-picture", name: "Body from the clip — picture (kept)", role: 2, jobId: null, count: 1, quoteLine: "references" },
      { step: "styled-picture", name: "Styled role picture (kept)", role: 0, jobId: null, count: 1, quoteLine: "styleRefs" },
      { step: "vocals", name: "Vocals split (kept vocals)", role: null, jobId: null, count: 1, quoteLine: "referenceAudio" },
      { step: "face-mask", name: "Face mask (the trend's stored mask)", role: null, jobId: null, count: 1, quoteLine: "privacy" },
      { step: "depth", name: "Depth map (the trend's stored map)", role: null, jobId: null, count: 1, quoteLine: "privacy" },
      { step: "new-thing", name: "new-thing", role: 4, jobId: null, count: 1, quoteLine: null },
    ])
  })

  it("a stored mask's retry is its own row: (retry), and privacyCredits when the quote records it", () => {
    const entries = [entry("face-mask", { attempt: "first" }), entry("face-mask", { attempt: "retry" })]
    expect(reusedOf(entries, { quote: withExtras }).map((r) => [r.name, r.quoteLine])).toEqual([
      ["Face mask (the trend's stored mask)", "privacy"],
      ["Face mask (the trend's stored mask) (retry)", "privacyCredits"],
    ])
    expect(reusedOf(entries, { quote: QUOTE })[1]?.quoteLine).toBe("privacy")
  })

  it("collapses every kept clip into one row with its count, where the first one was, on no line", () => {
    const rows = reusedOf(
      [
        entry("clip", { ref: "0123456789ab" }),
        entry("face-mask", { attempt: "first" }),
        entry("clip", { ref: "ba9876543210" }),
        entry("clip", { ref: "0123456789ab" }),
      ],
      { quote: QUOTE },
    )
    expect(rows).toEqual([
      { step: "clip", name: "Engine-ready clip (kept, local work)", role: null, jobId: null, count: 3, quoteLine: null },
      { step: "face-mask", name: "Face mask (the trend's stored mask)", role: null, jobId: null, count: 1, quoteLine: "privacy" },
    ])
  })

  it("a reused render keeps its job and goes to motionHd, or to motion when only that line exists", () => {
    const render = [entry("render", { jobId: RENDER_JOB })]
    expect(reusedOf(render, { quote: PRISM_FQ })).toEqual([
      { step: "render", name: "1080p render (an earlier try's)", role: null, jobId: RENDER_JOB, count: 1, quoteLine: "motionHd" },
    ])
    expect(reusedOf(render, { quote: PULSE_FQ })[0]?.quoteLine).toBe("motion")
  })

  it("without a recorded quote the entries are kept, each on no line", () => {
    const rows = reusedOf([entry("reference-sheet", { role: 0 }), entry("render", { jobId: RENDER_JOB }), entry("clip")], { quote: null })
    expect(rows.map((r) => [r.name, r.quoteLine])).toEqual([
      ["Reference sheet (kept)", null],
      ["1080p render (an earlier try's)", null],
      ["Engine-ready clip (kept, local work)", null],
    ])
  })

  it("a kept step whose line the run's quote does not carry is on no line", () => {
    const rows = reusedOf(
      [entry("vocals"), entry("face-mask", { attempt: "first" }), entry("depth"), entry("styled-picture", { role: 0 }), entry("render", { jobId: RENDER_JOB })],
      { quote: { ...PULSE_FQ, breakdown: { base: 40 } } },
    )
    expect(rows.map((r) => [r.step, r.quoteLine])).toEqual([["vocals", null], ["face-mask", null], ["depth", null], ["styled-picture", null], ["render", null]])
    expect(reusedOf([entry("face-mask", { attempt: "retry" })], { quote: { ...PULSE_FQ, privacyCredits: 50 } })[0]?.quoteLine).toBe("privacyCredits")
  })

  it("nothing reused is no rows", () => {
    expect(reusedOf([], { quote: QUOTE })).toEqual([])
  })
})
