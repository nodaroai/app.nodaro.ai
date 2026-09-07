/**
 * The `clips` section — what `add_clip_result` REFUSES.
 *
 * `buildTake` narrows a take by PRESENCE (`result.x ? { x } : {}`), never by
 * TYPE, so whatever the schema lets past is what lands in the document, rides
 * the CAS write and is serialized onto the canvas `generate-video` node. The
 * argument was once a `z.custom` checking only "an object with a string url",
 * and every field beside `url` rode through unvalidated. Three things followed,
 * each reproduced below through `applyOps` — the route's own entry point:
 *
 *  - a NON-`OpError` escaped a handler (`[...result.references]` on a
 *    `{ length: 1 }` threw a `TypeError`), which `apply.ts`'s header defines as
 *    a bug in this package: a 500 the caller retries instead of the 400 it
 *    deserves;
 *  - type garbage landed in the persisted document — a `duration: "5"` and a
 *    `provider: ["seedance"]` MIRRORED onto the clip level and onto the canvas
 *    node, where a reload narrowed the node's model away to `""`;
 *  - the landed take was unaddressable: `resultKey` returned the NUMBER `5`, so
 *    neither `set_active_clip` nor `remove_clip_result` could name it — the
 *    garbage could not even be removed.
 *
 * The sibling section is the contract witness throughout: `add_still_result`
 * has always stated its result field by field, and refuses each of these bodies
 * at parse. These cases pin that the two histories now answer alike.
 */
import { describe, expect, it } from "vitest"

import { applyOps } from "../apply"
import { isOpError } from "../errors"
import type { Production } from "../production"
import type { OpContext } from "../types"
import { parseProduction, serializeProduction } from "../../shot-graph"
import { clipResults } from "../../shot"
import type { Shot } from "../../shot"

const ctx: OpContext = { now: "2026-09-06T12:00:00.000Z", mintId: () => "id" }

const framed = (id: string): Shot => ({
  id,
  still: {
    nodeId: `generate-image-${id}`,
    url: `https://r2.example/${id}.png`,
    provider: "nano-banana",
    prompt: "p",
  },
})

const base = (): Production => ({ shots: [framed("a")] })

/** Apply one op and return the refusal's code — never a `TypeError`. */
const refusalCode = (op: unknown): string => {
  try {
    applyOps(base(), [op], ctx)
    return "APPLIED"
  } catch (error) {
    if (!isOpError(error)) throw error
    return error.code
  }
}

const addClip = (result: unknown) => ({
  op: "add_clip_result",
  shotId: "a",
  result,
})

const addStill = (result: unknown) => ({
  op: "add_still_result",
  shotId: "a",
  result,
})

describe("add_clip_result — the take's own shape", () => {
  it("refuses a non-iterable where a list belongs, instead of throwing a TypeError", () => {
    for (const field of ["references", "referenceImageUrls", "beats"]) {
      expect(
        refusalCode(addClip({ url: "https://r2/x.mp4", [field]: { length: 1 } })),
      ).toBe("op_invalid")
    }
  })

  it("refuses a mistyped field the same way its still sibling always has", () => {
    const garbage = {
      url: "https://r2/x.mp4",
      jobId: 5,
      duration: "5",
      provider: ["seedance-2"],
      beats: "abc",
      references: "xy",
      name: 42,
      promptFormat: "2",
      look: { camera: 7 },
      endTransition: "cut",
    }
    expect(refusalCode(addClip(garbage))).toBe("op_invalid")
    // The witness: the identical body has always been refused one history over.
    expect(refusalCode(addStill(garbage))).toBe("op_invalid")
  })

  it("refuses each mistyped scalar on its own", () => {
    const cases: ReadonlyArray<Record<string, unknown>> = [
      { jobId: 5 },
      { duration: "5" },
      { provider: ["seedance-2"] },
      { name: 42 },
      { promptFormat: "2" },
      { promptFormat: 3 },
      { prompt: 7 },
      { scenePrompt: [] },
      { startFrameUrl: 1 },
      { referenceVideoUrls: "xy" },
      { referenceAudioUrls: { 0: "a" } },
      { references: [{ id: "r" }] },
      { directions: "loud" },
      { directions: [{ kind: "nope", text: "hi" }] },
      { beats: [{ id: "b1", text: "x" }] },
      { endTransition: "cut" },
      { endTransition: { position: "start" } },
      { look: { camera: 7 } },
      { subject: { age: {} } },
    ]
    for (const patch of cases) {
      expect([JSON.stringify(patch), refusalCode(addClip({ url: "https://r2/x.mp4", ...patch }))]).toEqual([
        JSON.stringify(patch),
        "op_invalid",
      ])
    }
  })

  it("refuses a blank url — a take nothing in the batch could address", () => {
    // `resultKey` is `jobId ?? url`, so an empty url is a take with no name.
    expect(refusalCode(addClip({ url: "" }))).toBe("op_invalid")
  })

  it("still takes a fully-loaded, well-typed take, and lands every channel", () => {
    const result = {
      url: "https://r2/x.mp4",
      jobId: "job-A",
      name: "Crash in",
      prompt: "she turns",
      negativePrompt: "blurry",
      provider: "seedance-2",
      duration: 5,
      startFrameUrl: "https://r2/start.png",
      endFrameUrl: "https://r2/end.png",
      referenceImageUrls: ["https://r2/ref.png"],
      referenceVideoUrls: ["https://r2/ref.mp4"],
      referenceAudioUrls: ["https://r2/ref.mp3"],
      references: [
        {
          id: "c-kira",
          defaultName: "Kira",
          source: "wired-character",
          url: "https://r2/kira.png",
        },
      ],
      directions: [{ kind: "sfx", text: "a door slams" }],
      beats: [{ id: "b1", seconds: 3, text: "she turns" }],
      scenePrompt: "A rooftop at dusk.",
      endTransition: { id: "cross-dissolve", duration: "short" },
      freecutProjectUrl: "https://r2/project.json",
      aspectRatio: "16:9",
      resolution: "1080p",
      promptFormat: 2,
      look: { colorLookId: "warm" },
      filmLook: { colorLookId: "warm" },
      sceneLook: { cameraMotionId: "dolly-in" },
      subject: { customAge: 34 },
      revoicedVoiceId: "voice-1",
      revoicedVoiceName: "Nova",
    }
    const { production } = applyOps(base(), [addClip(result)], ctx)
    const clip = production.shots[0]!.clip!
    expect(clip.revoicedVoiceId).toBe("voice-1")
    expect(clip.revoicedVoiceName).toBe("Nova")
    const take = clip.results![0]!
    for (const [key, value] of Object.entries(result)) {
      if (key === "revoicedVoiceId" || key === "revoicedVoiceName") continue
      expect([key, take[key as keyof typeof take]]).toEqual([key, value])
    }
    // …and it survives the save the CAS write performs, unchanged.
    const wire = serializeProduction(production.shots, production.selectedShotId)
    const reloaded = parseProduction({ id: "wf", name: "wf", ...wire })
    expect(reloaded.shots[0]!.clip!.results![0]).toEqual(take)
  })

  it("an empty list is still an empty list, not a refusal", () => {
    // `readBeats` / `readVoiceDirections` report emptiness as `undefined`; the
    // schema lets the empty array through and `buildTake`'s omit-when-empty
    // says what it means.
    const { production } = applyOps(
      base(),
      [addClip({ url: "https://r2/x.mp4", beats: [], directions: [], references: [] })],
      ctx,
    )
    // A take carrying nothing `buildClip`'s keep-predicate names collapses to
    // the minimal legacy shape, so read it back the way every consumer does.
    const take = clipResults(production.shots[0]!.clip!)[0]!
    expect(take.beats).toBeUndefined()
    expect(take.directions).toBeUndefined()
    expect(take.references).toBeUndefined()
  })

  it("the refusal names the op that carried it, and applies nothing", () => {
    const before = base()
    try {
      applyOps(
        before,
        [
          { op: "rename_shot", id: "a", name: "Ledge" },
          addClip({ url: "https://r2/x.mp4", jobId: 5 }),
        ],
        ctx,
      )
      expect.unreachable()
    } catch (error) {
      if (!isOpError(error)) throw error
      expect(error.opIndex).toBe(1)
    }
    expect(before.shots[0]!.name).toBeUndefined()
  })
})

describe("add_clip_result — the receipt's prose", () => {
  it("reads a whitespace-only shot name as no name at all", () => {
    const { receipts } = applyOps(
      { shots: [{ ...framed("a"), name: "   " }] },
      [addClip({ url: "https://r2/x.mp4" })],
      ctx,
    )
    expect(receipts[0]!.summary).toBe("Added take 1 to Shot 1.")
  })
})
